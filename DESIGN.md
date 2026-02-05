# ClaudeBot 设计文档

## 1. 项目概述

### 1.1 目标

ClaudeBot 是一个 Electron 系统托盘应用，提供两种远程控制 Claude Code CLI 的方式：

1. **Telegram Bot** — 通过 Telegram 消息发送指令，实时查看执行进度
2. **Dopamind 客户端** — 通过 HTTP 轮询接收来自 Dopamind 云端任务队列的指令

应用以系统托盘图标形式运行，提供启停控制和设置窗口，支持中英双语。

### 1.2 核心架构

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Telegram    │────▶│                  │     │                  │
│  (手机/PC)   │◀────│                  │     │                  │
└─────────────┘     │                  │     │                  │
                    │  claude-runner   │────▶│  claude CLI       │
┌─────────────┐     │  (会话管理/流解析) │◀────│  (stream-json)   │
│  Dopamind    │────▶│                  │     │                  │
│  (云端队列)   │◀────│                  │     │                  │
└─────────────┘     └──────────────────┘     └──────────────────┘
        │                   │                         │
   HTTP 轮询           Node.js 进程              spawn 子进程
   3 秒间隔            NDJSON 流解析             --output-format
                      会话恢复/重试               stream-json

┌──────────────────────────────────────────────────────────────┐
│                    Electron 主进程 (main.cjs)                 │
│  ┌────────┐  ┌────────┐  ┌────────────┐  ┌───────────────┐  │
│  │ 系统托盘 │  │ 设置窗口 │  │ 自动更新     │  │ 生命周期管理    │  │
│  └────────┘  └────────┘  └────────────┘  └───────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 技术栈

| 组件 | 技术 |
|------|------|
| 桌面框架 | Electron |
| Telegram API | node-telegram-bot-api (polling 模式) |
| CLI 集成 | child_process.spawn → Claude Code CLI |
| 模块系统 | ESM (bot.js, claude-runner.js) + CJS (main.cjs, dopamind-client.cjs) |
| 国际化 | 自定义 i18n.cjs + JSON locale 文件 |
| 构建打包 | electron-builder |
| 自动更新 | electron-updater + GitHub Releases |

---

## 2. 文件结构

```
ClaudeBot/
├── main.cjs                # Electron 主进程（托盘、IPC、配置窗口、自动更新）
├── bot.js                  # Telegram Bot（ESM，polling 模式，命令处理）
├── claude-runner.js        # 共享核心模块（CLI 调用、会话管理、流解析、重试）
├── dopamind-client.cjs     # Dopamind HTTP 轮询客户端（CJS）
├── config.html             # 设置界面（Electron BrowserWindow）
├── preload-config.cjs      # Electron preload 脚本（IPC 安全桥）
├── i18n.cjs                # 国际化模块（中/英双语）
├── splash.html             # 启动画面
├── release.cjs             # 一键发版脚本
├── fix-modules.cjs         # electron-builder afterPack 钩子
├── sessions.json           # 会话持久化（自动生成）
├── .env.example            # 环境变量模板
├── locales/
│   ├── zh.json             # 中文字符串
│   └── en.json             # 英文字符串
├── assets/
│   ├── icon.ico            # Windows 应用图标
│   ├── icon.png            # macOS/Linux 图标
│   ├── tray-running.png    # 托盘图标（运行中）
│   └── tray-stopped.png    # 托盘图标（已停止）
├── electron-builder.yml    # 构建配置
├── package.json            # 依赖和脚本
└── dist/                   # 构建输出
```

---

## 3. 模块详细设计

### 3.1 main.cjs — Electron 主进程

职责：应用生命周期、系统托盘、设置窗口、IPC 通信、自动更新。

**启动流程：**

1. 请求单实例锁（防止多开）
2. 显示启动画面（300×220，无边框，居中）
3. 从 `%APPDATA%/ClaudeBot/.env` 读取配置
4. 加载语言设置，初始化 i18n
5. 初始化 claude-runner（查找二进制文件、加载 sessions.json）
6. 启动 Telegram Bot（如已配置 Token）
7. 启动 Dopamind 客户端（如已启用）
8. 创建系统托盘图标和右键菜单
9. 检查自动更新（electron-updater）
10. 关闭启动画面

