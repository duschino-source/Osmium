import { describe, it, expect } from 'vitest';
import {
  getCliColor,
  getCliCssVariable,
  getCliDisplayName,
  compareSemver,
  createVersionWarning,
} from '../index.js';

describe('@conductor/adapters utilities', () => {
  it('returns exact Section 7 colors for Codex, Antigravity, and DeepSeek', () => {
    expect(getCliColor('codex')).toBe('#1B2B22');
    expect(getCliColor('antigravity')).toBe('#2F5FD0');
    expect(getCliColor('deepseek')).toBe('#6B4FD0');
    expect(getCliCssVariable('codex')).toContain('--cli-codex');
    expect(getCliCssVariable('antigravity')).toContain('--cli-antigravity');
    expect(getCliCssVariable('deepseek')).toContain('--cli-deepseek');
  });

  it('assigns deterministic colors from the fixed palette for unknown CLIs', () => {
    const c1 = getCliColor('custom-cli-alpha');
    const c2 = getCliColor('custom-cli-alpha');
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('formats CLI display names accurately', () => {
    expect(getCliDisplayName('codex')).toBe('Codex CLI');
    expect(getCliDisplayName('antigravity')).toBe('Antigravity');
    expect(getCliDisplayName('deepseek')).toBe('DeepSeek CLI');
  });

  it('compares semver strings and generates non-blocking warnings for untested newer versions', () => {
    expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    expect(compareSemver('1.1.0', '1.1.0')).toBe(0);
    expect(compareSemver('0.9.5', '1.0.0')).toBe(-1);

    expect(createVersionWarning('codex', '0.2.0', '0.1.0')).toContain(
      'newer than tested version 0.1.0',
    );
    expect(createVersionWarning('codex', '0.1.0', '0.1.0')).toBeUndefined();
    expect(createVersionWarning('codex', '0.0.9', '0.1.0')).toBeUndefined();
  });
});
