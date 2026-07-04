// 模型供应商适配层：Anthropic（Claude，全功能智能体）+ OpenAI 兼容（含 Ollama）+ DeepSeek + Gemini + Kimi + 豆包。
// 都共用同一套工具执行器，都走「流式 + 工具调用循环」。
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { TOOLS, executeTool, summarizeToolInput } = require('./tools');
const { getSkillPrompts } = require('./skills');

function systemPrompt(config) {
  const today = new Date().toISOString().slice(0, 10);
  const workspace = config.workspace || '用户主目录';
  const basePrompt = [
    '你是一个常驻在用户桌面上的中文 AI 智能体助手——顶尖的编码 agent，风格干练、精确、直接、友好。',
    `今天是 ${today}。工作区：${workspace}（相对路径、搜索、命令 cwd 默认基于它）。`,
    '',
    '# 你的能力',
    '你能真正地帮用户做事，而不只是聊天：',
    '- **精确编辑代码**：用 `edit_file` 替换文件中的特定段落（old_string 需唯一命中，带足够上下文），而非覆盖整个文件。这是修改代码的首选方式。',
    '- **搜索代码**：用 `grep_search` 在代码库里定位符号/函数/字符串；用 `glob_search` 按模式找文件。先搜后改，精确定位。',
    '- **执行命令**：`run_command` 跑 git / 装依赖 / 测试 / 构建等。长任务（dev server）设 background=true 后台跑。',
    '- **读写文件**：`read_file`（支持行范围）/ `write_file`（新建）/ `list_directory`（可递归）。',
    '- **浏览器自动化**：`launch_browser` 启动浏览器 → `navigate` 打开网址 → `browser_click`/`browser_type` 交互 → `browser_screenshot` 查看 → `get_browser_content` 提取内容 → `close_browser` 关闭。用于自动化答题、UI 测试、数据抓取等。',
    '- **屏幕录制**：`start_recording` 开始录屏（记录你的浏览器操作过程）→ 执行任务 → `stop_recording` 保存视频。仅在用户明确要求录屏时使用。',
    '- **联网**（Claude 专属）：`web_search` 搜索、`web_fetch` 抓网页，获取实时信息/文档。',
    '- **截屏**：`take_screenshot` 查看用户屏幕，`browser_screenshot` 查看浏览器页面。',
    '- **Skill 安装**：`install_skill` 创建新 skill 到 `~/.ai-assistant/skills/`，`reload_skills` 重新加载。用户让你学新能力时，直接写 skill 安装即可，skill 可以注册自定义工具和增强提示词。',
    '',
    '# 行为准则',
    '- **先搜后改**：改代码前先 `grep_search` 定位准确位置，避免盲目猜测文件名/结构。',
    '- **精确编辑**：用 `edit_file` + 带上下文的 old_string，而非整文件重写——只改需要改的部分，保持其余代码不动。',
    '- **改完验证**：改动后主动跑相关测试/类型检查/编译，确保没有破坏既有功能。出错就修、迭代直到通过。',
    '- **浏览器操作**：操作浏览器时，先 `browser_screenshot` 查看页面，再精确用 CSS 选择器定位元素交互。操作后截图确认结果。',
    '- **录屏原则**：只在用户明确说"录屏"、"记录过程"、"录下来"时才用 `start_recording`。录屏会持续到 `stop_recording`，期间的所有操作都会被记录。',
    '- **简洁汇报**：完成后一两句话说明结果（改了什么、测试是否通过），避免复读代码。',
    '- **不过度设计**：解决当前问题即可，不要加用户未要求的抽象/功能。',
    '- **拿不准就问**：破坏性操作（删文件/大范围重构）或需求不明确时，先问用户确认方向。',
  ];
  // 追加 Skill 增强的 system prompt
  const skillPrompt = getSkillPrompts();
  if (skillPrompt) basePrompt.push('', '# [已加载 Skill]', skillPrompt);
  return basePrompt.join('\n');
}

function modelCaps(model) {
  const m = (model || '').toLowerCase();
  return {
    isHaiku: m.includes('haiku'),
    isFable: m.includes('fable') || m.includes('mythos'),
  };
}

