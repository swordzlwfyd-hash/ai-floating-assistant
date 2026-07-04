// ===== Markdown 渲染器 =====
const md = window.markdownit({
  html: false,
  linkify: true,
  breaks: true,
  highlight(str, lang) {
    if (lang && window.hljs && window.hljs.getLanguage(lang)) {
      try {
        return window.hljs.highlight(str, { language: lang }).value;
      } catch {}
    }
    return '';
  },
});

// ===== 元素引用 =====
const ball = document.getElementById('ball');
const panel = document.getElementById('panel');
const newChatBtn = document.getElementById('newChatBtn');
const collapseBtn = document.getElementById('collapseBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settings = document.getElementById('settings');
const saveSettings = document.getElementById('saveSettings');
const messagesEl = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');

const providerSel = document.getElementById('provider');
const anthropicFields = document.getElementById('anthropicFields');
const openaiFields = document.getElementById('openaiFields');
const deepseekFields = document.getElementById('deepseekFields');
const geminiFields = document.getElementById('geminiFields');
const kimiFields = document.getElementById('kimiFields');
const doubaoFields = document.getElementById('doubaoFields');
const anthropicModel = document.getElementById('anthropicModel');
const anthropicEffort = document.getElementById('anthropicEffort');
const anthropicKey = document.getElementById('anthropicKey');
const openaiBase = document.getElementById('openaiBase');
const openaiModel = document.getElementById('openaiModel');
const openaiKey = document.getElementById('openaiKey');
const deepseekModel = document.getElementById('deepseekModel');
const deepseekKey = document.getElementById('deepseekKey');
const geminiModel = document.getElementById('geminiModel');
const geminiKey = document.getElementById('geminiKey');
const kimiModel = document.getElementById('kimiModel');
const kimiKey = document.getElementById('kimiKey');
const doubaoModel = document.getElementById('doubaoModel');
const doubaoKey = document.getElementById('doubaoKey');
const workspace = document.getElementById('workspace');
const recordingsDir = document.getElementById('recordingsDir');
const maxTurns = document.getElementById('maxTurns');
const commandTimeout = document.getElementById('commandTimeout');
const enableTools = document.getElementById('enableTools');
const autoApproveModerate = document.getElementById('autoApproveModerate');
const autoApproveDangerous = document.getElementById('autoApproveDangerous');
const skillsList = document.getElementById('skillsList');
const skillsDir = document.getElementById('skillsDir');
const openSkillsDir = document.getElementById('openSkillsDir');

let config = null;
let busy = false;

// ===== Skill 管理 =====
async function loadSkills() {
  try {
    const skills = await window.api.listSkills();
    const dir = await window.api.getSkillsDir();
    skillsDir.textContent = dir;

    if (skills.length === 0) {
      skillsList.innerHTML = '<span style="color:var(--soft);font-size:12px">暂无 Skill，把 .js 文件放到上方目录即可安装</span>';
      return;
    }

    skillsList.innerHTML = skills.map((s) => `
      <div class="skill-item ${s.enabled ? '' : 'disabled'}">
        <div class="skill-info">
          <span class="skill-name">${s.name}</span>
          <span class="skill-desc">${s.description}</span>
          <span class="skill-meta">v${s.version} · ${s.author} · ${s.toolCount} 个工具</span>
        </div>
        <label class="skill-toggle">
          <input type="checkbox" ${s.enabled ? 'checked' : ''} data-skill="${s.id}">
          <span>${s.enabled ? '已启用' : '已禁用'}</span>
        </label>
      </div>
    `).join('');

    // 绑定开关事件
    skillsList.querySelectorAll('input[data-skill]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const skillId = cb.dataset.skill;
        const enabled = cb.checked;
        await window.api.toggleSkill(skillId, enabled);
        loadSkills(); // 刷新列表
        systemNote(`${enabled ? '✅' : '⛔'} Skill 已${enabled ? '启用' : '禁用'}，下次发送消息时生效`);
      });
    });
  } catch (err) {
    skillsList.innerHTML = '<span style="color:#f56565;font-size:12px">加载 Skill 失败</span>';
  }
}

openSkillsDir.addEventListener('click', async () => {
  const dir = await window.api.getSkillsDir();
  window.api.runCommand(`open "${dir}"`, {}); // 在 Finder 中打开
});

// 在设置面板打开时加载 skill 列表
settingsBtn.addEventListener('click', () => {
  settings.classList.toggle('hidden');
  if (!settings.classList.contains('hidden')) loadSkills();
});


