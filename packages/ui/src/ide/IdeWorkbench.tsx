import React, { useEffect, useState } from 'react';
import { FileExplorer, type FileNode } from './FileExplorer.js';
import { EditorWorkspace, type EditorTab } from './EditorWorkspace.js';
import { SearchPanel, type SearchMatchItem } from './SearchPanel.js';
import { SourceControlPanel, type GitStatusItem } from './SourceControlPanel.js';
import { TerminalPanel } from './TerminalPanel.js';
import { AgentDockedPanel } from './AgentDockedPanel.js';
import { StatusBar } from './StatusBar.js';
import { SettingsPanel, type SettingsValues } from './SettingsPanel.js';
import { Icon } from './Icon.js';

export type IdeActivity = 'explorer' | 'search' | 'git' | 'settings';

export interface IdeWorkbenchProps {
  rootName?: string;
  fileTree: FileNode[];
  tabs: EditorTab[];
  activeTabId?: string;
  gitFiles?: GitStatusItem[];
  branch?: string;
  activeCliName?: string;
  /** Controlled left-rail activity; omit for the internal default. */
  activity?: IdeActivity;
  onActivityChange?: (activity: IdeActivity) => void;
  settings?: SettingsValues;
  onSettingsChange?: (patch: Partial<SettingsValues>) => void;
  onSelectFile: (file: FileNode) => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onChangeContent: (id: string, content: string) => void;
  onSaveFile: (id: string) => void;
  onSearch: (query: string, opts: any) => Promise<SearchMatchItem[]>;
  onSelectSearchMatch: (match: SearchMatchItem) => void;
  onStageFile?: (path: string) => Promise<void>;
  onUnstageFile?: (path: string) => Promise<void>;
  onCommit?: (msg: string) => Promise<void>;
  onExecuteCommand?: (cmd: string) => Promise<string | void>;
  onSendMessageToAgent?: (msg: string) => Promise<string | void>;
  onCreateEntry?: (targetPath: string, kind: 'file' | 'directory') => Promise<void>;
  onRefreshExplorer?: () => void;
  onRefreshGit?: () => void;
}