**IPC 通道：**

| 通道 | 方向 | 说明 |
|------|------|------|
| `get-config` | 渲染 → 主 | 获取当前 .env 配置 |
| `save-config` | 渲染 → 主 | 保存配置并重启服务 |
| `get-locale` | 渲染 → 主 | 获取当前语言和翻译字符串 |
| `select-directory` | 渲染 → 主 | 打开目录选择对话框 |

**托盘菜单项：**
- 启动/停止服务
- 打开设置窗口
- 退出应用

### 3.2 bot.js — Telegram Bot

职责：Telegram 消息轮询、命令处理、进度实时推送。

**命令列表：**

| 命令 | 格式 | 功能 |
|------|------|------|
| `/start` | `/start` | 显示帮助信息和当前工作目录 |
| `/new` | `/new` | 清除当前会话，重置上下文 |
| `/usage` | `/usage` | 显示上下文/输出/费用统计 |
| `/ask` | `/ask <问题>` | 向 Claude 提问 |
| `/run` | `/run <指令>` | 让 Claude 执行编程任务 |
| `/stop` | `/stop` | 停止当前运行的任务 |
| `/dir` | `/dir` | 查看当前工作目录 |
| `/setdir` | `/setdir <路径>` | 切换工作目录 |
| `/status` | `/status` | 显示状态、工作目录、用户 ID |
| 纯文本 | 直接发送 | 作为 prompt 发送给 Claude（保持上下文） |

**进度展示逻辑：**

- 发送"处理中"占位消息，后续通过编辑消息更新进度
- 工具调用分类显示：`[tool:Read]`、`[tool:Edit]`、`[tool:Bash]` 等
- 文本块显示：`[text] 预览内容...`
- 超过 5 个工具调用时折叠旧条目，只显示最新 5 条
- 节流控制：最多 2 秒编辑一次消息，避免 Telegram API 限速
- 完成后追加上下文使用百分比

**长消息处理：** Telegram 单条消息限制 4096 字符，超长内容按 4000 字符分段发送。

### 3.3 claude-runner.js — 核心执行模块

职责：Claude CLI 调用、会话管理、流式 JSON 解析、用量追踪、自动重试。

**CLI 调用方式：**

```javascript
spawn(claudePath, [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--dangerously-skip-permissions',
  '--verbose'
], {
  cwd: workDir,
  env: { ...process.env, FORCE_COLOR: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})
```

关键参数：
- `--output-format stream-json` — NDJSON 流式输出，支持实时进度
- `--dangerously-skip-permissions` — 跳过权限确认（远程场景需要）
- `stdio: ['ignore', 'pipe', 'pipe']` — stdin 关闭防止挂起
- `windowsHide: true` — 不弹出控制台窗口

**流式 JSON 解析：**

Claude CLI 以 NDJSON（每行一个 JSON）格式输出，消息类型包括：

| type | 说明 |
|------|------|
| `system` | 系统消息，包含 session_id、模型信息 |
| `assistant` | Claude 的响应（文本或工具调用） |
| `user` | 工具执行结果 |
| `result` | 最终结果，包含 usage、cost、session_id |

**进度提取：** 从 assistant 消息中提取工具调用详情：

| 工具 | 提取字段 |
|------|---------|
| Read / Edit / Write | `file_path` |
| Bash | `command` |
| Glob / Grep | `pattern` |
| WebSearch | `query` |
| WebFetch | `url` |
| 文本输出 | 前 200 字符预览 |

**会话管理：**

```json
// sessions.json
{
  "487381488": "8c65d377-f29e-474a-8549-8ebb3b5c003b",
  "dopamind_userId": "a1b2c3d4-..."
}
```

