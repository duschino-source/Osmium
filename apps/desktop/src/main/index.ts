import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
Menu.setApplicationMenu(null);
// Stable Windows taskbar/notification identity for the app icon.
app.setAppUserModelId('com.osmiumide.app');
import path from 'node:path';
import type {
  AgentEvent,
  CliDetectionResult,
  CliId,
  SessionSummary,
  StartOptions,
} from '@osmium/core';
import {
  FileService,
  SearchService,
  GitService,
  TerminalService,
  WorkspaceService,
  DEFAULT_OSMIUM_SETTINGS,
  type OsmiumSettings,
} from '@osmium/ide-core';
import { AdapterHostClient, AdapterHostError } from './adapter-host';
import { SettingsStore } from './settings-store';

// Ensure headless container environments (Xvfb) can launch Electron reliably
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

let mainWindow: BrowserWindow | null = null;
const fileService = new FileService();
const searchService = new SearchService();
const gitService = new GitService();
const terminalService = new TerminalService();
const workspaceService = new WorkspaceService();

let adapterHost: AdapterHostClient | null = null;
let settingsStore: SettingsStore | null = null;
const sessions = new Map<string, SessionSummary>();
const sessionEventLogs = new Map<string, AgentEvent[]>();

function requireAdapterHost(): AdapterHostClient {
  if (!adapterHost) {
    throw new AdapterHostError('ERR_HOST_NOT_READY', 'Adapter host has not been initialised yet');
  }
  return adapterHost;
}

function recordSessionEvent(sessionId: string, event: AgentEvent): void {
  const log = sessionEventLogs.get(sessionId);
  if (log) {
    log.push(event);
  } else {
    sessionEventLogs.set(sessionId, [event]);
  }

  const summary = sessions.get(sessionId);
  if (summary) {
    summary.updatedAt = Date.now();
    if (event.type === 'status') {
      // AgentEvent status carries terminal states (interrupted/cancelled/closed)
      // that SessionSummary does not model; those settle back to idle.
      summary.status =
        event.state === 'working' || event.state === 'waiting' || event.state === 'error'
          ? event.state
          : 'idle';
    }
  }
}

type SessionStartParams = Partial<StartOptions> & {
  projectId?: string;
  cliId?: CliId;
  title?: string;
};

interface HostStartResult {
  sessionId: string;
  cliId: CliId;
  cwd: string;
}

