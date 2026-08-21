'use strict';

const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 3000;
const APP_URL = `http://localhost:${PORT}`;

// When packaged, resources are in process.resourcesPath; in dev, relative to electron/
const IS_PACKAGED = app.isPackaged;
const RESOURCES = IS_PACKAGED ? process.resourcesPath : path.join(__dirname, '..');
const SERVER_JS = IS_PACKAGED
  ? path.join(RESOURCES, 'server', 'src', 'server.js')
  : path.join(__dirname, '../server/src/server.js');
const ICON_PATH = IS_PACKAGED
  ? path.join(RESOURCES, 'app', 'icon-192.png')
  : path.join(__dirname, '../icon-192.png');

let mainWindow = null;
let tray = null;

// ── Start Express server in-process (no external Node.js needed) ──────────────
function startServer() {
  const dbDir = IS_PACKAGED
    ? path.join(app.getPath('userData'), 'db')
    : path.join(__dirname, '../server/db');
  const staticRoot = IS_PACKAGED
    ? path.join(RESOURCES, 'app')
    : path.join(__dirname, '..');

  process.env.PORT = String(PORT);
  process.env.DB_DIR = dbDir;
  process.env.STATIC_ROOT = staticRoot;
  process.env.APP_VERSION = app.getVersion();

  try {
    require(SERVER_JS);
  } catch (e) {
    console.error('[server] failed to load:', e.message);
    dialog.showErrorBox('FloorSync', 'Server failed to start:\n' + e.message);
    app.quit();
  }
}

// ── Wait for server to accept connections ─────────────────────────────────────
function waitForServer(cb, attempts = 0) {
  if (attempts > 60) { cb(new Error('Server did not start in time')); return; }
  http.get(APP_URL, () => cb(null)).on('error', () => {
    setTimeout(() => waitForServer(cb, attempts + 1), 500);
  });
}

// ── Create main window ────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'H&L FloorSync',
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#111111',
    show: false,
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the real browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function setAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'About H&L FloorSync',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About H&L FloorSync',
              message: `H&L FloorSync v${app.getVersion()}`,
              detail: 'H&L Manufacturing · CMMS'
            });
          }
        }
      ]
    }
  ]));
}

function createTray() {
  tray = new Tray(ICON_PATH);
  tray.setToolTip(`H&L FloorSync v${app.getVersion()}`);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open FloorSync',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
      }
    },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(APP_URL)
    },
    { type: 'separator' },
    {
      label: 'Open Maintenance',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.loadURL(APP_URL + '/maintenance.html'); }
        else { createWindow(); mainWindow.once('ready-to-show', () => mainWindow.loadURL(APP_URL + '/maintenance.html')); }
      }
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        if (IS_PACKAGED) autoUpdater.checkForUpdates().catch(() => {});
      }
    },
    { type: 'separator' },
    {
      label: 'Quit FloorSync',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    else createWindow();
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  setAppMenu();
  createTray();

  // Show splash while server loads
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 800, minHeight: 600,
    title: 'H&L FloorSync',
    icon: ICON_PATH,
    backgroundColor: '#111111',
    show: false,
  });

  mainWindow.loadURL('data:text/html,<style>body{background:%23111;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;color:%23aaa;font-size:14px}</style><body>Starting FloorSync...</body>');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', e => { if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('closed', () => { mainWindow = null; });

  startServer();

  waitForServer((err) => {
    if (err) {
      dialog.showErrorBox('FloorSync', 'Server failed to start:\n' + err.message);
      app.quit();
      return;
    }
    if (mainWindow) {
      mainWindow.loadURL(APP_URL);
    }
    // Check for updates silently after app loads (only when packaged)
    if (IS_PACKAGED) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.checkForUpdates().catch(() => {});
      autoUpdater.on('update-downloaded', () => {
        dialog.showMessageBox({
          type: 'info',
          title: 'Update Ready',
          message: 'A new version of H&L FloorSync has been downloaded. It will install when you quit the app.',
          buttons: ['Install Now', 'Later']
        }).then(({ response }) => {
          if (response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
      });
    }
  });
});

app.on('window-all-closed', () => {
  // Stay in tray
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
