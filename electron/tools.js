// 工具注册表：一套「最强编码 agent」工具，两个模型供应商共用同一执行器。
// 风险分三级：safe（永远放行）/ moderate（默认放行，可改为每次确认）/ dangerous（默认弹窗，可切全自动）。
const { execFile, spawn } = require('child_process');
const { desktopCapturer, screen } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

// 浏览器自动化（延迟加载，避免启动开销）
let puppeteer = null;
function getPuppeteer() {
  if (!puppeteer) puppeteer = require('puppeteer-core');
  return puppeteer;
}
const browsers = new Map(); // id -> { browser, page }
let browserSeq = 0;

// ---------- 路径 ----------
// 把 ~ 展开；相对路径基于工作区（ctx.workspace）或当前目录
function resolvePath(p, ctx) {
  const base = (ctx && ctx.workspace) || process.cwd();
  if (!p) return base;
  let out = p;
  if (out === '~' || out.startsWith('~/')) {
    out = path.join(os.homedir(), out.slice(1));
  }
  if (!path.isAbsolute(out)) out = path.join(base, out);
  return path.resolve(out);
}

// 判断某绝对路径是否在工作区内（用于危险判定）
function insideWorkspace(abs, ctx) {
  const ws = (ctx && ctx.workspace) || os.homedir();
  const rel = path.relative(path.resolve(ws), abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const MAX_OUTPUT = 60000; // 工具输出上限，超出转存文件按需读取
function clip(text) {
  if (typeof text !== 'string') text = String(text);
  if (text.length > MAX_OUTPUT) {
    return (
      text.slice(0, MAX_OUTPUT) +
      `\n…（输出过长，已截断，共 ${text.length} 字；可用 read_file 分段读取相关文件）`
    );
  }
  return text;
}

const IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'build', '.next', '.cache', 'Pods']);

// ---------- 危险命令判定 ----------
// 命中任一模式即视为 dangerous（不可逆 / 高破坏 / 提权）
const DANGER_PATTERNS = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f|\brm\s+(-[a-z]*\s+)*-[a-z]*f[a-z]*r/i, // rm -rf / -fr
  /\brm\s+-[a-z]*r/i, // rm -r（递归删除）
  /\bsudo\b/i,
  /\bmkfs\b|\bdd\s+if=|\bdd\s+of=/i,
  /:\(\)\s*\{.*\};?:/, // fork bomb
  />\s*\/dev\/(sd|hd|disk|nvme)/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bchmod\s+-R\s+000|\bchown\s+-R\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force|push\s+.*-f\b)/i,
  /\bkillall\b|\bpkill\s+-9\b/i,
  /\bdiskutil\s+(erase|partition|reformat)/i,
  /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, // 管道执行远程脚本
  /\bnpm\s+publish\b|\byarn\s+publish\b/i,
  /\bformat\b\s+[a-z]:/i, // windows format
];

function commandRisk(command) {
  if (!command) return 'moderate';
  for (const re of DANGER_PATTERNS) if (re.test(command)) return 'dangerous';
  // 纯只读命令归 safe，减少打扰
  const readOnly = /^(\s*(cat|ls|pwd|echo|grep|rg|find|head|tail|wc|which|type|git\s+(status|log|diff|show|branch|remote)|node\s+--version|npm\s+(ls|list|--version|view)|python\d?\s+--version|env|whoami|date|uname|df|du|ps)\b)/i;
  if (readOnly.test(command.trim())) return 'safe';
  return 'moderate';
}

// 判定一个工具调用的风险级别
function classifyRisk(name, input, ctx) {
  input = input || {};
  switch (name) {
    case 'read_file':
    case 'list_directory':
    case 'glob_search':
    case 'grep_search':
    case 'take_screenshot':
    case 'read_output':
    case 'browser_screenshot':
    case 'get_browser_content':
    case 'stop_recording':
      return 'safe';
    case 'launch_browser':
    case 'navigate':
    case 'browser_click':
    case 'browser_type':
    case 'browser_eval':
    case 'close_browser':
    case 'start_recording':
    case 'kill_job':
      return 'moderate';
    case 'write_file':
    case 'edit_file':
    case 'multi_edit': {
      const abs = resolvePath(input.path, ctx);
      return insideWorkspace(abs, ctx) ? 'moderate' : 'dangerous';
    }
    case 'run_command':
      return commandRisk(input.command);
    default:
      return 'moderate';
  }
}

