// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_OSMIUM_SETTINGS } from '@osmium/ide-core';
import { SettingsStore, sanitizeSettings } from '../main/settings-store.js';

const dirs: string[] = [];

function tempStore(): SettingsStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osmium-settings-'));
  dirs.push(dir);
  return new SettingsStore(path.join(dir, 'settings.json'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('returns defaults when the file does not exist', async () => {
    const store = tempStore();
    expect(await store.load()).toEqual(DEFAULT_OSMIUM_SETTINGS);
  });

  it('persists theme, palette, font size, and behaviour across loads', async () => {
    const store = tempStore();
    const saved = await store.save({
      theme: 'dark',
      palette: 'forest',
      fontSize: 14,
      sidebarVisible: false,
      autoSave: true,
      defaultApprovalMode: 'full-auto',
    });
    expect(saved.theme).toBe('dark');
    expect(saved.palette).toBe('forest');
    expect(saved.fontSize).toBe(14);
    expect(saved.sidebarVisible).toBe(false);
    expect(saved.autoSave).toBe(true);
    expect(saved.defaultApprovalMode).toBe('full-auto');
    expect(await store.load()).toEqual(saved);
  });

  it('sanitizes invalid and unknown values', async () => {
    const store = tempStore();
    const saved = await store.save({
      theme: 'neon' as never,
      palette: 'purple' as never,
      fontSize: 999,
      defaultApprovalMode: 'yolo' as never,
      apiKey: 'must-not-persist',
    } as never);

    expect(saved.theme).toBe(DEFAULT_OSMIUM_SETTINGS.theme);
    expect(saved.palette).toBe(DEFAULT_OSMIUM_SETTINGS.palette);
    expect(saved.fontSize).toBe(16);
    expect(saved.defaultApprovalMode).toBe(DEFAULT_OSMIUM_SETTINGS.defaultApprovalMode);
    expect(JSON.stringify(saved)).not.toContain('must-not-persist');
  });

  it('recovers from corrupt JSON', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osmium-settings-'));
    dirs.push(dir);
    const corruptPath = path.join(dir, 'settings.json');
    fs.writeFileSync(corruptPath, '{not json', 'utf8');
    const corruptStore = new SettingsStore(corruptPath);
    expect(await corruptStore.load()).toEqual(DEFAULT_OSMIUM_SETTINGS);
  });
});

describe('sanitizeSettings', () => {
  it('clamps font size and ignores non-string keybindings', () => {
    const settings = sanitizeSettings({
      fontSize: 2,
      keybindings: { 'osmium.save': 'Ctrl+S', broken: 42 },
    });
    expect(settings.fontSize).toBe(11);
    expect(settings.keybindings['osmium.save']).toBe('Ctrl+S');
    expect(settings.keybindings.broken).toBeUndefined();
  });
});
