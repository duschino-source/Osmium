import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.js';
import { computeTerminalSize, shouldResize, type TerminalSize } from './terminal-fit.js';

export interface TerminalBridge {
  create(opts: {
    cwd: string;
    shellProfile?: 'bash' | 'zsh' | 'powershell' | 'cmd' | 'default';
    cols?: number;
    rows?: number;
  }): Promise<{ id: string; cwd: string; shell: string; pid: number }>;
  write(id: string, data: string): Promise<void> | void;
  resize(id: string, cols: number, rows: number): Promise<void> | void;
  close(id: string): Promise<void> | void;
  onData(cb: (payload: { sessionId: string; data: string }) => void): () => void;
}

export interface XtermTerminalProps {
  /** Workspace root the shell should start in. */
  cwd: string;
  bridge: TerminalBridge | undefined;
  onClose?: () => void;
  shellProfile?: 'bash' | 'zsh' | 'powershell' | 'cmd' | 'default';
}

type Status = 'starting' | 'ready' | 'unavailable' | 'error';

/**
 * A real PTY-backed terminal.
 *
 * Honesty rules: if xterm or the PTY bridge is unavailable the component shows
 * an explicit unavailable state and never prints simulated shell output.
 */
export const XtermTerminal: React.FC<XtermTerminalProps> = ({
  cwd,
  bridge,
  onClose,
  shellProfile = 'default',
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sizeRef = useRef<TerminalSize | null>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [message, setMessage] = useState<string>('');
  const [shellLabel, setShellLabel] = useState<string>('');

  const teardown = useCallback(() => {
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    if (id && bridge) {
      try {
        void bridge.close(id);
      } catch {
        // A failed close must not throw during unmount.
      }
    }
    if (termRef.current) {
      try {
        termRef.current.dispose();
      } catch {
        // Disposing twice is harmless.
      }
      termRef.current = null;
    }
  }, [bridge]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const start = async () => {
      if (!bridge) {
        setStatus('unavailable');
        setMessage('Terminal bridge is not available in this environment.');
        return;
      }
      if (!hostRef.current) return;

      let Terminal: any;
      try {
        ({ Terminal } = await import('@xterm/xterm'));
      } catch (error) {
        setStatus('unavailable');
        setMessage(
          `Terminal renderer could not load: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      if (disposed || !hostRef.current) return;

      const styles = getComputedStyle(document.documentElement);
      const read = (name: string, fallback = '') =>
        styles.getPropertyValue(name).trim() || fallback;

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: read('--font-mono', 'ui-monospace, SFMono-Regular, Menlo, monospace'),
        fontSize: 12,
        lineHeight: 1.2,
        scrollback: 5000,
        convertEol: false,
        theme: {
          background: read('--bg-ide-panel') || undefined,
          foreground: read('--text-ink') || undefined,
          cursor: read('--accent-primary') || undefined,
          selectionBackground: read('--bg-control') || undefined,
        },
      });
      termRef.current = term;
      term.open(hostRef.current);

      // Subscribe before creating the PTY so the first prompt is not lost.
      unsubscribe = bridge.onData(({ sessionId, data }) => {
        if (sessionId === sessionIdRef.current) term.write(data);
      });

      const initial = computeTerminalSize(
        hostRef.current.clientWidth,
        hostRef.current.clientHeight,
        // Measure the real cell once xterm has rendered a row.
        term._core?._renderService?.dimensions?.css?.cell?.width || 8,
        term._core?._renderService?.dimensions?.css?.cell?.height || 17,
      );
      sizeRef.current = initial;

      try {
        const info = await bridge.create({
          cwd,
          shellProfile,
          cols: initial.cols,
          rows: initial.rows,
        });
        if (disposed) {
          void bridge.close(info.id);
          return;
        }
        sessionIdRef.current = info.id;
        setShellLabel(info.shell);
        setStatus('ready');
      } catch (error) {
        setStatus('error');
        setMessage(
          `Could not start a shell: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }

      term.onData((data: string) => {
        const id = sessionIdRef.current;
        if (id) void bridge.write(id, data);
      });

      // Keep the PTY in step with the pane. Debounced through rAF so a drag
      // does not spam resize IPC.
      let frame = 0;
      resizeObserver = new ResizeObserver(() => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const host = hostRef.current;
          if (!host || !termRef.current) return;
          const next = computeTerminalSize(
            host.clientWidth,
            host.clientHeight,
            term._core?._renderService?.dimensions?.css?.cell?.width || 8,
            term._core?._renderService?.dimensions?.css?.cell?.height || 17,
          );
          if (!shouldResize(sizeRef.current, next)) return;
          sizeRef.current = next;
          try {
            termRef.current.resize(next.cols, next.rows);
          } catch {
            // xterm rejects resize before open; ignore.
          }
          const id = sessionIdRef.current;
          if (id) void bridge.resize(id, next.cols, next.rows);
        });
      });
      resizeObserver.observe(hostRef.current);
      term.focus();
    };

    void start();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      unsubscribe?.();
      teardown();
    };
    // A new cwd or shell profile is a new shell.
  }, [bridge, cwd, shellProfile, teardown]);

  const clear = () => {
    termRef.current?.clear();
  };

  return (
    <div data-testid="ide-terminal-panel" className="wb-term">
      <div className="wb-term-head">
        <div className="wb-term-tabs">
          <button
            type="button"
            className="wb-term-tab"
            data-active="true"
            data-testid="term-tab-terminal"
          >
            terminal
          </button>
        </div>
        <div className="wb-panel-actions">
          {shellLabel && (
            <span className="wb-term-shell" data-testid="terminal-shell-label">
              {shellLabel}
            </span>
          )}
          <button
            type="button"
            className="wb-quick-btn"
            data-testid="terminal-clear"
            onClick={clear}
            disabled={status !== 'ready'}
          >
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

      <div className="wb-term-body">
        {status === 'unavailable' || status === 'error' ? (
          <div className="wb-empty" data-testid="terminal-unavailable">
            {message}
          </div>
        ) : null}
        <div
          ref={hostRef}
          className="wb-term-xterm"
          data-testid="terminal-xterm"
          data-status={status}
          hidden={status === 'unavailable' || status === 'error'}
        />
      </div>
    </div>
  );
};
