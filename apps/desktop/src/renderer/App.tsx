import React, { useEffect, useRef, useState } from 'react';
import type {
  AgentEvent,
  ApprovalMode,
  Capabilities,
  CliDetectionResult,
  CliId,
  OsmiumSettings,
} from '@osmium/core';
import { DEFAULT_OSMIUM_SETTINGS } from '@osmium/core';
import { getCliCssVariable, getCliDisplayName } from '@osmium/adapters';
import type { OsmiumBridge } from '@osmium/ide-core';
import {
  Button,
  Composer,
  DropdownMenu,
  DropdownItem,
  Icon,
  IdeWorkbench,
  type EditorTab,
  type FileNode,
  type IconName,
  type IdeActivity,
  type SettingsValues,
  type QuickOpenCandidate,
  type TerminalBridge,
} from '@osmium/ui';
import { parseGoToLine } from '@osmium/ui';
import { CliHubView, type CliHubEntry, type CliTestResult } from './CliHubView.js';
import { SessionView, type SessionStatus } from './SessionView.js';
import { BrandMark } from './BrandMark.js';
import { formatDocumentContent } from './format.js';

type DetectionEntry = CliDetectionResult & { capabilities?: Capabilities };
type DetectionMap = Partial<Record<CliId, DetectionEntry>>;
type TestResults = Partial<Record<CliId, CliTestResult>>;

interface ActiveSession {
  id: string;
  cliId: CliId;
  events: AgentEvent[];
  status: SessionStatus;
  error?: string;
  resolvedApprovals: string[];
}

const CLI_ORDER: CliId[] = ['codex', 'antigravity', 'deepseek', 'mock'];
const CLI_CHIP_LABEL: Record<string, string> = {
  codex: 'Codex CLI · Primary',
  antigravity: 'Antigravity · Second',
  deepseek: 'DeepSeek CLI',
  mock: 'Mock CLI · Test engine',
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The adapter host returned an unknown error.';
}

function getOsmiumBridge(): OsmiumBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { osmium?: OsmiumBridge }).osmium;
}

function statusFromEvent(state: string): SessionStatus {
  if (state === 'cancelled' || state === 'closed') return 'cancelled';
  if (state === 'error') return 'error';
  if (state === 'waiting') return 'waiting';
  if (state === 'working') return 'working';
  return 'idle';
}

export interface SidebarProjectItem {
  id: string;
  name: string;
  primaryCli: CliId;
}

const PRIMARY_NAV_ITEMS = ['New Task', 'Projects', 'Teamwork', 'Search'] as const;
const FOOTER_NAV_ITEMS = ['CLI Hub', 'Automations', 'Extensions', 'Settings'] as const;

const NAV_ICONS: Record<string, IconName> = {
  'New Task': 'filePlus',
  Projects: 'folder',
  Teamwork: 'users',
  Search: 'search',
  'CLI Hub': 'terminal',
  Automations: 'clock',
  Extensions: 'grid',
  Settings: 'gear',
};

const FILE_MENU_ITEMS: DropdownItem[] = [
  { key: 'open-folder', label: 'Open Folder...', badge: 'Ctrl+O' },
  { key: 'new-task', label: 'New Task', badge: 'Ctrl+N' },
  { key: 'new-session', label: 'New Session', badge: 'Ctrl+Shift+N' },
  { key: 'save-file', label: 'Save File', badge: 'Ctrl+S' },
  { key: 'save-checkpoint', label: 'Save Git Checkpoint', badge: 'Ctrl+S' },
  { key: 'exit', label: 'Close Window', badge: 'Alt+F4' },
];

const EDIT_MENU_ITEMS: DropdownItem[] = [
  { key: 'undo', label: 'Undo Checkpoint', badge: 'Ctrl+Z' },
  { key: 'copy-prompt', label: 'Copy Prompt', badge: 'Ctrl+C' },
  { key: 'clear-prompt', label: 'Clear Composer' },
];

const VIEW_MENU_ITEMS: DropdownItem[] = [
  { key: 'toggle-mode', label: 'Switch Code / Chat', badge: 'Ctrl+M' },
  { key: 'toggle-palette', label: 'Command Palette...', badge: 'Ctrl+K' },
  { key: 'settings', label: 'Settings...', badge: 'Ctrl+,' },
];

const HELP_MENU_ITEMS: DropdownItem[] = [
  { key: 'docs', label: 'Osmium Documentation' },
  { key: 'shortcuts', label: 'Keyboard Shortcuts', badge: 'Ctrl+K' },
  { key: 'about', label: 'About OsmiumIDE v0.1.0' },
];

