import type {
  AgentEvent,
  ApprovalMode,
  Capabilities,
  CheckpointSummary,
  CliDetectionResult,
  CliId,
  CliUsageStats,
  ExtensionManifest,
  ProjectConfig,
  ProjectSummary,
  SessionSummary,
  StartOptions,
  TeamworkPlan,
  TeamworkRunState,
} from '@conductor/core';

export interface FileTreeNode {
  name: string;
  relPath: string;
  absPath: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
  mtimeMs?: number;
  gitStatus?: 'M' | 'A' | 'D' | 'U' | 'R' | '?';
  ignored?: boolean;
  childrenLoaded?: boolean;
  children?: FileTreeNode[];
}

export interface FileReadResult {
  filePath: string;
  content: string;
  encoding: string;
  lineEnding: 'LF' | 'CRLF';
  mtimeMs: number;
  sizeBytes: number;
  largeFileSafeMode: boolean;
}

export interface FileWriteResult {
  filePath: string;
  mtimeMs: number;
  conflict?: {
    diskContent: string;
    diskMtimeMs: number;
  };
}

export interface SearchOptions {
  cwd: string;
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxResults?: number;
}

export interface SearchMatch {
  filePath: string;
  relPath: string;
  line: number;
  column: number;
  lineText: string;
  matchText: string;
}

export interface ReplaceAcrossFilesOptions extends SearchOptions {
  replacement: string;
  previewOnly?: boolean;
}

export interface ReplaceFilePreview {
  filePath: string;
  relPath: string;
  replacementsCount: number;
  beforePreview: string;
  afterPreview: string;
}

export interface GitFileStatus {
  path: string;
  status: 'M' | 'A' | 'D' | 'U' | 'R' | '?';
  staged: boolean;
}

export interface GitDiffHunk {
  index: number;
  header: string;
  summary: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  added: number;
  removed: number;
  lines: Array<{
    type: 'context' | 'add' | 'del';
    oldLineNumber?: number;
    newLineNumber?: number;
    content: string;
  }>;
}

export interface GitFileDiff {
  filePath: string;
  hunks: GitDiffHunk[];
  rawDiff: string;
}

export interface GitBlameLine {
  line: number;
  commitSha: string;
  author: string;
  timestamp: number;
  summary: string;
  content: string;
}

export interface GitThreeWayConflict {
  filePath: string;
  ours: string;
  base: string;
  theirs: string;
  merged?: string;
}