// ---------- 工具定义 ----------
const TOOLS = [
  {
    name: 'run_command',
    description:
      '在 shell 里执行命令，返回 stdout/stderr。用于 git、装依赖、跑测试/构建、脚本等。设 background=true 可后台跑长命令（返回 job id，再用 read_output/kill_job）。',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '完整命令' },
        cwd: { type: 'string', description: '工作目录，默认工作区；支持相对/绝对/~' },
        background: { type: 'boolean', description: '是否后台运行（长任务如 dev server）' },
        timeout_ms: { type: 'number', description: '前台命令超时毫秒，默认取配置' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: '读取文本文件，返回带行号内容。可用 offset/limit 读大文件的某段。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        offset: { type: 'number', description: '起始行（1 开始），可选' },
        limit: { type: 'number', description: '读取行数，可选' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '写入/覆盖整个文件（自动建父目录）。改动已存在文件优先用 edit_file。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      '精确编辑：把文件中的 old_string 替换成 new_string。old_string 必须在文件中唯一出现（否则报错），要带足够上下文保证唯一。这是修改代码的首选方式。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: '要被替换的原文（需唯一）' },
        new_string: { type: 'string', description: '替换后的新文本' },
        replace_all: { type: 'boolean', description: '替换全部匹配（默认 false，要求唯一）' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'multi_edit',
    description: '对同一文件顺序应用多处精确替换，原子生效（任一失败则全不改）。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: {
          type: 'array',
          description: '编辑列表，按顺序应用',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
              replace_all: { type: 'boolean' },
            },
            required: ['old_string', 'new_string'],
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  {
    name: 'list_directory',
    description: '列目录。recursive=true 递归（自动忽略 node_modules/.git 等）。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录，默认工作区' },
        recursive: { type: 'boolean' },
      },
    },
  },
  {
    name: 'glob_search',
    description: '按 glob 模式查找文件，如 **/*.js、src/**/*.ts。返回匹配的文件路径列表。',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式' },
        path: { type: 'string', description: '搜索根目录，默认工作区' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_search',
    description: '在文件内容里正则搜索，返回 file:line: 匹配行。用于在代码库里定位符号/字符串。',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式' },
        path: { type: 'string', description: '搜索根目录，默认工作区' },
        glob: { type: 'string', description: '限定文件 glob，如 *.js，可选' },
        ignore_case: { type: 'boolean' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'read_output',
    description: '读取某个后台命令 job 的最新输出。',
    input_schema: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
    },
  },
  {
    name: 'kill_job',
    description: '终止一个后台命令 job。',
    input_schema: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
    },
  },
  {
    name: 'take_screenshot',
    description: '截取当前屏幕，返回图片供你查看用户屏幕上的内容。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'launch_browser',
    description: '启动一个浏览器实例（无头或有头模式），返回 browser_id 供后续操作。用于浏览网页、自动化答题、UI 测试等。',
    input_schema: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', description: '是否无头模式，默认 false（显示浏览器窗口）' },
        viewport_width: { type: 'number', description: '视口宽度，默认 1280' },
        viewport_height: { type: 'number', description: '视口高度，默认 720' },
      },
    },
  },
  {
    name: 'navigate',
    description: '让浏览器导航到指定 URL。',
    input_schema: {
      type: 'object',
      properties: {
        browser_id: { type: 'string', description: '浏览器 ID' },
        url: { type: 'string', description: '目标 URL' },
        wait_until: { type: 'string', description: 'load / domcontentloaded / networkidle0 / networkidle2，默认 load' },
      },
      required: ['browser_id', 'url'],
    },
  },
  {
    name: 'browser_click',
    description: '在浏览器页面上点击指定选择器（CSS selector）的元素。',
    input_schema: {
      type: 'object',
      properties: {
        browser_id: { type: 'string' },
        selector: { type: 'string', description: 'CSS 选择器' },
      },
      required: ['browser_id', 'selector'],
    },
  },
  {
    name: 'browser_type',
    description: '在浏览器页面的输入框里输入文字（会先清空原有内容）。',
    input_schema: {
      type: 'object',
      properties: {
        browser_id: { type: 'string' },
        selector: { type: 'string', description: '输入框的 CSS 选择器' },
        text: { type: 'string', description: '要输入的文本' },
      },
      required: ['browser_id', 'selector', 'text'],
    },
  },
  {
    name: 'browser_eval',
    description: '在浏览器页面里执行 JavaScript 代码并返回结果（用于复杂交互、提取数据等）。',
    input_schema: {
      type: 'object',
      properties: {
        browser_id: { type: 'string' },
        code: { type: 'string', description: 'JavaScript 代码' },
      },
      required: ['browser_id', 'code'],
    },
  },
  {
    name: 'browser_screenshot',
    description: '截取浏览器当前页面的截图，返回图片供你查看。',
    input_schema: {
      type: 'object',
      properties: {
        browser_id: { type: 'string' },
        full_page: { type: 'boolean', description: '是否截取整页（滚动），默认 false' },
      },
      required: ['browser_id'],
    },
  },
  {
    name: 'get_browser_content',
    description: '获取浏览器当前页面的 HTML 内容或纯文本（用于分析页面结构、提取信息）。',
    input_schema: {
      type: 'object',
      properties: {
        browser_id: { type: 'string' },
        format: { type: 'string', description: 'html / text，默认 text' },
      },
      required: ['browser_id'],
    },
  },
  {
    name: 'close_browser',
    description: '关闭浏览器实例，释放资源。',
    input_schema: {
      type: 'object',
      properties: {
        browser_id: { type: 'string' },
      },
      required: ['browser_id'],
    },
  },
  {
    name: 'start_recording',
    description: '开始录制屏幕（包括浏览器操作），返回 recording_id。录制会持续到调用 stop_recording 为止。',
    input_schema: {
      type: 'object',
      properties: {
        fps: { type: 'number', description: '帧率，默认 30' },
      },
    },
  },
  {
    name: 'stop_recording',
    description: '停止录制并保存视频文件，返回保存路径。',
    input_schema: {
      type: 'object',
      properties: {
        recording_id: { type: 'string' },
        filename: { type: 'string', description: '文件名（不含路径），可选，默认时间戳' },
      },
      required: ['recording_id'],
    },
  },
];

