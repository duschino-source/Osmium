import React, { useState } from 'react';
import { Icon } from './Icon.js';

export interface TerminalPanelProps {
  onExecuteCommand?: (cmd: string) => Promise<string | void>;
  onClose?: () => void;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ onExecuteCommand, onClose }) => {
  const [activeTab, setActiveTab] = useState<'terminal' | 'problems' | 'output'>('terminal');
  const [inputCmd, setInputCmd] = useState('');
  const [outputLogs, setOutputLogs] = useState<string[]>([
    'Osmium Integrated Terminal (PowerShell / Shell)',
    'Type any command below or use quick actions.',
  ]);
  const [isRunning, setIsRunning] = useState(false);

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = inputCmd.trim();
    if (!cmd) return;

    setOutputLogs((prev) => [...prev, `PS E:\\SeriousProject\\Osmium> ${cmd}`]);
    setInputCmd('');
    setIsRunning(true);

    try {
      if (onExecuteCommand) {
        const res = await onExecuteCommand(cmd);
        if (res) {
          setOutputLogs((prev) => [...prev, res]);
        }
      } else {
        setOutputLogs((prev) => [...prev, `[Executed: ${cmd}]`]);
      }
    } catch (err: any) {
      setOutputLogs((prev) => [...prev, `Error: ${err.message || String(err)}`]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleQuickRun = (cmd: string) => {
    setInputCmd(cmd);
  };

  return (
    <div data-testid="ide-terminal-panel" className="wb-term">
      {/* Tab Header Bar */}
      <div className="wb-term-head">
        <div className="wb-term-tabs">
          {(['terminal', 'problems', 'output'] as const).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                className="wb-term-tab"
                data-testid={`term-tab-${tab}`}
                data-active={isActive || undefined}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'problems' ? 'Problems (0)' : tab}
              </button>
            );
          })}
        </div>

        {/* Quick action buttons & Close */}
        <div className="wb-panel-actions">
          <button
            type="button"
            className="wb-quick-btn"
            onClick={() => handleQuickRun('git status')}
          >
            git status
          </button>
          <button
            type="button"
            className="wb-quick-btn"
            onClick={() => handleQuickRun('pnpm test')}
          >
            pnpm test
          </button>
          <button type="button" className="wb-quick-btn" onClick={() => setOutputLogs([])}>
            Clear
          </button>
          {onClose && (
            <button
              type="button"
              className="wb-icon-btn"
              aria-label="Close terminal panel"
              onClick={onClose}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Terminal View Content */}
      {activeTab === 'terminal' && (
        <div className="wb-term-body">
          <div data-testid="terminal-output" className="wb-term-output">
            {outputLogs.map((log, idx) => (
              <div key={idx}>{log}</div>
            ))}
            {isRunning && <div>Running...</div>}
          </div>

          {/* Terminal Input Line */}
          <form onSubmit={handleCommandSubmit} className="wb-term-input-row">
            <span className="wb-term-prompt">$</span>
            <input
              type="text"
              className="wb-term-input"
              data-testid="terminal-cmd-input"
              value={inputCmd}
              onChange={(e) => setInputCmd(e.target.value)}
              placeholder="Type command and press Enter..."
            />
          </form>
        </div>
      )}

      {/* Problems View Content */}
      {activeTab === 'problems' && (
        <div className="wb-term-body">
          <div className="wb-empty">No errors or warnings found in workspace.</div>
        </div>
      )}

      {/* Output View Content */}
      {activeTab === 'output' && (
        <div className="wb-term-body">
          <div className="wb-term-output">
            [Osmium Task Output] Vite dev server active. IPC listeners registered.
          </div>
        </div>
      )}
    </div>
  );
};