// ---------- Anthropic（Claude）----------
async function runAnthropic({ config, messages, onEvent, signal, toolCtx }) {
  const c = config.anthropic;
  if (!c.apiKey) throw new Error('还没填 Claude (Anthropic) 的 API Key，点右上角设置。');
  const client = new Anthropic({ apiKey: c.apiKey });
  const caps = modelCaps(c.model);

  const tools = [];
  if (config.enableTools) {
    for (const t of TOOLS) {
      tools.push({ name: t.name, description: t.description, input_schema: t.input_schema });
    }
    // Claude 服务端自带的联网工具（Haiku 用基础版，其余用带动态过滤的新版）
    if (caps.isHaiku) {
      tools.push({ type: 'web_search_20250305', name: 'web_search' });
    } else {
      tools.push({ type: 'web_search_20260209', name: 'web_search' });
      tools.push({ type: 'web_fetch_20260209', name: 'web_fetch' });
    }
  }

  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  let assistantText = '';
  const maxTurns = config.maxTurns || 200;

  for (let turn = 0; turn < maxTurns; turn++) {
    const params = {
      model: c.model,
      max_tokens: 64000,
      system: [{ type: 'text', text: systemPrompt(config), cache_control: { type: 'ephemeral' } }],
      messages: convo,
    };
    if (tools.length) params.tools = tools;
    if (!caps.isHaiku) {
      params.thinking = { type: 'adaptive', display: 'summarized' };
      params.output_config = { effort: c.effort || 'xhigh' };
    }
    if (caps.isFable) {
      params.betas = ['server-side-fallback-2026-06-01'];
      params.fallbacks = [{ model: 'claude-opus-4-8' }];
    }

    const api = caps.isFable ? client.beta.messages : client.messages;
    const stream = api.stream(params, { signal });

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const b = event.content_block;
        if (b.type === 'text') onEvent({ type: 'text_start' });
        else if (b.type === 'thinking') onEvent({ type: 'thinking_start' });
        else if (b.type === 'server_tool_use') {
          onEvent({ type: 'server_tool', name: b.name });
        }
      } else if (event.type === 'content_block_delta') {
        const d = event.delta;
        if (d.type === 'text_delta') {
          assistantText += d.text;
          onEvent({ type: 'text_delta', text: d.text });
        } else if (d.type === 'thinking_delta') {
          onEvent({ type: 'thinking_delta', text: d.thinking });
        }
      }
    }

    const final = await stream.finalMessage();
    convo.push({ role: 'assistant', content: final.content });

    if (final.stop_reason === 'refusal') {
      onEvent({ type: 'text_delta', text: '\n\n（模型基于安全策略拒绝了本次请求。）' });
      break;
    }
    if (final.stop_reason === 'pause_turn') continue; // 服务端工具未完，继续
    if (final.stop_reason !== 'tool_use') break;

    const toolUses = final.content.filter((b) => b.type === 'tool_use');
    if (!toolUses.length) break;

    const results = [];
    for (const tu of toolUses) {
      onEvent({ type: 'tool_use', id: tu.id, name: tu.name, summary: summarizeToolInput(tu.name, tu.input) });
      const r = await executeTool(tu.name, tu.input, toolCtx);
      onEvent({ type: 'tool_result', id: tu.id, name: tu.name, ok: !r.isError, preview: r.text });

      let content;
      if (r.image) {
        content = [
          { type: 'image', source: { type: 'base64', media_type: r.image.mediaType, data: r.image.data } },
          { type: 'text', text: r.text },
        ];
      } else {
        content = r.text;
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content, is_error: !!r.isError });
    }
    convo.push({ role: 'user', content: results });
  }

  return assistantText.trim();
}

// ---------- OpenAI 兼容（含 Ollama）----------
function toOpenAITools() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

async function runOpenAI({ config, messages, onEvent, signal, toolCtx }) {
  const c = config.openai;
  if (!c.apiKey && !/localhost|127\.0\.0\.1/.test(c.baseUrl || '')) {
    throw new Error('还没填 API Key，点右上角设置。');
  }
  let baseURL = (c.baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
  if (!/\/v\d+$/.test(baseURL)) baseURL += '/v1';
  const client = new OpenAI({ apiKey: c.apiKey || 'ollama', baseURL });

  const convo = [{ role: 'system', content: systemPrompt(config) }];
  for (const m of messages) convo.push({ role: m.role, content: m.content });

  const tools = config.enableTools ? toOpenAITools() : undefined;
  let assistantText = '';
  const maxTurns = config.maxTurns || 200;

  for (let turn = 0; turn < maxTurns; turn++) {
    const stream = await client.chat.completions.create(
      { model: c.model, messages: convo, tools, stream: true },
      { signal }
    );

    const toolCalls = []; // 按 index 累积
    let finish = null;
    let textStarted = false;

    for await (const chunk of stream) {
      const choice = chunk.choices && chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) {
        if (!textStarted) { onEvent({ type: 'text_start' }); textStarted = true; }
        assistantText += delta.content;
        onEvent({ type: 'text_delta', text: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          if (!toolCalls[i]) toolCalls[i] = { id: '', name: '', args: '' };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].name += tc.function.name;
          if (tc.function?.arguments) toolCalls[i].args += tc.function.arguments;
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    const calls = toolCalls.filter(Boolean);
    if (finish !== 'tool_calls' || !calls.length) break;

    convo.push({
      role: 'assistant',
      content: assistantText || null,
      tool_calls: calls.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.args || '{}' },
      })),
    });

    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.args || '{}'); } catch { /* 参数解析失败 */ }
      onEvent({ type: 'tool_use', id: call.id, name: call.name, summary: summarizeToolInput(call.name, args) });
      const r = await executeTool(call.name, args, toolCtx);
      onEvent({ type: 'tool_result', id: call.id, name: call.name, ok: !r.isError, preview: r.text });
      let content = r.text;
      if (r.image) content += '\n（已截屏，但当前模型不支持在工具结果中查看图片）';
      convo.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }

  return assistantText.trim();
}

