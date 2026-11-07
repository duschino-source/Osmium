// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AgentEvent } from '@osmium/core';
import { CliHubView, type CliHubEntry } from '../renderer/CliHubView.js';
import { SessionView, groupSessionEvents } from '../renderer/SessionView.js';

const assistantChunks: AgentEvent[] = [
  { type: 'message', role: 'assistant', text: 'Reading. ', final: false },
  { type: 'message', role: 'assistant', text: 'Reading. Done.', final: true },
];

describe('SessionView', () => {
  it('merges assistant chunks, keeps the final text, and renders tool/file/raw events', () => {
    const events: AgentEvent[] = [
      { type: 'message', role: 'user', text: 'hello', final: true },
      ...assistantChunks,
      { type: 'tool', id: 't1', name: 'read_file', status: 'done', summary: 'src/main.ts' },
      { type: 'file-edit', path: 'src/main.ts', added: 2, removed: 1 },
      { type: 'raw', data: 'plain line one' },
      { type: 'raw', data: 'plain line two' },
    ];

    render(
      <SessionView
        cliId="mock"
        status="idle"
        events={events}
        resolvedApprovals={[]}
        onApproval={() => {}}
        onCancel={() => {}}
        onNewSession={() => {}}
      />,
    );

    expect(screen.getByText('hello')).toBeDefined();
    expect(screen.getByText('Reading. Done.')).toBeDefined();
    expect(screen.queryByText('Reading. Reading. Done.')).toBeNull();
    expect(screen.getByText('read_file')).toBeDefined();
    expect(screen.getAllByText('src/main.ts').length).toBeGreaterThan(0);
    expect(screen.getByText('Edited 1 file')).toBeDefined();
    expect(screen.getByText(/Raw output · 2 lines/)).toBeDefined();
  });

  it('renders an approval prompt and forwards the decision', () => {
    const onApproval = vi.fn();
    const events: AgentEvent[] = [
      { type: 'approval', id: 'gate-1', kind: 'command', detail: 'Send this prompt?' },
    ];
    render(
      <SessionView
        cliId="deepseek"
        status="waiting"
        events={events}
        resolvedApprovals={[]}
        onApproval={onApproval}
        onCancel={() => {}}
        onNewSession={() => {}}
      />,
    );

    expect(screen.getByTestId('approval-prompt-gate-1')).toBeDefined();
    fireEvent.click(screen.getByTestId('approval-allow-btn'));
    expect(onApproval).toHaveBeenCalledWith('gate-1', true, 'once');
  });

  it('hides an approval prompt after it is resolved', () => {
    const events: AgentEvent[] = [
      { type: 'approval', id: 'gate-1', kind: 'command', detail: 'Send this prompt?' },
    ];
    render(
      <SessionView
        cliId="deepseek"
        status="working"
        events={events}
        resolvedApprovals={['gate-1']}
        onApproval={() => {}}
        onCancel={() => {}}
        onNewSession={() => {}}
      />,
    );

    expect(screen.queryByTestId('approval-prompt-gate-1')).toBeNull();
    expect(screen.getByText('Approval resolved · command')).toBeDefined();
  });

  it('shows the session error and disables cancel when idle', () => {
    render(
      <SessionView
        cliId="deepseek"
        status="idle"
        events={[]}
        error="DeepSeek CLI is not installed"
        resolvedApprovals={[]}
        onApproval={() => {}}
        onCancel={() => {}}
        onNewSession={() => {}}
      />,
    );

    expect(screen.getByTestId('session-error').textContent).toContain(
      'DeepSeek CLI is not installed',
    );
    expect((screen.getByTestId('session-cancel-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('groupSessionEvents', () => {
  it('drops transient deltas when a final message arrives after a tool call', () => {
    const blocks = groupSessionEvents([
      { type: 'message', role: 'assistant', text: 'Plan: build', final: false },
      { type: 'tool', id: 't1', name: 'read_file', status: 'done' },
      { type: 'message', role: 'assistant', text: 'Plan: build, wire, test.', final: true },
    ]);
    expect(blocks).toEqual([
      { kind: 'tool', id: 't1', name: 'read_file', status: 'done', summary: undefined },
      { kind: 'assistant', text: 'Plan: build, wire, test.' },
    ]);
  });

  it('groups consecutive raw lines and collects file edits at the end', () => {
    const blocks = groupSessionEvents([
      { type: 'raw', data: 'a' },
      { type: 'raw', data: 'b' },
      { type: 'file-edit', path: 'x.ts', added: 1, removed: 2 },
    ]);
    expect(blocks).toEqual([
      { kind: 'raw', lines: ['a', 'b'] },
      { kind: 'file-edits', files: [{ path: 'x.ts', added: 1, removed: 2 }] },
    ]);
  });
});

describe('CliHubView', () => {
  const entries: CliHubEntry[] = [
    {
      id: 'mock',
      installed: true,
      verified: true,
      version: '0.1.0',
      path: 'C:\\repo\\target\\debug\\osmium-mock-cli.exe',
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
    {
      id: 'deepseek',
      installed: false,
      verified: true,
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
    {
      id: 'codex',
      installed: true,
      verified: false,
      version: '0.160.0',
      capabilities: {
        acp: true,
        jsonStream: true,
        resume: true,
        approvals: true,
        readOnlyMode: true,
        reportsUsage: true,
      },
    },
  ];

  it('shows honest installed/not-installed states and capability labels', () => {
    render(
      <CliHubView
        entries={entries}
        loading={false}
        testResults={{}}
        onRefresh={() => {}}
        onTest={() => {}}
      />,
    );

    expect(screen.getByTestId('cli-hub')).toBeDefined();
    expect(screen.getByTestId('cli-hub-row-mock').textContent).toContain('Installed · 0.1.0');
    expect(screen.getByTestId('cli-hub-row-deepseek').textContent).toContain('Not installed');
    expect(screen.getByTestId('cli-hub-row-mock').textContent).toContain('JSON stream');
    expect(screen.getByTestId('cli-hub-row-deepseek').textContent).toContain(
      'No capabilities verified',
    );
    expect(screen.getByTestId('cli-hub-row-deepseek').textContent).toContain(
      'Binary not found in PATH',
    );
    expect(screen.getByTestId('cli-hub-row-codex').textContent).toContain(
      'Detection only — adapter not verified in this build',
    );
    expect(screen.getByTestId('cli-hub-row-codex').textContent).not.toContain('JSON stream');
  });

  it('forwards Test and Refresh actions', () => {
    const onTest = vi.fn();
    const onRefresh = vi.fn();
    render(
      <CliHubView
        entries={entries}
        loading={false}
        testResults={{ deepseek: { ok: false, latencyMs: 4, message: 'not installed' } }}
        onRefresh={onRefresh}
        onTest={onTest}
      />,
    );
    fireEvent.click(screen.getByTestId('cli-hub-test-deepseek'));
    fireEvent.click(screen.getByTestId('cli-hub-refresh'));
    expect(onTest).toHaveBeenCalledWith('deepseek');
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.getByTestId('cli-hub-row-deepseek').textContent).toContain('Failed in 4ms');
  });
});
