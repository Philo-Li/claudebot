# Claude Code Telegram Bot 设计文档

## 1. 项目概述

### 1.1 目标

通过 Telegram Bot 远程控制本地电脑上的 Claude Code，实现随时随地通过手机指挥 Claude Code 执行编程任务。

### 1.2 核心架构

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Telegram   │────▶│   桥接服务      │────▶│  claude.exe      │
│  (手机/PC)  │◀────│   (bot.js)      │◀────│  (Claude Code)   │
└─────────────┘     └─────────────────┘     └──────────────────┘
      │                     │                        │
   用户发送            Node.js 进程              spawn 子进程
   指令消息            接收消息 →                执行任务 →
                       解析 JSON ←               JSON 输出 ←
                       返回 Telegram
```

### 1.3 技术栈

- **运行环境**: Node.js v20+
- **Telegram 库**: node-telegram-bot-api
- **Claude 调用方式**: 直接 spawn `claude.exe`，`--output-format json`
- **平台**: Windows（有特殊的子进程处理要求，见第 3 章）

---

## 2. 实现方案对比

### 2.1 方案一：CLI 调用（当前实现）

**原理**：通过 `child_process.spawn` 直接执行 `claude.exe` 二进制文件

```javascript
spawn(claudePath, ['-p', prompt, '--output-format', 'json'], {
  cwd: workDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})
```

**优点**：
- 实现简单，代码量少
- 不依赖额外 SDK
- Claude Code 功能开箱即用

**缺点**：
- 每次调用独立，无上下文记忆
- 无法流式输出（只能等全部完成后一次性返回）
- 控制粒度较粗

### 2.2 方案二：SDK 调用（未来扩展）

**原理**：使用 `@anthropic-ai/claude-code` 包的 SDK 编程调用

**现状**：经实际验证，`@anthropic-ai/claude-code` npm 包只是 CLI 本身（`cli.js`），
没有导出可编程调用的 `query()` 函数。SDK 可能在未来版本中作为独立包发布。

**如果 SDK 可用，预期用法**：
```javascript
import { query } from '@anthropic-ai/claude-code';

