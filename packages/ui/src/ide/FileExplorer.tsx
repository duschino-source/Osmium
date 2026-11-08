import React, { useState } from 'react';
import { Icon } from './Icon.js';

export interface FileNode {
  name: string;
  relPath: string;
  absPath: string;
  kind: 'file' | 'directory';
  children?: FileNode[];
  gitStatus?: 'M' | 'A' | 'D' | 'U' | 'R' | '?';
}

export interface FileExplorerProps {
  rootName?: string;
  tree: FileNode[];
  activeFilePath?: string;
  onSelectFile: (node: FileNode) => void;
  onCreateEntry?: (targetPath: string, kind: 'file' | 'directory') => Promise<void>;
  onRenameEntry?: (oldPath: string, newPath: string) => Promise<void>;
  onDeleteEntry?: (targetPath: string) => Promise<void>;
  onOpenFolder?: () => void;
  onRefresh?: () => void;
}

type FileIconKind = 'ts' | 'rs' | 'json' | 'css' | 'md' | 'other';

const getFileIconKind = (name: string): FileIconKind => {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'ts';
    case 'rs':
      return 'rs';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'md':
      return 'md';
    default:
      return 'other';
  }
};

export const FileExplorer: React.FC<FileExplorerProps> = ({
  rootName = 'OSMIUM',
  tree,
  activeFilePath,
  onSelectFile,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
  onOpenFolder,
  onRefresh,
}) => {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    new Set(['src', 'packages', 'apps']),
  );
  const [creatingKind, setCreatingKind] = useState<'file' | 'directory' | null>(null);
  const [newEntryName, setNewEntryName] = useState<string>('');
  const [selectedDir, setSelectedDir] = useState<string>('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);

  const toggleDir = (relPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) {
        next.delete(relPath);
      } else {
        next.add(relPath);
      }
      return next;
    });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEntryName.trim() || !creatingKind || !onCreateEntry) return;
    const target = selectedDir ? `${selectedDir}/${newEntryName.trim()}` : newEntryName.trim();
    await onCreateEntry(target, creatingKind);
    setNewEntryName('');
    setCreatingKind(null);
    onRefresh?.();
  };

  const startRename = (node: FileNode) => {
    setRenamingPath(node.absPath || node.relPath);
    setRenameValue(node.name);
  };

  const commitRename = async (node: FileNode) => {
    const trimmed = renameValue.trim();
    setRenamingPath(null);
    if (!trimmed || trimmed === node.name || !onRenameEntry) return;
    // Rename in place: keep the node's directory, swap the leaf name.
    const source = node.absPath || node.relPath;
    const separator = source.includes('\\') ? '\\' : '/';
    const parent = source.slice(0, source.lastIndexOf(separator));
    const target = parent ? `${parent}${separator}${trimmed}` : trimmed;
    await onRenameEntry(source, target);
    onRefresh?.();
  };

  const confirmDelete = async () => {
    const node = pendingDelete;
    setPendingDelete(null);
    if (!node || !onDeleteEntry) return;
    await onDeleteEntry(node.absPath || node.relPath);
    onRefresh?.();
  };

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isDir = node.kind === 'directory';
    const isExpanded = expandedDirs.has(node.relPath);
    const isActive = activeFilePath === node.absPath || activeFilePath === node.relPath;
    const nodeKey = node.absPath || node.relPath;
    const isRenaming = renamingPath === nodeKey;

    if (isRenaming) {
      return (
        <div key={nodeKey}>
          <form
            className="wb-row"
            data-testid={`explorer-rename-form-${node.name}`}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            onSubmit={(e) => {
              e.preventDefault();
              void commitRename(node);
            }}
          >
            <input
              type="text"
              className="wb-field"
              data-testid="explorer-rename-input"
              aria-label={`Rename ${node.name}`}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setRenamingPath(null);
                  setRenameValue('');
                }
              }}
              autoFocus
            />
          </form>
        </div>
      );
    }

    return (
      <div key={nodeKey}>
        <div className="wb-row-wrap" data-active={isActive || undefined}>
          <button
            type="button"
            className="wb-row"
            data-active={isActive}
            data-testid={`file-tree-item-${node.name}`}
            aria-expanded={isDir ? isExpanded : undefined}
            onClick={() => {
              if (isDir) {
                setSelectedDir(node.absPath);
                toggleDir(node.relPath);
              } else {
                onSelectFile(node);
              }
            }}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
          >
            {isDir && (
              <span className="wb-tree-chevron">
                <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={12} />
              </span>
            )}
            <span className="wb-file-icon" data-kind={isDir ? 'other' : getFileIconKind(node.name)}>
              <Icon name={isDir ? (isExpanded ? 'folderOpen' : 'folder') : 'file'} size={14} />
            </span>
            <span className="wb-row-label">{node.name}</span>
            {node.gitStatus && (
              <span className="wb-git" data-status={node.gitStatus}>
                {node.gitStatus}
              </span>
            )}
          </button>
          {onRenameEntry && (
            <button
              type="button"
              className="wb-row-action"
              data-testid={`explorer-rename-${node.name}`}
              aria-label={`Rename ${node.name}`}
              title="Rename"
              onClick={() => startRename(node)}
            >
              <Icon name="pencil" size={12} />
            </button>
          )}
          {onDeleteEntry && (
            <button
              type="button"
              className="wb-row-action"
              data-testid={`explorer-delete-${node.name}`}
              aria-label={`Delete ${node.name}`}
              title="Delete"
              onClick={() => setPendingDelete(node)}
            >
              <Icon name="trash" size={12} />
            </button>
          )}
        </div>

        {isDir && isExpanded && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="ide-file-explorer" className="wb-panel">
      {/* Explorer Header */}
      <div className="wb-panel-head">
        <span className="wb-panel-title">{rootName}</span>
        <div className="wb-panel-actions">
          <button
            type="button"
            className="wb-icon-btn"
            data-testid="explorer-new-file"
            title="New File"
            onClick={() => setCreatingKind('file')}
          >
            <Icon name="filePlus" size={14} />
          </button>
          <button
            type="button"
            className="wb-icon-btn"
            data-testid="explorer-new-folder"
            title="New Folder"
            onClick={() => setCreatingKind('directory')}
          >
            <Icon name="folderPlus" size={14} />
          </button>
          <button
            type="button"
            className="wb-icon-btn"
            data-testid="explorer-refresh"
            title="Refresh"
            onClick={onRefresh}
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
      </div>

      {/* Inline Create Input */}
      {creatingKind && (
        <form
          onSubmit={handleCreateSubmit}
          data-testid="explorer-create-form"
          className="wb-panel-head"
        >
          <input
            type="text"
            className="wb-field"
            data-testid="explorer-create-input"
            placeholder={`New ${creatingKind} in ${selectedDir ? selectedDir.split(/[\\/]/).pop() : rootName}...`}
            value={newEntryName}
            onChange={(e) => setNewEntryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCreatingKind(null);
                setNewEntryName('');
              }
            }}
            autoFocus
          />
        </form>
      )}

      {/* File Tree */}
      <div className="wb-body">
        {tree.length === 0 ? (
          <div className="wb-empty explorer-empty">
            <span>{rootName === 'NO FOLDER' ? 'No folder open' : 'No files found'}</span>
            {onOpenFolder && (
              <button
                type="button"
                className="wb-quick-btn"
                data-testid="explorer-open-folder"
                onClick={onOpenFolder}
              >
                Open Folder
              </button>
            )}
          </div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>

      {/* Delete confirmation: destructive actions are never one-click. */}
      {pendingDelete && (
        <div
          className="app-palette-scrim"
          data-testid="explorer-delete-confirm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPendingDelete(null);
          }}
        >
          <div className="app-palette" role="dialog" aria-label="Confirm delete">
            <div className="wb-panel-title">Delete {pendingDelete.name}?</div>
            <p className="wb-empty">
              {pendingDelete.kind === 'directory'
                ? 'This removes the folder and everything inside it.'
                : 'This removes the file from disk.'}{' '}
              This cannot be undone.
            </p>
            <div className="wb-panel-actions">
              <button
                type="button"
                className="wb-quick-btn"
                data-testid="explorer-delete-cancel"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wb-quick-btn"
                data-testid="explorer-delete-confirm-btn"
                onClick={() => void confirmDelete()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
