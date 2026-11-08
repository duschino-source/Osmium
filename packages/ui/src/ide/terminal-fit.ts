/**
 * Terminal geometry helpers. Pure so the sizing maths is unit tested without
 * a DOM or a real PTY.
 */

export interface TerminalSize {
  cols: number;
  rows: number;
}

export const MIN_COLS = 20;
export const MIN_ROWS = 5;

/**
 * Converts a pixel box into terminal columns/rows.
 *
 * Guards against the two failure modes that make a real terminal look broken:
 * a zero-sized pane (returns the minimums instead of 0) and a fractional
 * division that rounds up past the available space (floors, then clamps).
 */
export function computeTerminalSize(
  widthPx: number,
  heightPx: number,
  cellWidthPx: number,
  cellHeightPx: number,
): TerminalSize {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx)) {
    return { cols: MIN_COLS, rows: MIN_ROWS };
  }
  if (!Number.isFinite(cellWidthPx) || !Number.isFinite(cellHeightPx)) {
    return { cols: MIN_COLS, rows: MIN_ROWS };
  }
  if (cellWidthPx <= 0 || cellHeightPx <= 0) {
    return { cols: MIN_COLS, rows: MIN_ROWS };
  }

  const cols = Math.floor(widthPx / cellWidthPx);
  const rows = Math.floor(heightPx / cellHeightPx);
  return {
    cols: Math.max(MIN_COLS, cols),
    rows: Math.max(MIN_ROWS, rows),
  };
}

/** True when a resize is worth sending to the PTY. */
export function shouldResize(previous: TerminalSize | null, next: TerminalSize): boolean {
  if (!previous) return true;
  return previous.cols !== next.cols || previous.rows !== next.rows;
}

/**
 * Strips ANSI escape sequences. Used only by tests and by the fallback log
 * surface; the xterm surface consumes raw sequences directly.
 */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
}