// ---------- 后台 job ----------
const jobs = new Map(); // id -> { proc, output, done, code }
let jobSeq = 0;

function startBackground(command, cwd, ctx) {
  const id = `job-${++jobSeq}`;
  const shell = process.platform === 'win32' ? 'cmd' : '/bin/bash';
  const args = process.platform === 'win32' ? ['/c', command] : ['-lc', command];
  const proc = spawn(shell, args, { cwd: resolvePath(cwd, ctx), detached: false });
  const rec = { proc, output: '', done: false, code: null };
  jobs.set(id, rec);
  const append = (d) => {
    rec.output += d.toString();
    if (rec.output.length > MAX_OUTPUT * 2) rec.output = rec.output.slice(-MAX_OUTPUT * 2);
  };
  proc.stdout.on('data', append);
  proc.stderr.on('data', append);
  proc.on('close', (code) => {
    rec.done = true;
    rec.code = code;
  });
  proc.on('error', (e) => {
    rec.output += `\n[启动失败] ${e.message}`;
    rec.done = true;
    rec.code = -1;
  });
  return { text: `已在后台启动，job_id=${id}。稍后用 read_output 查看输出、kill_job 终止。`, jobId: id };
}

// ---------- 前台命令 ----------
function runCommand(command, cwd, ctx, timeoutMs) {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd' : '/bin/bash';
    const args = process.platform === 'win32' ? ['/c', command] : ['-lc', command];
    execFile(
      shell,
      args,
      { cwd: resolvePath(cwd, ctx), timeout: timeoutMs || 300000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        let out = '';
        if (stdout) out += stdout;
        if (stderr) out += (out ? '\n' : '') + stderr;
        if (err && err.killed) out += '\n（命令超时被终止，可用 background=true 跑长任务）';
        if (err && typeof err.code === 'number') out += `\n[exit code ${err.code}]`;
        resolve({ text: clip(out || '（无输出）'), isError: !!(err && err.code) });
      }
    );
  });
}