export const App: React.FC = () => {
  const [topMode, setTopMode] = useState<'code' | 'chat'>('code');
  const [activeNav, setActiveNav] = useState<string>('New Task');
  const [promptText, setPromptText] = useState<string>('');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('ask');
  const [activeCliId, setActiveCliId] = useState<CliId>('codex');
  const [routingMode, setRoutingMode] = useState<string>('Auto');
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [activeMenu, setActiveMenu] = useState<'file' | 'edit' | 'view' | 'help' | null>(null);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  // IDE State
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  const [quickOpenFiles, setQuickOpenFiles] = useState<QuickOpenCandidate[]>([]);
  const [cursor, setCursor] = useState<{ line: number; column: number }>({ line: 1, column: 1 });
  const [reveal, setReveal] = useState<{
    tabId: string;
    line: number;
    column?: number;
    nonce: number;
  } | null>(null);
  const [lineEnding, setLineEnding] = useState<string>('LF');
  const [workspaceError, setWorkspaceError] = useState<string>('');
  const handleOpenFolderRef = useRef<(() => Promise<void>) | null>(null);
  const [gitStatusFiles, setGitStatusFiles] = useState<
    Array<{ path: string; status: 'M' | 'A' | 'D' | 'U' | 'R' | '?'; staged: boolean }>
  >([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [ideActivity, setIdeActivity] = useState<IdeActivity>('explorer');
  const [settings, setSettings] = useState<OsmiumSettings>(DEFAULT_OSMIUM_SETTINGS);
  const [paletteQuery, setPaletteQuery] = useState<string>('');
  const [paletteIndex, setPaletteIndex] = useState<number>(0);

  // Adapter bridge state (CLI detection + chat sessions)
  const [detection, setDetection] = useState<DetectionMap | null>(null);
  const [detectionLoading, setDetectionLoading] = useState<boolean>(true);
  const [detectionError, setDetectionError] = useState<string>();
  const [testResults, setTestResults] = useState<TestResults>({});
  const [session, setSession] = useState<ActiveSession | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteQuery('');
        setPaletteIndex(0);
        setPaletteOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setTopMode((prev) => (prev === 'code' ? 'chat' : 'code'));
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === ',') {
        e.preventDefault();
        setTopMode('code');
        setIdeActivity('settings');
        setActiveNav('Settings');
        return;
      }
      if (e.key.toLowerCase() === 's' && !e.defaultPrevented) {
        e.preventDefault();
        void handleSaveFile(activeTabId);
        return;
      }
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        updateSettings({ sidebarVisible: !settings.sidebarVisible });
      }
      if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void handleOpenFolderRef.current?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTabId, editorTabs, settings.sidebarVisible, settings.formatOnSave]);

  const refreshWorkspace = React.useCallback(async () => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.readTree) return;
    const root = workspaceRoot;
    if (!root) {
      // No folder open: an empty tree is honest. The demo tree is gone.
      setFileTree([]);
      setQuickOpenFiles([]);
      return;
    }
    try {
      const [tree, branches, status, files] = await Promise.all([
        bridge.ide.readTree(root),
        bridge.ide.gitBranches(root),
        bridge.ide.gitStatus(root),
        bridge.ide.listWorkspaceFiles?.(root).catch(() => []),
      ]);
      setFileTree(Array.isArray(tree) ? (tree as FileNode[]) : []);
      setQuickOpenFiles(
        Array.isArray(files)
          ? files
              .filter((entry) => entry.kind === 'file')
              .map((entry) => ({
                relPath: entry.relPath,
                name: entry.name,
                kind: entry.kind,
              }))
          : [],
      );
      if (Array.isArray(branches) && branches.length > 0) {
        const current = branches.find((branch: any) => branch.current);
        if (current) setCurrentBranch(current.name);
      } else if (branches && typeof branches === 'object' && 'current' in branches) {
        if (branches.current) setCurrentBranch(String(branches.current));
      }
      if (Array.isArray(status)) {
        setGitStatusFiles(status);
      } else if (status && typeof status === 'object' && Array.isArray((status as any).files)) {
        setGitStatusFiles((status as any).files);
        if ((status as any).branch) setCurrentBranch(String((status as any).branch));
      }
    } catch (error) {
      setWorkspaceError(errorMessage(error));
    }
  }, [workspaceRoot]);

  // Adopt an already-open root (or the last one) on mount.
  useEffect(() => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.getWorkspaceRoot) return;
    bridge.ide
      .getWorkspaceRoot()
      .then((root) => {
        if (root) setWorkspaceRoot(root);
      })
      .catch(() => {
        // No root yet is a normal first-run state.
      });
  }, []);

  // Live filesystem watcher: refresh the tree when files change on disk.
  useEffect(() => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.onWorkspaceChanged || !workspaceRoot) return;
    const offChange = bridge.ide.onWorkspaceChanged(() => {
      void refreshWorkspace();
    });
    const offError = bridge.ide.onWorkspaceWatchError?.((payload) => {
      setWorkspaceError(payload.message);
    });
    void bridge.ide.watchWorkspace?.(workspaceRoot).catch(() => {});
    return () => {
      offChange();
      offError?.();
    };
  }, [workspaceRoot, refreshWorkspace]);

  const handleOpenFolder = React.useCallback(async () => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.openFolder) {
      setWorkspaceError('Folder picker is unavailable in this environment.');
      return;
    }
    try {
      const root = await bridge.ide.openFolder();
      if (!root) return;
      setWorkspaceRoot(root);
      setWorkspaceError('');
    } catch (error) {
      setWorkspaceError(errorMessage(error));
    }
  }, []);

  handleOpenFolderRef.current = handleOpenFolder;

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const max = await (window as any).osmium?.windowControls?.isMaximized?.();
        if (typeof max === 'boolean') {
          setIsMaximized(max);
        }
      } catch {
        // non-electron or mock environment
      }
    };
    checkMaximized();
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const refreshDetection = React.useCallback(async () => {
    setDetectionLoading(true);
    setDetectionError(undefined);
    try {
      const bridge = getOsmiumBridge();
      if (!bridge?.cli?.detectAll) {
        setDetection(null);
        setDetectionError('Adapter bridge unavailable in this environment.');
        return;
      }
      const result = await bridge.cli.detectAll();
      setDetection(result as DetectionMap);
    } catch (error) {
      setDetectionError(errorMessage(error));
    } finally {
      setDetectionLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDetection();
  }, [refreshDetection]);

  const applyAppearance = React.useCallback((next: OsmiumSettings) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const prefersDark =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
    const resolved = next.theme === 'system' ? (prefersDark ? 'dark' : 'light') : next.theme;
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-palette', next.palette);
    root.setAttribute(
      'data-font-size',
      next.fontSize <= 12 ? 'small' : next.fontSize >= 14 ? 'large' : 'medium',
    );
  }, []);

  useEffect(() => {
    applyAppearance(settings);
    if (settings.theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyAppearance(settings);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [settings, applyAppearance]);

  useEffect(() => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.getSettings) return;
    bridge.ide
      .getSettings()
      .then((loaded) => {
        setSettings((previous) => ({ ...previous, ...loaded }));
        if (loaded.defaultApprovalMode) setApprovalMode(loaded.defaultApprovalMode);
      })
      .catch(() => {
        // Keep the defaults if the settings file is unavailable.
      });
  }, []);

  const updateSettings = (patch: Partial<SettingsValues>) => {
    if (patch.defaultApprovalMode) setApprovalMode(patch.defaultApprovalMode);
    setSettings((previous) => {
      const next = { ...previous, ...patch } as OsmiumSettings;
      const save = getOsmiumBridge()?.ide?.saveSettings;
      if (save) {
        void save(next).catch(() => {
          // The UI remains usable even if persistence fails.
        });
      }
      return next;
    });
  };

  const autoSelectedCliRef = useRef(false);
  useEffect(() => {
    if (!detection || autoSelectedCliRef.current) return;
    autoSelectedCliRef.current = true;
    // Keep the configured primary only when it is both installed and verified.
    // Codex/Antigravity are detection-only in this build, so a dev machine
    // with the Codex CLI installed should still default to the verified mock
    // engine (or DeepSeek) for a working session.
    const isVerified = (id: CliId) => id === 'deepseek' || id === 'mock';
    if (detection[activeCliId]?.installed && isVerified(activeCliId)) return;
    const preferred =
      (['mock', 'deepseek'] as CliId[]).find((id) => detection[id]?.installed) ??
      CLI_ORDER.find((id) => detection[id]?.installed);
    if (preferred) setActiveCliId(preferred);
  }, [detection, activeCliId]);

  useEffect(() => {
    const bridge = getOsmiumBridge();
    if (!bridge?.session?.onEvent) return;
    return bridge.session.onEvent(({ sessionId, event }) => {
      if (sessionId !== activeSessionIdRef.current) return;
      setSession((previous) => {
        if (!previous) return previous;
        let status = previous.status;
        if (event.type === 'status') {
          status = statusFromEvent(event.state);
        } else if (event.type === 'approval') {
          status = 'waiting';
        } else if (
          event.type === 'message' ||
          event.type === 'tool' ||
          event.type === 'file-edit'
        ) {
          if (status !== 'error' && status !== 'cancelled') status = 'working';
        }
        return { ...previous, events: [...previous.events, event], status };
      });
    });
  }, []);

  const handleMinimize = () => {
    (window as any).osmium?.windowControls?.minimize?.();
  };

  const handleMaximize = async () => {
    try {
      await (window as any).osmium?.windowControls?.maximize?.();
      const max = await (window as any).osmium?.windowControls?.isMaximized?.();
      setIsMaximized(!!max);
    } catch {
      // non-electron or mock environment
    }
  };

  const handleClose = () => {
    (window as any).osmium?.windowControls?.close?.();
  };

  const openPalette = () => {
    setPaletteQuery('');
    setPaletteIndex(0);
    setPaletteOpen(true);
  };

  const openSettings = () => {
    setTopMode('code');
    setIdeActivity('settings');
    setActiveNav('Settings');
  };

  const handleMenuSelect = (key: string) => {
    setActiveMenu(null);
    switch (key) {
      case 'open-folder':
        void handleOpenFolder();
        break;
      case 'new-task':
        setActiveNav('New Task');
        break;
      case 'save-file':
        void handleSaveFile(activeTabId);
        break;
      case 'settings':
        openSettings();
        break;
      case 'exit':
        handleClose();
        break;
      case 'toggle-mode':
        setTopMode((prev) => (prev === 'code' ? 'chat' : 'code'));
        break;
      case 'toggle-palette':
      case 'shortcuts':
        openPalette();
        break;
      case 'clear-prompt':
        setPromptText('');
        break;
      case 'copy-prompt':
        if (promptText) {
          void navigator.clipboard?.writeText(promptText);
        }
        break;
      default:
        break;
    }
  };

  const handleConnectCli = () => setActiveNav('CLI Hub');

  const handleCliChange = (cliId: CliId) => {
    // CLI switching inside a live session is a later milestone (`session.switchCli`).
    // Changing the selection only affects the next session.
    if (session) return;
    setActiveCliId(cliId);
  };

  const handleTestCli = async (cliId: CliId) => {
    const startedAt = Date.now();
    try {
      const bridge = getOsmiumBridge();
      if (!bridge?.cli?.test) throw new Error('Adapter bridge unavailable in this environment.');
      const result = await bridge.cli.test(cliId);
      setTestResults((previous) => ({ ...previous, [cliId]: result }));
    } catch (error) {
      setTestResults((previous) => ({
        ...previous,
        [cliId]: { ok: false, latencyMs: Date.now() - startedAt, message: errorMessage(error) },
      }));
    }
  };

  const handleCancelSession = async () => {
    if (!session || session.id === 'pending') return;
    setSession((previous) => (previous ? { ...previous, status: 'cancelled' } : previous));
    try {
      await getOsmiumBridge()?.session?.cancel?.(session.id);
    } catch (error) {
      setSession((previous) =>
        previous ? { ...previous, status: 'error', error: errorMessage(error) } : previous,
      );
    }
  };

  const handleNewSession = async () => {
    const sessionId = activeSessionIdRef.current;
    activeSessionIdRef.current = null;
    setSession(null);
    if (!sessionId) return;
    const bridge = getOsmiumBridge();
    try {
      await bridge?.session?.close?.(sessionId);
    } catch {
      // The host may already have ended the session; the UI is already reset.
    }
  };

  const handleApprovalDecision = async (
    approvalId: string,
    allow: boolean,
    scope: 'once' | 'session',
  ) => {
    if (!session) return;
    const sessionId = session.id;
    setSession((previous) =>
      previous
        ? {
            ...previous,
            resolvedApprovals: Array.from(new Set([...previous.resolvedApprovals, approvalId])),
          }
        : previous,
    );
    try {
      await getOsmiumBridge()?.session?.respondToApproval?.(sessionId, approvalId, allow, scope);
    } catch (error) {
      setSession((previous) => (previous ? { ...previous, error: errorMessage(error) } : previous));
    }
  };

  const handleSendPrompt = async (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    if (session?.id === 'pending') return;
    setPromptText('');

    const bridge = getOsmiumBridge();
    const optimistic: AgentEvent = {
      type: 'message',
      role: 'user',
      text: prompt,
      final: true,
    };

    if (session && session.status !== 'error' && session.status !== 'cancelled') {
      setSession({ ...session, events: [...session.events, optimistic], status: 'working' });
      try {
        if (!bridge?.session?.send) {
          throw new Error('Adapter bridge unavailable in this environment.');
        }
        await bridge.session.send(session.id, prompt);
      } catch (error) {
        setSession((previous) =>
          previous ? { ...previous, status: 'error', error: errorMessage(error) } : previous,
        );
      }
      return;
    }

    const pending: ActiveSession = {
      id: 'pending',
      cliId: activeCliId,
      events: [optimistic],
      status: 'working',
      resolvedApprovals: [],
    };
    setSession(pending);
    activeSessionIdRef.current = null;

    try {
      if (!bridge?.session?.start) {
        throw new Error('Adapter bridge unavailable in this environment.');
      }
      const summary = await bridge.session.start({
        cwd: '',
        cliId: activeCliId,
        approvalMode,
        title: 'Chat session',
      });
      activeSessionIdRef.current = summary.id;
      setSession((previous) =>
        previous
          ? { ...previous, id: summary.id, cliId: summary.activeCli, status: 'working' }
          : previous,
      );
      await bridge.session.send(summary.id, prompt);
    } catch (error) {
      const message = errorMessage(error);
      setSession((previous) =>
        previous ? { ...previous, status: 'error', error: message } : previous,
      );
    }
  };

  const handleSelectFile = async (node: FileNode) => {
    if (node.kind === 'directory') return;

    const existing = editorTabs.find((t) => t.path === node.absPath || t.path === node.relPath);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.readFile) {
      setWorkspaceError('File reading is unavailable in this environment.');
      return;
    }

    let content: string;
    let readOnly = false;
    let detectedLineEnding = 'LF';
    try {
      const res = await bridge.ide.readFile(node.absPath);
      content = res.content;
      readOnly = res.largeFileSafeMode === true;
      detectedLineEnding = res.lineEnding ?? 'LF';
    } catch (error) {
      // Never open a tab with invented content: report the failure instead.
      setWorkspaceError(`Could not open ${node.name}: ${errorMessage(error)}`);
      return;
    }

    setLineEnding(detectedLineEnding);
    const newTab: EditorTab = {
      id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: node.name,
      path: node.relPath || node.absPath,
      absPath: node.absPath,
      content,
      dirty: false,
      readOnly,
    };

    setEditorTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  /** Opens a workspace-relative path (Quick Open, search results). */
  const handleOpenPath = React.useCallback(
    async (relPath: string) => {
      const bridge = getOsmiumBridge();
      if (!bridge?.ide?.readFile) return;
      const normalized = relPath.replace(/\\/g, '/');
      const separator = workspaceRoot.includes('\\') ? '\\' : '/';
      const absPath = workspaceRoot
        ? `${workspaceRoot}${workspaceRoot.endsWith(separator) ? '' : separator}${normalized.replace(/\//g, separator)}`
        : normalized;
      await handleSelectFile({
        name: normalized.split('/').pop() || normalized,
        relPath: normalized,
        absPath,
        kind: 'file',
      });
    },
    // handleSelectFile is recreated each render; the workspace root is the real input.
    [workspaceRoot, editorTabs],
  );

  const handleSaveFile = async (tabId: string) => {
    const tab = editorTabs.find((t) => t.id === tabId);
    if (!tab) return;
    let content = tab.content;
    if (settings.formatOnSave) {
      const formatted = formatDocumentContent(tab.name, content);
      if (formatted !== content) {
        content = formatted;
        setEditorTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, content } : t)));
      }
    }
    try {
      await getOsmiumBridge()?.ide?.writeFile?.(tab.absPath ?? tab.path, content);
      setEditorTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)));
      void refreshWorkspace();
    } catch {
      // Keep the dirty marker so the user can retry.
    }
  };

  useEffect(() => {
    if (!settings.autoSave) return;
    const dirtyTabs = editorTabs.filter((tab) => tab.dirty);
    if (dirtyTabs.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const tab of dirtyTabs) void handleSaveFile(tab.id);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [settings.autoSave, editorTabs, settings.formatOnSave]);

  const handleCreateEntry = async (targetPath: string, kind: 'file' | 'directory') => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.createEntry) return;
    // The explorer hands back a workspace-relative path; resolve it against the root.
    const separator = workspaceRoot.includes('\\') ? '\\' : '/';
    const absolute =
      /^[a-zA-Z]:[\\/]/.test(targetPath) || targetPath.startsWith('/')
        ? targetPath
        : workspaceRoot
          ? `${workspaceRoot}${workspaceRoot.endsWith(separator) ? '' : separator}${targetPath.replace(/\//g, separator)}`
          : targetPath;
    try {
      await bridge.ide.createEntry(absolute, kind);
      await refreshWorkspace();
    } catch (error) {
      setWorkspaceError(`Could not create ${targetPath}: ${errorMessage(error)}`);
    }
  };

  const handleRenameEntry = async (oldPath: string, newPath: string) => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.renameEntry) return;
    try {
      await bridge.ide.renameEntry(oldPath, newPath);
      // Reconcile open tabs: a renamed file keeps its buffer but changes path.
      setEditorTabs((prev) =>
        prev.map((tab) =>
          tab.absPath === oldPath
            ? {
                ...tab,
                absPath: newPath,
                path: newPath,
                name: newPath.split(/[\\/]/).pop() || tab.name,
              }
            : tab,
        ),
      );
      await refreshWorkspace();
    } catch (error) {
      setWorkspaceError(`Could not rename: ${errorMessage(error)}`);
    }
  };

  const handleDeleteEntry = async (targetPath: string) => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.deleteEntry) return;
    try {
      await bridge.ide.deleteEntry(targetPath);
      // Close any tab whose file no longer exists.
      setEditorTabs((prev) => {
        const remaining = prev.filter(
          (tab) =>
            tab.absPath !== targetPath &&
            !tab.absPath?.startsWith(targetPath + '\\') &&
            !tab.absPath?.startsWith(targetPath + '/'),
        );
        if (remaining.length !== prev.length && !remaining.some((t) => t.id === activeTabId)) {
          setActiveTabId(remaining[0]?.id ?? '');
        }
        return remaining;
      });
      await refreshWorkspace();
    } catch (error) {
      setWorkspaceError(`Could not delete: ${errorMessage(error)}`);
    }
  };

  const handleSearch = async (query: string, opts: any) => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.search || !workspaceRoot) return [];
    try {
      const res = await bridge.ide.search({ cwd: workspaceRoot, query, ...opts });
      return Array.isArray(res) ? res : [];
    } catch (error) {
      setWorkspaceError(`Search failed: ${errorMessage(error)}`);
      return [];
    }
  };

  const terminalBridge: TerminalBridge | undefined = React.useMemo(() => {
    const bridge = getOsmiumBridge();
    if (!bridge?.ide?.terminalCreate) return undefined;
    return {
      create: (opts) => bridge.ide.terminalCreate(opts),
      write: (id, data) => bridge.ide.terminalWrite(id, data),
      resize: (id, cols, rows) => bridge.ide.terminalResize(id, cols, rows),
      close: (id) => bridge.ide.terminalClose(id),
      onData: (cb) => bridge.ide.onTerminalData(cb),
    };
  }, []);

  const handleRequestGoToLine = React.useCallback(() => {
    if (!activeTabId) return;
    const input = window.prompt('Go to line (line or line:column)', '1');
    if (!input) return;
    const parsed = parseGoToLine(input);
    if (!parsed) {
      setWorkspaceError(`Not a line number: ${input}`);
      return;
    }
    setReveal({ tabId: activeTabId, line: parsed.line, column: parsed.column, nonce: Date.now() });
  }, [activeTabId]);

  const handleSendMessageToAgent = async (msg: string) => {
    // The docked panel is a launcher into the same real session surface; it
    // does not keep a second, simulated conversation.
    setTopMode('chat');
    await handleSendPrompt(msg);
  };

  const projects: SidebarProjectItem[] = workspaceRoot
    ? [
        {
          id: workspaceRoot,
          name: workspaceRoot.split(/[\\/]/).filter(Boolean).pop() || 'workspace',
          primaryCli: activeCliId,
        },
      ]
    : [];

  const showCliHub = activeNav === 'CLI Hub';
  const showSession = topMode === 'chat' && !!session && !showCliHub;
  const showHome = topMode === 'chat' && !session && !showCliHub;
  const showWorkbench = topMode === 'code' && !showCliHub;
  const sessionRunning = session?.status === 'working' || session?.status === 'waiting';
  const composerDisabled = !!session && (session.id === 'pending' || sessionRunning);

  const cliEntries: CliHubEntry[] = detection
    ? CLI_ORDER.map((id) => {
        const entry = detection[id];
        return {
          id,
          installed: entry?.installed ?? false,
          // DeepSeek and the deterministic mock are the adapters verified in
          // this build; Codex/Antigravity are detection-only for now.
          verified: id === 'deepseek' || id === 'mock',
          version: entry?.version,
          path: entry?.path,
          versionWarning: entry?.versionWarning,
          capabilities: entry?.capabilities,
        };
      })
    : [];

  const detectedActive = detection?.[activeCliId];
  const activeCliName = detectedActive?.installed
    ? `${getCliDisplayName(activeCliId)}${
        detectedActive.version ? ` · ${detectedActive.version}` : ''
      }`
    : detectionError
      ? `${getCliDisplayName(activeCliId)} · bridge unavailable`
      : detection
        ? `${getCliDisplayName(activeCliId)} · not installed`
        : getCliDisplayName(activeCliId);

  const chipState = (id: CliId): string => {
    if (detectionLoading) return 'checking';
    if (detectionError) return 'unavailable';
    const entry = detection?.[id];
    if (!entry) return 'unknown';
    return entry.installed ? 'installed' : 'missing';
  };

  const chipStatus = (id: CliId): string => {
    if (detectionLoading) return 'Checking…';
    if (detectionError) return 'Bridge unavailable';
    const entry = detection?.[id];
    if (!entry) return 'Unknown';
    if (!entry.installed) return 'Not installed';
    return entry.version ? `Installed · ${entry.version}` : 'Installed';
  };

  // One composer instance; it lives in Home before a session exists and in the
  // session footer afterwards (never both, so `composer-input` stays unique).
  const composerElement = (
    <Composer
      value={promptText}
      onChange={setPromptText}
      onSend={handleSendPrompt}
      activeCliId={session?.cliId ?? activeCliId}
      onCliChange={handleCliChange}
      approvalMode={approvalMode}
      onApprovalModeChange={setApprovalMode}
      routingMode={routingMode}
      onRoutingModeChange={setRoutingMode}
      disabled={composerDisabled}
      placeholder="Describe a task, or type / for /teamwork, /plan, /review"
    />
  );

  const settingsValues: SettingsValues = {
    theme: settings.theme,
    palette: settings.palette,
    fontSize: settings.fontSize,
    sidebarVisible: settings.sidebarVisible,
    defaultApprovalMode: settings.defaultApprovalMode,
    autoSave: settings.autoSave,
    formatOnSave: settings.formatOnSave,
    telemetryOptIn: settings.telemetryOptIn,
  };

  interface PaletteCommand {
    id: string;
    title: string;
    hint?: string;
    run: () => void;
  }

  const paletteCommands: PaletteCommand[] = [
    {
      id: 'new-chat',
      title: 'New Chat',
      hint: 'Chat',
      run: () => {
        setTopMode('chat');
        setActiveNav('New Task');
        void handleNewSession();
      },
    },
    {
      id: 'toggle-mode',
      title: topMode === 'code' ? 'Switch to Chat' : 'Switch to Code',
      hint: 'Ctrl+M',
      run: () => setTopMode((previous) => (previous === 'code' ? 'chat' : 'code')),
    },
    {
      id: 'save-file',
      title: 'Save Active File',
      hint: 'Ctrl+S',
      run: () => void handleSaveFile(activeTabId),
    },
    { id: 'settings', title: 'Open Settings', hint: 'Ctrl+,', run: openSettings },
    {
      id: 'cli-hub',
      title: 'Open CLI Hub',
      run: () => setActiveNav('CLI Hub'),
    },
    {
      id: 'theme-light',
      title: 'Theme: Light',
      run: () => updateSettings({ theme: 'light' }),
    },
    {
      id: 'theme-dark',
      title: 'Theme: Dark',
      run: () => updateSettings({ theme: 'dark' }),
    },
    {
      id: 'theme-system',
      title: 'Theme: Follow System',
      run: () => updateSettings({ theme: 'system' }),
    },
    {
      id: 'palette-blue',
      title: 'Accent Palette: Blue',
      run: () => updateSettings({ palette: 'blue' }),
    },
    {
      id: 'palette-forest',
      title: 'Accent Palette: Forest',
      run: () => updateSettings({ palette: 'forest' }),
    },
    {
      id: 'palette-graphite',
      title: 'Accent Palette: Graphite',
      run: () => updateSettings({ palette: 'graphite' }),
    },
    {
      id: 'refresh-workspace',
      title: 'Refresh Workspace',
      run: () => void refreshWorkspace(),
    },
  ];

  const normalizedPaletteQuery = paletteQuery.trim().toLowerCase();
  const filteredPaletteCommands = paletteCommands.filter((command) =>
    `${command.title} ${command.id}`.toLowerCase().includes(normalizedPaletteQuery),
  );
  const activePaletteIndex =
    filteredPaletteCommands.length === 0
      ? 0
      : Math.min(paletteIndex, filteredPaletteCommands.length - 1);
  const runPaletteCommand = (command: PaletteCommand) => {
    setPaletteOpen(false);
    setPaletteQuery('');
    setPaletteIndex(0);
    command.run();
  };

  const handleCursorChange = React.useCallback((position: { line: number; column: number }) => {
    setCursor((previous) =>
      previous.line === position.line && previous.column === position.column
        ? previous
        : { line: position.line, column: position.column },
    );
  }, []);

  return (
    <div data-testid="app-shell" className="app-shell">
      {/* Unified 44px toolbar (DESIGN.md §3) replacing the OS titlebar */}
      <header data-testid="app-titlebar" onDoubleClick={handleMaximize} className="app-titlebar">
        {/* Left: Branding & Custom Menus */}
        <div className="app-titlebar-left">
          <button
            type="button"
            data-testid="sidebar-toggle"
            className="xc-pane-btn app-sidebar-toggle"
            title="Toggle Sidebar (Ctrl+B)"
            aria-label={settings.sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={settings.sidebarVisible}
            onClick={() => updateSettings({ sidebarVisible: !settings.sidebarVisible })}
          >
            <Icon name="sidebarLeft" size={15} />
          </button>
          {/* Logo & App Name */}
          <div className="app-brand">
            <span className="app-brand-mark">
              <BrandMark size={22} />
            </span>
            <span data-testid="titlebar-app-name" className="app-brand-name">
              {topMode === 'chat' ? 'Osmium' : 'OsmiumIDE'}
            </span>
          </div>

          {/* Menus */}
          <div className="app-menus">
            <div className="app-menu-anchor">
              <button
                type="button"
                data-testid="menu-btn-file"
                className="xc-menu-trigger"
                data-active={activeMenu === 'file' || undefined}
                onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
              >
                File
              </button>
              <DropdownMenu
                isOpen={activeMenu === 'file'}
                onClose={() => setActiveMenu(null)}
                placement="bottom"
                items={FILE_MENU_ITEMS}
                onSelect={handleMenuSelect}
                data-testid="dropdown-menu-file"
                style={{ minWidth: '190px' }}
              />
            </div>

            <div className="app-menu-anchor">
              <button
                type="button"
                data-testid="menu-btn-edit"
                className="xc-menu-trigger"
                data-active={activeMenu === 'edit' || undefined}
                onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
              >
                Edit
              </button>
              <DropdownMenu
                isOpen={activeMenu === 'edit'}
                onClose={() => setActiveMenu(null)}
                placement="bottom"
                items={EDIT_MENU_ITEMS}
                onSelect={handleMenuSelect}
                data-testid="dropdown-menu-edit"
                style={{ minWidth: '190px' }}
              />
            </div>

            <div className="app-menu-anchor">
              <button
                type="button"
                data-testid="menu-btn-view"
                className="xc-menu-trigger"
                data-active={activeMenu === 'view' || undefined}
                onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}
              >
                View
              </button>
              <DropdownMenu
                isOpen={activeMenu === 'view'}
                onClose={() => setActiveMenu(null)}
                placement="bottom"
                items={VIEW_MENU_ITEMS}
                onSelect={handleMenuSelect}
                data-testid="dropdown-menu-view"
                style={{ minWidth: '190px' }}
              />
            </div>

            <div className="app-menu-anchor">
              <button
                type="button"
                data-testid="menu-btn-help"
                className="xc-menu-trigger"
                data-active={activeMenu === 'help' || undefined}
                onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}
              >
                Help
              </button>
              <DropdownMenu
                isOpen={activeMenu === 'help'}
                onClose={() => setActiveMenu(null)}
                placement="bottom"
                items={HELP_MENU_ITEMS}
                onSelect={handleMenuSelect}
                data-testid="dropdown-menu-help"
                style={{ minWidth: '190px' }}
              />
            </div>
          </div>
        </div>

        {/* Center: Search / Command Palette Pill */}
        <div className="app-titlebar-center">
          <button
            type="button"
            data-testid="titlebar-search-btn"
            className="app-search-pill"
            onClick={openPalette}
            aria-label="Search or open command palette"
          >
            <Icon name="search" size={13} />
            <span className="app-search-label">Search files, commands, or agents...</span>
            <kbd className="app-kbd">Ctrl K</kbd>
          </button>
        </div>

        {/* Right: Window Controls */}
        <div className="app-win-controls">
          <button
            type="button"
            aria-label="Minimize window"
            data-testid="win-btn-minimize"
            className="xc-win-btn"
            onClick={handleMinimize}
            title="Minimize"
          >
            <Icon name="minus" size={11} />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
            data-testid="win-btn-maximize"
            className="xc-win-btn"
            onClick={handleMaximize}
            title={isMaximized ? 'Restore Down' : 'Maximize'}
          >
            {isMaximized ? <Icon name="restore" size={11} /> : <Icon name="square" size={11} />}
          </button>
          <button
            type="button"
            aria-label="Close window"
            data-testid="win-btn-close"
            className="xc-win-btn xc-win-btn-close"
            onClick={handleClose}
            title="Close"
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      </header>

      {workspaceError && (
        <div className="app-error-banner" role="alert" data-testid="workspace-error">
          <span>{workspaceError}</span>
          <button
            type="button"
            className="wb-icon-btn"
            aria-label="Dismiss workspace error"
            onClick={() => setWorkspaceError('')}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {/* Main Workspace Body */}
      <div data-testid="app-body" className="app-body">
        {/* Left Navigation Sidebar — source list (DESIGN.md §3) */}
        {settings.sidebarVisible && (
          <aside aria-label="Primary Sidebar" data-testid="app-sidebar" className="app-sidebar">
            <div className="app-sidebar-top">
              {/* Code / Chat segmented control */}
              <div
                role="group"
                aria-label="Workspace mode"
                data-testid="mode-switcher"
                className="app-mode-switch"
              >
                {(['code', 'chat'] as const).map((mode) => {
                  const isActive = topMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`mode-btn-${mode}`}
                      aria-pressed={isActive}
                      onClick={() => {
                        setTopMode(mode);
                        if (activeNav === 'CLI Hub' || activeNav === 'Settings') {
                          setActiveNav('New Task');
                        }
                      }}
                      className="app-mode-btn"
                    >
                      {mode === 'code' ? 'Code' : 'Chat'}
                    </button>
                  );
                })}
              </div>

              {/* Primary Navigation Items with animated hover states */}
              <nav aria-label="Main navigation" className="app-nav">
                {PRIMARY_NAV_ITEMS.map((item) => {
                  const isActive = activeNav === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      data-testid={`nav-item-${item.toLowerCase().replace(/\s+/g, '-')}`}
                      onClick={() => {
                        setActiveNav(item);
                        if (item === 'New Task') {
                          setTopMode('chat');
                          setIdeActivity('explorer');
                        } else if (item === 'Search') {
                          setTopMode('code');
                          setIdeActivity('search');
                        } else {
                          setIdeActivity('explorer');
                        }
                      }}
                      className="app-nav-item"
                      data-active={isActive || undefined}
                    >
                      <span className="app-nav-icon">
                        <Icon name={NAV_ICONS[item] ?? 'file'} size={15} />
                      </span>
                      <span>{item}</span>
                    </button>
                  );
                })}
              </nav>

              {/* PROJECTS Section */}
              <div className="app-section">
                <div className="app-section-title">PROJECTS</div>
                <div className="app-nav">
                  {projects.length === 0 ? (
                    <div className="sidebar-empty" data-testid="sidebar-projects-empty">
                      No projects yet
                    </div>
                  ) : (
                    projects.map((proj) => {
                      const isSelected = activeNav === `project:${proj.id}`;
                      return (
                        <button
                          key={proj.id}
                          type="button"
                          data-testid={`sidebar-project-${proj.id}`}
                          onClick={() => setActiveNav(`project:${proj.id}`)}
                          className="app-nav-item"
                          data-active={isSelected || undefined}
                        >
                          <span
                            aria-hidden="true"
                            className="app-project-dot"
                            style={{ backgroundColor: getCliCssVariable(proj.primaryCli) }}
                          />
                          <span className="wb-row-label">{proj.name}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Footer Navigation */}
            <div aria-label="Footer navigation" className="app-nav">
              {FOOTER_NAV_ITEMS.map((item) => {
                const isSelected = activeNav === item;
                return (
                  <button
                    key={item}
                    type="button"
                    data-testid={`footer-item-${item.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={() => {
                      setActiveNav(item);
                      if (item === 'Settings') openSettings();
                    }}
                    className="app-nav-item"
                    data-active={isSelected || undefined}
                  >
                    <span className="app-nav-icon">
                      <Icon name={NAV_ICONS[item] ?? 'file'} size={15} />
                    </span>
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {/* Main Content Area - Home Screen (Chat mode, before a session) */}
        {showHome && (
          <main data-testid="app-main" className="app-home">
            <div className="app-home-inner">
              <h1 data-testid="home-headline" className="app-home-title">
                What are we building?
              </h1>

              <p data-testid="home-subtitle" className="app-home-subtitle">
                Connect the coding CLIs you already use. Detection runs locally; nothing leaves this
                machine.
              </p>

              {/* CLI Status Chips Row */}
              <div data-testid="cli-status-row" className="app-cli-row">
                {CLI_ORDER.map((id) => (
                  <span
                    key={id}
                    data-testid={`status-chip-${id}`}
                    data-state={chipState(id)}
                    className="app-cli-chip os-badge"
                  >
                    <span
                      aria-hidden="true"
                      className="app-project-dot"
                      style={{ backgroundColor: getCliCssVariable(id) }}
                    />
                    <span>{CLI_CHIP_LABEL[id] ?? getCliDisplayName(id)}</span>
                    <span className="app-cli-chip-state">{chipStatus(id)}</span>
                  </span>
                ))}

                <button
                  type="button"
                  data-testid="connect-cli-chip"
                  onClick={handleConnectCli}
                  className="app-connect-chip"
                >
                  <Icon name="plus" size={12} /> Connect CLI
                </button>
              </div>

              {/* Composer Box with interactive dropdowns */}
              <div className="app-composer-slot">{composerElement}</div>

              {/* Quick-Start Cards */}
              <div className="app-quick-row">
                <Button data-testid="quick-start-review" onClick={() => setPromptText('/review ')}>
                  Review this repo
                </Button>
                <Button data-testid="quick-start-plan" onClick={() => setPromptText('/plan ')}>
                  Plan a feature with /plan
                </Button>
                <Button
                  data-testid="quick-start-teamwork"
                  onClick={() => setPromptText('/teamwork ')}
                >
                  Split work with /teamwork
                </Button>
              </div>
            </div>
          </main>
        )}

        {showSession && session && (
          <SessionView
            cliId={session.cliId}
            status={session.status}
            events={session.events}
            error={session.error}
            resolvedApprovals={session.resolvedApprovals}
            onApproval={handleApprovalDecision}
            onCancel={handleCancelSession}
            onNewSession={handleNewSession}
            composer={composerElement}
          />
        )}

        {showCliHub && (
          <CliHubView
            entries={cliEntries}
            loading={detectionLoading}
            error={detectionError}
            testResults={testResults}
            onRefresh={refreshDetection}
            onTest={handleTestCli}
          />
        )}

        {/* Full IDE Workbench View (Code Mode) */}
        {showWorkbench && (
          <IdeWorkbench
            rootName={workspaceRoot ? workspaceRoot.split(/[\\/]/).pop() || 'OSMIUM' : 'NO FOLDER'}
            workspaceRoot={workspaceRoot}
            fileTree={fileTree}
            tabs={editorTabs}
            activeTabId={activeTabId}
            gitFiles={gitStatusFiles}
            branch={currentBranch}
            activeCliName={activeCliName}
            activity={ideActivity}
            onActivityChange={(activity) => {
              setIdeActivity(activity);
              if (activity !== 'settings' && activeNav === 'Settings') setActiveNav('New Task');
            }}
            settings={settingsValues}
            onSettingsChange={updateSettings}
            onSelectFile={handleSelectFile}
            onSelectTab={setActiveTabId}
            onCloseTab={(id) => {
              setEditorTabs((prev) => prev.filter((t) => t.id !== id));
              if (activeTabId === id && editorTabs.length > 1) {
                const remaining = editorTabs.filter((t) => t.id !== id);
                setActiveTabId(remaining[0].id);
              }
            }}
            onChangeContent={(id, content) => {
              setEditorTabs((prev) =>
                prev.map((t) => (t.id === id ? { ...t, content, dirty: true } : t)),
              );
            }}
            onSaveFile={handleSaveFile}
            onSearch={handleSearch}
            onSelectSearchMatch={(match) => {
              void handleOpenPath(match.relPath);
            }}
            onSendMessageToAgent={handleSendMessageToAgent}
            onCreateEntry={handleCreateEntry}
            onRenameEntry={handleRenameEntry}
            onDeleteEntry={handleDeleteEntry}
            onOpenFolder={handleOpenFolder}
            onRefreshExplorer={refreshWorkspace}
            onRefreshGit={refreshWorkspace}
            terminalBridge={terminalBridge}
            quickOpenFiles={quickOpenFiles}
            onOpenPath={handleOpenPath}
            cursor={cursor}
            onCursorChange={handleCursorChange}
            lineEnding={lineEnding}
            reveal={reveal}
            onRequestGoToLine={handleRequestGoToLine}
          />
        )}
      </div>

      {/* Command Palette Modal (Ctrl/Cmd + K) with smooth dropdown reveal */}
      {paletteOpen && (
        <div
          role="dialog"
          aria-label="Command Palette"
          data-testid="command-palette-dialog"
          className="app-palette-scrim osmium-animate-fade"
          onClick={() => setPaletteOpen(false)}
        >
          <div className="app-palette osmium-animate-dropdown" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              data-testid="command-palette-input"
              placeholder="Type a command..."
              aria-label="Command Palette Input"
              autoFocus
              className="app-palette-input"
              value={paletteQuery}
              onChange={(e) => {
                setPaletteQuery(e.target.value);
                setPaletteIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setPaletteIndex((previous) =>
                    Math.min(previous + 1, Math.max(0, filteredPaletteCommands.length - 1)),
                  );
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setPaletteIndex((previous) => Math.max(0, previous - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const command = filteredPaletteCommands[activePaletteIndex];
                  if (command) runPaletteCommand(command);
                } else if (e.key === 'Escape') {
                  setPaletteOpen(false);
                }
              }}
            />
            <div className="app-palette-list" role="listbox" aria-label="Commands">
              {filteredPaletteCommands.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={index === activePaletteIndex}
                  data-testid={`command-palette-item-${command.id}`}
                  data-active={index === activePaletteIndex || undefined}
                  className="app-palette-item"
                  onMouseEnter={() => setPaletteIndex(index)}
                  onClick={() => runPaletteCommand(command)}
                >
                  <span>{command.title}</span>
                  {command.hint && <small>{command.hint}</small>}
                </button>
              ))}
              {filteredPaletteCommands.length === 0 && (
                <div className="app-palette-empty">No matching commands.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