function registerPhase0IpcHandlers(): void {
  // Window controls
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });
  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  // Settings
  ipcMain.handle('ide:getSettings', async () =>
    settingsStore ? settingsStore.load() : DEFAULT_OSMIUM_SETTINGS,
  );
  ipcMain.handle('ide:saveSettings', async (_event, patch: unknown) =>
    settingsStore
      ? settingsStore.save((patch ?? {}) as Partial<OsmiumSettings>)
      : DEFAULT_OSMIUM_SETTINGS,
  );

  // File tree and editing
  ipcMain.handle('ide:readTree', async (_event, rootPath: string, relPath?: string) => {
    const cwd = rootPath || process.cwd();
    return fileService.readTree(cwd, relPath || '');
  });
  ipcMain.handle('ide:readFile', async (_event, filePath: string) => {
    return fileService.readFile(filePath);
  });
  ipcMain.handle(
    'ide:writeFile',
    async (_event, filePath: string, content: string, expectedMtimeMs?: number) => {
      return fileService.writeFile(filePath, content, expectedMtimeMs);
    },
  );
  ipcMain.handle(
    'ide:createEntry',
    async (_event, targetPath: string, kind: 'file' | 'directory') => {
      return fileService.createEntry(targetPath, kind);
    },
  );
  ipcMain.handle('ide:renameEntry', async (_event, oldPath: string, newPath: string) => {
    return fileService.renameEntry(oldPath, newPath);
  });
  ipcMain.handle('ide:deleteEntry', async (_event, targetPath: string) => {
    return fileService.deleteEntry(targetPath);
  });
  ipcMain.handle('ide:moveEntry', async (_event, srcPath: string, destPath: string) => {
    return fileService.renameEntry(srcPath, destPath);
  });

  // Workspace root, Open Folder, and the live filesystem watcher
  ipcMain.handle('ide:getWorkspaceRoot', async () => workspaceService.getRoot());

  ipcMain.handle('ide:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Open Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const root = await workspaceService.setRoot(result.filePaths[0]);
    await workspaceService.watch(root);
    return root;
  });

  ipcMain.handle('ide:setWorkspaceRoot', async (_event, rootPath: string) => {
    const root = await workspaceService.setRoot(rootPath);
    await workspaceService.watch(root);
    return root;
  });

  ipcMain.handle('ide:listWorkspaceFiles', async (_event, rootPath?: string) => {
    return workspaceService.listFiles(rootPath || workspaceService.getRoot() || undefined);
  });

  ipcMain.handle('ide:watchWorkspace', async (_event, rootPath?: string) => {
    await workspaceService.watch(rootPath || workspaceService.getRoot() || undefined);
    return true;
  });

  ipcMain.handle('ide:unwatchWorkspace', async () => {
    await workspaceService.unwatch();
    return true;
  });

  workspaceService.on('change', (batch: unknown) => {
    mainWindow?.webContents.send('ide:workspaceChanged', batch);
  });
  workspaceService.on('error', (error: unknown) => {
    // A watcher failure must be visible, not silent, but must not crash the app.
    mainWindow?.webContents.send('ide:workspaceWatchError', {
      message: error instanceof Error ? error.message : String(error),
    });
  });

  // Search
  ipcMain.handle('ide:search', async (_event, opts: any) => {
    return searchService.search(opts);
  });
  ipcMain.handle('ide:replaceAcrossFiles', async (_event, opts: any) => {
    return searchService.replaceAcrossFiles(opts);
  });

  // Git
  ipcMain.handle('ide:gitStatus', async (_event, cwd: string) => {
    return gitService.gitStatus(cwd || process.cwd());
  });
  ipcMain.handle('ide:gitDiff', async (_event, cwd: string, filePath?: string) => {
    return gitService.gitDiff(cwd || process.cwd(), filePath);
  });
  ipcMain.handle('ide:gitStageFile', async (_event, cwd: string, filePath: string) => {
    return gitService.gitStageFile(cwd || process.cwd(), filePath);
  });
  ipcMain.handle('ide:gitUnstageFile', async (_event, cwd: string, filePath: string) => {
    return gitService.gitUnstageFile(cwd || process.cwd(), filePath);
  });
  ipcMain.handle('ide:gitCommit', async (_event, cwd: string, message: string) => {
    return gitService.gitCommit(cwd || process.cwd(), message);
  });
  ipcMain.handle('ide:gitBranches', async (_event, cwd: string) => {
    return gitService.gitBranches(cwd || process.cwd());
  });

  // Terminal
  ipcMain.handle('ide:terminalCreate', async (_event, opts: any) => {
    return terminalService.createSession(opts || { cwd: process.cwd() }, (sessionId, data) => {
      mainWindow?.webContents.send('ide:terminalData', { sessionId, data });
    });
  });
  ipcMain.handle('ide:terminalWrite', async (_event, id: string, data: string) => {
    terminalService.write(id, data);
  });
  ipcMain.handle('ide:terminalResize', async (_event, id: string, cols: number, rows: number) => {
    terminalService.resize(id, cols, rows);
  });
  ipcMain.handle('ide:terminalClose', async (_event, id: string) => {
    terminalService.close(id);
  });
}

