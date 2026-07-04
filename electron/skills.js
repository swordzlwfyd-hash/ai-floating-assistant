// Skill 系统：从 ~/.ai-assistant/skills/ 加载用户自定义技能
// 每个 skill 是一个 .js 文件，可以：
// 1. 注册新的工具函数（扩展 agent 能力）
// 2. 增强 system prompt（添加领域知识）
// 3. 配置启用/禁用状态

const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILLS_DIR = path.join(os.homedir(), '.ai-assistant', 'skills');

// Skill 元数据格式
// {
//   id: 'code-review',
//   name: '代码审查',
//   description: '自动审查代码质量、安全漏洞、性能问题',
//   version: '1.0.0',
//   author: '...',
//   enabled: true,
//   tools: [ { name, description, input_schema, execute: async (input, ctx) => {...} } ],
//   systemPrompt: '你擅长代码审查...',
// }

let loadedSkills = [];

// 确保 skills 目录存在
function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    // 创建一个示例 skill
    const exampleSkill = `// 示例 Skill: Git 增强
module.exports = {
  id: 'git-helper',
  name: 'Git 助手',
  description: '增强 Git 操作：智能提交信息、分支建议、冲突解决',
  version: '1.0.0',
  author: 'AI Assistant',
  enabled: true,

  // 可选：添加新工具
  tools: [
    {
      name: 'git_smart_commit',
      description: '根据 diff 自动生成语义化的 commit message',
      input_schema: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: '是否只看 staged 的改动' },
        },
        required: [],
      },
      execute: async (input, ctx) => {
        const { execSync } = require('child_process');
        const cmd = input.staged ? 'git diff --cached' : 'git diff HEAD';
        const diff = execSync(cmd, { cwd: ctx.workspace, encoding: 'utf8' });
        return { text: \`Diff 内容：\\n\${diff}\` };
      },
    },
  ],

  // 可选：增强 system prompt
  systemPrompt: \`
你现在拥有 Git 增强能力：
- 可以用 git_smart_commit 工具分析 diff 并生成高质量的 commit message
- 遵循约定式提交规范（Conventional Commits）：feat/fix/docs/style/refactor/test/chore
\`,
};
`;
    fs.writeFileSync(path.join(SKILLS_DIR, 'git-helper.js'), exampleSkill, 'utf8');
  }
}

// 加载所有 skills
function loadSkills() {
  ensureSkillsDir();
  loadedSkills = [];

  try {
    const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const filePath = path.join(SKILLS_DIR, file);
      try {
        // 清除 require 缓存，支持热重载
        delete require.cache[require.resolve(filePath)];
        const skill = require(filePath);

        // 验证必需字段
        if (!skill.id || !skill.name) {
          console.error(`[Skill] ${file} 缺少 id 或 name 字段，跳过`);
          continue;
        }

        // 默认启用
        if (skill.enabled == null) skill.enabled = true;

        loadedSkills.push(skill);
      } catch (err) {
        console.error(`[Skill] 加载 ${file} 失败:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Skill] 读取 skills 目录失败:', err.message);
  }

  return loadedSkills;
}

// 获取所有已启用 skill 的工具
function getSkillTools() {
  const tools = [];
  for (const skill of loadedSkills) {
    if (skill.enabled && skill.tools) {
      for (const tool of skill.tools) {
        tools.push({
          ...tool,
          _skillId: skill.id, // 标记来源
        });
      }
    }
  }
  return tools;
}

// 获取所有已启用 skill 的 system prompt 增强
function getSkillPrompts() {
  const prompts = [];
  for (const skill of loadedSkills) {
    if (skill.enabled && skill.systemPrompt) {
      prompts.push(`# [Skill: ${skill.name}]\n${skill.systemPrompt.trim()}`);
    }
  }
  return prompts.join('\n\n');
}

// 切换 skill 启用状态
function toggleSkill(skillId, enabled) {
  const skill = loadedSkills.find((s) => s.id === skillId);
  if (skill) {
    skill.enabled = enabled;
    // 持久化到文件（简单实现：重写整个文件）
    const filePath = path.join(SKILLS_DIR, `${skillId}.js`);
    if (fs.existsSync(filePath)) {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        // 替换 enabled 字段（简单正则）
        content = content.replace(/enabled:\s*(true|false)/g, `enabled: ${enabled}`);
        fs.writeFileSync(filePath, content, 'utf8');
      } catch (err) {
        console.error(`[Skill] 更新 ${skillId} 状态失败:`, err.message);
      }
    }
  }
}

// 获取所有 skill 元数据（用于 UI 展示）
function getAllSkills() {
  return loadedSkills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description || '',
    version: s.version || '1.0.0',
    author: s.author || '',
    enabled: s.enabled,
    toolCount: s.tools?.length || 0,
  }));
}

module.exports = {
  loadSkills,
  getSkillTools,
  getSkillPrompts,
  toggleSkill,
  getAllSkills,
  SKILLS_DIR,
};
