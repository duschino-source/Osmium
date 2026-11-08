// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentEvent } from '@osmium/core';
import { DEFAULT_OSMIUM_SETTINGS } from '@osmium/ide-core';
import { App } from '../renderer/App.js';

afterEach(() => {
  delete (window as unknown as { osmium?: unknown }).osmium;
  for (const attribute of ['data-theme', 'data-palette', 'data-font-size']) {
    document.documentElement.removeAttribute(attribute);
  }
});

describe('@osmium/desktop Phase 0 App Shell', () => {
  it('renders sidebar navigation, an honest empty project state, and footer links', () => {
    render(<App />);
    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar).toBeDefined();
    expect(screen.getByTestId('mode-btn-code').textContent).toBe('Code');
    expect(screen.getByTestId('mode-btn-chat').textContent).toBe('Chat');
    expect(screen.getByTestId('nav-item-new-task').textContent).toBe('New Task');
    expect(screen.getByTestId('sidebar-projects-empty').textContent).toBe('No projects yet');
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
    fireEvent.click(screen.getByTestId('mode-btn-chat'));
    expect(screen.getByTestId('home-headline').textContent).toBe('What are we building?');
    expect(screen.getByTestId('home-subtitle').textContent).toBe(
      'Connect the coding CLIs you already use. Detection runs locally; nothing leaves this machine.',
    );
    expect(screen.getByTestId('status-chip-codex').textContent).toContain('Codex CLI · Primary');
    expect(screen.getByTestId('status-chip-antigravity').textContent).toContain(
      'Antigravity · Second',
    );
    expect(screen.getByTestId('status-chip-deepseek').textContent).toContain('DeepSeek CLI');
    expect(screen.getByTestId('status-chip-mock').textContent).toContain('Mock CLI · Test engine');
    expect(screen.getByTestId('connect-cli-chip').textContent).toContain('Connect CLI');

    fireEvent.click(screen.getByTestId('quick-start-teamwork'));
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
    expect(input.value).toBe('/teamwork ');
  });

  it('renders custom TitleBar with branding, menus, search pill, and window controls', () => {
    render(<App />);
    expect(screen.getByTestId('app-titlebar')).toBeDefined();
    expect(screen.getByTestId('titlebar-app-name').textContent).toBe('OsmiumIDE');
    expect(screen.getByTestId('titlebar-search-btn')).toBeDefined();
    expect(screen.getByTestId('win-btn-minimize')).toBeDefined();
    expect(screen.getByTestId('win-btn-maximize')).toBeDefined();
    expect(screen.getByTestId('win-btn-close')).toBeDefined();

    // Open File menu dropdown
    const fileMenuBtn = screen.getByTestId('menu-btn-file');
    fireEvent.click(fileMenuBtn);
    expect(screen.getByTestId('dropdown-menu-file')).toBeDefined();
    expect(screen.getByTestId('dropdown-item-new-task')).toBeDefined();

    // Clicking New Task navigates
    fireEvent.click(screen.getByTestId('dropdown-item-new-task'));
    expect(screen.queryByTestId('dropdown-menu-file')).toBeNull();
  });

  it('renders fully functional IDE workbench in Code mode with Activity Bar, File Explorer, Editor tabs, Terminal, and Agent panel', () => {
    render(<App />);
    expect(screen.getByTestId('ide-workbench')).toBeDefined();
    expect(screen.getByTestId('ide-activity-bar')).toBeDefined();
    expect(screen.getByTestId('ide-file-explorer')).toBeDefined();
    expect(screen.getByTestId('ide-editor-workspace')).toBeDefined();
    expect(screen.getByTestId('ide-terminal-panel')).toBeDefined();
    expect(screen.getByTestId('ide-agent-docked-panel')).toBeDefined();
    expect(screen.getByTestId('ide-status-bar')).toBeDefined();

    // Switch Activity to Search
    fireEvent.click(screen.getByTestId('activity-btn-search'));
    expect(screen.getByTestId('ide-search-panel')).toBeDefined();

    // Switch Activity to Git
    fireEvent.click(screen.getByTestId('activity-btn-git'));
    expect(screen.getByTestId('ide-source-control-panel')).toBeDefined();

    // Switch Activity back to Explorer
    fireEvent.click(screen.getByTestId('activity-btn-explorer'));
    expect(screen.getByTestId('ide-file-explorer')).toBeDefined();
  });

  it('renders real CLI detection chips and the CLI Hub from the bridge', async () => {
    const detectAll = vi.fn(async () => ({
      codex: {
        installed: false,
        versionWarning: 'Binary not found in PATH',
        capabilities: {
          acp: false,
          jsonStream: false,
          resume: false,
          approvals: false,
          readOnlyMode: false,
          reportsUsage: false,
        },
      },
      antigravity: { installed: false, capabilities: {} },
      deepseek: {
        installed: false,
        versionWarning: 'Binary not found in PATH',
        capabilities: {
          acp: false,
          jsonStream: false,
          resume: false,
          approvals: false,
          readOnlyMode: false,
          reportsUsage: false,
        },
      },
      mock: {
        installed: true,
        version: '0.1.0',
        path: 'target/debug/osmium-mock-cli.exe',
        capabilities: {
          acp: false,
          jsonStream: true,
          resume: true,
          approvals: true,
          readOnlyMode: true,
          reportsUsage: true,
          testedVersion: '0.1.0',
        },
      },
    }));
    const test = vi.fn(async () => ({ ok: true, latencyMs: 12, message: '0.1.0' }));
    (window as unknown as { osmium: unknown }).osmium = {
      cli: { detectAll, test },
    };

    render(<App />);
    fireEvent.click(screen.getByTestId('mode-btn-chat'));
    await waitFor(() =>
      expect(screen.getByTestId('status-chip-mock').textContent).toContain('Installed · 0.1.0'),
    );
    expect(screen.getByTestId('status-chip-deepseek').textContent).toContain('Not installed');

    fireEvent.click(screen.getByTestId('footer-item-cli-hub'));
    await waitFor(() => expect(screen.getByTestId('cli-hub')).toBeDefined());
    expect(screen.getByTestId('cli-hub-row-mock').textContent).toContain('Installed · 0.1.0');
    expect(screen.getByTestId('cli-hub-row-deepseek').textContent).toContain('Not installed');
    expect(screen.getByTestId('cli-hub-row-mock').textContent).toContain('JSON stream');

    fireEvent.click(screen.getByTestId('cli-hub-test-mock'));
    await waitFor(() =>
      expect(screen.getByTestId('cli-hub-row-mock').textContent).toContain('Responded in 12ms'),
    );
    expect(test).toHaveBeenCalledWith('mock');
  });

  it('starts a chat session and renders streamed events from the bridge', async () => {
    let pushEvent: ((payload: { sessionId: string; event: AgentEvent }) => void) | undefined;
    const start = vi.fn(async () => ({
      id: 'sess-1',
      projectId: 'osmium',
      title: 'Chat session',
      activeCli: 'mock',
      status: 'idle',
      createdAt: 0,
      updatedAt: 0,
    }));
    const send = vi.fn(async () => {
      pushEvent?.({
        sessionId: 'sess-1',
        event: { type: 'message', role: 'assistant', text: 'Done.', final: true },
      });
    });
    (window as unknown as { osmium: unknown }).osmium = {
      cli: { detectAll: async () => ({}) },
      session: {
        start,
        send,
        cancel: async () => {},
        respondToApproval: async () => {},
        close: async () => {},
        onEvent: (callback: (payload: { sessionId: string; event: AgentEvent }) => void) => {
          pushEvent = callback;
          return () => {};
        },
      },
    };

    render(<App />);
    fireEvent.click(screen.getByTestId('mode-btn-chat'));
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('composer-send-btn'));

    await waitFor(() => expect(screen.getByTestId('session-view')).toBeDefined());
    expect(screen.getByText('hello')).toBeDefined();
    await waitFor(() => expect(screen.getByText('Done.')).toBeDefined());
    expect(start).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('sess-1', 'hello');
  });

  it('shows an honest error when a CLI cannot start (not installed)', async () => {
    (window as unknown as { osmium: unknown }).osmium = {
      cli: { detectAll: async () => ({}) },
      session: {
        start: async () => {
          throw new Error('DeepSeek CLI binary not found at deepseek: Binary not found in PATH');
        },
        send: async () => {},
        cancel: async () => {},
        respondToApproval: async () => {},
        close: async () => {},
        onEvent: () => () => {},
      },
    };

    render(<App />);
    fireEvent.click(screen.getByTestId('mode-btn-chat'));
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('composer-send-btn'));

    await waitFor(() => expect(screen.getByTestId('session-error')).toBeDefined());
    expect(screen.getByTestId('session-error').textContent).toContain(
      'DeepSeek CLI binary not found',
    );
    // The composer stays available so the user can retry with another CLI.
    expect(screen.getByTestId('composer-input')).toBeDefined();
  });

  it('uses Osmium in Chat and OsmiumIDE in the IDE', () => {
    render(<App />);
    expect(screen.getByTestId('titlebar-app-name').textContent).toBe('OsmiumIDE');
    fireEvent.click(screen.getByTestId('mode-btn-chat'));
    expect(screen.getByTestId('titlebar-app-name').textContent).toBe('Osmium');
    fireEvent.click(screen.getByTestId('mode-btn-code'));
    expect(screen.getByTestId('titlebar-app-name').textContent).toBe('OsmiumIDE');
  });

  it('closes and reopens the navigation sidebar', () => {
    render(<App />);
    expect(screen.getByTestId('app-sidebar')).toBeDefined();
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(screen.queryByTestId('app-sidebar')).toBeNull();
    fireEvent.click(screen.getByTestId('sidebar-toggle'));
    expect(screen.getByTestId('app-sidebar')).toBeDefined();
  });

  it('loads persisted appearance and saves palette changes from Settings', async () => {
    const saveSettings = vi.fn(async (patch: unknown) => ({
      ...DEFAULT_OSMIUM_SETTINGS,
      ...(patch as Record<string, unknown>),
    }));
    (window as unknown as { osmium: unknown }).osmium = {
      cli: { detectAll: async () => ({}) },
      ide: {
        getSettings: async () => ({
          ...DEFAULT_OSMIUM_SETTINGS,
          theme: 'dark',
          palette: 'forest',
        }),
        saveSettings,
        readTree: async () => [],
        gitBranches: async () => ({ current: 'main', branches: ['main'] }),
        gitStatus: async () => ({ branch: 'main', files: [] }),
      },
    };

    render(<App />);
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
    expect(document.documentElement.getAttribute('data-palette')).toBe('forest');

    fireEvent.click(screen.getByTestId('footer-item-settings'));
    expect(screen.getByTestId('ide-settings-panel')).toBeDefined();

    fireEvent.click(screen.getByTestId('settings-theme-light'));
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    fireEvent.click(screen.getByTestId('settings-palette-forest'));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-palette')).toBe('forest'),
    );
    fireEvent.click(screen.getByTestId('settings-font-14'));
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-font-size')).toBe('large'),
    );
    expect(saveSettings).toHaveBeenCalled();
  });

  it('opens Settings from the command palette', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('titlebar-search-btn'));
    expect(screen.getByTestId('command-palette-input')).toBeDefined();
    fireEvent.click(screen.getByTestId('command-palette-item-settings'));
    expect(screen.getByTestId('ide-settings-panel')).toBeDefined();
  });

  it('creates an explorer entry in the workspace', async () => {
    const createEntry = vi.fn(async () => ({ created: true }));
    (window as unknown as { osmium: unknown }).osmium = {
      cli: { detectAll: async () => ({}) },
      ide: {
        createEntry,
        readTree: async () => [],
        gitBranches: async () => ({ current: 'main', branches: ['main'] }),
        gitStatus: async () => ({ branch: 'main', files: [] }),
      },
    };

    render(<App />);
    fireEvent.click(screen.getByTestId('explorer-new-file'));
    fireEvent.change(screen.getByTestId('explorer-create-input'), {
      target: { value: 'notes.md' },
    });
    fireEvent.submit(screen.getByTestId('explorer-create-form'));

    await waitFor(() => expect(createEntry).toHaveBeenCalledWith('notes.md', 'file'));
  });

  it('adopts a real workspace root and opens a file from Quick Open', async () => {
    (window as unknown as { osmium: unknown }).osmium = {
      cli: { detectAll: async () => ({}) },
      ide: {
        getWorkspaceRoot: async () => '/root',
        readTree: async () => [
          {
            name: 'notes.md',
            relPath: 'notes.md',
            absPath: '/root/notes.md',
            kind: 'file',
          },
        ],
        listWorkspaceFiles: async () => [{ relPath: 'notes.md', name: 'notes.md', kind: 'file' }],
        readFile: async () => ({ content: '# Notes' }),
        gitBranches: async () => ({ current: 'main', branches: ['main'] }),
        gitStatus: async () => ({ branch: 'main', files: [] }),
        onWorkspaceChanged: () => () => {},
        watchWorkspace: async () => true,
      },
    };

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('file-tree-item-notes.md')).toBeDefined());

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    const input = screen.getByTestId('quick-open-input');
    fireEvent.change(input, { target: { value: 'notes' } });
    fireEvent.click(screen.getByTestId('quick-open-item-notes.md'));

    await waitFor(() => expect(screen.getByTestId('editor-tab-notes.md')).toBeDefined());
  });
});
