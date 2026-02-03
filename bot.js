import TelegramBot from 'node-telegram-bot-api';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

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
  return 'claude'; // fallback to PATH
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

// ============== 会话持久化 ==============
const SESSIONS_FILE = new URL('sessions.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

function loadSessions() {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch {}
  return new Map();
}

function saveSessions() {
  const obj = Object.fromEntries(sessions);
  writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
}

const sessions = loadSessions();
console.log(`已加载 ${sessions.size} 个会话`);

function isAllowed(userId) {
  if (config.allowedUsers.length === 0) return true;
  return config.allowedUsers.includes(userId);
}

// ============== 调用 Claude Code ==============
// 使用 spawn 直接执行 claude.exe，stdin 设为 ignore，通过 JSON 格式捕获输出
// 支持通过 --resume 维持同一会话上下文
async function callClaude(chatId, prompt, workDir) {
  return new Promise((resolve) => {
    const sessionId = sessions.get(chatId);
    const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];

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

        // 保存 session_id 用于后续会话恢复
        if (json.session_id) {
          sessions.set(chatId, json.session_id);
          saveSessions();
        }

        resolve({
          success: !json.is_error,
          output: json.result || json.errors?.join('\n') || '(无输出)',
          cost: json.total_cost_usd,
          sessionId: json.session_id
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
/new - 开始新会话（清除上下文）
/stop - 停止当前任务
/dir - 查看当前工作目录
/setdir <路径> - 设置工作目录
/status - 查看状态

直接发送消息也会被当作指令发送给 Claude。
连续对话会自动保持上下文，使用 /new 重置。

当前工作目录: ${config.workDir}`
  );
});

bot.onText(/\/new/, (msg) => {
  if (!isAllowed(msg.from.id)) return;
  sessions.delete(msg.chat.id);
  saveSessions();
  bot.sendMessage(msg.chat.id, '已开始新会话。');
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
  const sessionId = sessions.get(msg.chat.id);
  bot.sendMessage(msg.chat.id,
`状态:
- 工作目录: ${config.workDir}
- 任务状态: ${isRunning ? '运行中' : '空闲'}
- 会话: ${sessionId ? sessionId.slice(0, 8) + '...' : '无（下次消息将开始新会话）'}
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
