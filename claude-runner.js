/**
 * claude-runner.js — Shared module for running Claude Code CLI.
 *
 * Exports:
 *   findGitBash()          — Locate git bash on Windows
 *   findClaude()           — Locate claude CLI binary
 *   initRunner(opts)       — Initialize the runner (paths, sessions file)
 *   callClaude(sessionKey, prompt, workDir, onProgress) — Execute claude -p
 *   handleStreamMessage(msg, sessionKey, onProgress) — Process stream-json messages
 *   getSessions()          — Get the sessions Map
 *   getRunningProcesses()  — Get the running processes Map
 *   killProcess(sessionKey) — Kill a running process by session key
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { t } = require('./i18n.cjs');

// ============== Module state ==============
let claudePath = 'claude';
let sessions = new Map();
let runningProcesses = new Map();
let sessionUsage = new Map();
let sessionsFilePath = '';

// ============== Path finders ==============

export function findGitBash() {
  if (process.platform !== 'win32') return null;
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

export function findClaude() {
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Claude\\.local\\bin\\claude.exe',
      process.env.LOCALAPPDATA + '\\Programs\\claude-code\\claude.exe',
    ];
    for (const p of candidates) {
      if (p && existsSync(p)) return p;
    }
  } else {
    const home = process.env.HOME || '';
    const candidates = [
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      '/opt/homebrew/bin/claude',
      home + '/.claude/local/bin/claude',
      home + '/.local/bin/claude',
      home + '/.npm-global/bin/claude',
    ];
    for (const p of candidates) {
      if (p && existsSync(p)) return p;
    }
    // NVM: ~/.nvm/versions/node/*/bin/claude
    const nvmDir = home + '/.nvm/versions/node';
    if (existsSync(nvmDir)) {
      try {
        const versions = readdirSync(nvmDir);
        for (const v of versions.reverse()) {
          const p = nvmDir + '/' + v + '/bin/claude';
          if (existsSync(p)) return p;
        }
      } catch {}
    }
  }
  return 'claude';
}

// ============== Session persistence ==============

