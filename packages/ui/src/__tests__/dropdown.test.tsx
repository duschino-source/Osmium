// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropdownMenu, Composer } from '../index.js';

describe('DropdownMenu & Composer Dropdowns', () => {
  it('renders DropdownMenu when open, selects item, and closes on Escape', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <DropdownMenu
        isOpen={false}
        onClose={onClose}
        items={[
          { key: 'opt-1', label: 'Option 1', description: 'First option' },
          { key: 'opt-2', label: 'Option 2', description: 'Second option' },
        ]}
        onSelect={onSelect}
      />,
    );

    expect(screen.queryByTestId('dropdown-menu')).toBeNull();

    rerender(
      <DropdownMenu
        isOpen={true}
        onClose={onClose}
        title="TEST MENU"
        items={[
          { key: 'opt-1', label: 'Option 1', description: 'First option' },
          { key: 'opt-2', label: 'Option 2', description: 'Second option' },
        ]}
        onSelect={onSelect}
      />,
    );

    const menu = screen.getByTestId('dropdown-menu');
    expect(menu).toBeDefined();
    expect(menu.textContent).toContain('TEST MENU');
    expect(menu.textContent).toContain('Option 1');

    fireEvent.click(screen.getByTestId('dropdown-item-opt-1'));
    expect(onSelect).toHaveBeenCalledWith('opt-1');
    expect(onClose).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Composer opens CLI dropdown and updates active CLI when item selected', () => {
    const onCliChange = vi.fn();
    render(<Composer activeCliId="codex" onCliChange={onCliChange} />);

    const cliBtn = screen.getByTestId('composer-cli-btn');
    expect(cliBtn.textContent).toContain('Codex CLI');

    // Click to open dropdown
    fireEvent.click(cliBtn);

    const antigravityOpt = screen.getByTestId('dropdown-item-antigravity');
    expect(antigravityOpt.textContent).toContain('Antigravity');
    expect(antigravityOpt.textContent).toContain('Google DeepMind');

    fireEvent.click(antigravityOpt);
    expect(onCliChange).toHaveBeenCalledWith('antigravity');
  });

  it('Composer opens Approval Mode dropdown and updates mode when item selected', () => {
    const onApprovalModeChange = vi.fn();
    render(<Composer approvalMode="ask" onApprovalModeChange={onApprovalModeChange} />);

    const approvalBtn = screen.getByTestId('composer-approval-btn');
    expect(approvalBtn.textContent).toContain('Ask for approval');

    // Click to open dropdown
    fireEvent.click(approvalBtn);

    const fullAutoOpt = screen.getByTestId('dropdown-item-full-auto');
    expect(fullAutoOpt.textContent).toContain('Full-auto');

    fireEvent.click(fullAutoOpt);
    expect(onApprovalModeChange).toHaveBeenCalledWith('full-auto');
  });

  it('renders green, yellow, red dots for approval modes without emojis', () => {
    const { rerender } = render(<Composer approvalMode="ask" />);
    let dot = screen
      .getByTestId('composer-approval-btn')
      .querySelector('.osmium-approval-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.backgroundColor).toBe('var(--state-ok)'); // semantic green token (DESIGN.md)

    rerender(<Composer approvalMode="auto-edit" />);
    dot = screen
      .getByTestId('composer-approval-btn')
      .querySelector('.osmium-approval-dot') as HTMLElement;
    expect(dot.style.backgroundColor).toBe('var(--state-warn)'); // semantic yellow token

    rerender(<Composer approvalMode="full-auto" />);
    dot = screen
      .getByTestId('composer-approval-btn')
      .querySelector('.osmium-approval-dot') as HTMLElement;
    expect(dot.style.backgroundColor).toBe('var(--state-error)'); // semantic red token

    // Open dropdown and check items have no emojis and correct dot colors
    fireEvent.click(screen.getByTestId('composer-approval-btn'));
    const askOpt = screen.getByTestId('dropdown-item-ask');
    expect(askOpt.textContent).not.toMatch(/🛡️|📝|⚡/);
    const askDot = askOpt.querySelector('span[style*="border-radius: 50%"]') as HTMLElement;
    expect(askDot).not.toBeNull();
    expect(askDot.style.backgroundColor).toBe('var(--state-ok)');
  });
});
