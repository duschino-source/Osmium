import React, { useState } from 'react';
import { Icon } from './Icon.js';

export interface GitStatusItem {
  path: string;
  status: 'M' | 'A' | 'D' | 'U' | 'R' | '?';
  staged: boolean;
}

export interface SourceControlPanelProps {
  branch?: string;
  files: GitStatusItem[];
  onStageFile: (filePath: string) => Promise<void>;
  onUnstageFile: (filePath: string) => Promise<void>;
  onCommit: (message: string) => Promise<void>;
  onSelectFileDiff?: (filePath: string) => void;
  onRefresh?: () => void;
}

export const SourceControlPanel: React.FC<SourceControlPanelProps> = ({
  branch = 'main',
  files,
  onStageFile,
  onUnstageFile,
  onCommit,
  onSelectFileDiff,
  onRefresh,
}) => {
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  const handleCommitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    setIsCommitting(true);
    try {
      await onCommit(commitMessage.trim());
      setCommitMessage('');
      onRefresh?.();
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div data-testid="ide-source-control-panel" className="wb-panel">
      {/* Header */}
      <div className="wb-panel-head">
        <span className="wb-panel-title">SOURCE CONTROL ({branch})</span>
        <div className="wb-panel-actions">
          <button
            type="button"
            className="wb-icon-btn"
            title="Refresh Git Status"
            onClick={onRefresh}
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
      </div>

      {/* Commit Box */}
      <form onSubmit={handleCommitSubmit}>
        <div className="wb-panel-head">
          <textarea
            data-testid="git-commit-input"
            className="wb-field"
            placeholder="Message (Ctrl+Enter to commit)"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            rows={2}
          />
        </div>
        <div className="wb-panel-head">
          <button
            type="submit"
            data-testid="git-commit-btn"
            className="os-btn os-btn-primary"
            disabled={isCommitting || !commitMessage.trim()}
          >
            {isCommitting ? 'Committing...' : 'Commit'}
          </button>
        </div>
      </form>

      {/* Staged & Unstaged Lists */}
      <div className="wb-body">
        {/* Staged Section */}
        {stagedFiles.length > 0 && (
          <div>
            <div className="wb-section-title">STAGED CHANGES ({stagedFiles.length})</div>
            {stagedFiles.map((file) => (
              <div key={file.path} data-testid={`staged-file-${file.path}`} className="wb-row">
                <button
                  type="button"
                  className="wb-row-btn"
                  onClick={() => onSelectFileDiff?.(file.path)}
                >
                  {file.path}
                </button>
                <span className="wb-git" data-status={file.status}>
                  {file.status}
                </span>
                <button
                  type="button"
                  className="wb-icon-btn"
                  title="Unstage changes"
                  onClick={() => onUnstageFile(file.path)}
                >
                  <Icon name="minus" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Changes Section */}
        <div>
          <div className="wb-section-title">CHANGES ({unstagedFiles.length})</div>
          {unstagedFiles.length === 0 ? (
            <div className="wb-empty">Working tree is clean.</div>
          ) : (
            unstagedFiles.map((file) => (
              <div key={file.path} data-testid={`unstaged-file-${file.path}`} className="wb-row">
                <button
                  type="button"
                  className="wb-row-btn"
                  onClick={() => onSelectFileDiff?.(file.path)}
                >
                  {file.path}
                </button>
                <span className="wb-git" data-status={file.status}>
                  {file.status}
                </span>
                <button
                  type="button"
                  className="wb-icon-btn"
                  title="Stage changes"
                  onClick={() => onStageFile(file.path)}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
