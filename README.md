# ClaudeBot

[中文文档](./README.zh-CN.md)

ClaudeBot is a system tray application for Windows, macOS, and Linux that lets you remotely control the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI via **Telegram** or **Dopamind**.

Send a message from your phone, and ClaudeBot will invoke Claude Code on your computer and stream the results back in real time.

## Features

- **Telegram Bot** — Send prompts and commands to Claude Code through Telegram
- **Dopamind Integration** — Receive and process tasks from the Dopamind cloud queue
- **Session Memory** — Maintains conversation context across messages
- **Live Progress** — Real-time progress updates while tasks are running
- **System Tray** — Runs silently in the background
- **Auto Update** — Automatically checks and installs new versions from GitHub Releases
- **Cross-Platform** — Windows, macOS, and Linux

## Installation

### Download

Go to the [Releases](https://github.com/Philo-Li/claudebot/releases) page and download the installer for your platform:

| Platform | File                                                                        |
| -------- | --------------------------------------------------------------------------- |
| Windows  | `ClaudeBot-Setup-x.x.x.exe` (installer) or `ClaudeBot-x.x.x.exe` (portable) |
| macOS    | `ClaudeBot-x.x.x.dmg`                                                       |
| Linux    | `ClaudeBot-x.x.x.AppImage` or `.deb`                                        |

### Prerequisites

You must have the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and the `claude` command available in your terminal.

## Quick Start

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram, send `/newbot`
2. Follow the prompts to set a name — you'll receive a **Bot Token** (e.g. `123456:ABC-DEF...`)
3. Open [@userinfobot](https://t.me/userinfobot) and send any message to get your **User ID**

### 2. Configure ClaudeBot

1. Launch ClaudeBot — the settings window opens automatically on first run
2. Fill in:
   - **Telegram Bot Token** — the token from step 1
   - **Allowed User IDs** — your Telegram User ID (comma-separated for multiple users)
   - **Work Directory** — the working directory for Claude Code (e.g. your project folder)
3. Click Save — the bot starts automatically

### 3. Start Using

Open Telegram, find your bot, and send a message:

```
Hey, list the files in the current directory
```

ClaudeBot will pass your message to Claude Code and send the result back to Telegram.

## Telegram Commands

Just send a message — no command needed. ClaudeBot passes it to Claude Code and streams the result back. Session context is preserved automatically.

| Command          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `/new`           | Start a new session (clear context)                  |
| `/stop`          | Stop the currently running task                      |
| `/usage`         | View token usage, cost, and context window           |
| `/status`        | View bot status (includes working directory)         |
| `/setdir <path>` | Set working directory (temporary, resets on restart) |

## Dopamind Integration

ClaudeBot can connect to the [Dopamind](https://dopamind.app) platform to receive tasks from a cloud queue.

### Setup

1. Right-click the tray icon → Settings
2. Check **Enable Dopamind**
3. Enter the **Device Token** from the Dopamind app (format: `dpm_...`)
4. Save and restart

Once enabled, ClaudeBot polls the Dopamind queue every 3 seconds, processes incoming tasks via Claude Code, and posts progress and results back.

## Tray Menu

Right-click the system tray icon to access:

| Item              | Description                                         |
| ----------------- | --------------------------------------------------- |
| Status            | Shows current state (Telegram / Dopamind / Stopped) |
| Start Bot         | Start all configured services                       |
| Stop Bot          | Stop all running services                           |
| Settings          | Open the configuration window                       |
| Check for Updates | Manually check for a new version                    |
| Open Data Folder  | Open the directory containing config files          |
| Quit              | Stop services and exit                              |

## Running from Source

```bash
# Clone the repository
git clone https://github.com/Philo-Li/claudebot.git
cd claudebot

# Install dependencies
npm install

# Run as Electron tray app (development)
npm run electron:dev

# Or run Telegram bot only (without Electron)
npm start
```

### Build Installers

```bash
npm run build:win      # Windows (NSIS installer + portable)
npm run build:mac      # macOS (DMG)
npm run build:linux    # Linux (AppImage + deb)
```

## Configuration

All settings are stored in a `.env` file under the system user data directory:

- Windows: `%APPDATA%\ClaudeBot\.env`
- macOS: `~/Library/Application Support/ClaudeBot/.env`
- Linux: `~/.config/ClaudeBot/.env`

| Variable             | Description                                       |
| -------------------- | ------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token                            |
| `ALLOWED_USER_IDS`   | Comma-separated list of allowed Telegram user IDs |
| `WORK_DIR`           | Default working directory for Claude Code         |
| `DOPAMIND_ENABLED`   | Enable Dopamind integration (`true` / `false`)    |
| `DOPAMIND_TOKEN`     | Dopamind device authentication token              |

## Auto Update

ClaudeBot checks for new versions on GitHub Releases at startup. When an update is available:

1. The update downloads in the background
2. A dialog prompts you when the download is complete
3. Choose "Restart Now" to install immediately

You can also trigger a check manually via **Check for Updates** in the tray menu.

## License

MIT
