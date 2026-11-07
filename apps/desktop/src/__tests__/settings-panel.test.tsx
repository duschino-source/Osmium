// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SettingsValues } from '@osmium/ui';
import { SettingsPanel } from '@osmium/ui';

const values: SettingsValues = {
  theme: 'light',
  palette: 'blue',
  fontSize: 13,
  sidebarVisible: true,
  defaultApprovalMode: 'ask',
  autoSave: false,
  formatOnSave: true,
  telemetryOptIn: false,
};

describe('SettingsPanel', () => {
  it('renders the current appearance and forwards theme/palette/size changes', () => {
    const onChange = vi.fn();
    render(<SettingsPanel values={values} onChange={onChange} />);

    expect(screen.getByTestId('settings-theme-light').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('settings-theme-dark'));
    expect(onChange).toHaveBeenCalledWith({ theme: 'dark' });

    fireEvent.click(screen.getByTestId('settings-palette-forest'));
    expect(onChange).toHaveBeenCalledWith({ palette: 'forest' });

    fireEvent.click(screen.getByTestId('settings-font-14'));
    expect(onChange).toHaveBeenCalledWith({ fontSize: 14 });

    fireEvent.click(screen.getByTestId('settings-sidebar'));
    expect(onChange).toHaveBeenCalledWith({ sidebarVisible: false });
  });

  it('forwards approval, auto-save, format, and telemetry changes', () => {
    const onChange = vi.fn();
    render(<SettingsPanel values={values} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('settings-approval-full-auto'));
    expect(onChange).toHaveBeenCalledWith({ defaultApprovalMode: 'full-auto' });

    fireEvent.click(screen.getByTestId('settings-auto-save'));
    expect(onChange).toHaveBeenCalledWith({ autoSave: true });

    fireEvent.click(screen.getByTestId('settings-format-on-save'));
    expect(onChange).toHaveBeenCalledWith({ formatOnSave: false });

    fireEvent.click(screen.getByTestId('settings-telemetry'));
    expect(onChange).toHaveBeenCalledWith({ telemetryOptIn: true });
  });
});
