import React from 'react';
import type { AgentEvent, CliId } from '@osmium/core';
import { ApprovalPrompt, Button, CliBadge, Icon } from '@osmium/ui';

export type SessionStatus = 'idle' | 'working' | 'waiting' | 'error' | 'cancelled';

export interface SessionViewProps {
  cliId: CliId;
  status: SessionStatus;
  events: AgentEvent[];
  error?: string;
  resolvedApprovals: string[];
  onApproval: (id: string, allow: boolean, scope: 'once' | 'session') => void;
  onCancel: () => void;
  onNewSession: () => void;
  /** Composer for follow-up turns; kept outside the scrolling transcript. */
  composer?: React.ReactNode;
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting',
  error: 'Error',
  cancelled: 'Cancelled',
};

interface AssistantBlock {
  kind: 'assistant';
  text: string;
}

type Block =
  | AssistantBlock
  | { kind: 'user'; text: string }
  | { kind: 'tool'; id: string; name: string; status: string; summary?: string }
  | { kind: 'approval'; id: string; approvalKind: 'command' | 'edit' | 'network'; detail: string }
  | { kind: 'usage'; note?: string; limitHit?: boolean }
  | { kind: 'raw'; lines: string[] }
  | { kind: 'status'; state: string; message?: string }
  | { kind: 'file-edits'; files: Array<{ path: string; added: number; removed: number }> };

/**
 * Converts the append-only AgentEvent log into readable blocks.
 *
 * Assistant deltas are merged into one block per turn (the final message wins,
 * matching `assemble_streamed_message` in the Rust normalizer). Consecutive
 * `raw` events are grouped so unstructured CLI output stays visible without
 * turning the transcript into noise.
 */
export function groupSessionEvents(events: AgentEvent[]): Block[] {
  // A final assistant message supersedes the transient deltas that preceded it
  // in the same turn (tool events may sit between them). Keeping both makes
  // the transcript read as duplicated text.
  const visible = events.filter((event, position) => {
    if (event.type !== 'message' || event.role !== 'assistant' || event.final) return true;
    for (let index = position + 1; index < events.length; index += 1) {
      const next = events[index];
      if (next.type !== 'message') continue;
      if (next.role === 'user') return true;
      if (next.final) return false;
    }
    return true;
  });

  const blocks: Block[] = [];
  const fileEdits: Array<{ path: string; added: number; removed: number }> = [];
  let index = 0;

  while (index < visible.length) {
    const event = visible[index];

    if (event.type === 'raw') {
      const lines: string[] = [];
      while (index < visible.length && visible[index].type === 'raw') {
        lines.push((visible[index] as { type: 'raw'; data: string }).data);
        index += 1;
      }
      blocks.push({ kind: 'raw', lines });
      continue;
    }

    if (event.type === 'message' && event.role === 'assistant') {
      const chunks: string[] = [];
      let finalText: string | undefined;
      while (index < visible.length) {
        const next = visible[index];
        if (next.type !== 'message' || next.role !== 'assistant') break;
        if (next.final) finalText = next.text;
        else chunks.push(next.text);
        index += 1;
      }
      blocks.push({ kind: 'assistant', text: finalText ?? chunks.join('') });
      continue;
    }

    if (event.type === 'message' && event.role === 'user') {
      blocks.push({ kind: 'user', text: event.text });
      index += 1;
      continue;
    }

    if (event.type === 'tool') {
      blocks.push({
        kind: 'tool',
        id: event.id,
        name: event.name,
        status: event.status,
        summary: event.summary,
      });
      index += 1;
      continue;
    }

    if (event.type === 'file-edit') {
      fileEdits.push({ path: event.path, added: event.added, removed: event.removed });
      index += 1;
      continue;
    }

    if (event.type === 'approval') {
      blocks.push({
        kind: 'approval',
        id: event.id,
        approvalKind: event.kind,
        detail: event.detail,
      });
      index += 1;
      continue;
    }

    if (event.type === 'usage') {
      blocks.push({ kind: 'usage', note: event.note, limitHit: event.limitHit });
      index += 1;
      continue;
    }

    if (event.type === 'status') {
      blocks.push({ kind: 'status', state: event.state, message: event.message });
      index += 1;
      continue;
    }

    index += 1;
  }

  if (fileEdits.length > 0) {
    blocks.push({ kind: 'file-edits', files: fileEdits });
  }
  return blocks;
}

