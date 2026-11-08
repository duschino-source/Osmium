// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileExplorer, QuickOpenPanel } from '../index.js';

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
];

describe('FileExplorer file lifecycle', () => {
  it('renames a file against its parent directory', async () => {
    const onRenameEntry = vi.fn(async () => {});
    render(<FileExplorer tree={tree} onSelectFile={() => {}} onRenameEntry={onRenameEntry} />);

    fireEvent.click(screen.getByTestId('explorer-rename-App.tsx'));
    fireEvent.change(screen.getByTestId('explorer-rename-input'), {
      target: { value: 'Main.tsx' },
    });
    fireEvent.submit(screen.getByTestId('explorer-rename-form-App.tsx'));

    await waitFor(() =>
      expect(onRenameEntry).toHaveBeenCalledWith('/root/src/App.tsx', '/root/src/Main.tsx'),
    );
  });

  it('requires confirmation before deleting', async () => {
    const onDeleteEntry = vi.fn(async () => {});
    render(<FileExplorer tree={tree} onSelectFile={() => {}} onDeleteEntry={onDeleteEntry} />);

    fireEvent.click(screen.getByTestId('explorer-delete-App.tsx'));
    expect(screen.getByTestId('explorer-delete-confirm')).toBeDefined();
    expect(onDeleteEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('explorer-delete-confirm-btn'));
    await waitFor(() => expect(onDeleteEntry).toHaveBeenCalledWith('/root/src/App.tsx'));
  });

  it('offers Open Folder when there is no workspace', () => {
    const onOpenFolder = vi.fn();
    render(
      <FileExplorer
        tree={[]}
        rootName="NO FOLDER"
        onSelectFile={() => {}}
        onOpenFolder={onOpenFolder}
      />,
    );
    fireEvent.click(screen.getByTestId('explorer-open-folder'));
    expect(onOpenFolder).toHaveBeenCalled();
  });
});

describe('QuickOpenPanel', () => {
  it('filters, navigates with arrows, and opens with Enter', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickOpenPanel
        open
        candidates={[
          { relPath: 'src/App.tsx', name: 'App.tsx', kind: 'file' },
          { relPath: 'src/main.ts', name: 'main.ts', kind: 'file' },
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    const input = screen.getByTestId('quick-open-input');
    fireEvent.change(input, { target: { value: 'main' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('src/main.ts');
    expect(onClose).toHaveBeenCalled();
  });
});
