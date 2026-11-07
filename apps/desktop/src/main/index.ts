import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

// Ensure headless container environments (Xvfb) can launch Electron reliably
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

let mainWindow: BrowserWindow | null = null;

function registerPhase0IpcHandlers(): void {
  ipcMain.handle('cli:detectAll', async () => ({
    codex: {
      installed: false,
      capabilities: {
        acp: false,
        jsonStream: true,
        resume: true,
        approvals: true,
        readOnlyMode: true,
        reportsUsage: true,
      },
    },
    antigravity: {
      installed: false,
      capabilities: {
        acp: false,
        jsonStream: false,
        resume: false,
        approvals: true,
        readOnlyMode: true,
        reportsUsage: false,
      },
    },
    deepseek: {
      installed: false,
      capabilities: {
        acp: false,
        jsonStream: false,
        resume: false,
        approvals: true,
        readOnlyMode: true,
        reportsUsage: true,
      },
    },
    mock: {
      installed: true,
      version: '0.1.0',
      capabilities: {
        acp: false,
        jsonStream: true,
        resume: true,
        approvals: true,
        readOnlyMode: true,
        reportsUsage: true,
        testedVersion: '0.1.0',
      },
    },
  }));

  ipcMain.handle('ide:getSettings', async () => ({
    theme: 'light',
    fontSize: 13,
    formatOnSave: true,
    autoSave: false,
    defaultApprovalMode: 'ask',
    telemetryOptIn: false,
    keybindings: {
      'osmium.commandPalette': 'CommandOrControl+K',
      'osmium.toggleAgentPanel': 'CommandOrControl+L',
    },
  }));
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    title: 'OsmiumIDE',
    backgroundColor: '#F6F8F5',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    const indexHtml = path.join(__dirname, '../renderer/index.html');
    void win.loadFile(indexHtml);
  }

  return win;
}

void app.whenReady().then(() => {
  registerPhase0IpcHandlers();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { mainWindow };
