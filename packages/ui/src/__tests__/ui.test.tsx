// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliBadge, Composer, EditedFilesCard, ApprovalPrompt } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('@osmium/ui tokens & components', () => {
  it('declares local bundled Inter @font-face and DESIGN.md CSS variables in tokens.css', () => {
    const tokensCss = fs.readFileSync(path.resolve(__dirname, '../tokens.css'), 'utf8');
    expect(tokensCss).toContain("font-family: 'Inter'");
    expect(tokensCss).toContain("url('./fonts/Inter-Regular.woff2')");
    expect(tokensCss).not.toMatch(/https?:\/\//i);

    // DESIGN.md section 2: neutral Apple-material palette, one tint (the
    // approved revamp replaced the legacy green baseline).
    expect(tokensCss.toLowerCase()).toContain('--bg-ground: #ffffff');
    expect(tokensCss.toLowerCase()).toContain('--bg-sidebar: #f5f5f7');
    expect(tokensCss.toLowerCase()).toContain('--border-default: #d1d1d6');
    expect(tokensCss.toLowerCase()).toContain('--text-ink: #1d1d1f');
    expect(tokensCss.toLowerCase()).toContain('--text-muted: #6e6e73');
    expect(tokensCss.toLowerCase()).toContain('--accent-primary: #0071e3');
    expect(tokensCss.toLowerCase()).toContain('--tint: #0071e3');
    expect(tokensCss.toLowerCase()).toContain('--bg-diff-add: rgba(36, 138, 61, 0.13)');
    expect(tokensCss.toLowerCase()).toContain('--bg-diff-remove: rgba(215, 0, 21, 0.1)');
    expect(tokensCss.toLowerCase()).toContain('--cli-codex: #1d1d1f');
    expect(tokensCss.toLowerCase()).toContain('--cli-antigravity: #2f5fd0');
    expect(tokensCss.toLowerCase()).toContain('--cli-deepseek: #6b4fd0');
    expect(tokensCss).toMatch(/\[data-theme=['"]dark['"]\]/);

    // Verify the WOFF2 files exist locally on disk
    const fontsDir = path.resolve(__dirname, '../fonts');
    expect(fs.existsSync(path.join(fontsDir, 'Inter-Regular.woff2'))).toBe(true);
    expect(fs.existsSync(path.join(fontsDir, 'Inter-Bold.woff2'))).toBe(true);
  });

  it('always renders CliBadge with a colored dot AND the CLI name (never color alone)', () => {
    render(<CliBadge cliId="codex" roleLabel="Primary" />);
    const badge = screen.getByTestId('cli-badge-codex');
    expect(badge.textContent).toContain('Codex CLI · Primary');
    const dot = badge.querySelector('.osmium-cli-dot') as HTMLElement | null;
    expect(dot).not.toBeNull();
  });

  it('opens SlashCommandMenu when typing / in Composer and triggers onSend', () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);

    const textarea = screen.getByTestId('composer-input');
    fireEvent.change(textarea, { target: { value: '/team' } });

    const menu = screen.getByTestId('slash-command-menu');
    expect(menu.textContent).toContain('/teamwork');
    expect(menu.textContent).toContain('Split this task across your CLIs');

    fireEvent.click(screen.getByTestId('slash-option-teamwork'));
    expect((textarea as HTMLTextAreaElement).value).toBe('/teamwork ');

    fireEvent.change(textarea, {
      target: { value: '/teamwork Add copy review brief' },
    });
    fireEvent.click(screen.getByTestId('composer-send-btn'));
    expect(onSend).toHaveBeenCalledWith('/teamwork Add copy review brief');
  });

  it('renders EditedFilesCard with counts, Undo, and Review buttons', () => {
    const onUndo = vi.fn();
    const onReview = vi.fn();
    render(
      <EditedFilesCard
        totalCount={3}
        totalAdded={94}
        totalRemoved={2}
        files={[
          { path: 'compare-model.ts', added: 43, removed: 0 },
          { path: 'CompareView.tsx', added: 48, removed: 1 },
        ]}
        onUndo={onUndo}
        onReview={onReview}
      />,
    );

    expect(screen.getByTestId('edited-files-card').textContent).toContain('Edited 3 files');
    expect(screen.getByTestId('edited-files-added').textContent).toBe('+94');
    expect(screen.getByTestId('edited-files-removed').textContent).toBe('-2');

    fireEvent.click(screen.getByTestId('edited-files-undo-btn'));
    fireEvent.click(screen.getByTestId('edited-files-review-btn'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('renders ApprovalPrompt with Allow, Deny, and Allow for this session buttons', () => {
    const onDecision = vi.fn();
    render(<ApprovalPrompt id="app-1" kind="command" detail="pnpm test" onDecision={onDecision} />);

    fireEvent.click(screen.getByTestId('approval-allow-session-btn'));
    expect(onDecision).toHaveBeenCalledWith('app-1', true, 'session');
  });
});
