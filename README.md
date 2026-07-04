# AI 悬浮球助手 · 最强编码 Agent + 浏览器自动化 + 录屏版

桌面常驻的 AI **编码智能体**小球。点击展开对话，可拖动、始终置顶、全局快捷键唤起。
不只是聊天——它能**精确编辑代码、全局搜索、联网查资料、读写文件、执行命令、看你的屏幕**，还能**控制浏览器自动化操作（答题/测试/数据抓取）并全程录屏记录**，像 Claude Code 一样真正帮你写代码、改 bug、重构项目，再加上浏览器自动化完成各种 Web 任务。跨平台（Mac / Windows）。

## 亮点

- 🤖 **真·编码 Agent**：Claude 驱动的工具调用循环（最多 200 轮），能自己决定查资料、定位代码、精确改文件、跑测试来完成编码任务
- 🌐 **浏览器自动化**：内置 Puppeteer，agent 可以启动浏览器、打开网址、点击、输入、截图、提取内容——自动化答题、UI 测试、数据抓取等
- 📹 **屏幕录制**：手动触发录屏，记录 agent 操作浏览器的全过程，保存为 MP4 视频（需系统安装 ffmpeg）
- ✂️ **精确编辑**：`edit_file` 工具只改需要改的部分，不整文件覆盖——带上下文的字符串替换，像 Claude Code 一样改代码
- 🔍 **代码搜索**：`grep_search` 在代码库里正则搜索、`glob_search` 按模式找文件——先搜后改，精确定位
- 🛡️ **智能信任分级**：读文件/搜索永远直接放行（safe）；改文件/git/装依赖默认放行（moderate）；`rm -rf`/`sudo` 等破坏性操作默认弹窗确认（dangerous），可一键切全自动
- 🔌 **多模型可选**：Claude（Anthropic，最强）/ OpenAI 兼容 / DeepSeek / Kimi / 豆包 / 本地 Ollama，设置里随时切换
- 🌊 **流式打字机输出** + **Markdown / 代码高亮 / 一键复制**
- 💭 **思考过程**可折叠查看（Claude adaptive thinking，effort=xhigh 编码最佳）
- 🔧 **工具卡片**实时展示每一步操作，按风险等级配色（safe 灰 / moderate 蓝 / dangerous 橙）
- 🌐 **联网**：Claude 自带 `web_search` / `web_fetch`，无需额外配置
- 💾 多轮对话**自动保存**，随时「新对话」清空
- ⌨️ 全局快捷键 **Ctrl/⌘ + Shift + 空格** 唤起
- ⏹ 随时**停止**生成

## 在 Mac / Windows 上运行

### 1. 装 Node.js（只需一次）

去 https://nodejs.org 下载 LTS 版安装，或 Mac 上用 Homebrew：`brew install node`

### 2. 进入项目目录并安装依赖

```bash
cd ~/Desktop/ai-floating-assistant
npm install
```

### 3. 启动

```bash
npm start
```

屏幕上会出现一个悬浮球。点击展开 → 点右上角 ⚙ 填好 API Key 和工作区目录 → 开始使用。

## 配置说明

设置面板（⚙）里：

### Claude（Anthropic）—— 推荐，功能最全
- **模型**：`claude-opus-4-8`（推荐）、`claude-fable-5`（最强，需组织开启 30 天数据保留）、`claude-sonnet-5`（更快更省）、`claude-haiku-4-5`（最便宜）
- **思考强度 effort**：`low` → `max`，编码推荐 `xhigh`（已默认）
- **API Key**：从 https://console.anthropic.com 获取
- 联网搜索 / 抓取网页开箱即用

### OpenAI 兼容 / Ollama
填 Base URL、模型名、API Key 即可：

| 服务 | Base URL | 模型示例 |
|------|----------|----------|
| OpenAI | `https://api.openai.com` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| 月之暗面 Kimi | `https://api.moonshot.cn` | `moonshot-v1-8k` |
| 豆包（方舟） | `https://ark.cn-beijing.volces.com/api/v3` | 接入点 ID |
| 本地 Ollama | `http://localhost:11434` | `llama3.1` 等 |

> 工具调用 / 联网在这些模型上仅当其自身支持时可用；联网搜索为 Claude 专属。

### 工作区与智能信任
- **工作区目录**：填你的项目根目录（如 `~/Desktop/my-project`），相对路径、搜索、命令 cwd 都默认基于它。不填则用用户主目录。
- **录屏保存目录**：录屏视频保存位置，不填则用桌面。
- **最大循环轮数**：默认 200，长任务可调更高。
- **命令超时**：前台命令超时秒数（长任务如 dev server 用 `background=true` 后台跑）。
- **智能信任分级**：
  - **读文件/搜索/列目录/截屏** → 永远直接执行（safe）
  - **改文件/git/装依赖/跑测试/浏览器操作** → 默认放行（moderate，编码 agent 日常），可关掉改为每次确认
  - **`rm -rf`/`sudo`/格式化等破坏性操作** → 默认弹窗确认（dangerous），可一键切全自动
  - 批准弹窗可选「本次会话全部允许」，当前对话内后续操作不再询问

## 工具清单