- Key：Telegram chatId 或 `dopamind_` + userId
- Value：Claude CLI 返回的 session UUID
- 恢复会话：通过 `--resume <sessionId>` 参数
- 收到 `result` 消息时自动保存 session_id

**用量追踪：** 每个会话独立记录：
- 上下文 token 数 / 上下文窗口总量（百分比）
- 输出 token 数
- 累计费用（USD）
- 对话轮数

**自动重试机制：**

| 错误类型 | 策略 |
|---------|------|
| 上下文溢出 ("Prompt is too long") | 删除会话 → 重试 1 次 |
| API 5xx / overloaded | 等待 5 秒 → 最多重试 2 次 |

### 3.4 dopamind-client.cjs — Dopamind 客户端

职责：HTTP 轮询云端队列、处理消息、回传进度和结果。

**轮询流程：**

```
每 3 秒
  │
  ▼
GET /api/desktop-queue/poll?limit=1
  │
  ├── 无消息 → 等待下一轮
  │
  └── 收到消息 → processMessage()
        │
        ├── 调用 callClaude(sessionKey, prompt, workDir, onProgress)
        │     │
        │     └── onProgress 回调
        │           │
        │           └── 缓冲 steps，每 2 秒 POST /api/desktop-queue/progress
        │
        └── 完成后 POST /api/desktop-queue/respond
              ├── success: true + response + cost
              └── success: false + errorMessage
```

**API 端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/desktop-queue/poll?limit=1` | 拉取待处理消息 |
| POST | `/api/desktop-queue/progress` | 上报执行进度 |
| POST | `/api/desktop-queue/respond` | 上报最终结果 |

### 3.5 config.html — 设置界面

通过 Electron BrowserWindow 展示，使用 `preload-config.cjs` 做 IPC 安全桥。

**配置项：**

| 字段 | 类型 | 说明 |
|------|------|------|
| 语言 | 下拉选择 | 中文 / English |
| Telegram Bot Token | 密码输入框 | 从 @BotFather 获取 |
| 允许的用户 ID | 文本输入框 | 逗号分隔的 Telegram 用户 ID |
| 工作目录 | 文本 + 浏览按钮 | Claude CLI 的工作目录 |
| Dopamind 开关 | 开关 | 启用/禁用 Dopamind 客户端 |
| Dopamind Token | 文本输入框 | 设备认证令牌 |

**安全措施：**
- `contextIsolation: true` — 渲染进程与主进程隔离
- `nodeIntegration: false` — 渲染进程无法直接访问 Node.js
- 通过 `contextBridge` 仅暴露白名单 IPC 方法

### 3.6 i18n.cjs — 国际化

- API：`t(key, params)`、`setLanguage(lang)`、`getLanguage()`
- 语言：`zh`（中文）、`en`（英文）
- 字符串数量：约 70 个 key，覆盖 Bot 消息、托盘菜单、设置界面、更新提示、错误信息
- 插值语法：`{paramName}` → 替换为实际值
- 语言设置持久化到 `.env` 的 `LANGUAGE` 字段

---

## 4. 数据流

### 4.1 Telegram 消息处理流程

```
用户发送消息
    │
    ▼
Telegram Bot API (polling)
    │
    ▼
bot.js 收到 message 事件
    │
    ├── 权限检查 (isAllowed)
    ├── 并发检查 (runningProcesses)
    ├── 发送 "处理中..." 占位消息
    │
    ▼
callClaude(chatId, prompt, workDir, onProgress)
    │
    ├── 查找/恢复会话 (sessions.json)
    ├── spawn claude CLI (stream-json 模式)
    │
    ▼
NDJSON 逐行解析
    │
    ├── system  → 记录 session_id
    ├── assistant (tool_use) → onProgress(工具名, 详情)
    │                             │
    │                             └── 编辑 Telegram 消息显示进度
    │                                 （节流：最多 2 秒/次）
    ├── assistant (text) → onProgress(文本预览)
    ├── user → 工具结果（内部消费）
    │
    └── result → 最终输出
                  │
                  ├── 保存 session_id
                  ├── 记录 usage 统计
                  │
                  ▼
         编辑占位消息为最终结果
         附加上下文使用百分比