// ---------- 文件读写 / 编辑 ----------
function withLineNumbers(text, startLine) {
  const lines = text.split('\n');
  const width = String(startLine + lines.length).length;
  return lines
    .map((l, i) => String(startLine + i).padStart(width, ' ') + '  ' + l)
    .join('\n');
}

async function readFileTool(input, ctx) {
  const abs = resolvePath(input.path, ctx);
  let data = await fsp.readFile(abs, 'utf8');
  let start = 1;
  if (input.offset || input.limit) {
    const lines = data.split('\n');
    start = Math.max(1, input.offset || 1);
    const end = input.limit ? start - 1 + input.limit : lines.length;
    data = lines.slice(start - 1, end).join('\n');
  }
  return { text: clip(withLineNumbers(data, start)) };
}

async function writeFileTool(input, ctx) {
  const abs = resolvePath(input.path, ctx);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, input.content ?? '', 'utf8');
  return { text: `已写入 ${abs}（${(input.content || '').length} 字）` };
}

function applyEdit(content, oldStr, newStr, replaceAll) {
  if (oldStr === '') throw new Error('old_string 不能为空');
  const count = content.split(oldStr).length - 1;
  if (count === 0) throw new Error('未找到 old_string，无法替换（检查是否完全一致）');
  if (count > 1 && !replaceAll) {
    throw new Error(`old_string 匹配到 ${count} 处，不唯一。请加更多上下文，或设 replace_all=true`);
  }
  if (replaceAll) return content.split(oldStr).join(newStr);
  return content.replace(oldStr, newStr);
}

async function editFileTool(input, ctx) {
  const abs = resolvePath(input.path, ctx);
  const content = await fsp.readFile(abs, 'utf8');
  const next = applyEdit(content, input.old_string, input.new_string, input.replace_all);
  await fsp.writeFile(abs, next, 'utf8');
  return { text: `已编辑 ${abs}` };
}

async function multiEditTool(input, ctx) {
  const abs = resolvePath(input.path, ctx);
  let content = await fsp.readFile(abs, 'utf8');
  const edits = input.edits || [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    try {
      content = applyEdit(content, e.old_string, e.new_string, e.replace_all);
    } catch (err) {
      throw new Error(`第 ${i + 1} 处编辑失败：${err.message}（已回滚，文件未改动）`);
    }
  }
  await fsp.writeFile(abs, content, 'utf8');
  return { text: `已对 ${abs} 应用 ${edits.length} 处编辑` };
}

// ---------- 列目录 / glob / grep（Node 递归实现，零依赖）----------
async function walk(dir, onFile, maxEntries) {
  const stack = [dir];
  let count = 0;
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.') && ent.name !== '.') {
        if (IGNORE_DIRS.has(ent.name)) continue;
      }
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name)) continue;
        stack.push(full);
      } else {
        onFile(full);
        if (++count >= (maxEntries || 5000)) return;
      }
    }
  }
}

async function listDirectory(input, ctx) {
  const abs = resolvePath(input.path, ctx);
  if (!input.recursive) {
    const items = await fsp.readdir(abs, { withFileTypes: true });
    const lines = items
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => (d.isDirectory() ? d.name + '/' : d.name));
    return { text: clip(`${abs}\n` + (lines.join('\n') || '（空目录）')) };
  }
  const found = [];
  await walk(abs, (f) => found.push(path.relative(abs, f)), 3000);
  return { text: clip(`${abs}（递归，忽略 node_modules/.git 等）\n` + found.sort().join('\n')) };
}

// 简易 glob → 正则（支持 ** / * / ?）
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else if (c === '/') re += '/';
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

async function globSearch(input, ctx) {
  const root = resolvePath(input.path, ctx);
  const re = globToRegExp(input.pattern);
  const found = [];
  await walk(root, (f) => {
    const rel = path.relative(root, f);
    if (re.test(rel) || re.test(f)) found.push(rel);
  }, 5000);
  return {
    text: clip(found.length ? found.sort().join('\n') : '（无匹配文件）'),
  };
}