function registerAdapterIpcHandlers(): void {
  // CLI discovery — the Rust sidecar is the single source of truth.
  ipcMain.handle('cli:detectAll', async () => requireAdapterHost().request('detectAll'));

  ipcMain.handle('cli:detect', async (_event, id: CliId) =>
    requireAdapterHost().request<CliDetectionResult>('detect', { cliId: id }),
  );

  ipcMain.handle('cli:getCapabilities', async (_event, id: CliId) =>
    requireAdapterHost().request('capabilities', { cliId: id }),
  );

  ipcMain.handle('cli:getUsage', async () => requireAdapterHost().request('getUsage'));

  ipcMain.handle('cli:test', async (_event, id: CliId) => {
    const startedAt = Date.now();
    try {
      const detection = await requireAdapterHost().request<CliDetectionResult>('detect', {
        cliId: id,
      });
      return {
        ok: detection.installed,
        latencyMs: Date.now() - startedAt,
        message: detection.installed
          ? (detection.version ?? detection.path ?? 'Installed')
          : (detection.versionWarning ?? 'Binary not found'),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Sessions
  ipcMain.handle('session:start', async (_event, params: SessionStartParams = {}) => {
    // The renderer's StartOptions type requires `cwd`, so it may pass '' when no
    // folder is open. Treat empty/whitespace-only and omitted cwd as the
    // Electron process cwd before forwarding to the host.
    const cwd = params.cwd?.trim() ? params.cwd : process.cwd();
    const cliId = params.cliId ?? 'deepseek';
    const approvalMode = params.approvalMode ?? 'ask';

    const started = await requireAdapterHost().request<HostStartResult>('start', {
      cliId,
      cwd,
      approvalMode,
      resume: params.resume ?? null,
      systemContext: params.systemContext ?? null,
      readOnly: params.readOnly ?? null,
    });

    const now = Date.now();
    const summary: SessionSummary = {
      id: started.sessionId,
      projectId: params.projectId ?? (path.basename(cwd) || cwd),
      title: params.title ?? 'New session',
      activeCli: started.cliId ?? cliId,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };
    sessions.set(summary.id, summary);
    if (!sessionEventLogs.has(summary.id)) sessionEventLogs.set(summary.id, []);
    return summary;
  });

  ipcMain.handle(
    'session:send',
    async (_event, sessionId: string, prompt: string, attachments?: string[]) => {
      await requireAdapterHost().request('send', {
        sessionId,
        prompt,
        attachments: attachments ?? [],
      });
    },
  );

  ipcMain.handle('session:cancel', async (_event, sessionId: string) => {
    await requireAdapterHost().request('cancel', { sessionId });
  });

  ipcMain.handle(
    'session:respondToApproval',
    async (
      _event,
      sessionId: string,
      approvalId: string,
      allow: boolean,
      scope?: 'once' | 'session',
    ) => {
      await requireAdapterHost().request('respondToApproval', {
        sessionId,
        approvalId,
        allow,
        ...(scope ? { scope } : {}),
      });
    },
  );

  ipcMain.handle('session:close', async (_event, sessionId: string) => {
    try {
      await requireAdapterHost().request('close', { sessionId });
    } catch (error) {
      // Closing is terminal for the session; an unknown session is already
      // closed from the renderer's point of view.
      if (!(error instanceof AdapterHostError) || error.code !== 'ERR_HOST_SESSION_NOT_FOUND') {
        throw error;
      }
    } finally {
      sessions.delete(sessionId);
      sessionEventLogs.delete(sessionId);
    }
  });

  ipcMain.handle('session:list', async (_event, projectId?: string) => {
    const all = [...sessions.values()];
    return projectId ? all.filter((session) => session.projectId === projectId) : all;
  });

  ipcMain.handle(
    'session:getEvents',
    async (_event, sessionId: string) => sessionEventLogs.get(sessionId) ?? [],
  );
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    title: 'OsmiumIDE',
    icon: path.join(__dirname, '../renderer/icon.png'),
    backgroundColor: '#F6F8F5',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu();

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    win.setAlwaysOnTop(true);
    setTimeout(() => {
      win.setAlwaysOnTop(false);
    }, 300);
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
  if (process.platform === 'darwin' && app.dock) {
    // BrowserWindow icon covers Linux/Windows; the macOS dock needs this call.
    app.dock.setIcon(path.join(__dirname, '../renderer/icon.png'));
  }
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  adapterHost = new AdapterHostClient();
  adapterHost.on('sessionEvent', ({ sessionId, event }) => {
    recordSessionEvent(sessionId, event);
    mainWindow?.webContents.send('session:onEvent', { sessionId, event });
  });
  adapterHost.on('sessionEnded', ({ sessionId }) => {
    const summary = sessions.get(sessionId);
    if (summary) {
      summary.status = 'idle';
      summary.updatedAt = Date.now();
    }
  });

  registerPhase0IpcHandlers();
  registerAdapterIpcHandlers();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

let adapterHostClosing = false;
let forceQuitTimer: ReturnType<typeof setTimeout> | null = null;
app.on('before-quit', (event) => {
  // Kill every PTY before the window goes away. Without this, closing the app
  // leaves orphaned shells on Windows.
  terminalService.closeAll();
  void workspaceService.unwatch();

  const client = adapterHost;
  if (!client || adapterHostClosing) return;
  adapterHostClosing = true;
  adapterHost = null;
  event.preventDefault();
  // A wedged CLI must not prevent the app from closing. The graceful client
  // close has its own short timeouts; this is the final safety net.
  forceQuitTimer = setTimeout(() => app.exit(0), 8000);
  forceQuitTimer.unref?.();
  void client.close().finally(() => {
    if (forceQuitTimer) {
      clearTimeout(forceQuitTimer);
      forceQuitTimer = null;
    }
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { mainWindow };
