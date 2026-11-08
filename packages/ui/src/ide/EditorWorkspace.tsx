import React, { useCallback, useLayoutEffect, useMemo, useRef, useEffect } from 'react';
import { Icon } from './Icon.js';
import { highlight, languageFromPath, languageLabel } from './syntax.js';

export interface EditorTab {
  id: string;
  name: string;
  /** Workspace-relative path, shown in the jump bar. */
  path: string;
  /** Absolute path used for disk IO when it differs from `path`. */
  absPath?: string;
  content: string;
  dirty?: boolean;
  readOnly?: boolean;
  language?: string;
}

export interface EditorReveal {
  tabId: string;
  line: number;
  column?: number;
  /** Change to re-trigger the reveal for the same line. */
  nonce: number;
}

export interface EditorWorkspaceProps {
  tabs: EditorTab[];
  activeTabId?: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onChangeContent: (id: string, content: string) => void;
  onSaveFile: (id: string) => void;
  onCursorChange?: (position: { line: number; column: number; selected: number }) => void;
  reveal?: EditorReveal | null;
  emptyShortcuts?: Array<{ label: string; keys: string }>;
}

const LINE_HEIGHT = 20;

const OPENERS: Record<string, string> = { '{': '}', '(': ')', '[': ']' };

export function positionFromOffset(
  value: string,
  offset: number,
): { line: number; column: number } {
  const before = value.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

export function offsetFromLine(value: string, line: number, column = 1): number {
  const lines = value.split('\n');
  const target = Math.max(1, Math.min(line, lines.length));
  let offset = 0;
  for (let i = 0; i < target - 1; i += 1) offset += (lines[i]?.length ?? 0) + 1;
  return offset + Math.max(0, Math.min(column - 1, lines[target - 1]?.length ?? 0));
}

interface Edit {
  value: string;
  start: number;
  end: number;
}

/** Enter keeps the current indentation and opens a block between brackets. */
export function editForEnter(value: string, start: number, end: number): Edit {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const indent = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? '';
  const prev = value[start - 1] ?? '';
  const next = value[end] ?? '';
  const opensBlock = OPENERS[prev] !== undefined;
  const extra = opensBlock ? '  ' : '';
  let insert = `\n${indent}${extra}`;
  let caret = start + insert.length;
  if (opensBlock && OPENERS[prev] === next) {
    insert += `\n${indent}`;
  }
  return { value: value.slice(0, start) + insert + value.slice(end), start: caret, end: caret };
}

/** Tab indents the selected lines (or inserts two spaces); Shift+Tab outdents. */
export function editForTab(value: string, start: number, end: number, outdent: boolean): Edit {
  const multiline = value.slice(start, end).includes('\n');
  if (!outdent && !multiline) {
    return {
      value: value.slice(0, start) + '  ' + value.slice(end),
      start: start + 2,
      end: start + 2,
    };
  }
  const blockStart = value.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = value.indexOf('\n', end);
  const blockEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(blockStart, blockEnd).split('\n');
  let firstDelta = 0;
  let totalDelta = 0;
  const changed = lines.map((line, index) => {
    if (outdent) {
      const strip = /^( {1,2}|\t)/.exec(line)?.[0].length ?? 0;
      if (index === 0) firstDelta = -strip;
      totalDelta -= strip;
      return line.slice(strip);
    }
    if (index === 0) firstDelta = 2;
    totalDelta += 2;
    return `  ${line}`;
  });
  return {
    value: value.slice(0, blockStart) + changed.join('\n') + value.slice(blockEnd),
    start: Math.max(blockStart, start + firstDelta),
    end: Math.max(blockStart, end + totalDelta),
  };
}

interface SurfaceProps {
  tab: EditorTab;
  reveal?: EditorReveal | null;
  onChange: (content: string) => void;
  onSave: () => void;
  onCursorChange?: EditorWorkspaceProps['onCursorChange'];
}

const EditorSurface: React.FC<SurfaceProps> = ({
  tab,
  reveal,
  onChange,
  onSave,
  onCursorChange,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const [caretLine, setCaretLine] = React.useState(1);

  const lang = languageFromPath(tab.path);
  const tokens = useMemo(() => highlight(tab.content, lang), [tab.content, lang]);
  const lineCount = useMemo(() => tab.content.split('\n').length, [tab.content]);

  const reportCursor = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const { line, column } = positionFromOffset(el.value, el.selectionStart);
    setCaretLine(line);
    onCursorChange?.({ line, column, selected: Math.abs(el.selectionEnd - el.selectionStart) });
  }, [onCursorChange]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    const pending = pendingSelection.current;
    if (el && pending) {
      el.setSelectionRange(pending.start, pending.end);
      pendingSelection.current = null;
      reportCursor();
    }
  }, [tab.content, reportCursor]);

  useEffect(() => {
    reportCursor();
  }, [tab.id, reportCursor]);

  useEffect(() => {
    if (!reveal || reveal.tabId !== tab.id) return;
    const el = inputRef.current;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    const offset = offsetFromLine(el.value, reveal.line, reveal.column ?? 1);
    el.focus({ preventScroll: true });
    el.setSelectionRange(offset, offset);
    scroller.scrollTop = Math.max(0, (reveal.line - 1) * LINE_HEIGHT - scroller.clientHeight / 3);
    reportCursor();
  }, [reveal, tab.id, reportCursor]);

  const applyEdit = (edit: Edit) => {
    pendingSelection.current = { start: edit.start, end: edit.end };
    onChange(edit.value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
      return;
    }
    if (tab.readOnly) return;
    const el = e.currentTarget;
    if (e.key === 'Tab') {
      e.preventDefault();
      applyEdit(editForTab(el.value, el.selectionStart, el.selectionEnd, e.shiftKey));
    } else if (e.key === 'Enter' && !mod && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      applyEdit(editForEnter(el.value, el.selectionStart, el.selectionEnd));
    }
  };

  return (
    <div className="ed-scroll" ref={scrollRef} data-testid="ide-editor-scroll">
      <div className="ed-body">
        <div className="ed-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="ed-ln" data-active={i + 1 === caretLine || undefined}>
              {i + 1}
            </div>
          ))}
        </div>
        <div className="ed-code">
          <div
            className="ed-current-line"
            style={{ top: `calc(var(--ed-pad-y) + ${(caretLine - 1) * LINE_HEIGHT}px)` }}
          />
          <pre className="ed-text ed-highlight" aria-hidden="true">
            {tokens.map((t, i) =>
              t.cls ? (
                <span key={i} className={`syn-${t.cls}`}>
                  {t.text}
                </span>
              ) : (
                <React.Fragment key={i}>{t.text}</React.Fragment>
              ),
            )}
            {'\n'}
          </pre>
          <textarea
            ref={inputRef}
            data-testid="ide-code-textarea"
            aria-label={`Editor: ${tab.name}`}
            className="ed-text ed-input"
            value={tab.content}
            readOnly={tab.readOnly}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onSelect={reportCursor}
            onKeyUp={reportCursor}
            onClick={reportCursor}
          />
        </div>
      </div>
    </div>
  );
};

