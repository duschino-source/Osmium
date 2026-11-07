import type {
  AgentEvent,
  AgentSession,
  ApprovalMode,
  Capabilities,
  CliAdapter,
  CliDetectionResult,
  CliId,
  StartOptions,
} from '@osmium/core';

export type {
  AgentEvent,
  AgentSession,
  ApprovalMode,
  Capabilities,
  CliAdapter,
  CliDetectionResult,
  CliId,
  StartOptions,
};

export const KNOWN_CLI_COLORS: Record<string, string> = {
  codex: '#1B2B22',
  antigravity: '#2F5FD0',
  deepseek: '#6B4FD0',
  mock: '#2F6B4F',
};

/**
 * Fixed fallback palette for additional third-party CLIs beyond Codex, Antigravity, and DeepSeek
 * (Section 7: "A new CLI gets the next color from a fixed palette").
 */
export const DEFAULT_CLI_PALETTE: readonly string[] = [
  '#1B2B22', // Codex
  '#2F5FD0', // Antigravity
  '#6B4FD0', // DeepSeek
  '#2F6B4F', // Forest Accent
  '#B85D19', // Warm Amber
  '#0E7490', // Deep Teal
  '#9D174D', // Berry
  '#4338CA', // Indigo
];

export function getCliColor(cliId: CliId, paletteIndex?: number): string {
  const normalized = cliId.toLowerCase();
  if (KNOWN_CLI_COLORS[normalized]) {
    return KNOWN_CLI_COLORS[normalized];
  }
  if (typeof paletteIndex === 'number' && paletteIndex >= 0) {
    return DEFAULT_CLI_PALETTE[paletteIndex % DEFAULT_CLI_PALETTE.length];
  }
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  const extraPalette = DEFAULT_CLI_PALETTE.slice(3);
  return extraPalette[hash % extraPalette.length];
}

export function getCliCssVariable(cliId: CliId): string {
  const normalized = cliId.toLowerCase();
  if (normalized === 'codex') return 'var(--cli-codex, #1B2B22)';
  if (normalized === 'antigravity') return 'var(--cli-antigravity, #2F5FD0)';
  if (normalized === 'deepseek') return 'var(--cli-deepseek, #6B4FD0)';
  return getCliColor(cliId);
}

export function getCliDisplayName(cliId: CliId): string {
  const normalized = cliId.toLowerCase();
  if (normalized === 'codex') return 'Codex CLI';
  if (normalized === 'antigravity') return 'Antigravity';
  if (normalized === 'deepseek') return 'DeepSeek CLI';
  if (normalized === 'mock') return 'Mock CLI';
  return cliId;
}

export function compareSemver(versionA: string, versionB: string): number {
  const cleanA = versionA.replace(/^[^0-9]*/, '').split(/[-+]/)[0];
  const cleanB = versionB.replace(/^[^0-9]*/, '').split(/[-+]/)[0];
  const partsA = cleanA.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const partsB = cleanB.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length, 3);
  for (let i = 0; i < len; i++) {
    const a = partsA[i] ?? 0;
    const b = partsB[i] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Produces a non-blocking warning message when an installed CLI version is newer
 * than the version tested by the adapter (Section 5).
 */
export function createVersionWarning(
  cliId: CliId,
  installedVersion?: string,
  testedVersion?: string,
): string | undefined {
  if (!installedVersion || !testedVersion) {
    return undefined;
  }
  if (compareSemver(installedVersion, testedVersion) > 0) {
    return `${getCliDisplayName(cliId)} version ${installedVersion} is newer than tested version ${testedVersion}. Proceeding with compatibility fallback.`;
  }
  return undefined;
}
