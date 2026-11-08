import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rankQuickOpen, type QuickOpenCandidate } from './quick-open.js';

export interface QuickOpenPanelProps {
  open: boolean;
  candidates: readonly QuickOpenCandidate[];
  onSelect: (relPath: string) => void;
  onClose: () => void;
  /** Shown when the workspace has no index yet. */
  emptyHint?: string;
}

/**
 * Ctrl+P surface. Keyboard-first: arrows move, Enter opens, Escape closes.
 * Filtering is pure (see quick-open.ts) so it is unit tested without a DOM.
 */
export const QuickOpenPanel: React.FC<QuickOpenPanelProps> = ({
  open,
  candidates,
  onSelect,
  onClose,
  emptyHint = 'No files in this workspace yet.',
}) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => rankQuickOpen(candidates, query, 50), [candidates, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    // Focus after the panel mounts so the caret lands in the field.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  const commit = (relPath: string) => {
    onSelect(relPath);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((prev) => (matches.length === 0 ? 0 : (prev + 1) % matches.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((prev) => (matches.length === 0 ? 0 : (prev - 1 + matches.length) % matches.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = matches[index];
      if (target) commit(target.item.relPath);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="app-palette-scrim"
      data-testid="quick-open-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="app-palette" role="dialog" aria-label="Quick Open">
        <input
          ref={inputRef}
          type="text"
          className="app-palette-input"
          data-testid="quick-open-input"
          placeholder="Go to file..."
          aria-label="Quick Open file name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="app-palette-list" role="listbox" aria-label="Files">
          {matches.length === 0 ? (
            <div className="app-palette-empty" data-testid="quick-open-empty">
              {candidates.length === 0 ? emptyHint : 'No matching files.'}
            </div>
          ) : (
            matches.map((match, i) => (
              <button
                key={match.item.relPath}
                type="button"
                role="option"
                aria-selected={i === index}
                data-testid={`quick-open-item-${match.item.relPath}`}
                data-active={i === index || undefined}
                className="app-palette-item"
                onMouseEnter={() => setIndex(i)}
                onClick={() => commit(match.item.relPath)}
              >
                <span>{match.item.name}</span>
                <small>{match.item.relPath}</small>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
