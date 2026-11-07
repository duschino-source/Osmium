import React from 'react';
import type { ApprovalMode } from '@osmium/core';
import { Icon } from './Icon.js';

export type SettingsTheme = 'light' | 'dark' | 'system';
export type SettingsPalette = 'blue' | 'teal' | 'forest' | 'graphite';

export interface SettingsValues {
  theme: SettingsTheme;
  palette: SettingsPalette;
  fontSize: number;
  sidebarVisible: boolean;
  defaultApprovalMode: ApprovalMode;
  autoSave: boolean;
  formatOnSave: boolean;
  telemetryOptIn: boolean;
}

export interface SettingsPanelProps {
  values: SettingsValues;
  onChange: (patch: Partial<SettingsValues>) => void;
}

const THEMES: Array<{ key: SettingsTheme; label: string }> = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

const PALETTES: Array<{ key: SettingsPalette; label: string }> = [
  { key: 'blue', label: 'Blue' },
  { key: 'teal', label: 'Teal' },
  { key: 'forest', label: 'Forest' },
  { key: 'graphite', label: 'Graphite' },
];

const APPROVAL_MODES: Array<{ key: ApprovalMode; label: string; hint: string }> = [
  { key: 'ask', label: 'Ask', hint: 'Confirm every write or command' },
  { key: 'auto-edit', label: 'Auto-edit', hint: 'Apply edits, ask before commands' },
  { key: 'full-auto', label: 'Full-auto', hint: 'Run without prompts' },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ values, onChange }) => (
  <div data-testid="ide-settings-panel" className="wb-panel">
    <div className="wb-panel-head">
      <span className="wb-panel-title">
        <Icon name="gear" size={14} /> Settings
      </span>
    </div>

    <div className="wb-body wb-settings-body">
      <section className="wb-settings-section">
        <div className="wb-settings-title">Appearance</div>
        <div className="wb-settings-label">Theme</div>
        <div className="wb-settings-segment" role="group" aria-label="Theme">
          {THEMES.map((theme) => (
            <button
              key={theme.key}
              type="button"
              data-testid={`settings-theme-${theme.key}`}
              aria-pressed={values.theme === theme.key}
              data-active={values.theme === theme.key || undefined}
              onClick={() => onChange({ theme: theme.key })}
            >
              {theme.label}
            </button>
          ))}
        </div>

        <div className="wb-settings-label">Accent palette</div>
        <div className="wb-settings-palettes">
          {PALETTES.map((palette) => (
            <button
              key={palette.key}
              type="button"
              data-testid={`settings-palette-${palette.key}`}
              aria-pressed={values.palette === palette.key}
              data-active={values.palette === palette.key || undefined}
              onClick={() => onChange({ palette: palette.key })}
            >
              <span className="wb-palette-swatch" data-palette={palette.key} aria-hidden="true" />
              <span>{palette.label}</span>
            </button>
          ))}
        </div>

        <div className="wb-settings-label">Reading size</div>
        <div className="wb-settings-segment" role="group" aria-label="Reading size">
          {[
            { value: 12, label: 'Small' },
            { value: 13, label: 'Default' },
            { value: 14, label: 'Large' },
          ].map((size) => (
            <button
              key={size.value}
              type="button"
              data-testid={`settings-font-${size.value}`}
              aria-pressed={values.fontSize === size.value}
              data-active={values.fontSize === size.value || undefined}
              onClick={() => onChange({ fontSize: size.value })}
            >
              {size.label}
            </button>
          ))}
        </div>

        <label className="wb-settings-toggle">
          <span>
            <strong>Navigation sidebar</strong>
            <span>Show the project/session rail (Ctrl+B)</span>
          </span>
          <input
            type="checkbox"
            data-testid="settings-sidebar"
            checked={values.sidebarVisible}
            onChange={(event) => onChange({ sidebarVisible: event.target.checked })}
          />
        </label>
      </section>

      <section className="wb-settings-section">
        <div className="wb-settings-title">Agent behaviour</div>
        <div className="wb-settings-label">Default approval</div>
        <div className="wb-settings-segment" role="group" aria-label="Default approval">
          {APPROVAL_MODES.map((mode) => (
            <button
              key={mode.key}
              type="button"
              data-testid={`settings-approval-${mode.key}`}
              aria-pressed={values.defaultApprovalMode === mode.key}
              data-active={values.defaultApprovalMode === mode.key || undefined}
              onClick={() => onChange({ defaultApprovalMode: mode.key })}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="wb-settings-hint">
          {APPROVAL_MODES.find((mode) => mode.key === values.defaultApprovalMode)?.hint}
        </div>

        <label className="wb-settings-toggle">
          <span>
            <strong>Auto-save</strong>
            <span>Save the active editor after a pause</span>
          </span>
          <input
            type="checkbox"
            data-testid="settings-auto-save"
            checked={values.autoSave}
            onChange={(event) => onChange({ autoSave: event.target.checked })}
          />
        </label>

        <label className="wb-settings-toggle">
          <span>
            <strong>Format on save</strong>
            <span>Pretty-print JSON and trim trailing whitespace</span>
          </span>
          <input
            type="checkbox"
            data-testid="settings-format-on-save"
            checked={values.formatOnSave}
            onChange={(event) => onChange({ formatOnSave: event.target.checked })}
          />
        </label>
      </section>

      <section className="wb-settings-section">
        <div className="wb-settings-title">Privacy</div>
        <label className="wb-settings-toggle">
          <span>
            <strong>Share anonymous usage</strong>
            <span>Off by default. Local-first; no account required.</span>
          </span>
          <input
            type="checkbox"
            data-testid="settings-telemetry"
            checked={values.telemetryOptIn}
            onChange={(event) => onChange({ telemetryOptIn: event.target.checked })}
          />
        </label>
      </section>

      <div className="wb-settings-note">
        Stored locally in your Osmium profile. Theme palettes change one accent hue at a time.
      </div>
    </div>
  </div>
);
