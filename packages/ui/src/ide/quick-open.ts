/**
 * Pure Quick Open matching. Renderer-safe: no node imports, no I/O.
 *
 * Scoring favours, in order: consecutive character runs, matches at a path
 * segment boundary, matches in the file name over the directory, and shorter
 * paths. That is the behaviour people expect from a Ctrl+P box: typing `ap`
 * should surface `App.tsx` before `docs/adapters/apply.md`.
 */

export interface QuickOpenCandidate {
  relPath: string;
  name: string;
  kind: 'file' | 'directory';
}

export interface QuickOpenMatch<T extends QuickOpenCandidate = QuickOpenCandidate> {
  item: T;
  score: number;
  /** Indices in `relPath` that matched, for highlighting. */
  indices: number[];
}

const SEGMENT_BOUNDARY = new Set(['/', '\\', '.', '-', '_', ' ']);

/**
 * Subsequence match with a score, or null when `query` is not a subsequence of
 * `text`. Case-insensitive; an exact-case match scores slightly higher so
 * `App` outranks `app` when both are present.
 */
export function fuzzyScore(
  text: string,
  query: string,
): { score: number; indices: number[] } | null {
  if (!query) return { score: 0, indices: [] };
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const indices: number[] = [];
  let textIndex = 0;
  let score = 0;
  let previousMatch = -2;

  for (let q = 0; q < lowerQuery.length; q += 1) {
    const target = lowerQuery[q];
    let found = -1;
    for (let t = textIndex; t < lowerText.length; t += 1) {
      if (lowerText[t] === target) {
        found = t;
        break;
      }
    }
    if (found === -1) return null;

    // Consecutive characters are the strongest signal.
    if (found === previousMatch + 1) score += 8;
    // Starting a path segment is the next strongest.
    if (found === 0 || SEGMENT_BOUNDARY.has(text[found - 1] ?? '')) score += 6;
    // Exact case is a tiebreaker only; it must never outrank a better position.
    if (text[found] === query[q]) score += 0.5;

    indices.push(found);
    previousMatch = found;
    textIndex = found + 1;
  }

  // Prefer shorter paths when the match quality ties.
  score -= Math.min(text.length, 200) * 0.05;
  // A match anchored at the start of the string is what people mean when they
  // type the first letters of a file name.
  if (indices[0] === 0) score += 12;
  // Density: a query that covers more of the name is a stronger signal than
  // one that merely appears somewhere inside a longer name.
  if (text.length > 0) score += (query.length / text.length) * 20;
  return { score, indices };
}

/**
 * Ranks candidates against a query. An empty query returns the first `limit`
 * candidates in their given order (the caller supplies a sensible order).
 */
export function rankQuickOpen<T extends QuickOpenCandidate>(
  candidates: readonly T[],
  query: string,
  limit = 50,
): QuickOpenMatch<T>[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return candidates.slice(0, limit).map((item) => ({ item, score: 0, indices: [] }));
  }

  const matches: QuickOpenMatch<T>[] = [];
  for (const item of candidates) {
    const byPath = fuzzyScore(item.relPath, trimmed);
    const byName = fuzzyScore(item.name, trimmed);
    if (!byPath && !byName) continue;
    // The file name carries more intent than the folder it lives in.
    const nameScore = byName ? byName.score + 10 : Number.NEGATIVE_INFINITY;
    const pathScore = byPath ? byPath.score : Number.NEGATIVE_INFINITY;
    const best = (nameScore >= pathScore ? byName : byPath) as { score: number; indices: number[] };
    matches.push({ item, score: best.score, indices: best.indices });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.relPath.localeCompare(b.item.relPath);
  });

  return matches.slice(0, limit);
}

/**
 * Parses a Go to Line expression. Accepts `42`, `42:7`, and `:7`.
 * Returns null when the input is not a usable target.
 */
export function parseGoToLine(input: string): { line: number; column: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^(?:(\d+))?(?::(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const line = match[1] ? Number.parseInt(match[1], 10) : 1;
  const column = match[2] ? Number.parseInt(match[2], 10) : 1;
  if (!Number.isFinite(line) || line < 1) return null;
  if (!Number.isFinite(column) || column < 1) return null;
  return { line, column };
}