async function grepSearch(input, ctx) {
  const root = resolvePath(input.path, ctx);
  let re;
  try {
    re = new RegExp(input.pattern, input.ignore_case ? 'i' : '');
  } catch (e) {
    return { text: `正则无效：${e.message}`, isError: true };
  }
  const fileRe = input.glob ? globToRegExp(input.glob) : null;
  const results = [];
  const files = [];
  await walk(root, (f) => {
    const rel = path.relative(root, f);
    if (!fileRe || fileRe.test(path.basename(f)) || fileRe.test(rel)) files.push(f);
  }, 8000);
  for (const f of files) {
    if (results.length > 300) break;
    let content;
    try {
      content = await fsp.readFile(f, 'utf8');
    } catch {
      continue; // 二进制/无权限跳过
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        results.push(`${path.relative(root, f)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (results.length > 300) break;
      }
    }
  }
  return {
    text: clip(results.length ? results.join('\n') : '（无匹配）') +
      (results.length > 300 ? '\n…（结果过多，已截断）' : ''),
  };
}

async function takeScreenshot() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  const sf = primary.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) },
  });
  const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
  if (!src) return { text: '截图失败：找不到屏幕源', isError: true };
  const png = src.thumbnail.toPNG();
  return {
    text: '已截取当前屏幕。',
    image: { mediaType: 'image/png', data: png.toString('base64') },
  };
}

// ---------- 浏览器自动化 ----------
async function findChromePath() {
  const paths = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Chromium.app/Contents/MacOS/Chromium',
       '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  for (const p of paths) {
    try {
      await fsp.access(p);
      return p;
    } catch {}
  }
  throw new Error('未找到 Chrome/Chromium/Edge 浏览器，请先安装');
}

async function launchBrowser(input) {
  const pptr = getPuppeteer();
  const executablePath = await findChromePath();
  const browser = await pptr.launch({
    executablePath,
    headless: input.headless !== false ? false : false, // 默认显示窗口
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: input.viewport_width || 1280,
    height: input.viewport_height || 720,
  });
  const id = `browser-${++browserSeq}`;
  browsers.set(id, { browser, page });
  return { text: `已启动浏览器，browser_id=${id}`, browserId: id };
}

async function navigate(input) {
  const rec = browsers.get(input.browser_id);
  if (!rec) return { text: `浏览器 ${input.browser_id} 不存在`, isError: true };
  const waitUntil = input.wait_until || 'load';
  await rec.page.goto(input.url, { waitUntil });
  const title = await rec.page.title();
  return { text: `已导航到 ${input.url}\n标题：${title}` };
}

async function browserClick(input) {
  const rec = browsers.get(input.browser_id);
  if (!rec) return { text: `浏览器 ${input.browser_id} 不存在`, isError: true };
  await rec.page.waitForSelector(input.selector, { timeout: 10000 });
  await rec.page.click(input.selector);
  return { text: `已点击 ${input.selector}` };
}

async function browserType(input) {
  const rec = browsers.get(input.browser_id);
  if (!rec) return { text: `浏览器 ${input.browser_id} 不存在`, isError: true };
  await rec.page.waitForSelector(input.selector, { timeout: 10000 });
  await rec.page.click(input.selector, { clickCount: 3 }); // 全选
  await rec.page.type(input.selector, input.text);
  return { text: `已在 ${input.selector} 输入文字` };
}

async function browserEval(input) {
  const rec = browsers.get(input.browser_id);
  if (!rec) return { text: `浏览器 ${input.browser_id} 不存在`, isError: true };
  const result = await rec.page.evaluate(input.code);
  return { text: clip(JSON.stringify(result, null, 2)) };
}

async function browserScreenshot(input) {
  const rec = browsers.get(input.browser_id);
  if (!rec) return { text: `浏览器 ${input.browser_id} 不存在`, isError: true };
  const png = await rec.page.screenshot({ fullPage: !!input.full_page });
  return {
    text: '已截取浏览器页面。',
    image: { mediaType: 'image/png', data: png.toString('base64') },
  };
}

async function getBrowserContent(input) {
  const rec = browsers.get(input.browser_id);
  if (!rec) return { text: `浏览器 ${input.browser_id} 不存在`, isError: true };
  const format = input.format || 'text';
  const content = format === 'html'
    ? await rec.page.content()
    : await rec.page.evaluate(() => document.body.innerText);
  return { text: clip(content) };
}

async function closeBrowser(input) {
  const rec = browsers.get(input.browser_id);
  if (!rec) return { text: `浏览器 ${input.browser_id} 不存在`, isError: true };
  await rec.browser.close();
  browsers.delete(input.browser_id);
  return { text: `已关闭浏览器 ${input.browser_id}` };
}

// ---------- 录屏 ----------
const recordings = new Map(); // id -> { chunks, stopped, resolve }
let recordingSeq = 0;

async function startRecording(input, ctx) {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  const sf = primary.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) },
  });
  const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
  if (!src) return { text: '录屏失败：找不到屏幕源', isError: true };

  const id = `rec-${++recordingSeq}`;
  const rec = { chunks: [], stopped: false, resolve: null };
  recordings.set(id, rec);

  // 录屏需要在渲染进程里通过 MediaRecorder，这里返回 stream source id 给前端
  // 但 Electron 主进程无法直接用 MediaRecorder，所以我们采用简化方案：
  // 用定时截屏拼成视频（或者通过 IPC 让渲染进程录制）
  // 为了简单，这里采用"每秒截屏 N 次并保存帧"的方式，stop 时用 ffmpeg 拼接
  // 如果系统没 ffmpeg 就提示用户安装

  const fps = input.fps || 30;
  const interval = 1000 / fps;
  let frameCount = 0;
  const tmpDir = path.join(os.tmpdir(), `afa-rec-${id}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const timer = setInterval(async () => {
    if (rec.stopped) {
      clearInterval(timer);
      if (rec.resolve) rec.resolve();
      return;
    }
    try {
      const sources2 = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) },
      });
      const src2 = sources2.find((s) => String(s.display_id) === String(primary.id)) || sources2[0];
      if (src2) {
        const png = src2.thumbnail.toPNG();
        const framePath = path.join(tmpDir, `frame-${String(frameCount).padStart(6, '0')}.png`);
        await fsp.writeFile(framePath, png);
        frameCount++;
      }
    } catch (err) {
      console.error('录屏帧捕获失败:', err);
    }
  }, interval);

  rec.timer = timer;
  rec.tmpDir = tmpDir;
  rec.fps = fps;
  rec.frameCount = () => frameCount;

  return { text: `已开始录制屏幕（${fps} fps），recording_id=${id}。调用 stop_recording 停止并保存。`, recordingId: id };
}

