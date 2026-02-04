import TelegramBot from 'node-telegram-bot-api';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  initRunner,
  callClaude,
  getSessions,
  getRunningProcesses,
  killProcess,
  killAllProcesses,
} from './claude-runner.js';

// ============== 模块级变量 ==============
let bot = null;
let config = null;

// ============== 配置 ==============
function loadConfig(envPath) {
  const envFile = envPath || '.env';
  if (existsSync(envFile)) {
    const envContent = readFileSync(envFile, 'utf-8');
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
    throw new Error('请设置 TELEGRAM_BOT_TOKEN');
  }

  if (allowedUsers.length === 0) {
    console.warn('警告: 未设置 ALLOWED_USER_IDS，任何人都可以使用此 Bot！');
  }

  return { token, allowedUsers, workDir };
}

function isAllowed(userId) {
  if (config.allowedUsers.length === 0) return true;
  return config.allowedUsers.includes(userId);
}

// ============== 会话持久化 (delegate to runner) ==============
function saveSessions() {
  // Sessions are auto-saved by claude-runner on result
}

// ============== 进度更新 ==============
function createProgressUpdater(chatId, messageId) {
  let lastUpdate = 0;
  let lastText = '';
  const steps = [];
  let pendingFlush = null;

  const flush = () => {
    const display = steps.join('\n');
    const trimmed = display.length > 3800
      ? '...\n' + display.slice(display.length - 3800)
      : display;
    const newText = `[status:processing]\n\n${trimmed}`;
    if (newText === lastText) return;

    lastText = newText;
    lastUpdate = Date.now();

    bot.editMessageText(newText, { chat_id: chatId, message_id: messageId })
      .catch(() => {});
  };

  const updater = (text) => {
    steps.push(text);

    const now = Date.now();
    if (now - lastUpdate < 2000) {
      if (!pendingFlush) {
        pendingFlush = setTimeout(() => { pendingFlush = null; flush(); }, 2000);
      }
      return;
    }
    if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
    flush();
  };

  updater.finish = () => {
    if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
    if (steps.length === 0) return;
    const display = steps.join('\n');
    const trimmed = display.length > 3800
      ? '...\n' + display.slice(display.length - 3800)
      : display;
    const finalText = `[status:done]\n\n${trimmed}`;
    if (finalText !== lastText) {
      bot.editMessageText(finalText, { chat_id: chatId, message_id: messageId })
        .catch(() => {});
    }
  };

  return updater;
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

// ============== 注册命令处理 ==============
function registerHandlers() {
  const sessions = getSessions();
  const runningProcesses = getRunningProcesses();

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
    bot.sendMessage(msg.chat.id, '已开始新会话。');
  });

  bot.onText(/\/stop/, (msg) => {
    if (!isAllowed(msg.from.id)) return;
    if (killProcess(msg.chat.id)) {
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
    const statusMsg = await bot.sendMessage(chatId, '[status:processing]');
    const onProgress = createProgressUpdater(chatId, statusMsg.message_id);

    const result = await callClaude(chatId, prompt, config.workDir, onProgress);
    onProgress.finish();

    const prefix = result.success ? '' : '[error] ';
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

    const statusMsg = await bot.sendMessage(chatId, '[status:processing]');
    const onProgress = createProgressUpdater(chatId, statusMsg.message_id);

    const result = await callClaude(chatId, msg.text.trim(), config.workDir, onProgress);
    onProgress.finish();

    const prefix = result.success ? '' : '[error] ';
    const suffix = result.cost ? `\n\n--- 费用: $${result.cost.toFixed(4)}` : '';
    await sendLongMessage(chatId, result.output + suffix, prefix);
  });
}

// ============== 导出: start / stop ==============
export async function start({ envPath, sessionsPath } = {}) {
  // Initialize the shared runner
  initRunner({ sessionsPath });

  // 配置
  config = loadConfig(envPath);

  // Telegram Bot
  bot = new TelegramBot(config.token, { polling: true });
  registerHandlers();

  console.log('========================================');
  console.log('Claude Code Telegram Bot 已启动');
  console.log(`工作目录: ${config.workDir}`);
  console.log(`授权用户: ${config.allowedUsers.length > 0 ? config.allowedUsers.join(', ') : '所有人'}`);
  console.log('========================================');
}

export async function stop() {
  console.log('正在停止 Bot...');

  // 杀死所有运行中的子进程
  killAllProcesses();

  // 停止 Telegram 轮询
  if (bot) {
    await bot.stopPolling();
    bot = null;
  }

  console.log('Bot 已停止。');
}

// ============== 直接运行兼容 ==============
const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && (
  process.argv[1] === __filename ||
  process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/')
);

if (isDirectRun) {
  start().catch(err => {
    console.error('启动失败:', err.message);
    process.exit(1);
  });
}