### 编码工具
| 工具 | 说明 | 风险 |
|------|------|------|
| `read_file` | 读文本文件，支持行范围 | safe |
| `write_file` | 写入/覆盖整个文件 | moderate |
| `edit_file` | **精确编辑**：字符串替换，old_string 需唯一命中 | moderate |
| `multi_edit` | 对同一文件顺序应用多处编辑，原子生效 | moderate |
| `list_directory` | 列目录，可递归（自动忽略 node_modules/.git） | safe |
| `glob_search` | 按 glob 找文件（如 `**/*.ts`） | safe |
| `grep_search` | 在代码里正则搜索，返回 `file:line:` 匹配行 | safe |
| `run_command` | 执行命令，`background=true` 后台跑长任务 | 动态判定 |
| `read_output` / `kill_job` | 读后台命令输出 / 终止后台任务 | safe / moderate |

### 浏览器自动化工具
| 工具 | 说明 | 风险 |
|------|------|------|
| `launch_browser` | 启动浏览器（有头/无头模式），返回 browser_id | moderate |
| `navigate` | 导航到指定 URL | moderate |
| `browser_click` | 点击页面元素（CSS 选择器） | moderate |
| `browser_type` | 在输入框输入文字 | moderate |
| `browser_eval` | 执行 JavaScript 代码并返回结果 | moderate |
| `browser_screenshot` | 截取浏览器页面（可全页滚动） | safe |
| `get_browser_content` | 获取页面 HTML 或纯文本内容 | safe |
| `close_browser` | 关闭浏览器实例 | moderate |

### 录屏与截图
| 工具 | 说明 | 风险 |
|------|------|------|
| `start_recording` | 开始录制屏幕（包括浏览器操作），返回 recording_id | moderate |
| `stop_recording` | 停止录制并保存为 MP4 视频 | safe |
| `take_screenshot` | 截取当前屏幕供模型查看 | safe |

### 联网（Claude 专属）
| 工具 | 说明 | 风险 |
|------|------|------|
| `web_search` / `web_fetch` | 联网搜索/抓网页 | safe |

## 使用示例

### 浏览器自动化 + 录屏
```
你：帮我录屏，然后打开百度搜索"Claude AI"，点击第一个结果，截图给我看
```

Agent 会：
1. `start_recording` 开始录屏
2. `launch_browser` 启动浏览器
3. `navigate` 到百度
4. `browser_type` 输入搜索词
5. `browser_click` 点击搜索按钮
6. `browser_click` 点击第一个结果
7. `browser_screenshot` 截图
8. `stop_recording` 保存录屏
9. 返回截图和录屏文件路径

### 自动化答题
```
你：打开 https://example.com/quiz，帮我完成这个选择题测试
```

Agent 会：
1. `launch_browser` 启动浏览器
2. `navigate` 到测试页面
3. `browser_screenshot` 查看题目
4. `browser_click` / `browser_type` 选择/填写答案
5. `browser_click` 提交
6. `get_browser_content` 获取结果

## 依赖说明

### 浏览器自动化
需要系统安装 **Chrome / Chromium / Microsoft Edge** 浏览器。程序会自动检测以下路径：

**Mac:**
- `/Applications/Google Chrome.app`
- `/Applications/Chromium.app`
- `/Applications/Microsoft Edge.app`

**Windows:**
- `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
- `C:\Program Files\Microsoft\Edge\Application\msedge.exe`

**Linux:**
- `/usr/bin/google-chrome`
- `/usr/bin/chromium-browser`

### 录屏功能
需要系统安装 **ffmpeg**（用于把截屏帧拼接成 MP4 视频）：

**Mac:**
```bash
brew install ffmpeg
```

**Windows:**
从 https://ffmpeg.org/download.html 下载安装

**Linux:**
```bash
sudo apt install ffmpeg  # Ubuntu/Debian
sudo yum install ffmpeg  # CentOS/RHEL
```

## ⚠️ 安全提示

这个助手能在你的电脑上**执行命令、读写文件、截屏**。默认：
- 读文件/搜索直接放行
- 改文件/git/装依赖默认放行（编码日常）
- 破坏性操作（`rm -rf`/`sudo` 等）弹窗确认

你可以：
- 关掉「自动放行中等风险」，让每次改文件都问你
- 开启「自动放行危险操作」（谨慎）
- 批准弹窗时选「本次会话全部允许」，当前对话内不再询问

API Key 保存在系统用户数据目录，不会写进网页里。

## 项目结构

```
ai-floating-assistant/
├── package.json
├── electron/
│   ├── main.js        主进程：窗口 / 快捷键 / IPC / 智能体编排 + 会话信任
│   ├── preload.js     安全桥接层
│   ├── config.js      配置与历史持久化（workspace/maxTurns/智能信任开关）
│   ├── tools.js       编码工具注册表：edit/grep/glob/后台命令 + 三级 risk 分级
│   └── providers.js   模型适配：Claude + OpenAI 兼容，流式 + 工具循环（最多 200 轮）
└── src/
    ├── index.html     界面结构（工作区/智能信任设置）
    ├── styles.css     样式（深色 · 悬浮球 + 面板 + 工具卡片按 risk 配色）
    └── renderer.js    交互：流式渲染 / Markdown / 工具 UI / 批准（含"信任会话"）
```

## 打包成安装包（可选）

可用 [electron-builder](https://www.electron.build/) 打成 `.app` / `.exe`，此处未内置。
