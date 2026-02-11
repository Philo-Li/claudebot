import TelegramBot from 'node-telegram-bot-api';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import {
  initRunner,
  callClaude,
  getSessions,
  getRunningProcesses,
  killProcess,
  killAllProcesses,
  getSessionUsage,
  resetSessionUsage,
  deleteSession,
} from './claude-runner.js';

const require = createRequire(import.meta.url);
const { t, setLanguage } = require('./i18n.cjs');

// ============== 模块级变量 ==============
let bot = null;
let config = null;

// ============== 配置 ==============
function loadConfig(envPath) {
  const envFile = envPath || '.env';
  if (existsSync(envFile)) {
    const envContent = readFileSync(envFile, 'utf-8');
    envContent.split('\n').forEach((line) => {
      const [key, ...values] = line.split('=');
      if (key && values.length > 0 && !key.startsWith('#')) {
        process.env[key.trim()] = values.join('=').trim();
      }
    });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUsers = process.env.ALLOWED_USER_IDS?.split(',').map((id) => parseInt(id.trim())) || [];
  const workDir = process.env.WORK_DIR || process.cwd();
  const allowSkipPermissions = (process.env.ALLOW_SKIP_PERMISSIONS || 'true').toLowerCase() === 'true';

  if (!token) {
    throw new Error(t('bot.tokenRequired'));
  }

  if (allowedUsers.length === 0) {
    console.warn(t('bot.noUserIdsWarning'));
  }

  return { token, allowedUsers, workDir, allowSkipPermissions };
}

function isAllowed(userId) {
  if (config.allowedUsers.length === 0) return false;
  return config.allowedUsers.includes(userId);
}

// Sessions are auto-saved by claude-runner on result

// ============== 进度更新 ==============
const MAX_VISIBLE_TOOLS = 5;
const TOOL_TAG_RE = /^\[tool:/;
const TEXT_TAG_RE = /^\[text\]/;

function buildProgressDisplay(steps) {
  const toolSteps = [];
  const otherSteps = [];
  for (const s of steps) {
    if (TOOL_TAG_RE.test(s)) {
      toolSteps.push(s);
    } else if (!TEXT_TAG_RE.test(s)) {
      // Keep non-tool, non-text steps (e.g. [init], [status:processing] retry)
      otherSteps.push(s);
    }
    // [text] steps are skipped during processing display
  }

  const lines = [...otherSteps];
  if (toolSteps.length > MAX_VISIBLE_TOOLS) {
    lines.push(`... ${toolSteps.length - MAX_VISIBLE_TOOLS} more tools`);
    lines.push(...toolSteps.slice(-MAX_VISIBLE_TOOLS));
  } else {
    lines.push(...toolSteps);
  }
  return lines.join('\n');
}

function buildFinishDisplay(steps) {
  let toolCount = 0;
  const textLines = [];
  for (const s of steps) {
    if (TOOL_TAG_RE.test(s)) {
      toolCount++;
    } else if (TEXT_TAG_RE.test(s)) {
      // Keep [text] content for final display
      textLines.push(s.replace(TEXT_TAG_RE, '').trim());
    }
    // skip [init], [status:*] etc.
  }
  const lines = [];
  if (toolCount > 0) lines.push(`[status:done] Used ${toolCount} tools`);
  if (textLines.length > 0) lines.push(...textLines);
  return lines.join('\n');
}

function createProgressUpdater(chatId, messageId) {
  let lastUpdate = 0;
  let lastText = '';
  const steps = [];
  let pendingFlush = null;

  const flush = () => {
    const display = buildProgressDisplay(steps);
    const trimmed = display.length > 3800 ? '...\n' + display.slice(display.length - 3800) : display;
    const newText = `[status:processing]\n\n${trimmed}`;
    if (newText === lastText) return;

    lastText = newText;
    lastUpdate = Date.now();

    bot.editMessageText(newText, { chat_id: chatId, message_id: messageId }).catch(() => {});
  };

  const updater = (text) => {
    steps.push(text);

    const now = Date.now();
    if (now - lastUpdate < 2000) {
      if (!pendingFlush) {
        pendingFlush = setTimeout(() => {
          pendingFlush = null;
          flush();
        }, 2000);
      }
      return;
    }
    if (pendingFlush) {
      clearTimeout(pendingFlush);
      pendingFlush = null;
    }
    flush();
  };

  updater.finish = () => {
    if (pendingFlush) {
      clearTimeout(pendingFlush);
      pendingFlush = null;
    }
    if (steps.length === 0) return;
    const display = buildFinishDisplay(steps);
    if (!display) return;
    const trimmed = display.length > 3800 ? '...\n' + display.slice(display.length - 3800) : display;
    if (trimmed !== lastText) {
      bot.editMessageText(trimmed, { chat_id: chatId, message_id: messageId }).catch(() => {});
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

// ============== 用量摘要 ==============
function usageSuffix(chatId) {
  const usage = getSessionUsage(chatId);
  if (!usage || !usage.contextWindow) return '';
  const remaining = (100 - (usage.contextTokens / usage.contextWindow) * 100).toFixed(0);
  return `\n\n[context] ${remaining}% remaining`;
}

// ============== 注册命令处理 ==============
function registerHandlers() {
  const sessions = getSessions();
  const runningProcesses = getRunningProcesses();

  bot.onText(/\/start/, (msg) => {
    if (!isAllowed(msg.from.id)) {
      bot.sendMessage(msg.chat.id, t('bot.noPermission'));
      return;
    }
    bot.sendMessage(msg.chat.id, t('bot.startMessage', { workDir: config.workDir }));
  });

  bot.onText(/\/new/, (msg) => {
    if (!isAllowed(msg.from.id)) return;
    deleteSession(msg.chat.id);
    resetSessionUsage(msg.chat.id);
    bot.sendMessage(msg.chat.id, t('bot.newSession'));
  });

  bot.onText(/\/usage/, (msg) => {
    if (!isAllowed(msg.from.id)) return;
    const usage = getSessionUsage(msg.chat.id);
    if (!usage) {
      bot.sendMessage(msg.chat.id, t('bot.usageNone'));
      return;
    }
    const pct = usage.contextWindow ? ((usage.contextTokens / usage.contextWindow) * 100).toFixed(1) : '?';
    bot.sendMessage(
      msg.chat.id,
      t('bot.usageInfo', {
        contextTokens: usage.contextTokens.toLocaleString(),
        contextWindow: usage.contextWindow.toLocaleString(),
        pct,
        outputTokens: usage.totalOutputTokens.toLocaleString(),
        cost: usage.totalCost.toFixed(4),
        turns: usage.turns,
      }),
    );
  });

  bot.onText(/\/stop/, (msg) => {
    if (!isAllowed(msg.from.id)) return;
    if (killProcess(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, t('bot.stopped'));
    } else {
      bot.sendMessage(msg.chat.id, t('bot.noRunningTask'));
    }
  });

  bot.onText(/\/setdir (.+)/, (msg, match) => {
    if (!isAllowed(msg.from.id)) return;
    const newDir = match[1].trim();
    if (existsSync(newDir)) {
      config.workDir = newDir;
      bot.sendMessage(msg.chat.id, t('bot.workDirSet', { dir: newDir }));
    } else {
      bot.sendMessage(msg.chat.id, t('bot.dirNotExist', { dir: newDir }));
    }
  });

  bot.onText(/\/status/, (msg) => {
    if (!isAllowed(msg.from.id)) return;
    const isRunning = runningProcesses.has(String(msg.chat.id));
    const sessionId = sessions.get(String(msg.chat.id));
    bot.sendMessage(
      msg.chat.id,
      t('bot.status', {
        workDir: config.workDir,
        taskStatus: isRunning ? t('bot.statusRunning') : t('bot.statusIdle'),
        session: sessionId ? sessionId.slice(0, 8) + '...' : t('bot.sessionNone'),
        userId: msg.from.id,
      }),
    );
  });

  bot.onText(/\/(ask|run) ([\s\S]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) {
      bot.sendMessage(chatId, t('bot.noPermission'));
      return;
    }
    if (runningProcesses.has(String(chatId))) {
      bot.sendMessage(chatId, t('bot.taskRunning'));
      return;
    }

    const prompt = match[2].trim();
    const statusMsg = await bot.sendMessage(chatId, '[status:processing]');
    const onProgress = createProgressUpdater(chatId, statusMsg.message_id);

    const result = await callClaude(chatId, prompt, config.workDir, onProgress, {
      allowSkipPermissions: config.allowSkipPermissions,
    });
    onProgress.finish();

    const prefix = result.success ? '' : '[error] ';
    await sendLongMessage(chatId, result.output + usageSuffix(chatId), prefix);
  });

  bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/') || !msg.text) return;
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from.id)) {
      bot.sendMessage(chatId, t('bot.noPermission'));
      return;
    }
    if (runningProcesses.has(String(chatId))) {
      bot.sendMessage(chatId, t('bot.taskRunning'));
      return;
    }

    const statusMsg = await bot.sendMessage(chatId, '[status:processing]');
    const onProgress = createProgressUpdater(chatId, statusMsg.message_id);

    const result = await callClaude(chatId, msg.text.trim(), config.workDir, onProgress, {
      allowSkipPermissions: config.allowSkipPermissions,
    });
    onProgress.finish();

    const prefix = result.success ? '' : '[error] ';
    await sendLongMessage(chatId, result.output + usageSuffix(chatId), prefix);
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
  console.log(t('bot.started'));
  console.log(t('bot.workDir', { dir: config.workDir }));
  console.log(
    t('bot.authorizedUsers', {
      users: config.allowedUsers.length > 0 ? config.allowedUsers.join(', ') : t('bot.allUsers'),
    }),
  );
  console.log('========================================');
}

export async function stop() {
  console.log(t('bot.stopping'));

  // 杀死所有运行中的子进程
  killAllProcesses();

  // 停止 Telegram 轮询
  if (bot) {
    await bot.stopPolling();
    bot = null;
  }

  console.log(t('bot.stoppedLog'));
}

// ============== 直接运行兼容 ==============
const __filename = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] &&
  (process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/'));

if (isDirectRun) {
  // Set language from env when running standalone
  if (process.env.LANGUAGE === 'en' || process.env.LANGUAGE === 'zh') {
    setLanguage(process.env.LANGUAGE);
  }
  const __dirname = dirname(__filename);
  start({ sessionsPath: join(__dirname, 'sessions.json') }).catch((err) => {
    console.error(t('bot.startFailed'), err.message);
    process.exit(1);
  });
}
