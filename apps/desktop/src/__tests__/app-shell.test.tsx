// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../renderer/App.js';

describe('@conductor/desktop Phase 0 App Shell', () => {
  it('renders sidebar navigation, projects with CLI dots, recent sessions, and footer links', () => {
    render(<App />);
    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar).toBeDefined();
    expect(screen.getByTestId('mode-btn-code').textContent).toBe('Code');
    expect(screen.getByTestId('mode-btn-chat').textContent).toBe('Chat');
    expect(screen.getByTestId('nav-item-new-task').textContent).toBe('New Task');
    expect(screen.getByTestId('sidebar-project-api-gateway').textContent).toContain('api-gateway');
    expect(screen.getByTestId('sidebar-project-landing-site').textContent).toContain(
      'landing-site',
    );
    expect(screen.getByTestId('sidebar-project-cli-playground').textContent).toContain(
      'cli-playground',
    );
    expect(screen.getByTestId('footer-item-cli-hub').textContent).toBe('CLI Hub');
  });

  it('Code/Chat toggle marks exactly the active mode as pressed', () => {
    render(<App />);
    const code = screen.getByTestId('mode-btn-code');
    const chat = screen.getByTestId('mode-btn-chat');
    expect(code.getAttribute('aria-pressed')).toBe('true');
    expect(chat.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chat);
    expect(chat.getAttribute('aria-pressed')).toBe('true');
    expect(code.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders Home screen headline, CLI status chips, Composer, and quick-start buttons', () => {
    render(<App />);
    expect(screen.getByTestId('home-headline').textContent).toBe('What are we building?');
    expect(screen.getByTestId('home-subtitle').textContent).toBe(
      'Connect the coding CLIs you already use. CLI detection arrives in Phase 1.',
    );
    expect(screen.getByTestId('status-chip-codex').textContent).toContain('Codex CLI · Primary');
    expect(screen.getByTestId('status-chip-antigravity').textContent).toContain(
      'Antigravity · Second',
    );
    expect(screen.getByTestId('status-chip-deepseek').textContent).toContain('DeepSeek CLI');
    expect(screen.getByTestId('connect-cli-chip').textContent).toContain('+ Connect CLI');

    fireEvent.click(screen.getByTestId('quick-start-teamwork'));
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    expect(input.value).toBe('/teamwork ');
  });
});