export interface TerminalCreateOptions {
  cwd: string;
  shellProfile?: 'bash' | 'zsh' | 'powershell' | 'cmd' | 'default';
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface TerminalSessionInfo {
  id: string;
  cwd: string;
  shell: string;
  pid: number;
}

export interface LspServerStatus {
  id: string;
  language: string;
  command: string;
  installed: boolean;
  running: boolean;
  installHint: string;
}

export interface CommandDefinition {
  id: string;
  title: string;
  category?: string;
  keybinding?: string;
  description?: string;
}

export interface WorkspaceLayoutState {
  projectId: string;
  mode: 'chat' | 'code';
  sidebarVisible: boolean;
  rightPaneVisible: boolean;
  terminalVisible: boolean;
  agentPanelDocked: boolean;
  followAgent: boolean;
  openTabs: string[];
  pinnedTabs: string[];
  activeTab?: string;
  splitDirection?: 'none' | 'right' | 'down';
}

export interface ConductorSettings {
  theme: 'light' | 'dark';
  fontSize: number;
  formatOnSave: boolean;
  autoSave: boolean;
  defaultApprovalMode: ApprovalMode;
  telemetryOptIn: boolean;
  keybindings: Record<string, string>;
}

export interface PlanChecklistItem {
  id: string;
  title: string;
  checked: boolean;
}

export interface SlashCommandResult {
  command: '/plan' | '/review' | '/teamwork' | '/cli' | '/undo';
  summary: string;
  planItems?: PlanChecklistItem[];
  reviewComments?: Array<{ filePath: string; line: number; comment: string; cliId: CliId }>;
  teamworkPlan?: TeamworkPlan;
  switchedCli?: CliId;
  undoneCheckpointId?: string;
}

export interface ConductorBridge {
  cli: {
    detectAll(): Promise<Record<CliId, CliDetectionResult & { capabilities: Capabilities }>>;
    detect(id: CliId): Promise<CliDetectionResult>;
    test(id: CliId): Promise<{ ok: boolean; latencyMs: number; message: string }>;
    getCapabilities(id: CliId): Promise<Capabilities>;
    getUsage(): Promise<CliUsageStats[]>;
  };
  session: {
    start(
      opts: StartOptions & { projectId?: string; cliId?: CliId; title?: string },
    ): Promise<SessionSummary>;
    send(sessionId: string, prompt: string, attachments?: string[]): Promise<void>;
    cancel(sessionId: string): Promise<void>;
    respondToApproval(
      sessionId: string,
      approvalId: string,
      allow: boolean,
      scope?: 'once' | 'session',
    ): Promise<void>;
    switchCli(
      sessionId: string,
      targetCliId: CliId,
    ): Promise<{ session: SessionSummary; handoffSummary: string }>;
    runSlashCommand(sessionId: string, commandText: string): Promise<SlashCommandResult>;
    approvePlan(
      sessionId: string,
      planId: string,
      items: PlanChecklistItem[],
    ): Promise<{ executed: boolean }>;
    list(projectId?: string): Promise<SessionSummary[]>;
    getEvents(sessionId: string): Promise<AgentEvent[]>;
    onEvent(cb: (payload: { sessionId: string; event: AgentEvent }) => void): () => void;
  };
  checkpoint: {
    create(sessionId: string, cwd: string): Promise<CheckpointSummary>;
    undo(checkpointId: string): Promise<{ restored: boolean; commitSha: string }>;
    getDiff(checkpointId: string): Promise<GitFileDiff[]>;
    list(sessionId: string): Promise<CheckpointSummary[]>;
  };
  project: {
    open(rootPath: string): Promise<ProjectSummary>;
    list(): Promise<ProjectSummary[]>;
    getConfig(rootPath: string): Promise<ProjectConfig>;
    saveConfig(rootPath: string, config: Partial<ProjectConfig>): Promise<ProjectConfig>;
  };
  teamwork: {
    plan(projectId: string, goal: string): Promise<TeamworkPlan>;
    startRun(projectId: string, plan: TeamworkPlan): Promise<TeamworkRunState>;
    getRun(runId: string): Promise<TeamworkRunState | null>;
    listRuns(projectId: string): Promise<TeamworkRunState[]>;
    reassignTask(taskId: string, cliId: CliId): Promise<TeamworkRunState>;
    retryTask(taskId: string, cliId?: CliId): Promise<TeamworkRunState>;
    mergeTask(
      taskId: string,
    ): Promise<{ merged: boolean; conflicts?: string[]; integrationBranch: string }>;
    resolveConflictWithCli(taskId: string, cliId: CliId): Promise<TeamworkRunState>;
    onStateChange(cb: (state: TeamworkRunState) => void): () => void;
  };
  ide: {
    readTree(rootPath: string, relPath?: string): Promise<FileTreeNode[]>;
    readFile(filePath: string): Promise<FileReadResult>;
    writeFile(
      filePath: string,
      content: string,
      expectedMtimeMs?: number,
    ): Promise<FileWriteResult>;
    createEntry(targetPath: string, kind: 'file' | 'directory'): Promise<{ created: boolean }>;
    renameEntry(oldPath: string, newPath: string): Promise<{ renamed: boolean }>;
    deleteEntry(targetPath: string): Promise<{ deleted: boolean }>;
    moveEntry(srcPath: string, destPath: string): Promise<{ moved: boolean }>;
    search(opts: SearchOptions): Promise<SearchMatch[]>;
    replaceAcrossFiles(opts: ReplaceAcrossFilesOptions): Promise<ReplaceFilePreview[]>;
    gitStatus(cwd: string): Promise<{ branch: string; files: GitFileStatus[] }>;
    gitDiff(cwd: string, filePath?: string): Promise<GitFileDiff[]>;
    gitStageFile(cwd: string, filePath: string): Promise<void>;
    gitUnstageFile(cwd: string, filePath: string): Promise<void>;
    gitHunkAction(
      cwd: string,
      filePath: string,
      hunkIndex: number,
      action: 'stage' | 'unstage' | 'accept' | 'reject' | 'ask-to-change',
      prompt?: string,
    ): Promise<{ ok: boolean; updatedHunks?: GitDiffHunk[] }>;
    gitCommit(cwd: string, message: string): Promise<{ commitSha: string }>;
    gitBranches(cwd: string): Promise<{ current: string; branches: string[] }>;
    gitCheckout(cwd: string, branch: string, create?: boolean): Promise<void>;
    gitBlame(cwd: string, filePath: string): Promise<GitBlameLine[]>;
    gitStash(cwd: string, action: 'push' | 'pop' | 'list'): Promise<string[]>;
    gitConflictThreeWay(
      cwd: string,
      filePath: string,
      resolution?: 'ours' | 'theirs' | 'custom',
      customContent?: string,
    ): Promise<GitThreeWayConflict>;
    terminalCreate(opts: TerminalCreateOptions): Promise<TerminalSessionInfo>;
    terminalWrite(id: string, data: string): Promise<void>;
    terminalResize(id: string, cols: number, rows: number): Promise<void>;
    terminalClose(id: string): Promise<void>;
    lspStatus(cwd: string): Promise<LspServerStatus[]>;
    lspRequest(cwd: string, method: string, params?: unknown): Promise<unknown>;
    tasksList(cwd: string): Promise<Array<{ name: string; command: string }>>;
    tasksRun(cwd: string, scriptName: string): Promise<{ exitCode: number; output: string }>;
    dapStart(
      cwd: string,
      config: { type: 'node' | 'python'; program: string; args?: string[] },
    ): Promise<{ sessionId: string; status: 'running' | 'stopped' }>;
    dapCommand(
      sessionId: string,
      cmd: 'setBreakpoints' | 'continue' | 'stepOver' | 'stepInto' | 'variables' | 'evaluate',
      args?: unknown,
    ): Promise<unknown>;
    extensionsList(): Promise<ExtensionManifest[]>;
    extensionsInstall(
      src: string,
      approvePermissions?: boolean,
    ): Promise<{
      installed: boolean;
      requiresPermissionPrompt?: boolean;
      manifest: ExtensionManifest;
    }>;
    importVsCode(
      kind: 'theme' | 'keybindings' | 'snippets',
      filePath: string,
    ): Promise<{ imported: boolean; data: Record<string, unknown> }>;
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
    listCommands(): Promise<CommandDefinition[]>;
    getLayout(projectId: string): Promise<WorkspaceLayoutState>;
    saveLayout(
      projectId: string,
      layout: Partial<WorkspaceLayoutState>,
    ): Promise<WorkspaceLayoutState>;
    getSettings(): Promise<ConductorSettings>;
    saveSettings(settings: Partial<ConductorSettings>): Promise<ConductorSettings>;
  };
}

export const IPC_CHANNELS = {
  CLI_DETECT_ALL: 'cli:detectAll',
  CLI_DETECT: 'cli:detect',
  CLI_TEST: 'cli:test',
  CLI_GET_CAPABILITIES: 'cli:getCapabilities',
  CLI_GET_USAGE: 'cli:getUsage',
  SESSION_START: 'session:start',
  SESSION_SEND: 'session:send',
  SESSION_CANCEL: 'session:cancel',
  SESSION_RESPOND_APPROVAL: 'session:respondToApproval',
  SESSION_SWITCH_CLI: 'session:switchCli',
  SESSION_RUN_SLASH_COMMAND: 'session:runSlashCommand',
  SESSION_APPROVE_PLAN: 'session:approvePlan',
  SESSION_LIST: 'session:list',
  SESSION_GET_EVENTS: 'session:getEvents',
  SESSION_ON_EVENT: 'session:onEvent',
  CHECKPOINT_CREATE: 'checkpoint:create',
  CHECKPOINT_UNDO: 'checkpoint:undo',
  CHECKPOINT_GET_DIFF: 'checkpoint:getDiff',
  CHECKPOINT_LIST: 'checkpoint:list',
  PROJECT_OPEN: 'project:open',
  PROJECT_LIST: 'project:list',
  PROJECT_GET_CONFIG: 'project:getConfig',
  PROJECT_SAVE_CONFIG: 'project:saveConfig',
  TEAMWORK_PLAN: 'teamwork:plan',
  TEAMWORK_START_RUN: 'teamwork:startRun',
  TEAMWORK_GET_RUN: 'teamwork:getRun',
  TEAMWORK_LIST_RUNS: 'teamwork:listRuns',
  TEAMWORK_REASSIGN_TASK: 'teamwork:reassignTask',
  TEAMWORK_RETRY_TASK: 'teamwork:retryTask',
  TEAMWORK_MERGE_TASK: 'teamwork:mergeTask',
  TEAMWORK_RESOLVE_CONFLICT: 'teamwork:resolveConflictWithCli',
  TEAMWORK_ON_STATE_CHANGE: 'teamwork:onStateChange',
  IDE_READ_TREE: 'ide:readTree',
  IDE_READ_FILE: 'ide:readFile',
  IDE_WRITE_FILE: 'ide:writeFile',
  IDE_CREATE_ENTRY: 'ide:createEntry',
  IDE_RENAME_ENTRY: 'ide:renameEntry',
  IDE_DELETE_ENTRY: 'ide:deleteEntry',
  IDE_MOVE_ENTRY: 'ide:moveEntry',
  IDE_SEARCH: 'ide:search',
  IDE_REPLACE_ACROSS_FILES: 'ide:replaceAcrossFiles',
  IDE_GIT_STATUS: 'ide:gitStatus',
  IDE_GIT_DIFF: 'ide:gitDiff',
  IDE_GIT_STAGE_FILE: 'ide:gitStageFile',
  IDE_GIT_UNSTAGE_FILE: 'ide:gitUnstageFile',
  IDE_GIT_HUNK_ACTION: 'ide:gitHunkAction',
  IDE_GIT_COMMIT: 'ide:gitCommit',
  IDE_GIT_BRANCHES: 'ide:gitBranches',
  IDE_GIT_CHECKOUT: 'ide:gitCheckout',
  IDE_GIT_BLAME: 'ide:gitBlame',
  IDE_GIT_STASH: 'ide:gitStash',
  IDE_GIT_CONFLICT_THREE_WAY: 'ide:gitConflictThreeWay',
  IDE_TERMINAL_CREATE: 'ide:terminalCreate',
  IDE_TERMINAL_WRITE: 'ide:terminalWrite',
  IDE_TERMINAL_RESIZE: 'ide:terminalResize',
  IDE_TERMINAL_CLOSE: 'ide:terminalClose',
  IDE_LSP_STATUS: 'ide:lspStatus',
  IDE_LSP_REQUEST: 'ide:lspRequest',
  IDE_TASKS_LIST: 'ide:tasksList',
  IDE_TASKS_RUN: 'ide:tasksRun',
  IDE_DAP_START: 'ide:dapStart',
  IDE_DAP_COMMAND: 'ide:dapCommand',
  IDE_EXTENSIONS_LIST: 'ide:extensionsList',
  IDE_EXTENSIONS_INSTALL: 'ide:extensionsInstall',
  IDE_IMPORT_VSCODE: 'ide:importVsCode',
  IDE_EXECUTE_COMMAND: 'ide:executeCommand',
  IDE_LIST_COMMANDS: 'ide:listCommands',
  IDE_GET_LAYOUT: 'ide:getLayout',
  IDE_SAVE_LAYOUT: 'ide:saveLayout',
  IDE_GET_SETTINGS: 'ide:getSettings',
  IDE_SAVE_SETTINGS: 'ide:saveSettings',
} as const;

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type CommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/**
 * Unified Command Registry (Section 13.4) used by the command palette,
 * menus, keybindings, and extensions.
 */
export class CommandRegistry {
  private readonly definitions = new Map<string, CommandDefinition>();
  private readonly handlers = new Map<string, CommandHandler>();

  register(definition: CommandDefinition, handler: CommandHandler): void {
    this.definitions.set(definition.id, definition);
    this.handlers.set(definition.id, handler);
  }

  unregister(id: string): boolean {
    this.definitions.delete(id);
    return this.handlers.delete(id);
  }

  has(id: string): boolean {
    return this.handlers.has(id);
  }

  list(): CommandDefinition[] {
    return Array.from(this.definitions.values());
  }

  async execute<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const handler = this.handlers.get(id);
    if (!handler) {
      throw new Error(`Command not found in CommandRegistry: "${id}"`);
    }
    return (await handler(...args)) as T;
  }
}

declare global {
  interface Window {
    conductor?: ConductorBridge;
  }
}
