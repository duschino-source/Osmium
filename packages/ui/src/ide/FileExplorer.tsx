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
  onRefresh,
}) => {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    new Set(['src', 'packages', 'apps']),
  );
  const [creatingKind, setCreatingKind] = useState<'file' | 'directory' | null>(null);
  const [newEntryName, setNewEntryName] = useState<string>('');
  const [selectedDir, setSelectedDir] = useState<string>('');

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

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isDir = node.kind === 'directory';
    const isExpanded = expandedDirs.has(node.relPath);
    const isActive = activeFilePath === node.absPath || activeFilePath === node.relPath;

    return (
      <div key={node.absPath || node.relPath}>
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
          <div className="wb-empty">No files found</div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
};