export const SessionView: React.FC<SessionViewProps> = ({
  cliId,
  status,
  events,
  error,
  resolvedApprovals,
  onApproval,
  onCancel,
  onNewSession,
  composer,
}) => {
  const resolved = new Set(resolvedApprovals);
  const blocks = groupSessionEvents(events);
  const running = status === 'working' || status === 'waiting';
  const editedFiles = blocks.find((block) => block.kind === 'file-edits');
  const totalAdded =
    editedFiles && editedFiles.kind === 'file-edits'
      ? editedFiles.files.reduce((sum, file) => sum + file.added, 0)
      : 0;
  const totalRemoved =
    editedFiles && editedFiles.kind === 'file-edits'
      ? editedFiles.files.reduce((sum, file) => sum + file.removed, 0)
      : 0;

  return (
    <main data-testid="session-view" className="app-session">
      <div className="app-session-inner">
        <header className="app-session-head">
          <div className="app-session-identity">
            <CliBadge cliId={cliId} />
            <span className="app-session-status" data-state={status}>
              {STATUS_LABELS[status]}
            </span>
          </div>
          <div className="app-session-actions">
            <Button
              size="sm"
              data-testid="session-cancel-btn"
              onClick={onCancel}
              disabled={!running}
            >
              Cancel
            </Button>
            <Button size="sm" variant="ghost" data-testid="session-new-btn" onClick={onNewSession}>
              New chat
            </Button>
          </div>
        </header>

        {error && (
          <div data-testid="session-error" className="app-session-error" role="alert">
            <Icon name="alert" size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="app-session-body">
          {blocks.length === 0 && !error && (
            <div className="app-session-empty">
              Send a prompt to start a session. The CLI decides what it can do; unknown output is
              shown as raw text.
            </div>
          )}

          {blocks.map((block, index) => {
            if (block.kind === 'user') {
              return (
                <div key={`user-${index}`} className="app-msg app-msg-user">
                  {block.text}
                </div>
              );
            }
            if (block.kind === 'assistant') {
              return (
                <div key={`assistant-${index}`} className="app-msg app-msg-assistant">
                  {block.text}
                </div>
              );
            }
            if (block.kind === 'tool') {
              return (
                <div
                  key={`tool-${block.id}-${index}`}
                  className="app-tool-row"
                  data-state={block.status}
                >
                  <Icon name="tool" size={13} />
                  <span className="app-tool-name">{block.name}</span>
                  <span className="app-tool-status">{block.status}</span>
                  {block.summary && <span className="app-tool-summary">{block.summary}</span>}
                </div>
              );
            }
            if (block.kind === 'approval') {
              if (resolved.has(block.id)) {
                return (
                  <div key={`approval-${block.id}`} className="app-status-line">
                    Approval resolved · {block.approvalKind}
                  </div>
                );
              }
              return (
                <ApprovalPrompt
                  key={`approval-${block.id}`}
                  id={block.id}
                  kind={block.approvalKind}
                  detail={block.detail}
                  onDecision={onApproval}
                />
              );
            }
            if (block.kind === 'usage') {
              return (
                <div
                  key={`usage-${index}`}
                  className="app-usage-row"
                  data-state={block.limitHit ? 'warn' : undefined}
                >
                  <Icon name="alert" size={12} />
                  <span>
                    {block.limitHit ? 'Subscription limit reported' : 'Usage reported'}
                    {block.note ? ` · ${block.note}` : ''}
                  </span>
                </div>
              );
            }
            if (block.kind === 'raw') {
              return (
                <details key={`raw-${index}`} className="app-raw">
                  <summary>
                    Raw output · {block.lines.length} line{block.lines.length === 1 ? '' : 's'}
                  </summary>
                  <pre>{block.lines.join('\n')}</pre>
                </details>
              );
            }
            if (block.kind === 'status') {
              if (!block.message) return null;
              return (
                <div key={`status-${index}`} className="app-status-line" data-state={block.state}>
                  {block.message}
                </div>
              );
            }
            if (block.kind === 'file-edits') {
              return (
                <div key="file-edits" className="app-edited-summary">
                  <div className="app-edited-head">
                    <strong>
                      Edited {block.files.length} file{block.files.length === 1 ? '' : 's'}
                    </strong>
                    <span className="os-diff-add">+{totalAdded}</span>
                    <span className="os-diff-remove">-{totalRemoved}</span>
                  </div>
                  <div className="app-edited-list">
                    {block.files.map((file) => (
                      <div
                        key={`${file.path}-${file.added}-${file.removed}`}
                        className="app-edited-row"
                      >
                        <span className="app-edited-path">{file.path}</span>
                        <span className="app-edited-delta">
                          <span className="os-diff-add-text">+{file.added}</span>{' '}
                          <span className="os-diff-remove-text">-{file.removed}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>

        {composer && <div className="app-session-composer">{composer}</div>}
      </div>
    </main>
  );
};
