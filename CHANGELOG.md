# Changelog

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
