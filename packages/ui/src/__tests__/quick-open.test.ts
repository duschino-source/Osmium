import { describe, it, expect } from 'vitest';
import { fuzzyScore, rankQuickOpen, parseGoToLine } from '../ide/quick-open.js';
import { computeTerminalSize, shouldResize, stripAnsi } from '../ide/terminal-fit.js';

describe('Quick Open matching', () => {
  const candidates = [
    { relPath: 'apps/desktop/src/renderer/App.tsx', name: 'App.tsx', kind: 'file' as const },
    { relPath: 'docs/adapters/apply.md', name: 'apply.md', kind: 'file' as const },
    { relPath: 'packages/ui/src/ide/Icon.tsx', name: 'Icon.tsx', kind: 'file' as const },
    { relPath: 'packages/core/src/types.ts', name: 'types.ts', kind: 'file' as const },
  ];

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('App.tsx', 'zzz')).toBeNull();
  });

  it('matches a subsequence and reports the matched indices', () => {
    const result = fuzzyScore('App.tsx', 'apt');
    expect(result).not.toBeNull();
    expect(result!.indices.length).toBe(3);
    // a(0) p(1) t(4) in "App.tsx"
    expect(result!.indices).toEqual([0, 1, 4]);
  });

  it('prefers the file name over the directory path', () => {
    const ranked = rankQuickOpen(candidates, 'app');
    // App.tsx must outrank docs/adapters/apply.md even though both match.
    expect(ranked[0].item.name).toBe('App.tsx');
  });

  it('ranks a segment-boundary match above a mid-word match', () => {
    const ranked = rankQuickOpen(candidates, 'icon');
    expect(ranked[0].item.name).toBe('Icon.tsx');
  });

  it('returns candidates unchanged for an empty query', () => {
    const ranked = rankQuickOpen(candidates, '   ');
    expect(ranked.length).toBe(candidates.length);
    expect(ranked[0].item.relPath).toBe(candidates[0].relPath);
  });

  it('honours the result limit', () => {
    expect(rankQuickOpen(candidates, '', 2).length).toBe(2);
  });

  it('returns nothing when no candidate matches', () => {
    expect(rankQuickOpen(candidates, 'qqqqq')).toEqual([]);
  });
});

describe('parseGoToLine', () => {
  it('parses a bare line number', () => {
    expect(parseGoToLine('42')).toEqual({ line: 42, column: 1 });
  });

  it('parses line:column', () => {
    expect(parseGoToLine('42:7')).toEqual({ line: 42, column: 7 });
  });

  it('parses a bare column', () => {
    expect(parseGoToLine(':7')).toEqual({ line: 1, column: 7 });
  });

  it('rejects junk and zero', () => {
    expect(parseGoToLine('abc')).toBeNull();
    expect(parseGoToLine('')).toBeNull();
    expect(parseGoToLine('0')).toBeNull();
    expect(parseGoToLine('12:0')).toBeNull();
  });
});

describe('terminal geometry', () => {
  it('converts a pixel box into columns and rows', () => {
    expect(computeTerminalSize(800, 400, 8, 20)).toEqual({ cols: 100, rows: 20 });
  });

  it('floors rather than overflowing the pane', () => {
    // 803 / 8 = 100.375 -> 100, not 101.
    expect(computeTerminalSize(803, 419, 8, 20).cols).toBe(100);
    expect(computeTerminalSize(803, 419, 8, 20).rows).toBe(20);
  });

  it('never returns zero cells for a collapsed pane', () => {
    const size = computeTerminalSize(0, 0, 8, 20);
    expect(size.cols).toBeGreaterThan(0);
    expect(size.rows).toBeGreaterThan(0);
  });

  it('falls back to minimums on non-finite input', () => {
    expect(computeTerminalSize(Number.NaN, 100, 8, 20).cols).toBeGreaterThan(0);
    expect(computeTerminalSize(100, 100, 0, 0).rows).toBeGreaterThan(0);
  });

  it('only reports a resize when the grid actually changes', () => {
    expect(shouldResize(null, { cols: 80, rows: 24 })).toBe(true);
    expect(shouldResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
    expect(shouldResize({ cols: 80, rows: 24 }, { cols: 81, rows: 24 })).toBe(true);
  });

  it('strips ANSI sequences for the fallback log surface', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m text')).toBe('red text');
  });
});
