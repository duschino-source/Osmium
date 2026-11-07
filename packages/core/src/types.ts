export type CliId = 'codex' | 'antigravity' | 'deepseek' | 'mock' | (string & {});

export type ApprovalMode = 'ask' | 'auto-edit' | 'full-auto';

export interface Capabilities {
  acp: boolean;
  jsonStream: boolean;
  resume: boolean;
  approvals: boolean;
  readOnlyMode: boolean;
  reportsUsage: boolean;
  testedVersion?: string;
}

export interface CliDetectionResult {
  installed: boolean;
  version?: string;
  path?: string;
  versionWarning?: string;
}

export interface CliAdapter {
  id: CliId;
  displayName: string;
  detect(): Promise<CliDetectionResult>;
  capabilities(): Promise<Capabilities>;
  start(opts: StartOptions): Promise<AgentSession>;
}

export interface StartOptions {
  cwd: string;
  approvalMode: ApprovalMode;
  resume?: string;
  systemContext?: string;
  readOnly?: boolean;
}

export interface AgentSession {
  id: string;
  events: AsyncIterable<AgentEvent>;
  send(prompt: string, attachments?: string[]): Promise<void>;
  respondToApproval(id: string, allow: boolean, scope?: 'once' | 'session'): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export type AgentEvent =
  | { type: 'message'; role: 'assistant' | 'user'; text: string; final: boolean }
  | {
      type: 'tool';
      id: string;
      name: string;
      status: 'running' | 'done' | 'error';
      summary?: string;
      durationSec?: number;
    }
  | { type: 'file-edit'; path: string; added: number; removed: number }
  | { type: 'approval'; id: string; kind: 'command' | 'edit' | 'network'; detail: string }
  | { type: 'usage'; limitHit?: boolean; note?: string }
  | { type: 'status'; state: 'idle' | 'working' | 'waiting' | 'error'; message?: string }
  | { type: 'raw'; data: string };

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  primaryCli: CliId;
  secondaryClis: CliId[];
  approvalMode: ApprovalMode;
  updatedAt: number;
}

export interface SessionSummary {
  id: string;
  projectId: string;
  title: string;
  activeCli: CliId;
  providerSessionId?: string;
  status: 'idle' | 'working' | 'waiting' | 'error';
  createdAt: number;
  updatedAt: number;
}

export interface CheckpointSummary {
  id: string;
  sessionId: string;
  turnIndex: number;
  gitRef: string;
  commitSha: string;
  filesChanged: Array<{ path: string; added: number; removed: number }>;
  createdAt: number;
}

export type TeamworkTaskStatus = 'queued' | 'running' | 'review' | 'done' | 'error';

export interface TeamworkTaskState {
  id: string;
  runId: string;
  title: string;
  description?: string;
  taskType: string;
  assignedCli: CliId;
  status: TeamworkTaskStatus;
  scope: string[];
  dependencies: string[];
  worktreePath?: string;
  branchName?: string;
  sessionId?: string;
  diffAdded: number;
  diffRemoved: number;
  outOfScopeFiles: string[];
  errorMessage?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface TeamworkRunState {
  id: string;
  projectId: string;
  sessionId?: string;
  goal: string;
  orchestratorCli: CliId;
  integrationBranch: string;
  maxParallel: number;
  status: 'planning' | 'running' | 'review' | 'done' | 'conflict' | 'error';
  tasks: TeamworkTaskState[];
  createdAt: number;
  updatedAt: number;
}

export interface CliUsageStats {
  cliId: CliId;
  turnsRun: number;
  lastLimitHitAt?: number;
  lastNote?: string;
}