function loadSessions() {
  try {
    if (sessionsFilePath && existsSync(sessionsFilePath)) {
      const data = JSON.parse(readFileSync(sessionsFilePath, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch {}
  return new Map();
}

function saveSessions() {
  if (!sessionsFilePath) return;
  const obj = Object.fromEntries(sessions);
  writeFileSync(sessionsFilePath, JSON.stringify(obj, null, 2));
}

// ============== Initialization ==============

export function initRunner({ sessionsPath } = {}) {
  const gitBashPath = findGitBash();
  if (gitBashPath) {
    process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
    console.log(`Git Bash: ${gitBashPath}`);
  }

  claudePath = findClaude();
  console.log(`Claude: ${claudePath}`);

  sessionsFilePath = sessionsPath || '';
  sessions = loadSessions();
  console.log(t('runner.sessionsLoaded', { count: sessions.size }));

  runningProcesses = new Map();
}

// ============== Accessors ==============

export function getSessions() {
  return sessions;
}

export function deleteSession(sessionKey) {
  sessionKey = String(sessionKey);
  sessions.delete(sessionKey);
  saveSessions();
}

export function getRunningProcesses() {
  return runningProcesses;
}

export function killProcess(sessionKey) {
  sessionKey = String(sessionKey);
  const proc = runningProcesses.get(sessionKey);
  if (proc) {
    proc.kill('SIGTERM');
    runningProcesses.delete(sessionKey);
    return true;
  }
  return false;
}

export function killAllProcesses() {
  for (const [_key, proc] of runningProcesses) {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
  runningProcesses.clear();
}

// ============== Session usage tracking ==============

function updateSessionUsage(sessionKey, msg, lastAssistantUsage) {
  const usage = msg.usage || {};

  // Use last assistant message's usage for context size (not the aggregate total)
  // The result message's usage is cumulative across all API turns, which is misleading
  const au = lastAssistantUsage || {};
  const contextTokens =
    (au.input_tokens || 0) + (au.cache_creation_input_tokens || 0) + (au.cache_read_input_tokens || 0);

  // Extract contextWindow from modelUsage
  let contextWindow = 0;
  if (msg.modelUsage) {
    for (const model of Object.values(msg.modelUsage)) {
      if (model.contextWindow) {
        contextWindow = model.contextWindow;
        break;
      }
    }
  }

  const prev = sessionUsage.get(sessionKey) || {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    contextTokens: 0,
    contextWindow: 0,
    turns: 0,
  };

  sessionUsage.set(sessionKey, {
    totalCost: prev.totalCost + (msg.total_cost_usd || 0),
    totalInputTokens: prev.totalInputTokens + (usage.input_tokens || 0),
    totalOutputTokens: prev.totalOutputTokens + (usage.output_tokens || 0),
    contextTokens,
    contextWindow: contextWindow || prev.contextWindow,
    turns: prev.turns + 1,
  });
}

export function getSessionUsage(sessionKey) {
  return sessionUsage.get(String(sessionKey)) || null;
}

export function resetSessionUsage(sessionKey) {
  sessionUsage.delete(String(sessionKey));
}

// ============== Stream message handler ==============

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function getToolDetail(toolName, input) {
  switch (toolName) {
    case 'Read':
      return input.file_path || '';
    case 'Write':
      return input.file_path || '';
    case 'Bash': {
      const cmd = input.command || '';
      return truncate(cmd, 80);
    }
    case 'Glob':
      return input.pattern || '';
    case 'Grep':
      return input.pattern || '';
    case 'Task':
      return input.description || '';
    case 'WebSearch':
      return input.query || '';
    case 'WebFetch':
      return input.url || '';
    default:
      return '';
  }
}

function getEditDetail(input) {
  const file = input.file_path || '';
  const old_str = input.old_string || '';
  const new_str = input.new_string || '';
  if (!old_str && !new_str) return file;
  const lines = [`[edit:start] ${file}`];
  if (old_str) {
    lines.push('[edit:old]');
    lines.push(old_str);
  }
  if (new_str) {
    lines.push('[edit:new]');
    lines.push(new_str);
  }
  lines.push('[edit:end]');
  return lines.join('\n');
}

export function handleStreamMessage(msg, sessionKey, onProgress, opts = {}) {
  if (!onProgress) return;

  if (msg.type === 'system') {
    return;
  } else if (msg.type === 'assistant' && msg.message?.content) {
    // Merge consecutive same-tool blocks into one line
    let lastTool = null;
    let lastDetails = [];

    const flushTool = () => {
      if (!lastTool) return;
      const tag = `[tool:${lastTool.toLowerCase()}]`;
      onProgress(lastDetails.length ? `${tag} ${lastDetails.join(', ')}` : tag);
      lastTool = null;
      lastDetails = [];
    };

    for (const block of msg.message.content) {
      if (block.type === 'tool_use') {
        if (block.name === 'Edit') {
          flushTool();
          if (opts.editDetails) {
            onProgress(getEditDetail(block.input || {}));
          } else {
            onProgress(`[tool:edit] ${block.input?.file_path || ''}`);
          }
          continue;
        }
        const detail = getToolDetail(block.name, block.input || {});
        if (block.name === lastTool) {
          lastDetails.push(detail);
        } else {
          flushTool();
          lastTool = block.name;
          lastDetails = detail ? [detail] : [];
        }
      } else {
        flushTool();
        if (block.type === 'text' && block.text) {
          const preview = block.text.slice(0, 200) + (block.text.length > 200 ? '...' : '');
          onProgress(`[text] ${preview}`);
        }
      }
    }
    flushTool();
  }
  // tool_result messages (type === 'user') are skipped — not useful for progress
}

// ============== Call Claude ==============

const MAX_API_RETRIES = 2;
const API_RETRY_DELAY = 5000;
const API_RETRY_PATTERN = /API Error: 5\d{2}\b|"type":"api_error"|overloaded/;

export async function callClaude(sessionKey, prompt, workDir, onProgress, opts = {}) {
  sessionKey = String(sessionKey);
  const retryState = opts._retryState || { contextRetried: false, apiRetries: 0 };
  return new Promise((resolve) => {
    const sessionId = sessions.get(sessionKey);
    const allowSkipPermissions = opts.allowSkipPermissions !== false;
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (allowSkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    console.log(`[${new Date().toISOString()}] 执行: claude -p ...`);
    console.log(`[工作目录] ${workDir}${sessionId ? ` [会话] ${sessionId}` : ' [新会话]'}`);

    const proc = spawn(claudePath, args, {
      cwd: workDir,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    runningProcesses.set(sessionKey, proc);
    if (onProgress) onProgress('[init]');

    let stderr = '';
    let buffer = '';
    let finalResult = null;
    let lastAssistantUsage = null;

    proc.stdout.on('data', (data) => {
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          // Track per-turn usage from assistant messages (actual context size)
          if (msg.type === 'assistant' && msg.message?.usage) {
            lastAssistantUsage = msg.message.usage;
          }

          if (msg.type === 'result') {
            if (msg.session_id) {
              sessions.set(sessionKey, msg.session_id);
              saveSessions();
            }
            updateSessionUsage(sessionKey, msg, lastAssistantUsage);
            finalResult = {
              success: !msg.is_error,
              output: msg.result || msg.errors?.join('\n') || t('runner.noOutput'),
              cost: msg.total_cost_usd,
            };
          }

          handleStreamMessage(msg, sessionKey, onProgress, opts);
        } catch {}
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      runningProcesses.delete(sessionKey);
      console.log(`[${new Date().toISOString()}] 完成, 退出码: ${code}`);

      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer);
          if (msg.type === 'assistant' && msg.message?.usage) {
            lastAssistantUsage = msg.message.usage;
          }
          if (msg.type === 'result') {
            if (msg.session_id) {
              sessions.set(sessionKey, msg.session_id);
              saveSessions();
            }
            updateSessionUsage(sessionKey, msg, lastAssistantUsage);
            finalResult = {
              success: !msg.is_error,
              output: msg.result || msg.errors?.join('\n') || t('runner.noOutput'),
              cost: msg.total_cost_usd,
            };
          }
          handleStreamMessage(msg, sessionKey, onProgress, opts);
        } catch {}
      }

      const errorOutput = finalResult?.output || stderr || '';

      // Auto-retry with new session on "Prompt is too long"
      if (!retryState.contextRetried && sessionId && errorOutput.includes('Prompt is too long')) {
        console.log(`[${new Date().toISOString()}] 上下文超限，清除会话并重试`);
        sessions.delete(sessionKey);
        resetSessionUsage(sessionKey);
        saveSessions();
        resolve(
          callClaude(sessionKey, prompt, workDir, onProgress, {
            ...opts,
            _retryState: { ...retryState, contextRetried: true },
          }),
        );
        return;
      }

      // Auto-retry on API 5xx / overloaded errors
      if (!finalResult?.success && retryState.apiRetries < MAX_API_RETRIES && API_RETRY_PATTERN.test(errorOutput)) {
        const attempt = retryState.apiRetries + 1;
        console.log(
          `[${new Date().toISOString()}] API 错误，${API_RETRY_DELAY / 1000}s 后重试 (${attempt}/${MAX_API_RETRIES})`,
        );
        if (onProgress) onProgress(`[status:processing] retry ${attempt}/${MAX_API_RETRIES}...`);
        setTimeout(() => {
          resolve(
            callClaude(sessionKey, prompt, workDir, onProgress, {
              ...opts,
              _retryState: { ...retryState, apiRetries: attempt },
            }),
          );
        }, API_RETRY_DELAY);
        return;
      }

      if (finalResult) {
        resolve(finalResult);
      } else {
        resolve({
          success: false,
          output: stderr || t('runner.noOutput'),
        });
      }
    });

    proc.on('error', (err) => {
      runningProcesses.delete(sessionKey);
      resolve({ success: false, output: t('runner.execError', { message: err.message }) });
    });
  });
}