export const IdeWorkbench: React.FC<IdeWorkbenchProps> = ({
  rootName = 'OSMIUM',
  fileTree,
  tabs,
  activeTabId,
  gitFiles = [],
  branch = 'main',
  activeCliName = 'Codex CLI',
  activity,
  onActivityChange,
  settings,
  onSettingsChange,
  onSelectFile,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onSaveFile,
  onSearch,
  onSelectSearchMatch,
  onStageFile = async () => {},
  onUnstageFile = async () => {},
  onCommit = async () => {},
  onExecuteCommand,
  onSendMessageToAgent,
  onCreateEntry,
  onRefreshExplorer,
  onRefreshGit,
}) => {
  const [internalActivity, setInternalActivity] = useState<IdeActivity>('explorer');
  const activeActivity = activity ?? internalActivity;
  const settingsValues: SettingsValues = settings ?? {
    theme: 'light',
    palette: 'blue',
    fontSize: 13,
    sidebarVisible: true,
    defaultApprovalMode: 'ask',
    autoSave: false,
    formatOnSave: true,
    telemetryOptIn: false,
  };
  const selectActivity = (next: IdeActivity) => {
    setInternalActivity(next);
    onActivityChange?.(next);
  };
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [agentPanelOpen, setAgentPanelOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1024,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setAgentPanelOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  return (
    <div data-testid="ide-workbench" className="wb-workbench">
      {/* Middle Body */}
      <div className="wb-workbench-body">
        {/* Activity Bar (Left icon strip) */}
        <div data-testid="ide-activity-bar" className="wb-activity">
          <button
            type="button"
            title="Explorer"
            data-testid="activity-btn-explorer"
            data-active={activeActivity === 'explorer' || undefined}
            aria-pressed={activeActivity === 'explorer'}
            onClick={() => selectActivity('explorer')}
            className="wb-activity-btn"
          >
            <Icon name="folder" size={20} />
          </button>
          <button
            type="button"
            title="Search"
            data-testid="activity-btn-search"
            data-active={activeActivity === 'search' || undefined}
            aria-pressed={activeActivity === 'search'}
            onClick={() => selectActivity('search')}
            className="wb-activity-btn"
          >
            <Icon name="search" size={20} />
          </button>
          <button
            type="button"
            title="Source Control"
            data-testid="activity-btn-git"
            data-active={activeActivity === 'git' || undefined}
            aria-pressed={activeActivity === 'git'}
            onClick={() => selectActivity('git')}
            className="wb-activity-btn"
          >
            <Icon name="branch" size={20} />
          </button>
          <div className="wb-activity-spacer" />
          <button
            type="button"
            title="Toggle Agent Panel (Ctrl+L)"
            data-testid="activity-btn-agent"
            data-active={agentPanelOpen || undefined}
            aria-pressed={agentPanelOpen}
            onClick={() => setAgentPanelOpen(!agentPanelOpen)}
            className="wb-activity-btn"
          >
            <Icon name="bot" size={20} />
          </button>
          <button
            type="button"
            title="Settings (Ctrl+,)"
            data-testid="activity-btn-settings"
            data-active={activeActivity === 'settings' || undefined}
            aria-pressed={activeActivity === 'settings'}
            onClick={() => selectActivity('settings')}
            className="wb-activity-btn"
          >
            <Icon name="gear" size={20} />
          </button>
        </div>

        {/* Side Panel (Explorer / Search / Git / Settings) */}
        <div className="wb-navigator" data-wide={activeActivity === 'settings' || undefined}>
          {activeActivity === 'explorer' && (
            <FileExplorer
              rootName={rootName}
              tree={fileTree}
              activeFilePath={activeTab?.path}
              onSelectFile={onSelectFile}
              onCreateEntry={onCreateEntry}
              onRefresh={onRefreshExplorer}
            />
          )}
          {activeActivity === 'search' && (
            <SearchPanel onSearch={onSearch} onSelectMatch={onSelectSearchMatch} />
          )}
          {activeActivity === 'git' && (
            <SourceControlPanel
              branch={branch}
              files={gitFiles}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onCommit={onCommit}
              onSelectFileDiff={(path) => {
                onSelectFile({
                  name: path.split('/').pop() || path,
                  relPath: path,
                  absPath: path,
                  kind: 'file',
                });
              }}
              onRefresh={onRefreshGit}
            />
          )}
          {activeActivity === 'settings' && (
            <SettingsPanel
              values={settingsValues}
              onChange={(patch) => onSettingsChange?.(patch)}
            />
          )}
        </div>

        {/* Center Editor + Terminal Panel */}
        <div className="wb-center">
          <EditorWorkspace
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onChangeContent={onChangeContent}
            onSaveFile={onSaveFile}
          />
          {terminalOpen && (
            <TerminalPanel
              onExecuteCommand={onExecuteCommand}
              onClose={() => setTerminalOpen(false)}
            />
          )}
        </div>

        {/* Right Docked Agent Panel */}
        {agentPanelOpen && activeActivity !== 'settings' && (
          <AgentDockedPanel
            activeFileName={activeTab?.name || 'Workspace'}
            onSendMessage={onSendMessageToAgent}
            onApplyCode={(code) => {
              if (activeTab) {
                onChangeContent(activeTab.id, activeTab.content + '\n' + code);
              }
            }}
            onClose={() => setAgentPanelOpen(false)}
          />
        )}
      </div>

      {/* Bottom Status Bar */}
      <StatusBar
        branch={branch}
        errorCount={0}
        warningCount={0}
        line={1}
        column={1}
        encoding="UTF-8"
        lineEnding="CRLF"
        language={
          activeTab?.name.endsWith('.rs')
            ? 'Rust'
            : activeTab?.name.endsWith('.json')
              ? 'JSON'
              : 'TypeScript'
        }
        activeCliName={activeCliName}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        onToggleAgentPanel={() => setAgentPanelOpen(!agentPanelOpen)}
      />
    </div>
  );
};
