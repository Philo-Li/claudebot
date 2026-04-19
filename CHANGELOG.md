# Changelog

## v1.1.7 (2026-04-19)

### 中文

#### 问题修复

- 修复自动更新模块因缺少 `sax` 依赖导致应用启动时崩溃的问题。

---

### English

#### Bug Fixes

- Fixed a startup crash caused by missing `sax` dependency in the auto-updater module.

---

## v1.1.6 (2026-04-19)

### 中文

#### 功能增强

- 同一 session 的并发请求现在自动串行执行，避免多条消息同时发送时产生冲突。
- Dopamind session key 改为按工作目录隔离，同一用户在不同目录下各自维护独立上下文。
- 新增 `migrateSessionKey()`，自动将旧格式 session key 迁移到新格式，历史会话不丢失。
- 无 `conversationId` 的消息改为启动独立 session，不再共用同一用户的全局 session。

---

### English

#### Feature Enhancements

- Concurrent calls to the same session are now serialized automatically, preventing conflicts when multiple messages arrive simultaneously.
- Dopamind session keys are now scoped per working directory, so each user gets separate context per directory.
- Added `migrateSessionKey()` to transparently migrate legacy session keys to the new format, preserving conversation history.
- Messages without a `conversationId` now start an isolated session instead of sharing the user's global session.

---

## v1.1.5 (2026-03-27)

### 中文

#### 重要新功能

- 支持 Dopamind App 与桌面端通过二维码快速配对，扫码后可自动写入 Device Token 并启用连接。
- 设置页新增多目录工作区支持，可同时管理多个 Claude Code 工作目录。
- Electron 设置界面重构为卡片式导航，配置流程更清晰。

#### 功能增强

- Dopamind 配对页现在在进入页面时自动拉起配对流程，减少手动操作。
- Device Token 与 Bot Token 输入框新增显示/隐藏切换，便于核对敏感配置。
- 配对成功后会自动保存配置并保留窗口，方便继续检查当前设置。

#### 问题修复

- 修复配对接口返回嵌套 `data` 时桌面端无法正确解析的问题。
- 改进配对轮询日志与错误处理，补充过期重试与服务端错误提示。
- 调整离开页面时的配对停止逻辑，避免导航过程中的重复启动或状态残留。

---

### English

#### Major New Features

- Added QR pairing between the Dopamind mobile app and the desktop client, with automatic Device Token fill-in after a successful scan.
- Added multi-directory workspace support so ClaudeBot can manage more than one Claude Code working directory.
- Redesigned the Electron settings UI with card-based navigation for a clearer setup flow.

#### Feature Enhancements

- The Dopamind pairing flow now starts automatically when the pairing page is opened.
- Added show/hide toggles for Device Token and Bot Token fields to make sensitive values easier to verify.
- Pairing success now saves the configuration automatically while keeping the settings window open for review.

#### Bug Fixes

- Fixed pairing response parsing when the API returns payloads under a nested `data` object.
- Improved pairing polling logs and error handling, including session expiry restart and server-side error feedback.
- Adjusted pairing shutdown behavior during navigation to avoid duplicate starts and stale polling state.

---
