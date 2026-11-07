// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  FileExplorer,
  EditorWorkspace,
  SearchPanel,
  SourceControlPanel,
  StatusBar,
} from '../index.js';

describe('IDE Workbench UI Components', () => {
  it('renders FileExplorer and responds to file click and expansion', () => {
    const onSelectFile = vi.fn();
    const tree = [
      {
        name: 'src',
        relPath: 'src',
        absPath: '/root/src',
        kind: 'directory' as const,
        children: [
          {
            name: 'App.tsx',
            relPath: 'src/App.tsx',
            absPath: '/root/src/App.tsx',
            kind: 'file' as const,
          },
        ],
      },
      {
        name: 'package.json',
        relPath: 'package.json',
        absPath: '/root/package.json',
        kind: 'file' as const,
      },
    ];

    render(<FileExplorer tree={tree} onSelectFile={onSelectFile} />);

    expect(screen.getByTestId('ide-file-explorer')).toBeDefined();
    expect(screen.getByText('package.json')).toBeDefined();

    // Click on package.json
    fireEvent.click(screen.getByTestId('file-tree-item-package.json'));
    expect(onSelectFile).toHaveBeenCalledWith(tree[1]);
  });

  it('renders EditorWorkspace with tabs and dirty indicator', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onChangeContent = vi.fn();
    const onSaveFile = vi.fn();

    const tabs = [
      {
        id: 'tab-1',
        name: 'App.tsx',
        path: 'src/App.tsx',
        content: 'console.log(1);',
        dirty: true,
      },
      {
        id: 'tab-2',
        name: 'main.rs',
        path: 'crates/main.rs',
        content: 'fn main() {}',
        dirty: false,
      },
    ];

    render(
      <EditorWorkspace
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onChangeContent={onChangeContent}
        onSaveFile={onSaveFile}
      />,
    );

    expect(screen.getByTestId('ide-editor-workspace')).toBeDefined();
    expect(screen.getByTestId('editor-tab-App.tsx')).toBeDefined();
    expect(screen.getByTestId('editor-save-btn')).toBeDefined();

    // Click save
    fireEvent.click(screen.getByTestId('editor-save-btn'));
    expect(onSaveFile).toHaveBeenCalledWith('tab-1');

    // Type in textarea
    const textarea = screen.getByTestId('ide-code-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'console.log(2);' } });
    expect(onChangeContent).toHaveBeenCalledWith('tab-1', 'console.log(2);');
  });

  it('renders SearchPanel and triggers search query', async () => {
    const onSearch = vi.fn().mockResolvedValue([
      {
        filePath: '/root/src/App.tsx',
        relPath: 'src/App.tsx',
        line: 10,
        column: 5,
        lineText: 'const x = 42;',
        matchText: '42',
      },
    ]);
    const onSelectMatch = vi.fn();

    render(<SearchPanel onSearch={onSearch} onSelectMatch={onSelectMatch} />);
    const input = screen.getByTestId('search-input');
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.submit(input);

    expect(onSearch).toHaveBeenCalledWith('42', {
      isRegex: false,
      caseSensitive: false,
      wholeWord: false,
    });
  });

  it('renders SourceControlPanel and triggers commit', async () => {
    const onCommit = vi.fn();
    render(
      <SourceControlPanel
        branch="feature/ide"
        files={[{ path: 'src/App.tsx', status: 'M', staged: false }]}
        onStageFile={vi.fn()}
        onUnstageFile={vi.fn()}
        onCommit={onCommit}
      />,
    );

    expect(screen.getByText('SOURCE CONTROL (feature/ide)')).toBeDefined();
    expect(screen.getByTestId('unstaged-file-src/App.tsx')).toBeDefined();

    const input = screen.getByTestId('git-commit-input');
    fireEvent.change(input, { target: { value: 'feat: add ide' } });
    fireEvent.click(screen.getByTestId('git-commit-btn'));

    expect(onCommit).toHaveBeenCalledWith('feat: add ide');
  });

  it('renders StatusBar with branch, line, column, and active CLI', () => {
    render(
      <StatusBar
        branch="main"
        errorCount={0}
        warningCount={2}
        line={42}
        column={18}
        activeCliName="Codex CLI"
      />,
    );

    expect(screen.getByTestId('ide-status-bar')).toBeDefined();
    expect(screen.getByText('main')).toBeDefined();
    expect(screen.getByText('Ln 42, Col 18')).toBeDefined();
    expect(screen.getByText('Codex CLI')).toBeDefined();
  });
});
