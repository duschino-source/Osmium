import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_OSMIUM_SETTINGS,
  type OsmiumSettings,
  type ThemeMode,
  type ThemePalette,
} from '@osmium/ide-core';

const THEMES: ThemeMode[] = ['light', 'dark', 'system'];
const PALETTES: ThemePalette[] = ['blue', 'teal', 'forest', 'graphite'];
const APPROVAL_MODES = ['ask', 'auto-edit', 'full-auto'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whitelist settings. Unknown keys — including anything credential-shaped —
 * are dropped instead of being persisted or forwarded.
 */
export function sanitizeSettings(input: unknown): OsmiumSettings {
  const source = isRecord(input) ? input : {};
  const theme = THEMES.includes(source.theme as ThemeMode)
    ? (source.theme as ThemeMode)
    : DEFAULT_OSMIUM_SETTINGS.theme;
  const palette = PALETTES.includes(source.palette as ThemePalette)
    ? (source.palette as ThemePalette)
    : DEFAULT_OSMIUM_SETTINGS.palette;
  const fontSize =
    typeof source.fontSize === 'number' && Number.isFinite(source.fontSize)
      ? Math.min(16, Math.max(11, Math.round(source.fontSize)))
      : DEFAULT_OSMIUM_SETTINGS.fontSize;
  const approvalMode = APPROVAL_MODES.includes(
    source.defaultApprovalMode as (typeof APPROVAL_MODES)[number],
  )
    ? (source.defaultApprovalMode as OsmiumSettings['defaultApprovalMode'])
    : DEFAULT_OSMIUM_SETTINGS.defaultApprovalMode;

  const keybindings: Record<string, string> = { ...DEFAULT_OSMIUM_SETTINGS.keybindings };
  if (isRecord(source.keybindings)) {
    for (const [key, value] of Object.entries(source.keybindings)) {
      if (typeof value === 'string' && key.length <= 120 && value.length <= 120) {
        keybindings[key] = value;
      }
    }
  }

  return {
    theme,
    palette,
    fontSize,
    sidebarVisible:
      typeof source.sidebarVisible === 'boolean'
        ? source.sidebarVisible
        : DEFAULT_OSMIUM_SETTINGS.sidebarVisible,
    formatOnSave:
      typeof source.formatOnSave === 'boolean'
        ? source.formatOnSave
        : DEFAULT_OSMIUM_SETTINGS.formatOnSave,
    autoSave:
      typeof source.autoSave === 'boolean' ? source.autoSave : DEFAULT_OSMIUM_SETTINGS.autoSave,
    defaultApprovalMode: approvalMode,
    telemetryOptIn:
      typeof source.telemetryOptIn === 'boolean'
        ? source.telemetryOptIn
        : DEFAULT_OSMIUM_SETTINGS.telemetryOptIn,
    keybindings,
  };
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<OsmiumSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return sanitizeSettings(JSON.parse(raw));
    } catch {
      return sanitizeSettings(DEFAULT_OSMIUM_SETTINGS);
    }
  }

  async save(patch: Partial<OsmiumSettings>): Promise<OsmiumSettings> {
    const current = await this.load();
    const next = sanitizeSettings({ ...current, ...patch });
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }
}