async function stopRecording(input, ctx) {
  const rec = recordings.get(input.recording_id);
  if (!rec) return { text: `录制 ${input.recording_id} 不存在`, isError: true };
  if (rec.stopped) return { text: '该录制已停止', isError: true };

  rec.stopped = true;
  clearInterval(rec.timer);

  // 等待最后一帧写完
  await new Promise((r) => setTimeout(r, 200));

  const recordingsDir = (ctx && ctx.recordingsDir) || path.join(os.homedir(), 'Desktop');
  await fsp.mkdir(recordingsDir, { recursive: true });

  const filename = input.filename || `recording-${Date.now()}.mp4`;
  const outPath = path.join(recordingsDir, filename);

  // 用 ffmpeg 把帧拼成视频（需要系统装了 ffmpeg）
  const ffmpegCmd = `ffmpeg -y -framerate ${rec.fps} -i "${rec.tmpDir}/frame-%06d.png" -c:v libx264 -pix_fmt yuv420p "${outPath}"`;

  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd' : '/bin/bash';
    const args = process.platform === 'win32' ? ['/c', ffmpegCmd] : ['-lc', ffmpegCmd];
    execFile(shell, args, { timeout: 300000 }, async (err, stdout, stderr) => {
      // 清理临时帧
      try {
        await fsp.rm(rec.tmpDir, { recursive: true, force: true });
      } catch {}
      recordings.delete(input.recording_id);

      if (err) {
        if (err.message.includes('ffmpeg')) {
          resolve({ text: '录制已停止，但系统未安装 ffmpeg，无法生成视频。请先安装 ffmpeg（Mac: brew install ffmpeg）。', isError: true });
        } else {
          resolve({ text: `录制失败：${err.message}`, isError: true });
        }
      } else {
        resolve({ text: `录制已保存到 ${outPath}（共 ${rec.frameCount()} 帧）` });
      }
    });
  });
}

