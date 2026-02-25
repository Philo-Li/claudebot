# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**ClaudeBot** is an Electron tray application that provides two interfaces for controlling Claude Code CLI:

1. **Telegram Bot** — Send prompts to Claude Code via Telegram messages
2. **Dopamind Client** — HTTP polling client that receives prompts from the Dopamind API queue

The app runs as a system tray icon with start/stop controls and a settings window.

## Repository Structure

```
ClaudeBot/
├── main.cjs              # Electron main process (tray app, config window, IPC)
├── bot.js                # Telegram bot (ESM, polling mode)
├── claude-runner.js      # Shared module: spawn claude CLI, session management
├── dopamind-client.cjs   # Dopamind HTTP polling client (CJS)
├── config.html           # Settings UI (Electron BrowserWindow)
├── preload-config.cjs    # Electron preload script for config window
├── sessions.json         # Session persistence (auto-generated)
├── assets/               # Tray icons (tray-running.png, tray-stopped.png, icon.ico)
├── electron-builder.yml  # Electron Builder config
├── package.json          # Dependencies and scripts
└── dist/                 # Build output
```

## Quick Start Commands

```bash
# Run Telegram bot directly (without Electron)
npm start

# Run as Electron tray app (development)
npm run electron:dev

# Build installers
npm run build:win      # Windows (NSIS + portable)
npm run build:mac      # macOS (DMG)
npm run build:linux    # Linux (AppImage + deb)
```

## Technology Stack

| Component       | Technology                                                           |
| --------------- | -------------------------------------------------------------------- |
| Desktop Shell   | Electron                                                             |
| Telegram API    | node-telegram-bot-api                                                |
| Module System   | ESM (bot.js, claude-runner.js) + CJS (main.cjs, dopamind-client.cjs) |
| CLI Integration | Claude Code CLI via child_process.spawn                              |
| Build           | electron-builder                                                     |

## Architecture Notes

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron Shell                           │
│                         (main.cjs)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ System Tray │  │ Config IPC  │  │ Bot Lifecycle Manager   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│      Telegram Bot        │    │    Dopamind Client       │
│        (bot.js)          │    │  (dopamind-client.cjs)   │
│                          │    │                          │
│  • /ask, /run, /new      │    │  • HTTP polling (3s)     │
│  • /stop, /status        │    │  • Progress reporting    │
│  • /dir, /setdir         │    │  • Result posting        │
└──────────────────────────┘    └──────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
              ┌──────────────────────────────┐
              │      Claude Runner           │
              │    (claude-runner.js)        │
              │                              │
              │  • Spawn claude -p           │
              │  • Stream JSON parsing       │
              │  • Session management        │
              │  • Progress callbacks        │
              └──────────────────────────────┘
                              │
                              ▼
              ┌──────────────────────────────┐
              │       Claude Code CLI        │
              │  (child_process.spawn)       │
              │                              │
              │  --output-format stream-json │
              │  --resume (session ID)       │
              └──────────────────────────────┘
```

### Module Descriptions

- **main.cjs** — Electron main process. Creates system tray, manages bot lifecycle, settings window via IPC
- **bot.js** — Telegram bot. Registers command handlers (/ask, /run, /new, /stop, /dir, /setdir, /status). Plain messages also sent to Claude
- **claude-runner.js** — Core module. Spawns `claude -p` with `--output-format stream-json`, manages sessions (resume via session ID), parses streaming progress
- **dopamind-client.cjs** — Polls Dopamind API `/api/desktop-queue/poll` every 3s, processes messages via claude-runner, posts progress and results back
- **Config** is stored in `%APPDATA%/ClaudeBot/.env` (Electron userData path), not in the repo

### Data Flow

1. **Input**: User sends message via Telegram or Dopamind queues a prompt
2. **Processing**: Bot/Client receives message → calls `claude-runner.js`
3. **Execution**: Runner spawns Claude CLI with streaming output
4. **Streaming**: JSON events parsed in real-time → progress callbacks fired
5. **Output**: Final result sent back to Telegram/Dopamind API

### Module System (ESM + CJS)

| File | Type | Reason |
|------|------|--------|
| main.cjs | CommonJS | Electron main process requirement |
| preload-config.cjs | CommonJS | Electron preload requirement |
| dopamind-client.cjs | CommonJS | Spawned by Electron main |
| bot.js | ESM | Modern JS, async/await |
| claude-runner.js | ESM | Shared core module |

CJS modules use dynamic `import()` to load ESM modules.

## Environment Variables

Stored in `.env` at Electron's userData path:

- `TELEGRAM_BOT_TOKEN` — Telegram Bot API token
- `ALLOWED_USER_IDS` — Comma-separated Telegram user IDs
- `WORK_DIR` — Default working directory for Claude
- `DOPAMIND_ENABLED` — Enable Dopamind client (`true`/`false`)
- `DOPAMIND_TOKEN` — Dopamind API authentication token

## Code Quality

ESLint 9 (flat config) + Prettier + husky pre-commit hooks.

```bash
npm run lint          # Check for lint errors
npm run lint:fix      # Auto-fix lint errors
npm run format        # Format all files with Prettier
npm run format:check  # Check formatting without writing
```

Pre-commit hook runs `lint-staged` automatically on staged `.js`/`.cjs`/`.mjs`/`.json`/`.md`/`.yml` files.

## Development Guidelines

1. **Mixed module system** — `main.cjs` and `dopamind-client.cjs` are CommonJS (required by Electron main); `bot.js` and `claude-runner.js` are ESM
2. CJS modules import ESM via dynamic `import()` — do not convert to `require()`
3. Keep Claude CLI integration in `claude-runner.js` only — both bot.js and dopamind-client.cjs depend on it
4. All user-facing strings are in Chinese (简体中文)
5. No TypeScript — project uses plain JavaScript

## Git Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>
```

**Important:** Keep commit message to a single line. Do NOT add body or footer.

### Types

| Type       | Description                               |
| ---------- | ----------------------------------------- |
| `feat`     | New feature                               |
| `fix`      | Bug fix                                   |
| `docs`     | Documentation only                        |
| `style`    | Code style (formatting, semicolons, etc.) |
| `refactor` | Code refactoring (no feature/fix)         |
| `perf`     | Performance improvement                   |
| `test`     | Adding or updating tests                  |
| `chore`    | Build process, dependencies, CI/CD        |

### Scopes

- `telegram` — Telegram bot functionality
- `dopamind` — Dopamind client integration
- `runner` — Claude CLI runner module
- `electron` — Electron shell, tray, config window
- `build` — Electron Builder, packaging
- `deps` — Dependencies update

### Examples

```
feat(telegram): add file upload support
fix(runner): handle session resume failure
refactor(dopamind): simplify progress batching
chore(build): update electron-builder config
feat(electron): add auto-start on login
```

### Rules

1. Use lowercase for type, scope, and subject
2. No period at the end of subject line
3. Keep subject line under 72 characters
4. Use imperative mood ("add" not "added")
5. Do NOT add footer like "🤖 Generated with Claude Code" or "Co-Authored-By"
