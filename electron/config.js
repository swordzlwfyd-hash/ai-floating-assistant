// 配置与会话历史持久化（存到系统用户数据目录，API Key 不落在页面里）
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function historyPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

const DEFAULT_CONFIG = {
  provider: 'anthropic', // anthropic | openai
  enableTools: true, // 是否允许智能体调用工具
  workspace: '', // 工作区目录（项目根），空则用 home
  recordingsDir: '', // 录屏保存目录，空则用桌面
  maxTurns: 200, // 单次对话最多工具循环轮数
  commandTimeoutMs: 300000, // 前台命令超时毫秒
  autoApproveModerate: true, // 中等风险（改文件/git/装依赖）自动放行
  autoApproveDangerous: false, // 危险操作（rm -rf/sudo 等）自动放行（谨慎）
  anthropic: {
    apiKey: '',
    model: 'claude-opus-4-8',
    effort: 'xhigh', // low | medium | high | xhigh | max（编码推荐 xhigh）
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com', // Ollama 用 http://localhost:11434
    model: 'gpt-4o-mini',
  },
};

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(override || {})) {
    if (
      override[k] &&
      typeof override[k] === 'object' &&
      !Array.isArray(override[k]) &&
      typeof base[k] === 'object'
    ) {
      out[k] = deepMerge(base[k], override[k]);
    } else {
      out[k] = override[k];
    }
  }
  return out;
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const merged = deepMerge(DEFAULT_CONFIG, raw);
    // 向后兼容：旧 autoApproveTools 迁移到新的两个开关
    if (raw.autoApproveTools != null && raw.autoApproveModerate == null) {
      merged.autoApproveModerate = !!raw.autoApproveTools;
      merged.autoApproveDangerous = !!raw.autoApproveTools;
    }
    return merged;
  } catch {
    return deepMerge(DEFAULT_CONFIG, {});
  }
}

function saveConfig(cfg) {
  const merged = deepMerge(DEFAULT_CONFIG, cfg || {});
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// 会话历史：中立格式 [{ role: 'user'|'assistant', content: string }]
function loadHistory() {
  try {
    const raw = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    fs.writeFileSync(historyPath(), JSON.stringify(history || [], null, 2), 'utf8');
  } catch {
    /* 忽略写入失败 */
  }
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  loadHistory,
  saveHistory,
};
