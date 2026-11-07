import React from 'react';
import { Icon } from './Icon.js';

export interface StatusBarProps {
  branch?: string;
  errorCount?: number;
  warningCount?: number;
  line?: number;
  column?: number;
  encoding?: string;
  lineEnding?: string;
  language?: string;
  activeCliName?: string;
  onToggleTerminal?: () => void;
  onToggleAgentPanel?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  branch = 'main',
  errorCount = 0,
  warningCount = 0,
  line = 1,
  column = 1,
  encoding = 'UTF-8',
  lineEnding = 'CRLF',
  language = 'TypeScript',
  activeCliName = 'Codex CLI',
  onToggleTerminal,
  onToggleAgentPanel,
}) => {
  return (
    <footer data-testid="ide-status-bar" className="wb-statusbar">
      {/* Left items */}
      <div className="wb-status-group">
        <button type="button" title="Git Branch" className="wb-status-item">
          <Icon name="branch" size={12} />
          <span>{branch}</span>
        </button>

        <span className="wb-status-text" title={`${errorCount} errors`}>
          <Icon name="xCircle" size={12} />
          <span>{errorCount}</span>
        </span>
        <span className="wb-status-text" title={`${warningCount} warnings`}>
          <Icon name="alert" size={12} />
          <span>{warningCount}</span>
        </span>

        {onToggleTerminal && (
          <button
            type="button"
            data-testid="status-bar-terminal-btn"
            onClick={onToggleTerminal}
            className="wb-status-item"
          >
            Terminal
          </button>
        )}
      </div>

      {/* Right items */}
      <div className="wb-status-group">
        <span className="wb-status-text">
          Ln {line}, Col {column}
        </span>
        <span className="wb-status-text">{encoding}</span>
        <span className="wb-status-text">{lineEnding}</span>
        <span className="wb-status-text">{language}</span>

        <button
          type="button"
          data-testid="status-bar-cli-btn"
          onClick={onToggleAgentPanel}
          className="wb-status-cli"
        >
          <span className="wb-status-dot" />
          <span>{activeCliName}</span>
        </button>
      </div>
    </footer>
  );
};