```

### 4.2 Dopamind 消息处理流程

```
轮询 GET /poll (每 3 秒)
    │
    └── 收到消息 { messageId, content, userId }
          │
          ▼
    callClaude("dopamind_" + userId, content, workDir, onProgress)
          │
          ├── onProgress 回调
          │     └── 缓冲 steps → POST /progress (每 2 秒)
          │
          └── 完成
                └── POST /respond { messageId, response, success, cost }
```

---

## 5. Windows 平台特殊处理

### 5.1 Git Bash 依赖

Claude CLI 在 Windows 上内部依赖 Git Bash。启动时自动检测并注入环境变量：

```javascript
function findGitBash() {
  // 优先级：环境变量 > 常见安装路径
  // 1. process.env.CLAUDE_CODE_GIT_BASH_PATH
  // 2. C:\Program Files\Git\bin\bash.exe
  // 3. C:\Program Files (x86)\Git\bin\bash.exe
}
process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
```

### 5.2 Claude CLI 路径查找

```javascript
function findClaude() {
  // 1. C:\Program Files\Claude\.local\bin\claude.exe
  // 2. %LOCALAPPDATA%\Programs\claude-code\claude.exe
  // 3. 回退到 PATH 中的 'claude'
}
```

### 5.3 spawn 注意事项

- 必须直接执行 `claude.exe` 完整路径，不经过 shell
- `stdio: ['ignore', 'pipe', 'pipe']` — stdin 关闭防止等待输入
- `--output-format stream-json` — text 模式在 Windows 管道下 stdout 为空
- `windowsHide: true` — 不弹出控制台窗口

---

## 6. 构建与发布

### 6.1 构建配置 (electron-builder.yml)

| 平台 | 目标格式 | 架构 |
|------|---------|------|
| Windows | NSIS 安装包 | x64 |
| macOS | DMG | x64 + arm64 |
| Linux | AppImage + deb | — |

特殊配置：
- `asar: false` — 不压缩资源（便于调试）
- `afterPack: fix-modules.cjs` — 构建后补全缺失的生产依赖
- macOS `LSUIElement: true` — 隐藏 Dock 图标（纯托盘应用）

### 6.2 fix-modules.cjs — 依赖修复钩子

electron-builder 的依赖树分析有时遗漏 hoisted 模块。此钩子在打包后：
1. 运行 `npm ls --prod --all --parseable` 获取完整生产依赖列表
2. 对比打包后的 `resources/app/node_modules`
3. 复制缺失的模块到打包目录

### 6.3 自动更新

- 基于 `electron-updater` + GitHub Releases
- 启动时自动检查新版本
- 下载完成后弹窗提示用户安装

### 6.4 一键发版 (release.cjs)

```bash
npm run release -- patch   # 1.0.0 → 1.0.1
npm run release -- minor   # 1.0.0 → 1.1.0
npm run release -- major   # 1.0.0 → 2.0.0
npm run release -- 2.1.0   # 指定版本号
```

流程：更新 package.json 版本 → 提交 → 打 tag → 构建 → 推送 → 创建 GitHub Release → 上传安装包。

---

## 7. 环境变量

存储位置：`%APPDATA%/ClaudeBot/.env`（Windows）或 `~/Library/Application Support/ClaudeBot/.env`（macOS）

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `TELEGRAM_BOT_TOKEN` | 是 | — | Telegram Bot Token |
| `ALLOWED_USER_IDS` | 推荐 | 允许所有人 | 逗号分隔的 Telegram 用户 ID |
| `WORK_DIR` | 否 | 当前目录 | Claude CLI 工作目录 |
| `DOPAMIND_ENABLED` | 否 | `false` | 启用 Dopamind 客户端 |
| `DOPAMIND_TOKEN` | 否 | — | Dopamind 设备令牌 |
| `DOPAMIND_API_URL` | 否 | `https://api.dopamind.app` | Dopamind API 地址 |
| `LANGUAGE` | 否 | `zh` | 界面语言 (`zh` / `en`) |