const DEFAULT_SHORTCUTS = [
  { label: 'Open Quickly', keys: 'Ctrl P' },
  { label: 'Command Palette', keys: 'Ctrl K' },
  { label: 'Show Navigator', keys: 'Ctrl 0' },
];

export const EditorWorkspace: React.FC<EditorWorkspaceProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onSaveFile,
  onCursorChange,
  reveal,
  emptyShortcuts = DEFAULT_SHORTCUTS,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  if (!activeTab || tabs.length === 0) {
    return (
      <div className="ed" data-testid="ide-editor-workspace">
        <div className="ed-empty" data-testid="ide-editor-empty">
          <Icon name="file" size={44} strokeWidth={1.1} className="ed-empty-icon" />
          <div className="ed-empty-title">No Editor</div>
          <dl className="ed-empty-keys">
            {emptyShortcuts.map((s) => (
              <div key={s.label} className="ed-empty-row">
                <dt>{s.label}</dt>
                <dd>
                  <kbd>{s.keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    );
  }

  const crumbs = activeTab.path.replace(/\\/g, '/').split('/').filter(Boolean);

  return (
    <div className="ed" data-testid="ide-editor-workspace">
      <div
        className="ed-tabs"
        role="tablist"
        aria-label="Open editors"
        data-testid="editor-tab-bar"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id;
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              data-testid={`editor-tab-${tab.name}`}
              data-active={isActive || undefined}
              data-dirty={tab.dirty || undefined}
              className="ed-tab"
              title={tab.path}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onCloseTab(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
            >
              <span className="ed-tab-name">{tab.name}</span>
              <button
                type="button"
                aria-label={`Close ${tab.name}`}
                className="ed-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <span className="ed-tab-dot" />
                <Icon name="x" size={11} strokeWidth={2} className="ed-tab-x" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="ed-jump">
        <nav className="ed-crumbs" aria-label="Path">
          {crumbs.map((crumb, idx) => (
            <React.Fragment key={`${crumb}-${idx}`}>
              <span className="ed-crumb" data-last={idx === crumbs.length - 1 || undefined}>
                {crumb}
              </span>
              {idx < crumbs.length - 1 && (
                <Icon name="chevronRight" size={10} strokeWidth={2} className="ed-crumb-sep" />
              )}
            </React.Fragment>
          ))}
        </nav>
        <div className="ed-jump-meta">
          {activeTab.readOnly && <span className="ed-pill">Read-only</span>}
          <span className="ed-lang">{languageLabel(activeTab.path)}</span>
          {activeTab.dirty && (
            <button
              type="button"
              data-testid="editor-save-btn"
              className="ed-save"
              onClick={() => onSaveFile(activeTab.id)}
            >
              Save
            </button>
          )}
        </div>
      </div>

      <EditorSurface
        key={activeTab.id}
        tab={activeTab}
        reveal={reveal}
        onChange={(content) => onChangeContent(activeTab.id, content)}
        onSave={() => onSaveFile(activeTab.id)}
        onCursorChange={onCursorChange}
      />
    </div>
  );
};