for await (const message of query({
  prompt: '来自 Telegram 的指令',
  options: {
    cwd: '/your/project',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
    maxTurns: 10,
    permissionMode: 'acceptEdits'
  }
})) {
  if (message.type === 'result') {
    console.log(message.result);
  }
}
```

**预期优点**（SDK 可用后）：
- 可保持会话上下文（通过 `resume` 参数）
- 支持流式输出，实时推送进度到 Telegram
- 精细控制工具权限和预算
- 结构化错误处理

---

## 3. Windows 平台踩坑记录

在 Windows 上从 Node.js 调用 `claude.exe` 遇到了多个问题，以下是完整的排查过程和最终方案。

### 3.1 问题一：claude.exe 需要 Git Bash

`claude.exe` 在 Windows 上运行时，内部需要调用 Git Bash。如果找不到，会报错：

```
Claude Code on Windows requires git-bash (https://git-scm.com/downloads/win).
If installed but not in PATH, set environment variable pointing to your bash.exe,
similar to: CLAUDE_CODE_GIT_BASH_PATH=C:\Program Files\Git\bin\bash.exe
```

**解决方案**：启动时自动检测 Git Bash 位置，注入环境变量 `CLAUDE_CODE_GIT_BASH_PATH`。

```javascript
function findGitBash() {
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const candidates = [
    'C:\\Software\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// 注入到 process.env，子进程会继承
process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
```

### 3.2 问题二：多种 spawn 方式测试结果

从 Node.js（PowerShell 启动）调用 claude，测试了 5 种方式：

| 方式 | 代码 | 结果 |
|------|------|------|
| `spawn` + `shell: true` | `spawn('claude', args, { shell: true })` | 进程挂起，永不返回 |
| `exec` via cmd.exe | `exec('claude -p "..." --output-format text')` | 退出码 0，stdout 为空 |
| `execFile` via git-bash | `execFile(gitBash, ['-c', 'claude ...'])` | 退出码 0，stdout 为空 |
| `execFile` claude.exe 直接 | `execFile(claudeExe, args)` | 退出码 0，stdout 为空 |
| **`spawn` claude.exe 直接** | `spawn(claudeExe, args, { stdio: ['ignore', 'pipe', 'pipe'] })` | **成功** |

### 3.3 问题三：`--output-format text` 输出为空

即使使用正确的 spawn 方式，`--output-format text` 在 Windows 管道环境下 stdout 为空。
但 `--output-format json` 能正常捕获输出。

**原因推测**：`claude.exe` 在 `text` 模式下可能直接写入 Windows 控制台（conhost），
绕过了 Node.js 的管道；`json` 模式则正常写入 stdout。

### 3.4 最终方案

```javascript
const proc = spawn(claudePath, ['-p', prompt, '--output-format', 'json'], {
  cwd: workDir,
  env: { ...process.env, FORCE_COLOR: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],  // 关键：stdin 设为 ignore
  windowsHide: true                    // 不弹出窗口
});
```

关键要素：
1. **直接执行 `claude.exe` 完整路径**，不经过任何 shell
2. **`stdio: ['ignore', 'pipe', 'pipe']`** — stdin 关闭防止等待输入，stdout/stderr 通过管道捕获
3. **`--output-format json`** — text 格式在 Windows 管道下 stdout 为空，必须用 json
4. **`windowsHide: true`** — 防止弹出控制台窗口
5. **`CLAUDE_CODE_GIT_BASH_PATH` 环境变量** — claude.exe 内部需要

---

## 4. 详细设计

### 4.1 文件结构

```
ClaudeBot/
├── bot.js           # 主程序入口（约 270 行）
├── package.json     # 项目配置和依赖
├── .env             # 环境变量配置（不提交到 Git）
├── .env.example     # 配置示例文件
└── DESIGN.md        # 本设计文档
```

### 4.2 配置项

| 配置项 | 必填 | 说明 |
|--------|------|------|
| `TELEGRAM_BOT_TOKEN` | 是 | Telegram Bot Token，从 @BotFather 获取 |
| `ALLOWED_USER_IDS` | 推荐 | 允许使用 Bot 的用户 ID 列表，逗号分隔 |
| `WORK_DIR` | 否 | Claude Code 默认工作目录，默认为当前目录 |

### 4.3 核心模块

#### 4.3.1 配置加载

手动解析 `.env` 文件（不依赖 dotenv 库），解析逻辑：
- 按行分割
- 跳过 `#` 开头的注释
- 按第一个 `=` 分割 key/value（value 中可以包含 `=`）
- 写入 `process.env`

#### 4.3.2 路径查找

启动时自动检测两个关键路径：

**Git Bash 路径**：按优先级搜索：
1. 环境变量 `CLAUDE_CODE_GIT_BASH_PATH`
2. `C:\Software\Git\bin\bash.exe`
3. `C:\Program Files\Git\bin\bash.exe`
4. `C:\Program Files (x86)\Git\bin\bash.exe`

**Claude 路径**：按优先级搜索：
1. `C:\Program Files\Claude\.local\bin\claude.exe`
2. `%LOCALAPPDATA%\Programs\claude-code\claude.exe`
3. 回退到 PATH 中的 `claude`

#### 4.3.3 Claude 调用模块

```javascript
async function callClaude(chatId, prompt, workDir) {
  // 1. spawn claude.exe，参数 ['-p', prompt, '--output-format', 'json']
  // 2. stdin 设为 ignore（防止挂起）
  // 3. 收集 stdout（JSON 格式）和 stderr
  // 4. 进程关闭后解析 JSON，提取 result 字段
  // 5. 返回 { success, output, cost }
}
```

JSON 输出格式示例：

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 2269,
  "duration_api_ms": 2086,
  "num_turns": 1,
  "result": "OK",
  "session_id": "04b72852-7365-41e6-8be5-478a6af757e4",
  "total_cost_usd": 0.01004,
  "usage": {
    "input_tokens": 3,
    "output_tokens": 4
  }
}
```

程序提取 `result` 作为回复文本，`total_cost_usd` 作为费用显示。

#### 4.3.4 消息发送模块

Telegram 消息限制 4096 字符。超长消息自动分段：

```javascript
async function sendLongMessage(chatId, text, prefix) {
  // 拼接 prefix + text
  // 如果 <= 4000 字符，直接发送
  // 否则按 4000 字符分段，每段标注 [1/3] [2/3] [3/3]
}
```

#### 4.3.5 进程管理

```javascript
const runningProcesses = new Map();
// key: chatId (Telegram 聊天 ID)
// value: ChildProcess 实例
```

- 同一聊天只能同时运行一个任务
- `/stop` 命令发送 `SIGTERM` 信号终止进程
- 进程结束后自动从 Map 中移除

### 4.4 Bot 命令设计

| 命令 | 格式 | 功能 |
|------|------|------|
| `/start` | `/start` | 显示帮助信息和当前工作目录 |
| `/ask` | `/ask <问题>` | 向 Claude 提问 |
| `/run` | `/run <指令>` | 让 Claude 执行编程任务 |
| `/stop` | `/stop` | 停止当前运行的任务 |
| `/dir` | `/dir` | 显示当前工作目录 |
| `/setdir` | `/setdir <路径>` | 切换工作目录（验证路径存在） |
| `/status` | `/status` | 显示 Bot 状态、工作目录、用户 ID |

直接发送文本消息（非 `/` 开头）会被当作 `/run` 处理。

### 4.5 数据流

```
用户发送 "帮我看看有什么文件"
         │
         ▼
Telegram Bot API (polling)
         │
         ▼
bot.js 收到 message 事件
         │
         ├── 权限检查 (isAllowed)
         ├── 冲突检查 (runningProcesses.has)
         ├── 发送 "正在处理..." 到 Telegram
         │
         ▼
spawn claude.exe -p "帮我看看有什么文件" --output-format json
         │
         ├── stdout 收集 JSON 数据
         ├── stderr 收集错误信息
         │
         ▼
进程关闭 (close 事件)
         │
         ├── JSON.parse(stdout)
         ├── 提取 result 和 total_cost_usd
         │
         ▼
sendLongMessage → Telegram
         │
         └── "当前目录包含以下文件:
              - notes/
              - templates/
              ...

              --- 费用: $0.0451"
```

---

## 5. 部署与配置指南

### 5.1 前置条件

1. 安装 Node.js v20+
2. 安装 Git for Windows（Claude Code 依赖 Git Bash）
3. 安装并登录 Claude Code CLI（确保 `claude --version` 能正常输出）

### 5.2 创建 Telegram Bot（获取 Token）

1. 打开 Telegram，搜索 **@BotFather** 并进入对话
2. 发送 `/newbot`
3. BotFather 会要求你输入：
   - **Bot 名称**：显示名，例如 `My Claude Bot`
   - **Bot 用户名**：必须以 `bot` 结尾，例如 `my_claude_code_bot`
4. 创建成功后，BotFather 会回复一段消息，其中包含 Token，格式类似：
   ```
   Use this token to access the HTTP API:
   8263396582:AAHk_fgHzuOws58XRNCaAS-hsaOtVzuZX8o
   ```
5. 复制这个 Token，后续填入 `.env` 文件的 `TELEGRAM_BOT_TOKEN` 字段

### 5.3 获取你的 Telegram 用户 ID

1. 在 Telegram 中搜索 **@userinfobot** 并进入对话
2. 发送任意消息，它会回复你的用户信息，例如：
   ```
   Id: 487381488
   First: Philo
   Lang: zh-hans
   ```
3. 复制 `Id` 后面的数字，填入 `.env` 文件的 `ALLOWED_USER_IDS` 字段
4. 如果有多个用户，用逗号分隔：`487381488,123456789`

### 5.4 安装与配置

```bash
# 1. 进入项目目录
cd ClaudeBot

# 2. 安装依赖
npm install

# 3. 复制配置模板
cp .env.example .env

# 4. 编辑 .env 文件
```

`.env` 文件配置示例：

```ini
# Telegram Bot Token (从 @BotFather 获取)
TELEGRAM_BOT_TOKEN=8263396582:AAHk_fgHzuOws58XRNCaAS-hsaOtVzuZX8o

# 允许使用 Bot 的 Telegram 用户 ID (安全限制)
ALLOWED_USER_IDS=487381488

# Claude Code 工作目录
WORK_DIR=C:\Work\Obsidian
```

### 5.5 启动 Bot

```bash
npm start
```

启动成功后会输出：

```
Git Bash: C:\Software\Git\bin\bash.exe
Claude: C:\Program Files\Claude\.local\bin\claude.exe
========================================
Claude Code Telegram Bot 已启动
工作目录: C:\Work\Obsidian
授权用户: 487381488
========================================
```

### 5.6 长期运行（可选）

使用 `pm2` 后台运行并开机自启：

```bash
npm install -g pm2
pm2 start bot.js --name claude-bot
pm2 save
pm2 startup   # 设置开机自启
```

### 5.7 日常使用

打开 Telegram，找到你创建的 Bot，直接发消息即可：

```
你: hi
Bot: 正在处理...
Bot: Hi! How can I help you today?

     --- 费用: $0.0451

你: /setdir C:\Work\CS\MyProject
Bot: 工作目录已设置为: C:\Work\CS\MyProject

你: 帮我在 src/utils 下创建一个日期格式化函数
Bot: 正在处理...
Bot: 已创建 src/utils/dateFormat.js ...

     --- 费用: $0.0832
```

---

## 6. 安全考虑

### 6.1 访问控制
- **必须** 配置 `ALLOWED_USER_IDS` 限制授权用户
- 未授权用户的请求会被拒绝
- 用户 ID 是 Telegram 分配的唯一数字，无法伪造

### 6.2 权限边界
- Bot 继承 Claude Code 的全部权限（读写文件、执行命令）
- 建议将 `WORK_DIR` 限制在特定项目目录
- Claude Code 自身有安全限制（如不删除系统文件）

### 6.3 风险提示
- 不要在公共网络暴露 Bot Token
- `.env` 文件不要提交到 Git
- 定期检查控制台日志
- 每次调用的费用会显示在回复中，注意监控

---

## 7. 扩展计划

### 7.1 近期可添加功能
- [ ] 支持发送文件（代码、截图）给 Claude
- [ ] 任务队列（多任务排队执行）
- [ ] 超时自动终止并通知
- [ ] 多项目/多目录快速切换（如 `/switch project1`）

### 7.2 中期优化方向
- [ ] 等 SDK 发布后迁移，支持会话上下文和流式输出
- [ ] 流式输出 — 每隔几秒编辑 Telegram 消息显示进度
- [ ] 工具权限白名单配置
- [ ] 费用统计和日报

### 7.3 长期愿景
- [ ] 多用户支持，每人独立工作空间
- [ ] 与 GitHub/GitLab 集成
- [ ] 定时任务（如每日代码审查）
- [ ] 语音消息转文字后发送给 Claude

---

## 8. 完整代码 (bot.js)

```javascript
import TelegramBot from 'node-telegram-bot-api';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';

// ============== 配置 ==============
function loadConfig() {
  if (existsSync('.env')) {
    const envContent = readFileSync('.env', 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, ...values] = line.split('=');
      if (key && values.length > 0 && !key.startsWith('#')) {
        process.env[key.trim()] = values.join('=').trim();
      }
    });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUsers = process.env.ALLOWED_USER_IDS?.split(',').map(id => parseInt(id.trim())) || [];
  const workDir = process.env.WORK_DIR || process.cwd();

  if (!token) {
    console.error('错误: 请设置 TELEGRAM_BOT_TOKEN');
    process.exit(1);
  }

  if (allowedUsers.length === 0) {
    console.warn('警告: 未设置 ALLOWED_USER_IDS，任何人都可以使用此 Bot！');
  }

  return { token, allowedUsers, workDir };
}

const config = loadConfig();

// ============== 查找路径 ==============
function findGitBash() {
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const candidates = [
    'C:\\Software\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function findClaude() {
  const candidates = [
    'C:\\Program Files\\Claude\\.local\\bin\\claude.exe',
    process.env.LOCALAPPDATA + '\\Programs\\claude-code\\claude.exe',
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return 'claude';
}

const gitBashPath = findGitBash();
if (gitBashPath) {
  process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
  console.log(`Git Bash: ${gitBashPath}`);
}

const claudePath = findClaude();
console.log(`Claude: ${claudePath}`);

// ============== Telegram Bot ==============
const bot = new TelegramBot(config.token, { polling: true });
const runningProcesses = new Map();

function isAllowed(userId) {
  if (config.allowedUsers.length === 0) return true;
  return config.allowedUsers.includes(userId);
}

// ============== 调用 Claude Code ==============
async function callClaude(chatId, prompt, workDir) {
  return new Promise((resolve) => {
    console.log(`[${new Date().toISOString()}] 执行: claude -p ...`);
    console.log(`[工作目录] ${workDir}`);

    const proc = spawn(claudePath, ['-p', prompt, '--output-format', 'json'], {
      cwd: workDir,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    runningProcesses.set(chatId, proc);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      runningProcesses.delete(chatId);
      console.log(`[${new Date().toISOString()}] 完成, 退出码: ${code}, 输出长度: ${stdout.length}`);

      if (stderr && !stdout) {
        resolve({ success: false, output: stderr });
        return;
      }

      try {
        const json = JSON.parse(stdout);
        resolve({
          success: !json.is_error,
          output: json.result || json.errors?.join('\n') || '(无输出)',
          cost: json.total_cost_usd
        });
      } catch {
        resolve({
          success: code === 0,
          output: stdout || stderr || `进程退出码: ${code}`
        });
      }
    });

    proc.on('error', (err) => {
      runningProcesses.delete(chatId);
      resolve({ success: false, output: `执行错误: ${err.message}` });
    });
  });
}

// ============== 消息发送 ==============
async function sendLongMessage(chatId, text, prefix = '') {
  const maxLength = 4000;
  const fullText = prefix + text;

  if (fullText.length <= maxLength) {
    await bot.sendMessage(chatId, fullText);
    return;
  }

  const chunks = [];
  let remaining = fullText;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunkPrefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}]\n` : '';
    await bot.sendMessage(chatId, chunkPrefix + chunks[i]);
  }
}

// ============== 命令处理 ==============
bot.onText(/\/start/, (msg) => {
  if (!isAllowed(msg.from.id)) {
    bot.sendMessage(msg.chat.id, '抱歉，你没有权限使用此 Bot。');
    return;
  }
  bot.sendMessage(msg.chat.id,
`Claude Code Telegram Bot

命令:
/ask <问题> - 向 Claude 提问
/run <指令> - 让 Claude 执行任务
/stop - 停止当前任务
/dir - 查看当前工作目录
/setdir <路径> - 设置工作目录
/status - 查看状态

直接发送消息也会被当作指令发送给 Claude。

当前工作目录: ${config.workDir}`
  );
});

bot.onText(/\/stop/, (msg) => {
  if (!isAllowed(msg.from.id)) return;
  const proc = runningProcesses.get(msg.chat.id);
  if (proc) {
    proc.kill('SIGTERM');
    runningProcesses.delete(msg.chat.id);
    bot.sendMessage(msg.chat.id, '已停止当前任务。');
  } else {
    bot.sendMessage(msg.chat.id, '当前没有运行中的任务。');
  }
});

bot.onText(/\/dir$/, (msg) => {
  if (!isAllowed(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, `当前工作目录: ${config.workDir}`);
});

bot.onText(/\/setdir (.+)/, (msg, match) => {
  if (!isAllowed(msg.from.id)) return;
  const newDir = match[1].trim();
  if (existsSync(newDir)) {
    config.workDir = newDir;
    bot.sendMessage(msg.chat.id, `工作目录已设置为: ${newDir}`);
  } else {
    bot.sendMessage(msg.chat.id, `目录不存在: ${newDir}`);
  }
});

bot.onText(/\/status/, (msg) => {
  if (!isAllowed(msg.from.id)) return;
  const isRunning = runningProcesses.has(msg.chat.id);
  bot.sendMessage(msg.chat.id,
`状态:
- 工作目录: ${config.workDir}
- 任务状态: ${isRunning ? '运行中' : '空闲'}
- 你的用户 ID: ${msg.from.id}`
  );
});

bot.onText(/\/(ask|run) ([\s\S]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAllowed(msg.from.id)) {
    bot.sendMessage(chatId, '抱歉，你没有权限使用此 Bot。');
    return;
  }
  if (runningProcesses.has(chatId)) {
    bot.sendMessage(chatId, '已有任务在运行中，请等待完成或使用 /stop 停止。');
    return;
  }

  const prompt = match[2].trim();
  await bot.sendMessage(chatId, `正在处理...\n\n指令: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);

  const result = await callClaude(chatId, prompt, config.workDir);

  const prefix = result.success ? '' : '[错误] ';
  const suffix = result.cost ? `\n\n--- 费用: $${result.cost.toFixed(4)}` : '';
  await sendLongMessage(chatId, result.output + suffix, prefix);
});

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/') || !msg.text) return;
  const chatId = msg.chat.id;
  if (!isAllowed(msg.from.id)) {
    bot.sendMessage(chatId, '抱歉，你没有权限使用此 Bot。');
    return;
  }
  if (runningProcesses.has(chatId)) {
    bot.sendMessage(chatId, '已有任务在运行中，请等待完成或使用 /stop 停止。');
    return;
  }

  await bot.sendMessage(chatId, '正在处理...');

  const result = await callClaude(chatId, msg.text.trim(), config.workDir);

  const prefix = result.success ? '' : '[错误] ';
  const suffix = result.cost ? `\n\n--- 费用: $${result.cost.toFixed(4)}` : '';
  await sendLongMessage(chatId, result.output + suffix, prefix);
});

