const { app, Tray, Menu, dialog, shell, nativeImage, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { t, setLanguage, getLanguage } = require('./i18n.cjs');

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
let splashWindow = null;

const userDataPath = app.getPath('userData');
const envPath = path.join(userDataPath, '.env');
const sessionsPath = path.join(userDataPath, 'sessions.json');
const envExamplePath = path.join(__dirname, '.env.example');

function getAppIconPath() {
  const name = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(__dirname, 'assets', name);
}

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
    ? t('tray.running', { services: statusParts.join(' + ') })
    : t('tray.stopped');

  tray.setToolTip(`ClaudeBot - ${statusText}`);

  const currentLang = getLanguage();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('tray.status', { status: statusText }),
      enabled: false,
    },
    { type: 'separator' },
    {
      label: t('tray.startBot'),
      enabled: !botRunning && !dopamindRunning,
      click: startBot,
    },
    {
      label: t('tray.stopBot'),
      enabled: botRunning || dopamindRunning,
      click: stopBot,
    },
    { type: 'separator' },
    {
      label: t('tray.language'),
      submenu: [
        {
          label: '中文',
          type: 'radio',
          checked: currentLang === 'zh',
          click: () => switchLanguage('zh'),
        },
        {
          label: 'English',
          type: 'radio',
          checked: currentLang === 'en',
          click: () => switchLanguage('en'),
        },
      ],
    },
    {
      label: t('tray.settings'),
      click: showConfigWindow,
    },
    {
      label: t('tray.checkUpdates'),
      click: () => autoUpdater.manualCheck(),
    },
    {
      label: t('tray.openDataFolder'),
      click: () => shell.openPath(userDataPath),
    },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: async () => {
        await stopBot();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function switchLanguage(lang) {
  setLanguage(lang);
  // Persist to .env
  const envConfig = parseEnvFile();
  envConfig.language = lang;
  writeEnvFile(envConfig);
  updateTray();
}

async function startBot() {
  if (botRunning || dopamindRunning) return;

  try {
    // Ensure .env exists
    if (!fs.existsSync(envPath)) {
      closeSplash();
      showConfigWindow();
      return;
    }

    const envConfig = parseEnvFile();

    // Apply language setting
    if (envConfig.language) {
      setLanguage(envConfig.language);
    }

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
          apiUrl: envConfig.dopamindApiUrl || 'https://api.dopamind.app',
          token: envConfig.dopamindToken,
          defaultWorkDir: envConfig.workDir || process.cwd(),
          allowSkipPermissions: (envConfig.allowSkipPermissions || 'true') === 'true',
          onError: (errMsg) => {
            dopamindRunning = false;
            updateTray();
            dialog.showErrorBox(
              t('dopamind.authErrorTitle'),
              t('dopamind.authErrorMessage', { message: errMsg }),
            );
          },
        },
      });
      dopamindRunning = true;
      console.log('Dopamind client started successfully');
    }

    if (!hasTelegram && !hasDopamind) {
      closeSplash();
      showConfigWindow();
      return;
    }
  } catch (err) {
    closeSplash();
    console.error('Failed to start:', err);
    dialog.showErrorBox(t('dialog.startFailed'), err.message);
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
    language: '',
    allowSkipPermissions: 'true',
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
    else if (key === 'LANGUAGE') result.language = val;
    else if (key === 'ALLOW_SKIP_PERMISSIONS') result.allowSkipPermissions = val;
  }
  return result;
}