// ===== 面板展开 / 收起 =====
let dragMoved = false;
function openPanel() {
  window.api.expand();
  ball.classList.add('hidden');
  panel.classList.remove('hidden');
  input.focus();
}
function collapsePanel() {
  window.api.collapse();
  panel.classList.add('hidden');
  ball.classList.remove('hidden');
}
ball.addEventListener('click', () => { if (!dragMoved) openPanel(); });
collapseBtn.addEventListener('click', collapsePanel);
window.api.onExpanded((v) => {
  if (v) { ball.classList.add('hidden'); panel.classList.remove('hidden'); input.focus(); }
});

// ===== 设置 =====
settingsBtn.addEventListener('click', () => settings.classList.toggle('hidden'));
providerSel.addEventListener('change', syncProviderFields);
function syncProviderFields() {
  const p = providerSel.value;
  anthropicFields.classList.toggle('hidden', p !== 'anthropic');
  openaiFields.classList.toggle('hidden', p !== 'openai');
  deepseekFields.classList.toggle('hidden', p !== 'deepseek');
  geminiFields.classList.toggle('hidden', p !== 'gemini');
  kimiFields.classList.toggle('hidden', p !== 'kimi');
  doubaoFields.classList.toggle('hidden', p !== 'doubao');
}

async function loadConfigUI() {
  config = await window.api.getConfig();
  providerSel.value = config.provider;
  anthropicModel.value = config.anthropic.model;
  anthropicEffort.value = config.anthropic.effort;
  anthropicKey.value = config.anthropic.apiKey || '';
  openaiBase.value = config.openai.baseUrl || '';
  openaiModel.value = config.openai.model || '';
  openaiKey.value = config.openai.apiKey || '';
  deepseekModel.value = config.deepseek?.model || 'deepseek-chat';
  deepseekKey.value = config.deepseek?.apiKey || '';
  geminiModel.value = config.gemini?.model || 'gemini-2.0-flash-exp';
  geminiKey.value = config.gemini?.apiKey || '';
  kimiModel.value = config.kimi?.model || 'moonshot-v1-128k';
  kimiKey.value = config.kimi?.apiKey || '';
  doubaoModel.value = config.doubao?.model || '';
  doubaoKey.value = config.doubao?.apiKey || '';
  workspace.value = config.workspace || '';
  recordingsDir.value = config.recordingsDir || '';
  maxTurns.value = config.maxTurns || 200;
  commandTimeout.value = Math.round((config.commandTimeoutMs || 300000) / 1000);
  enableTools.checked = !!config.enableTools;
  autoApproveModerate.checked = config.autoApproveModerate !== false;
  autoApproveDangerous.checked = !!config.autoApproveDangerous;
  syncProviderFields();
}

saveSettings.addEventListener('click', async () => {
  const next = {
    provider: providerSel.value,
    enableTools: enableTools.checked,
    workspace: workspace.value.trim(),
    recordingsDir: recordingsDir.value.trim(),
    maxTurns: parseInt(maxTurns.value) || 200,
    commandTimeoutMs: (parseInt(commandTimeout.value) || 300) * 1000,
    autoApproveModerate: autoApproveModerate.checked,
    autoApproveDangerous: autoApproveDangerous.checked,
    anthropic: {
      apiKey: anthropicKey.value.trim(),
      model: anthropicModel.value,
      effort: anthropicEffort.value,
    },
    openai: {
      apiKey: openaiKey.value.trim(),
      baseUrl: openaiBase.value.trim() || 'https://api.openai.com',
      model: openaiModel.value.trim() || 'gpt-4o',
    },
    deepseek: {
      apiKey: deepseekKey.value.trim(),
      baseUrl: 'https://api.deepseek.com',
      model: deepseekModel.value.trim() || 'deepseek-chat',
    },
    gemini: {
      apiKey: geminiKey.value.trim(),
      model: geminiModel.value || 'gemini-2.0-flash-exp',
    },
    kimi: {
      apiKey: kimiKey.value.trim(),
      baseUrl: 'https://api.moonshot.cn',
      model: kimiModel.value || 'moonshot-v1-128k',
    },
    doubao: {
      apiKey: doubaoKey.value.trim(),
      baseUrl: 'https://ark.cn-beijing.volces.com',
      model: doubaoModel.value.trim(),
    },
  };
  config = await window.api.setConfig(next);
  settings.classList.add('hidden');
  systemNote('设置已保存 ✅');
});

// ===== 消息渲染 =====
function el(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}
function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addUserMessage(text) {
  const d = el('div', 'msg user');
  d.textContent = text;
  messagesEl.appendChild(d);
  scrollDown();
}

