import { contextBridge, ipcRenderer } from 'electron';

const conductorBridge = {
  cli: {
    detectAll: () => ipcRenderer.invoke('cli:detectAll'),
    detect: (id: string) => ipcRenderer.invoke('cli:detect', id),
    test: (id: string) => ipcRenderer.invoke('cli:test', id),
    getCapabilities: (id: string) => ipcRenderer.invoke('cli:getCapabilities', id),
    getUsage: () => ipcRenderer.invoke('cli:getUsage'),
  },
  session: {
    start: (opts: unknown) => ipcRenderer.invoke('session:start', opts),
    send: (sessionId: string, prompt: string, attachments?: string[]) =>
      ipcRenderer.invoke('session:send', sessionId, prompt, attachments),
    cancel: (sessionId: string) => ipcRenderer.invoke('session:cancel', sessionId),
    respondToApproval: (
      sessionId: string,
      approvalId: string,
      allow: boolean,
      scope?: 'once' | 'session',
    ) => ipcRenderer.invoke('session:respondToApproval', sessionId, approvalId, allow, scope),
    switchCli: (sessionId: string, targetCliId: string) =>
      ipcRenderer.invoke('session:switchCli', sessionId, targetCliId),
    runSlashCommand: (sessionId: string, commandText: string) =>
      ipcRenderer.invoke('session:runSlashCommand', sessionId, commandText),
    approvePlan: (sessionId: string, planId: string, items: unknown[]) =>
      ipcRenderer.invoke('session:approvePlan', sessionId, planId, items),
    list: (projectId?: string) => ipcRenderer.invoke('session:list', projectId),
    getEvents: (sessionId: string) => ipcRenderer.invoke('session:getEvents', sessionId),
    onEvent: (cb: (payload: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on('session:onEvent', listener);
      return () => {
        ipcRenderer.removeListener('session:onEvent', listener);
      };
    },
  },
  checkpoint: {
    create: (sessionId: string, cwd: string) =>
      ipcRenderer.invoke('checkpoint:create', sessionId, cwd),
    undo: (checkpointId: string) => ipcRenderer.invoke('checkpoint:undo', checkpointId),
    getDiff: (checkpointId: string) => ipcRenderer.invoke('checkpoint:getDiff', checkpointId),
    list: (sessionId: string) => ipcRenderer.invoke('checkpoint:list', sessionId),
  },
  project: {
    open: (rootPath: string) => ipcRenderer.invoke('project:open', rootPath),
    list: () => ipcRenderer.invoke('project:list'),
    getConfig: (rootPath: string) => ipcRenderer.invoke('project:getConfig', rootPath),
    saveConfig: (rootPath: string, config: unknown) =>
      ipcRenderer.invoke('project:saveConfig', rootPath, config),
  },
  teamwork: {
    plan: (projectId: string, goal: string) => ipcRenderer.invoke('teamwork:plan', projectId, goal),
    startRun: (projectId: string, plan: unknown) =>
      ipcRenderer.invoke('teamwork:startRun', projectId, plan),
    getRun: (runId: string) => ipcRenderer.invoke('teamwork:getRun', runId),
    listRuns: (projectId: string) => ipcRenderer.invoke('teamwork:listRuns', projectId),
    reassignTask: (taskId: string, cliId: string) =>
      ipcRenderer.invoke('teamwork:reassignTask', taskId, cliId),
    retryTask: (taskId: string, cliId?: string) =>
      ipcRenderer.invoke('teamwork:retryTask', taskId, cliId),
    mergeTask: (taskId: string) => ipcRenderer.invoke('teamwork:mergeTask', taskId),
    resolveConflictWithCli: (taskId: string, cliId: string) =>
      ipcRenderer.invoke('teamwork:resolveConflictWithCli', taskId, cliId),
    onStateChange: (cb: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => cb(state);
      ipcRenderer.on('teamwork:onStateChange', listener);
      return () => {
        ipcRenderer.removeListener('teamwork:onStateChange', listener);
      };
    },
  },
  ide: {
    readTree: (rootPath: string, relPath?: string) =>
      ipcRenderer.invoke('ide:readTree', rootPath, relPath),
    readFile: (filePath: string) => ipcRenderer.invoke('ide:readFile', filePath),
    writeFile: (filePath: string, content: string, expectedMtimeMs?: number) =>
      ipcRenderer.invoke('ide:writeFile', filePath, content, expectedMtimeMs),
    createEntry: (targetPath: string, kind: 'file' | 'directory') =>
      ipcRenderer.invoke('ide:createEntry', targetPath, kind),
    renameEntry: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('ide:renameEntry', oldPath, newPath),
    deleteEntry: (targetPath: string) => ipcRenderer.invoke('ide:deleteEntry', targetPath),
    moveEntry: (srcPath: string, destPath: string) =>
      ipcRenderer.invoke('ide:moveEntry', srcPath, destPath),
    search: (opts: unknown) => ipcRenderer.invoke('ide:search', opts),
    replaceAcrossFiles: (opts: unknown) => ipcRenderer.invoke('ide:replaceAcrossFiles', opts),
    gitStatus: (cwd: string) => ipcRenderer.invoke('ide:gitStatus', cwd),
    gitDiff: (cwd: string, filePath?: string) => ipcRenderer.invoke('ide:gitDiff', cwd, filePath),
    gitStageFile: (cwd: string, filePath: string) =>
      ipcRenderer.invoke('ide:gitStageFile', cwd, filePath),
    gitUnstageFile: (cwd: string, filePath: string) =>
      ipcRenderer.invoke('ide:gitUnstageFile', cwd, filePath),
    gitHunkAction: (
      cwd: string,
      filePath: string,
      hunkIndex: number,
      action: string,
      prompt?: string,
    ) => ipcRenderer.invoke('ide:gitHunkAction', cwd, filePath, hunkIndex, action, prompt),
    gitCommit: (cwd: string, message: string) => ipcRenderer.invoke('ide:gitCommit', cwd, message),
    gitBranches: (cwd: string) => ipcRenderer.invoke('ide:gitBranches', cwd),
    gitCheckout: (cwd: string, branch: string, create?: boolean) =>
      ipcRenderer.invoke('ide:gitCheckout', cwd, branch, create),
    gitBlame: (cwd: string, filePath: string) => ipcRenderer.invoke('ide:gitBlame', cwd, filePath),
    gitStash: (cwd: string, action: 'push' | 'pop' | 'list') =>
      ipcRenderer.invoke('ide:gitStash', cwd, action),
    gitConflictThreeWay: (
      cwd: string,
      filePath: string,
      resolution?: string,
      customContent?: string,
    ) => ipcRenderer.invoke('ide:gitConflictThreeWay', cwd, filePath, resolution, customContent),
    terminalCreate: (opts: unknown) => ipcRenderer.invoke('ide:terminalCreate', opts),
    terminalWrite: (id: string, data: string) => ipcRenderer.invoke('ide:terminalWrite', id, data),
    terminalResize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('ide:terminalResize', id, cols, rows),
    terminalClose: (id: string) => ipcRenderer.invoke('ide:terminalClose', id),
    lspStatus: (cwd: string) => ipcRenderer.invoke('ide:lspStatus', cwd),
    lspRequest: (cwd: string, method: string, params?: unknown) =>
      ipcRenderer.invoke('ide:lspRequest', cwd, method, params),
    tasksList: (cwd: string) => ipcRenderer.invoke('ide:tasksList', cwd),
    tasksRun: (cwd: string, scriptName: string) =>
      ipcRenderer.invoke('ide:tasksRun', cwd, scriptName),
    dapStart: (cwd: string, config: unknown) => ipcRenderer.invoke('ide:dapStart', cwd, config),
    dapCommand: (sessionId: string, cmd: string, args?: unknown) =>
      ipcRenderer.invoke('ide:dapCommand', sessionId, cmd, args),
    extensionsList: () => ipcRenderer.invoke('ide:extensionsList'),
    extensionsInstall: (src: string, approvePermissions?: boolean) =>
      ipcRenderer.invoke('ide:extensionsInstall', src, approvePermissions),
    importVsCode: (kind: string, filePath: string) =>
      ipcRenderer.invoke('ide:importVsCode', kind, filePath),
    executeCommand: (id: string, ...args: unknown[]) =>
      ipcRenderer.invoke('ide:executeCommand', id, ...args),
    listCommands: () => ipcRenderer.invoke('ide:listCommands'),
    getLayout: (projectId: string) => ipcRenderer.invoke('ide:getLayout', projectId),
    saveLayout: (projectId: string, layout: unknown) =>
      ipcRenderer.invoke('ide:saveLayout', projectId, layout),
    getSettings: () => ipcRenderer.invoke('ide:getSettings'),
    saveSettings: (settings: unknown) => ipcRenderer.invoke('ide:saveSettings', settings),
  },
};

contextBridge.exposeInMainWorld('conductor', conductorBridge);