---

## 8. 安全设计

### 8.1 访问控制
- `ALLOWED_USER_IDS` 限制授权的 Telegram 用户
- 未配置时所有人可用（启动时输出警告）
- Telegram 用户 ID 由平台分配，无法伪造

### 8.2 Electron 安全
- 设置窗口启用 `contextIsolation` 和禁用 `nodeIntegration`
- 通过 `preload-config.cjs` + `contextBridge` 仅暴露白名单 IPC 方法
- 配置文件存储在系统用户数据目录，不随代码分发

### 8.3 敏感信息
- `.env` 文件不提交到 Git（存储在 userData 路径）
- Bot Token、用户 ID 等敏感信息仅通过设置界面配置
- **不要** 在文档或代码中硬编码真实 Token

### 8.4 Claude CLI 权限
- 使用 `--dangerously-skip-permissions` 跳过交互式权限确认
- 建议将 `WORK_DIR` 限制在特定项目目录以缩小操作范围

---

## 9. 部署指南

### 9.1 安装包方式（推荐）

从 [GitHub Releases](https://github.com/Philo-Li/claudebot/releases) 下载对应平台安装包：
- Windows：`.exe` (NSIS 安装包)
- macOS：`.dmg`
- Linux：`.AppImage` 或 `.deb`

安装后首次启动，点击托盘图标 → 设置，填写 Telegram Bot Token 和用户 ID。

### 9.2 开发模式

```bash
# 克隆仓库
git clone https://github.com/Philo-Li/claudebot.git
cd claudebot

# 安装依赖
npm install

# Electron 开发模式
npm run electron:dev

# 或直接运行 Telegram Bot（无 Electron）
npm start
```

### 9.3 前置条件

1. 安装 Git for Windows（Claude CLI 依赖 Git Bash）
2. 安装并登录 Claude Code CLI（确保 `claude --version` 正常输出）
3. 创建 Telegram Bot（通过 @BotFather 获取 Token）

### 9.4 创建 Telegram Bot

1. 打开 Telegram，搜索 **@BotFather** 并发送 `/newbot`
2. 按提示设置 Bot 名称和用户名（用户名必须以 `bot` 结尾）
3. 创建成功后获得 Token，格式类似 `123456789:ABCdefGHI...`
4. 将 Token 填入 ClaudeBot 设置界面

### 9.5 获取 Telegram 用户 ID

1. 在 Telegram 中搜索 **@userinfobot**
2. 发送任意消息，获取回复中的 `Id` 数字
3. 将 ID 填入设置界面的"允许的用户 ID"字段

---

## 10. 常见问题

### Q: 启动后报错 "Claude Code on Windows requires git-bash"
确保安装了 Git for Windows。如果安装在非标准路径，设置环境变量 `CLAUDE_CODE_GIT_BASH_PATH` 指向 `bash.exe`。

### Q: 发送消息后一直显示"处理中"
检查 Claude CLI 是否正常工作：在终端执行 `claude -p "hello" --output-format stream-json`，确认有输出。

### Q: 如何同时使用 Telegram 和 Dopamind？
在设置中填写 Telegram Token，同时开启 Dopamind 开关并填写设备令牌。两个客户端独立运行，共享 claude-runner 模块。

### Q: 会话上下文如何工作？
每个用户（Telegram chatId / Dopamind userId）维护独立会话。会话 ID 存储在 `sessions.json`，通过 `--resume` 参数恢复上下文。使用 `/new` 命令可清除当前会话。

### Q: 上下文溢出怎么办？
claude-runner 会自动检测 "Prompt is too long" 错误，删除当前会话并以新会话重试一次。

### Q: 每次调用费用大约多少？
简单问答约 $0.01–0.05，复杂编程任务约 $0.05–0.50。每次回复附带费用信息，使用 `/usage` 可查看累计统计。