function writeEnvFile({ token, userIds, workDir, dopamindEnabled, dopamindToken, language, allowSkipPermissions }) {
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
    '',
    '# Allow skip permissions (dangerous)',
    `ALLOW_SKIP_PERMISSIONS=${allowSkipPermissions || 'true'}`,
    '',
    '# Language (zh / en)',
    `LANGUAGE=${language || 'zh'}`,
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
    icon: getAppIconPath(),
    title: t('tray.settings'),
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

ipcMain.handle('get-locale', () => {
  const lang = getLanguage();
  const localesDir = path.join(__dirname, 'locales');
  const data = JSON.parse(fs.readFileSync(path.join(localesDir, `${lang}.json`), 'utf-8'));
  return { lang, strings: data };
});

ipcMain.handle('select-directory', async () => {
  const parent = configWindow || null;
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function showSplash() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 220,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    icon: getAppIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Read language early for splash (env may exist before startBot)
  const envConfig = parseEnvFile();
  const splashLang = envConfig.language || 'zh';
  splashWindow.loadFile(path.join(__dirname, 'splash.html'), { query: { lang: splashLang } });
  splashWindow.on('closed', () => { splashWindow = null; });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

function showUpdateWindow(version, releaseNotes) {
  const notes = releaseNotes || t('update.noNotes');
  // Escape backticks and backslashes for safe embedding in template literal
  const safeNotes = notes.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const safeVersion = version.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; background: #fff; color: #333; display: flex; flex-direction: column; height: 100vh; }
  .header { padding: 20px 24px 12px; border-bottom: 1px solid #eee; }
  .header h2 { font-size: 16px; font-weight: 600; color: #111; }
  .header .version { font-size: 13px; color: #666; margin-top: 4px; }
  .content { flex: 1; overflow-y: auto; padding: 16px 24px; font-size: 13px; line-height: 1.7; }
  .content h2 { font-size: 14px; margin: 12px 0 6px; color: #111; }
  .content h2:first-child { margin-top: 0; }
  .content ul { padding-left: 20px; margin: 0 0 8px; }
  .content li { margin: 2px 0; }
  .footer { padding: 16px 24px; border-top: 1px solid #eee; display: flex; justify-content: flex-end; gap: 10px; }
  button { padding: 7px 18px; border-radius: 6px; font-size: 13px; cursor: pointer; border: 1px solid #d0d0d0; background: #f5f5f5; color: #333; }
  button:hover { background: #e8e8e8; }
  button.primary { background: #0066ff; color: #fff; border-color: #0066ff; }
  button.primary:hover { background: #0052cc; }
</style>
</head>
<body>
  <div class="header">
    <h2>${t('update.changelogTitle')}</h2>
    <div class="version">v${safeVersion}</div>
  </div>
  <div class="content" id="notes"></div>
  <div class="footer">
    <button id="btn-later">${t('update.later')}</button>
    <button id="btn-restart" class="primary">${t('update.restartNow')}</button>
  </div>
</body>
</html>`;

  const updateWin = new BrowserWindow({
    width: 400,
    height: 500,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    icon: getAppIconPath(),
    title: t('update.changelogTitle'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  updateWin.setMenuBarVisibility(false);
  updateWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  updateWin.webContents.on('did-finish-load', () => {
    // Inject markdown-like rendering and button handlers
    updateWin.webContents.executeJavaScript(`
      (function() {
        var raw = \`${safeNotes}\`;
        // Simple markdown-to-HTML: ## headings and - list items
        var lines = raw.split('\\n');
        var html = '';
        var inList = false;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.startsWith('## ')) {
            if (inList) { html += '</ul>'; inList = false; }
            html += '<h2>' + line.slice(3) + '</h2>';
          } else if (line.startsWith('- ')) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += '<li>' + line.slice(2) + '</li>';
          } else if (line.trim() === '') {
            if (inList) { html += '</ul>'; inList = false; }
          } else {
            if (inList) { html += '</ul>'; inList = false; }
            html += '<p>' + line + '</p>';
          }
        }
        if (inList) html += '</ul>';
        document.getElementById('notes').innerHTML = html;

        document.getElementById('btn-later').addEventListener('click', function() {
          window.close();
        });
        document.getElementById('btn-restart').addEventListener('click', function() {
          window.location.href = 'about:restart';
        });
      })();
    `);
  });

  // Intercept navigation to detect button clicks
  updateWin.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (url === 'about:restart') {
      updateWin.close();
      autoUpdater.quitAndInstall();
    }
  });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let manualCheck = false;

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (manualCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: t('tray.checkUpdates'),
        message: t('update.downloading', { version: info.version }),
      });
    }
    manualCheck = false;
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: t('tray.checkUpdates'),
        message: t('update.upToDate', { version: app.getVersion() }),
      });
    }
    manualCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    manualCheck = false;
    const releaseNotes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : (info.releaseNotes && info.releaseNotes[0] && info.releaseNotes[0].note) || '';
    showUpdateWindow(info.version, releaseNotes);
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
    if (manualCheck) {
      dialog.showMessageBox({
        type: 'error',
        title: t('tray.checkUpdates'),
        message: t('update.error', { message: err.message || String(err) }),
      });
    }
    manualCheck = false;
  });

  autoUpdater.manualCheck = () => {
    manualCheck = true;
    autoUpdater.checkForUpdatesAndNotify();
  };
}

app.whenReady().then(async () => {
  // Show splash immediately for user feedback
  showSplash();

  // Hide dock icon on macOS (tray-only app)
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  tray = new Tray(createTrayIcon(false));
  updateTray();

  // Auto-start bot
  await startBot();

  // Close splash after startup completes
  closeSplash();

  // Setup and check for updates (also re-check every 24 hours)
  setupAutoUpdater();
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 24 * 60 * 60 * 1000);
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
      message: t('dialog.alreadyRunning'),
      buttons: ['OK'],
    });
  }
});