// ---------- 执行入口 ----------
// ctx: { requestPermission(name,input,risk)->Promise<bool>, workspace,
//        autoApproveModerate, autoApproveDangerous, trustAll(): bool }
async function executeTool(name, input, ctx) {
  input = input || {};
  try {
    const risk = classifyRisk(name, input, ctx);
    if (!isAutoApproved(risk, ctx)) {
      const ok = await ctx.requestPermission(name, input, risk);
      if (!ok) return { text: '用户拒绝了这个操作。', isError: true };
    }

    switch (name) {
      case 'run_command':
        if (input.background) return startBackground(input.command, input.cwd, ctx);
        return await runCommand(input.command, input.cwd, ctx, input.timeout_ms);
      case 'read_file':
        return await readFileTool(input, ctx);
      case 'write_file':
        return await writeFileTool(input, ctx);
      case 'edit_file':
        return await editFileTool(input, ctx);
      case 'multi_edit':
        return await multiEditTool(input, ctx);
      case 'list_directory':
        return await listDirectory(input, ctx);
      case 'glob_search':
        return await globSearch(input, ctx);
      case 'grep_search':
        return await grepSearch(input, ctx);
      case 'read_output': {
        const rec = jobs.get(input.job_id);
        if (!rec) return { text: `没有这个 job：${input.job_id}`, isError: true };
        const status = rec.done ? `已结束 [exit ${rec.code}]` : '运行中';
        return { text: clip(`[${status}]\n` + (rec.output || '（暂无输出）')) };
      }
      case 'kill_job': {
        const rec = jobs.get(input.job_id);
        if (!rec) return { text: `没有这个 job：${input.job_id}`, isError: true };
        try { rec.proc.kill('SIGTERM'); } catch {}
        return { text: `已终止 ${input.job_id}` };
      }
      case 'take_screenshot':
        return await takeScreenshot();
      case 'launch_browser':
        return await launchBrowser(input);
      case 'navigate':
        return await navigate(input);
      case 'browser_click':
        return await browserClick(input);
      case 'browser_type':
        return await browserType(input);
      case 'browser_eval':
        return await browserEval(input);
      case 'browser_screenshot':
        return await browserScreenshot(input);
      case 'get_browser_content':
        return await getBrowserContent(input);
      case 'close_browser':
        return await closeBrowser(input);
      case 'start_recording':
        return await startRecording(input, ctx);
      case 'stop_recording':
        return await stopRecording(input, ctx);
      default:
        return { text: `未知工具：${name}`, isError: true };
    }
  } catch (err) {
    return { text: `工具执行出错：${err.message}`, isError: true };
  }
}

function isAutoApproved(risk, ctx) {
  if (ctx && typeof ctx.trustAll === 'function' && ctx.trustAll()) return true;
  if (risk === 'safe') return true;
  if (risk === 'moderate') return !!(ctx && ctx.autoApproveModerate);
  if (risk === 'dangerous') return !!(ctx && ctx.autoApproveDangerous);
  return false;
}

// ---------- UI 摘要 ----------
function summarizeToolInput(name, input) {
  input = input || {};
  switch (name) {
    case 'run_command':
      return (input.background ? '[后台] ' : '') + (input.command || '');
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'multi_edit':
    case 'list_directory':
      return input.path || '';
    case 'glob_search':
      return input.pattern || '';
    case 'grep_search':
      return input.pattern + (input.glob ? `  (${input.glob})` : '');
    case 'read_output':
    case 'kill_job':
      return input.job_id || '';
    case 'take_screenshot':
      return '截屏';
    case 'launch_browser':
      return (input.headless ? '无头' : '有头') + '模式';
    case 'navigate':
      return input.url || '';
    case 'browser_click':
      return input.selector || '';
    case 'browser_type':
      return `${input.selector}: ${(input.text || '').slice(0, 30)}`;
    case 'browser_eval':
      return (input.code || '').slice(0, 50);
    case 'browser_screenshot':
      return input.full_page ? '全页截图' : '视口截图';
    case 'get_browser_content':
      return input.format || 'text';
    case 'close_browser':
      return input.browser_id || '';
    case 'start_recording':
      return `${input.fps || 30} fps`;
    case 'stop_recording':
      return input.filename || '默认文件名';
    default:
      return JSON.stringify(input);
  }
}

module.exports = { TOOLS, executeTool, summarizeToolInput, classifyRisk };
