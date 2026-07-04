const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const { loadConfig, saveConfig, loadHistory, saveHistory } = require('./config');
const { runAgent } = require('./providers');
const { loadSkills, getAllSkills, toggleSkill, SKILLS_DIR } = require('./skills');

const BALL = 76;
const PANEL_W = 440;
const PANEL_H = 680;
const MARGIN = 24;

let win = null;
let expanded = false;

// 进行中的任务：AbortController + 待批准的工具 + 会话信任标志
let currentAbort = null;
const pendingPermissions = new Map();
let sessionTrustAll = false; // 本次会话是否已选"全部允许"

function createWindow() {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: BALL,
    height: BALL,
    x: sw - BALL - MARGIN,
    y: 120,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.setAlwaysOnTop(true, 'floating');

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

// 展开成面板 / 收起成小球时，直接改变窗口大小，避免透明区域误点
function setExpanded(next) {
  if (!win) return;
  expanded = next;
  const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = disp.workArea;
  const [x, y] = win.getPosition();

  if (next) {
    let nx = Math.min(x, area.x + area.width - PANEL_W - 8);
    let ny = Math.min(y, area.y + area.height - PANEL_H - 8);
    nx = Math.max(nx, area.x + 8);
    ny = Math.max(ny, area.y + 8);
    win.setBounds({ x: Math.round(nx), y: Math.round(ny), width: PANEL_W, height: PANEL_H });
  } else {
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: BALL, height: BALL });
  }
}

function toggleWindow() {
  if (!win) return createWindow();
  if (!win.isVisible()) {
    win.show();
    win.focus();
    return;
  }
  if (!expanded) {
    setExpanded(true);
    win.webContents.send('window:expanded', true);
    win.focus();
  } else {
    win.focus();
  }
}

// ---------- 窗口控制 ----------
ipcMain.on('window:expand', () => {
  setExpanded(true);
  win?.webContents.send('window:expanded', true);
});
ipcMain.on('window:collapse', () => {
  setExpanded(false);
  win?.webContents.send('window:expanded', false);
});
ipcMain.on('window:hide', () => win?.hide());

ipcMain.on('drag-window', (_e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

// ---------- 配置 & 历史 ----------
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, cfg) => saveConfig(cfg));
ipcMain.handle('skills:list', () => getAllSkills());
ipcMain.handle('skills:toggle', (_e, { skillId, enabled }) => toggleSkill(skillId, enabled));
ipcMain.handle('skills:dir', () => SKILLS_DIR);
ipcMain.handle('history:get', () => loadHistory());
ipcMain.handle('history:clear', () => {
  saveHistory([]);
  sessionTrustAll = false; // 新对话时清空会话信任标志
  return [];
});

// ---------- 工具批准回执 ----------
ipcMain.on('tool:permission-response', (_e, { id, approved, trustSession }) => {
  const resolve = pendingPermissions.get(id);
  if (resolve) {
    pendingPermissions.delete(id);
    if (trustSession) sessionTrustAll = true;
    resolve(!!approved);
  }
});

// ---------- 停止 ----------
ipcMain.on('chat:stop', () => {
  if (currentAbort) currentAbort.abort();
});

// ---------- 发送消息，跑智能体 ----------
let permCounter = 0;
ipcMain.handle('chat:send', async (_e, { text }) => {
  const config = loadConfig();
  const history = loadHistory();
  const send = (payload) => win?.webContents.send('chat:event', payload);

  const abort = new AbortController();
  currentAbort = abort;

  const toolCtx = {
    workspace: config.workspace || require('os').homedir(),
    recordingsDir: config.recordingsDir || require('path').join(require('os').homedir(), 'Desktop'),
    autoApproveModerate: !!config.autoApproveModerate,
    autoApproveDangerous: !!config.autoApproveDangerous,
    trustAll: () => sessionTrustAll,
    requestPermission: (name, input, risk) =>
      new Promise((resolve) => {
        const id = `perm-${Date.now()}-${permCounter++}`;
        pendingPermissions.set(id, resolve);
        send({ type: 'tool_permission', id, name, input, risk });
      }),
  };

  send({ type: 'turn_start' });

  try {
    const assistantText = await runAgent({
      config,
      messages: [...history, { role: 'user', content: text }],
      onEvent: send,
      signal: abort.signal,
      toolCtx,
    });

    const newHistory = [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: assistantText || '（无文本输出）' },
    ];
    saveHistory(newHistory);
    send({ type: 'done' });
  } catch (err) {
    const aborted = err?.name === 'APIUserAbortError' || abort.signal.aborted;
    if (aborted) {
      // 停止时也把这轮用户消息 + 已产出的内容留个记录
      send({ type: 'stopped' });
    } else {
      send({ type: 'error', message: err?.message || String(err) });
    }
  } finally {
    if (currentAbort === abort) currentAbort = null;
    // 清理本轮遗留的待批准项
    for (const [id, resolve] of pendingPermissions) {
      pendingPermissions.delete(id);
      resolve(false);
    }
  }
});

app.whenReady().then(() => {
  loadSkills(); // 加载 Skill 系统
  createWindow();
  // 全局快捷键：唤起 / 展开助手
  globalShortcut.register('CommandOrControl+Shift+Space', toggleWindow);
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