function systemNote(text) {
  const d = el('div', 'sys-note', text);
  messagesEl.appendChild(d);
  scrollDown();
}

// 给代码块加复制按钮 + 高亮
function enhanceCode(container) {
  container.querySelectorAll('pre > code').forEach((code) => {
    if (window.hljs && !code.dataset.hl) {
      try { window.hljs.highlightElement(code); } catch {}
      code.dataset.hl = '1';
    }
    const pre = code.parentElement;
    if (!pre.querySelector('.copy-code')) {
      const btn = el('button', 'copy-code', '复制');
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent);
        btn.textContent = '已复制';
        setTimeout(() => (btn.textContent = '复制'), 1200);
      });
      pre.appendChild(btn);
    }
  });
}

// ===== 当前回合状态 =====
let group = null; // 本回合的助手容器
let textEl = null; // 当前文本气泡的内容元素
let textBuf = '';
let thinkingBody = null;
let renderScheduled = false;
const toolCards = new Map();

function ensureGroup() {
  if (!group) {
    group = el('div', 'msg ai');
    messagesEl.appendChild(group);
  }
  return group;
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (textEl) {
      textEl.innerHTML = md.render(textBuf);
      enhanceCode(textEl);
      scrollDown();
    }
  });
}

function newTextBubble() {
  ensureGroup();
  textBuf = '';
  const bubble = el('div', 'bubble');
  group.appendChild(bubble);
  textEl = bubble;
  scrollDown();
}

function ensureThinking() {
  if (!thinkingBody) {
    ensureGroup();
    const details = document.createElement('details');
    details.className = 'thinking';
    const summary = el('summary', null, '💭 思考中…');
    const body = el('div', 'thinking-body');
    details.appendChild(summary);
    details.appendChild(body);
    group.appendChild(details);
    thinkingBody = body;
    details._summary = summary;
    details._el = details;
    thinkingBody._details = details;
  }
  return thinkingBody;
}

function toolLabel(name) {
  return ({
    run_command: '执行命令',
    read_file: '读取文件',
    write_file: '写入文件',
    edit_file: '精确编辑',
    multi_edit: '批量编辑',
    list_directory: '列目录',
    glob_search: '查找文件',
    grep_search: '代码搜索',
    read_output: '读后台输出',
    kill_job: '终止后台任务',
    take_screenshot: '截屏',
    launch_browser: '启动浏览器',
    navigate: '浏览器导航',
    browser_click: '浏览器点击',
    browser_type: '浏览器输入',
    browser_eval: '浏览器执行JS',
    browser_screenshot: '浏览器截图',
    get_browser_content: '获取页面内容',
    close_browser: '关闭浏览器',
    start_recording: '开始录屏',
    stop_recording: '停止录屏',
    web_search: '联网搜索',
    web_fetch: '抓取网页',
  })[name] || name;
}

function addToolCard(id, name, summary, risk) {
  ensureGroup();
  const riskClass = risk === 'dangerous' ? 'risk-dangerous' : (risk === 'moderate' ? 'risk-moderate' : 'risk-safe');
  const card = el('div', `tool-card running ${riskClass}`);
  const head = el('div', 'tool-head');
  head.appendChild(el('span', 'tool-name', '🔧 ' + toolLabel(name)));
  if (summary) head.appendChild(el('code', 'tool-summary', summary));
  const spin = el('span', 'tool-status', '运行中…');
  head.appendChild(spin);
  card.appendChild(head);
  group.appendChild(card);
  toolCards.set(id, { card, status: spin });
  scrollDown();
}

function finishToolCard(id, ok, preview) {
  const rec = toolCards.get(id);
  if (!rec) return;
  rec.card.classList.remove('running');
  rec.card.classList.add(ok ? 'ok' : 'err');
  rec.status.textContent = ok ? '✓ 完成' : '✕ 出错';
  if (preview) {
    const details = document.createElement('details');
    details.className = 'tool-output';
    details.appendChild(el('summary', null, '查看结果'));
    details.appendChild(el('pre', null, preview));
    rec.card.appendChild(details);
  }
  scrollDown();
}