// ---------- DeepSeek ----------
async function runDeepSeek({ config, messages, onEvent, signal, toolCtx }) {
  const c = config.deepseek;
  if (!c.apiKey) throw new Error('还没填 DeepSeek 的 API Key，点右上角设置。');
  const client = new OpenAI({ apiKey: c.apiKey, baseURL: c.baseUrl || 'https://api.deepseek.com' });

  // DeepSeek 使用 OpenAI 兼容接口，直接复用 OpenAI 逻辑
  return runOpenAI({ config: { ...config, openai: c }, messages, onEvent, signal, toolCtx });
}

// ---------- Gemini ----------
function toGeminiTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: 'OBJECT',
      properties: Object.fromEntries(
        Object.entries(t.input_schema.properties || {}).map(([k, v]) => [
          k,
          { type: (v.type || 'STRING').toUpperCase(), description: v.description },
        ])
      ),
      required: t.input_schema.required || [],
    },
  }));
}

async function runGemini({ config, messages, onEvent, signal, toolCtx }) {
  const c = config.gemini;
  if (!c.apiKey) throw new Error('还没填 Gemini 的 API Key，点右上角设置。');
  const genAI = new GoogleGenerativeAI(c.apiKey);
  const model = genAI.getGenerativeModel({
    model: c.model || 'gemini-2.0-flash-exp',
    tools: config.enableTools ? [{ functionDeclarations: toGeminiTools() }] : undefined,
    systemInstruction: systemPrompt(config),
  });

  const history = [];
  for (const m of messages) {
    history.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }

  const chat = model.startChat({ history });
  let assistantText = '';
  const maxTurns = config.maxTurns || 200;

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await chat.sendMessageStream('继续', { signal });
    let hasFunctionCall = false;

    for await (const chunk of result.stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;

      const textPart = candidate.content?.parts?.find((p) => p.text);
      if (textPart?.text) {
        if (!assistantText) onEvent({ type: 'text_start' });
        assistantText += textPart.text;
        onEvent({ type: 'text_delta', text: textPart.text });
      }

      const fnCalls = candidate.content?.parts?.filter((p) => p.functionCall) || [];
      if (fnCalls.length) hasFunctionCall = true;
    }

    const response = await result.response;
    const fnCalls = response.candidates?.[0]?.content?.parts?.filter((p) => p.functionCall) || [];

    if (!hasFunctionCall || !fnCalls.length) break;

    const functionResponses = [];
    for (const fc of fnCalls) {
      const name = fc.functionCall.name;
      const args = fc.functionCall.args || {};
      onEvent({ type: 'tool_use', id: name, name, summary: summarizeToolInput(name, args) });
      const r = await executeTool(name, args, toolCtx);
      onEvent({ type: 'tool_result', id: name, name, ok: !r.isError, preview: r.text });

      functionResponses.push({
        functionResponse: {
          name,
          response: { result: r.text },
        },
      });
    }

    await chat.sendMessage(functionResponses);
  }

  return assistantText.trim();
}

// ---------- Kimi (Moonshot) ----------
async function runKimi({ config, messages, onEvent, signal, toolCtx }) {
  const c = config.kimi;
  if (!c.apiKey) throw new Error('还没填 Kimi 的 API Key，点右上角设置。');
  const client = new OpenAI({ apiKey: c.apiKey, baseURL: c.baseUrl || 'https://api.moonshot.cn/v1' });

  // Kimi 使用 OpenAI 兼容接口
  return runOpenAI({ config: { ...config, openai: c }, messages, onEvent, signal, toolCtx });
}

// ---------- 豆包 (Doubao) ----------
async function runDoubao({ config, messages, onEvent, signal, toolCtx }) {
  const c = config.doubao;
  if (!c.apiKey) throw new Error('还没填豆包的 API Key，点右上角设置。');
  if (!c.model) throw new Error('豆包需要填写接入点 ID（model 字段），如 ep-xxx');
  const client = new OpenAI({ apiKey: c.apiKey, baseURL: c.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3' });

  // 豆包使用 OpenAI 兼容接口
  return runOpenAI({ config: { ...config, openai: c }, messages, onEvent, signal, toolCtx });
}

async function runAgent(opts) {
  const provider = opts.config.provider;
  if (provider === 'openai') return runOpenAI(opts);
  if (provider === 'deepseek') return runDeepSeek(opts);
  if (provider === 'gemini') return runGemini(opts);
  if (provider === 'kimi') return runKimi(opts);
  if (provider === 'doubao') return runDoubao(opts);
  return runAnthropic(opts); // 默认 Claude
}

module.exports = { runAgent };
