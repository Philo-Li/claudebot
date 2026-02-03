const { app, Tray, Menu, dialog, shell, nativeImage, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let tray = null;
let botModule = null;
let botRunning = false;
let dopamindClient = null;
let dopamindRunning = false;
let configWindow = null;

const userDataPath = app.getPath('userData');
const envPath = path.join(userDataPath, '.env');
const sessionsPath = path.join(userDataPath, 'sessions.json');
const envExamplePath = path.join(__dirname, '.env.example');

function getIconPath(running) {
  const name = running ? 'tray-running.png' : 'tray-stopped.png';
  // In packaged app, resources are in app.asar
  return path.join(__dirname, 'assets', name);
}

function createTrayIcon(running) {
  const iconPath = getIconPath(running);
  return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
}

function updateTray() {
  if (!tray) return;

  const anyRunning = botRunning || dopamindRunning;
  tray.setImage(createTrayIcon(anyRunning));

  // Build status text
  const statusParts = [];
  if (botRunning) statusParts.push('Telegram');
  if (dopamindRunning) statusParts.push('Dopamind');
  const statusText = statusParts.length > 0
    ? `Running (${statusParts.join(' + ')})`
    : 'Stopped';

  tray.setToolTip(`ClaudeBot - ${statusText}`);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Status: ${statusText}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Start Bot',
      enabled: !botRunning && !dopamindRunning,
      click: startBot,
    },
    {
      label: 'Stop Bot',
      enabled: botRunning || dopamindRunning,
      click: stopBot,
    },
    { type: 'separator' },
    {
      label: '设置',
      click: showConfigWindow,
    },
    {
      label: 'Open Data Folder',
      click: () => shell.openPath(userDataPath),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: async () => {
        await stopBot();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

async function startBot() {
  if (botRunning || dopamindRunning) return;

  try {
    // Ensure .env exists
    if (!fs.existsSync(envPath)) {
      showConfigWindow();
      return;
    }

    const envConfig = parseEnvFile();

    // Start Telegram bot if token is configured
    const hasTelegram = !!envConfig.token;
    if (hasTelegram) {
      if (!botModule) {
        botModule = await import('./bot.js');
      }
      await botModule.start({ envPath, sessionsPath });
      botRunning = true;
      console.log('Telegram bot started successfully');
    }

    // Start Dopamind client if enabled
    const hasDopamind = envConfig.dopamindEnabled === 'true' && envConfig.dopamindToken;
    if (hasDopamind) {
      if (!dopamindClient) {
        dopamindClient = require('./dopamind-client.cjs');
      }

      // Initialize claude-runner if Telegram isn't running (it would have initialized it)
      if (!hasTelegram) {
        const runner = await import('./claude-runner.js');
        runner.initRunner({ sessionsPath });
      }

      await dopamindClient.start({
        dopamindConfig: {
          apiUrl: envConfig.dopamindApiUrl || 'https://staging-api.dopamind.app',
          token: envConfig.dopamindToken,
          defaultWorkDir: envConfig.workDir || process.cwd(),
        },
      });
      dopamindRunning = true;
      console.log('Dopamind client started successfully');
    }

    if (!hasTelegram && !hasDopamind) {
      showConfigWindow();
      return;
    }
  } catch (err) {
    console.error('Failed to start:', err);
    dialog.showErrorBox('Start Failed', err.message);
    botRunning = false;
    dopamindRunning = false;
  }

  updateTray();
}

async function stopBot() {
  // Stop Telegram bot
  if (botRunning && botModule) {
    try {
      await botModule.stop();
      console.log('Telegram bot stopped');
    } catch (err) {
      console.error('Failed to stop Telegram bot:', err);
    }
    botRunning = false;
  }

  // Stop Dopamind client
  if (dopamindRunning && dopamindClient) {
    try {
      dopamindClient.stop();
      console.log('Dopamind client stopped');
    } catch (err) {
      console.error('Failed to stop Dopamind client:', err);
    }
    dopamindRunning = false;
  }

  updateTray();
}

function parseEnvFile() {
  const result = {
    token: '',
    userIds: '',
    workDir: '',
    dopamindEnabled: '',
    dopamindApiUrl: '',
    dopamindToken: '',
  };
  if (!fs.existsSync(envPath)) return result;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key === 'TELEGRAM_BOT_TOKEN') result.token = val;
    else if (key === 'ALLOWED_USER_IDS') result.userIds = val;
    else if (key === 'WORK_DIR') result.workDir = val;
    else if (key === 'DOPAMIND_ENABLED') result.dopamindEnabled = val;
    else if (key === 'DOPAMIND_API_URL') result.dopamindApiUrl = val;
    else if (key === 'DOPAMIND_TOKEN') result.dopamindToken = val;
  }
  return result;
}

function writeEnvFile({ token, userIds, workDir, dopamindEnabled, dopamindToken }) {
  const content = [
    '# Telegram Bot Token',
    `TELEGRAM_BOT_TOKEN=${token || ''}`,
    '',
    '# Allowed Telegram user IDs (comma-separated)',
    `ALLOWED_USER_IDS=${userIds || ''}`,
    '',
    '# Work directory',
    `WORK_DIR=${workDir || ''}`,
    '',
    '# Dopamind Integration',
    `DOPAMIND_ENABLED=${dopamindEnabled || 'false'}`,
    `DOPAMIND_TOKEN=${dopamindToken || ''}`,
  ].join('\n');
  fs.writeFileSync(envPath, content);
}

function showConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 450,
    height: 620,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: '设置',
    webPreferences: {
      preload: path.join(__dirname, 'preload-config.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  configWindow.setMenuBarVisibility(false);
  configWindow.loadFile(path.join(__dirname, 'config.html'));

  configWindow.on('closed', () => {
    configWindow = null;
  });
}

ipcMain.handle('get-config', () => {
  return parseEnvFile();
});

ipcMain.handle('save-config', async (_event, data) => {
  writeEnvFile(data);
  if (configWindow) {
    configWindow.close();
  }
  // Restart services with new config
  if (botRunning || dopamindRunning) {
    await stopBot();
  }
  startBot();
});

ipcMain.handle('select-directory', async () => {
  const parent = configWindow || null;
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app.whenReady().then(() => {
  // Hide dock icon on macOS (tray-only app)
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  tray = new Tray(createTrayIcon(false));
  updateTray();

  // Auto-start bot if config exists
  if (fs.existsSync(envPath)) {
    startBot();
  } else {
    // First run — show setup
    startBot();
  }
});

// Keep app running when all windows are closed (tray-only)
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// Handle second instance
app.on('second-instance', () => {
  // Just flash the tray or show a notification
  if (tray) {
    dialog.showMessageBox({
      type: 'info',
      title: 'ClaudeBot',
      message: 'ClaudeBot is already running in the system tray.',
      buttons: ['OK'],
    });
  }
});