// ============== 启动 ==============
console.log('========================================');
console.log('Claude Code Telegram Bot 已启动');
console.log(`工作目录: ${config.workDir}`);
console.log(`授权用户: ${config.allowedUsers.length > 0 ? config.allowedUsers.join(', ') : '所有人'}`);
console.log('========================================');
```

---

## 9. 常见问题

### Q: 如何获取 Telegram Bot Token?
在 Telegram 中搜索 @BotFather，发送 `/newbot`，按提示操作即可获得 Token。

### Q: 如何获取我的 Telegram 用户 ID?
在 Telegram 中搜索 @userinfobot，发送任意消息，它会回复你的用户 ID。

### Q: 启动后报错 "Claude Code on Windows requires git-bash"
确保安装了 Git for Windows，程序会自动查找 Git Bash。如果安装在非标准路径，
设置环境变量：`CLAUDE_CODE_GIT_BASH_PATH=你的bash.exe路径`

### Q: 发送消息后一直显示"正在处理"不返回
检查控制台日志。确保使用的是最新版 bot.js（使用 `spawn` 直接执行 `claude.exe`
+ `--output-format json` + `stdio: ['ignore', 'pipe', 'pipe']`）。
详见第 3 章踩坑记录。

### Q: 每次调用费用大约多少?
简单问答约 $0.01-0.05，复杂编程任务约 $0.05-0.50，取决于上下文大小和输出长度。
每次回复都会附带费用信息。

### Q: 能否同时处理多个任务?
当前设计每个聊天只能同时运行一个任务。使用 `/stop` 停止后可发送新任务。

### Q: 如何在后台长期运行?
推荐使用 `pm2`：
```bash
npm install -g pm2
pm2 start bot.js --name claude-bot
pm2 save
pm2 startup
```
