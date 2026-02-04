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
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { t } = require('./i18n.cjs');

// ============== Module state ==============
let claudePath = 'claude';
let sessions = new Map();
let runningProcesses = new Map();
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
    const candidates = [
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
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

export function getRunningProcesses() {
  return runningProcesses;
}

export function killProcess(sessionKey) {
  const proc = runningProcesses.get(sessionKey);
  if (proc) {
    proc.kill('SIGTERM');
    runningProcesses.delete(sessionKey);
    return true;
  }
  return false;
}

export function killAllProcesses() {
  for (const [key, proc] of runningProcesses) {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
  runningProcesses.clear();
}

// ============== Stream message handler ==============

export function handleStreamMessage(msg, sessionKey, onProgress) {
  if (!onProgress) return;

  if (msg.type === 'system') {
    onProgress('[init]');
  } else if (msg.type === 'assistant' && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === 'tool_use') {
        const toolName = block.name;
        const input = block.input || {};
        let desc = '';

        if (toolName === 'Read') {
          desc = `[tool:read] ${input.file_path || ''}`;
        } else if (toolName === 'Edit') {
          desc = `[tool:edit] ${input.file_path || ''}`;
        } else if (toolName === 'Write') {
          desc = `[tool:write] ${input.file_path || ''}`;
        } else if (toolName === 'Bash') {
          const cmd = input.command || '';
          desc = `[tool:bash] ${cmd.slice(0, 80)}${cmd.length > 80 ? '...' : ''}`;
        } else if (toolName === 'Glob') {
          desc = `[tool:glob] ${input.pattern || ''}`;
        } else if (toolName === 'Grep') {
          desc = `[tool:grep] ${input.pattern || ''}`;
        } else if (toolName === 'Task') {
          desc = `[tool:task] ${input.description || ''}`;
        } else {
          desc = `[tool:${toolName.toLowerCase()}]`;
        }

        onProgress(desc);
      } else if (block.type === 'text' && block.text) {
        onProgress(block.text);
      }
    }
  }
}

// ============== Call Claude ==============

export async function callClaude(sessionKey, prompt, workDir, onProgress) {
  return new Promise((resolve) => {
    const sessionId = sessions.get(sessionKey);
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--verbose'
    ];

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    console.log(`[${new Date().toISOString()}] 执行: claude -p ...`);
    console.log(`[工作目录] ${workDir}${sessionId ? ` [会话] ${sessionId}` : ' [新会话]'}`);

    const proc = spawn(claudePath, args, {
      cwd: workDir,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    runningProcesses.set(sessionKey, proc);

    let stderr = '';
    let buffer = '';
    let finalResult = null;

    proc.stdout.on('data', (data) => {
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          if (msg.type === 'result') {
            if (msg.session_id) {
              sessions.set(sessionKey, msg.session_id);
              saveSessions();
            }
            finalResult = {
              success: !msg.is_error,
              output: msg.result || msg.errors?.join('\n') || t('runner.noOutput'),
              cost: msg.total_cost_usd
            };
          }

          handleStreamMessage(msg, sessionKey, onProgress);
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
          if (msg.type === 'result') {
            if (msg.session_id) {
              sessions.set(sessionKey, msg.session_id);
              saveSessions();
            }
            finalResult = {
              success: !msg.is_error,
              output: msg.result || msg.errors?.join('\n') || t('runner.noOutput'),
              cost: msg.total_cost_usd
            };
          }
        } catch {}
      }

      if (finalResult) {
        resolve(finalResult);
      } else {
        resolve({
          success: false,
          output: stderr || t('runner.noOutput')
        });
      }
    });

    proc.on('error', (err) => {
      runningProcesses.delete(sessionKey);
      resolve({ success: false, output: t('runner.execError', { message: err.message }) });
    });
  });
}
