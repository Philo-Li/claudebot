# ClaudeBot

[English](./README.md)

ClaudeBot 是一个 Windows/macOS/Linux 系统托盘应用，让你通过 **Telegram** 或 **Dopamind** 远程控制本地的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI。

你可以在手机上发一条消息，ClaudeBot 就会在你的电脑上调用 Claude Code 执行任务，并把结果实时推送回来。

## 功能特性

- **Telegram 机器人** — 通过 Telegram 发送指令，远程操控 Claude Code
- **Dopamind 集成** — 从 Dopamind 队列接收任务并自动处理
- **会话记忆** — 自动保持上下文，支持多轮对话
- **实时进度** — 任务执行过程中实时推送进度更新
- **系统托盘** — 后台静默运行，不占用桌面空间
- **自动更新** — 通过 GitHub Releases 自动检查并安装新版本
- **跨平台** — 支持 Windows、macOS、Linux

## 安装

### 下载安装包

前往 [Releases](https://github.com/Philo-Li/claudebot/releases) 页面，下载对应平台的安装包：

| 平台    | 文件                                                                    |
| ------- | ----------------------------------------------------------------------- |
| Windows | `ClaudeBot-Setup-x.x.x.exe`（安装版）或 `ClaudeBot-x.x.x.exe`（便携版） |
| macOS   | `ClaudeBot-x.x.x.dmg`                                                   |
| Linux   | `ClaudeBot-x.x.x.AppImage` 或 `.deb`                                    |

### 前置条件

本机需要先安装 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)，并确保在终端中可以直接运行 `claude` 命令。

## 快速开始

### 1. 创建 Telegram Bot

1. 在 Telegram 中找到 [@BotFather](https://t.me/BotFather)，发送 `/newbot`
2. 按照提示设置名称，完成后会得到一个 **Bot Token**（格式如 `123456:ABC-DEF...`）
3. 找到 [@userinfobot](https://t.me/userinfobot)，发送任意消息获取你的 **User ID**

### 2. 配置 ClaudeBot

1. 启动 ClaudeBot，首次运行会自动弹出设置窗口
2. 填入：
   - **Telegram Bot Token** — 上一步获取的 Token
   - **Allowed User IDs** — 你的 Telegram User ID（多个用逗号分隔）
   - **Work Directory** — Claude Code 的工作目录（如你的项目文件夹）
3. 点击保存，Bot 会自动启动

### 3. 开始使用

打开 Telegram，找到你的 Bot，直接发消息即可：

```
你好，帮我看看当前目录有哪些文件
```

ClaudeBot 会调用 Claude Code 处理你的请求，并把结果发回 Telegram。

## Telegram 命令

| 命令             | 说明                     |
| ---------------- | ------------------------ |
| `/ask <问题>`    | 向 Claude 提问           |
| `/run <指令>`    | 让 Claude 执行任务       |
| `/new`           | 开始新会话（清除上下文） |
| `/stop`          | 停止当前正在运行的任务   |
| `/dir`           | 查看当前工作目录         |
| `/setdir <路径>` | 设置工作目录             |
| `/status`        | 查看 Bot 运行状态        |

直接发送普通消息（不带 `/`）也会被当作提问发送给 Claude，并且自动保持会话上下文。

## Dopamind 集成

ClaudeBot 支持接入 [Dopamind](https://dopamind.app) 平台，从云端队列接收任务。

### 启用方法

1. 右键托盘图标 → 设置
2. 勾选 **Enable Dopamind**
3. 填入从 Dopamind App 获取的 **Device Token**（格式如 `dpm_...`）
4. 保存并重启

启用后，ClaudeBot 会每 3 秒轮询一次 Dopamind 队列，自动处理收到的任务，并将进度和结果回传。

## 托盘菜单

右键点击系统托盘图标，可以看到以下选项：

| 菜单项            | 说明                                             |
| ----------------- | ------------------------------------------------ |
| Status            | 显示当前运行状态（Telegram / Dopamind / 已停止） |
| Start Bot         | 启动所有已配置的服务                             |
| Stop Bot          | 停止所有服务                                     |
| 设置              | 打开配置窗口                                     |
| Check for Updates | 手动检查新版本                                   |
| Open Data Folder  | 打开配置文件所在目录                             |
| Quit              | 退出应用                                         |

## 从源码运行

```bash
# 克隆仓库
git clone https://github.com/Philo-Li/claudebot.git
cd claudebot

# 安装依赖
npm install

# 以 Electron 托盘应用运行（开发模式）
npm run electron:dev

# 或仅运行 Telegram Bot（不启动 Electron）
npm start
```

### 构建安装包

```bash
npm run build:win      # Windows（NSIS 安装版 + 便携版）
npm run build:mac      # macOS（DMG）
npm run build:linux    # Linux（AppImage + deb）
```

## 配置项

所有配置存储在系统用户数据目录下的 `.env` 文件中：

- Windows: `%APPDATA%\ClaudeBot\.env`
- macOS: `~/Library/Application Support/ClaudeBot/.env`
- Linux: `~/.config/ClaudeBot/.env`

| 变量名               | 说明                                       |
| -------------------- | ------------------------------------------ |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API Token                     |
| `ALLOWED_USER_IDS`   | 允许使用的 Telegram 用户 ID，逗号分隔      |
| `WORK_DIR`           | Claude Code 默认工作目录                   |
| `DOPAMIND_ENABLED`   | 是否启用 Dopamind 集成（`true` / `false`） |
| `DOPAMIND_TOKEN`     | Dopamind 设备认证 Token                    |

## 自动更新

ClaudeBot 内置了自动更新功能。应用启动时会自动检查 GitHub Releases 上的新版本，如果有更新：

1. 自动在后台下载
2. 下载完成后弹窗提示
3. 选择「立即重启」即可完成更新

也可以通过托盘菜单中的 **Check for Updates** 手动触发检查。

## 许可证

MIT