function addPermissionCard(id, name, inputObj, risk) {
  ensureGroup();
  const riskClass = risk === 'dangerous' ? 'risk-dangerous' : (risk === 'moderate' ? 'risk-moderate' : '');
  const card = el('div', `perm-card ${riskClass}`);
  const icon = risk === 'dangerous' ? '⚠️' : '🔸';
  card.appendChild(el('div', 'perm-title', `${icon} 请求执行「${toolLabel(name)}」`));
  const detail = name === 'run_command' ? inputObj.command : (inputObj.path || '');
  if (detail) card.appendChild(el('code', 'perm-detail', detail));
  const row = el('div', 'perm-actions');
  const allow = el('button', 'perm-allow', '允许');
  const deny = el('button', 'perm-deny', '拒绝');
  const trustBtn = el('button', 'perm-trust', '本次会话全部允许');
  row.appendChild(allow);
  row.appendChild(deny);
  row.appendChild(trustBtn);
  card.appendChild(row);
  group.appendChild(card);
  scrollDown();

  const respond = (approved, trustSession) => {
    window.api.respondPermission(id, approved, trustSession);
    allow.disabled = deny.disabled = trustBtn.disabled = true;
    card.classList.add(approved ? 'granted' : 'denied');
    const msg = trustSession ? '已信任本次会话' : (approved ? '已允许' : '已拒绝');
    row.replaceChildren(el('span', 'perm-result', msg));
  };
  allow.addEventListener('click', () => respond(true, false));
  deny.addEventListener('click', () => respond(false, false));
  trustBtn.addEventListener('click', () => respond(true, true));
}

// ===== 收发 =====
function setBusy(v) {
  busy = v;
  sendBtn.classList.toggle('hidden', v);
  stopBtn.classList.toggle('hidden', !v);
  input.disabled = false;
}

function resetTurnState() {
  group = null;
  textEl = null;
  textBuf = '';
  thinkingBody = null;
  toolCards.clear();
}

async function send() {
  const text = input.value.trim();
  if (!text || busy) return;
  addUserMessage(text);
  input.value = '';
  input.style.height = 'auto';
  resetTurnState();
  setBusy(true);
  try {
    await window.api.send(text);
  } catch (err) {
    systemNote('⚠️ ' + (err?.message || err));
    setBusy(false);
  }
}

sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', () => window.api.stop());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
});

newChatBtn.addEventListener('click', async () => {
  if (busy) return;
  await window.api.clearHistory();
  messagesEl.replaceChildren();
  greeting();
});

// ===== 事件流处理 =====
window.api.onEvent((ev) => {
  switch (ev.type) {
    case 'turn_start':
      resetTurnState();
      break;
    case 'thinking_start':
      ensureThinking();
      break;
    case 'thinking_delta':
      ensureThinking().textContent += ev.text;
      scrollDown();
      break;
    case 'text_start':
      newTextBubble();
      break;
    case 'text_delta':
      if (!textEl) newTextBubble();
      textBuf += ev.text;
      scheduleRender();
      break;
    case 'server_tool':
      addToolCard('srv-' + Math.random(), ev.name, '', 'safe');
      break;
    case 'tool_use':
      addToolCard(ev.id, ev.name, ev.summary, ev.risk || 'moderate');
      break;
    case 'tool_result':
      finishToolCard(ev.id, ev.ok, ev.preview);
      break;
    case 'tool_permission':
      addPermissionCard(ev.id, ev.name, ev.input || {}, ev.risk || 'moderate');
      break;
    case 'done':
      if (thinkingBody) thinkingBody._details._summary.textContent = '💭 思考过程';
      setBusy(false);
      break;
    case 'stopped':
      systemNote('已停止。');
      setBusy(false);
      break;
    case 'error':
      systemNote('⚠️ ' + ev.message);
      setBusy(false);
      break;
  }
});

// ===== 悬浮球拖动 =====
let dragging = false;
let lastX = 0;
let lastY = 0;
ball.addEventListener('mousedown', (e) => {
  dragging = true;
  dragMoved = false;
  lastX = e.screenX;
  lastY = e.screenY;
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
  window.api.dragWindow(dx, dy);
  lastX = e.screenX;
  lastY = e.screenY;
});
window.addEventListener('mouseup', () => {
  dragging = false;
  setTimeout(() => (dragMoved = false), 50);
});

// ===== 初始化 =====
function greeting() {
  systemNote('你好，我是你的桌面 AI 助手，能聊天、联网、读写文件、执行命令、看屏幕。先到 ⚙ 填好 API Key 就能开始。');
}

async function renderHistory() {
  const history = await window.api.getHistory();
  if (!history.length) { greeting(); return; }
  for (const m of history) {
    if (m.role === 'user') {
      addUserMessage(m.content);
    } else {
      const g = el('div', 'msg ai');
      const bubble = el('div', 'bubble');
      bubble.innerHTML = md.render(m.content || '');
      g.appendChild(bubble);
      messagesEl.appendChild(g);
      enhanceCode(bubble);
    }
  }
  scrollDown();
}

(async function init() {
  await loadConfigUI();
  await renderHistory();
})();
