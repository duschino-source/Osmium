import React, { useState } from 'react';
import type { ApprovalMode, CliId } from '@conductor/core';
import { getCliColor, getCliDisplayName } from '@conductor/adapters';

export interface CliBadgeProps {
  cliId: CliId;
  displayName?: string;
  roleLabel?: 'Primary' | 'Second' | string;
  onClick?: () => void;
  className?: string;
  'data-testid'?: string;
}

/**
 * Renders a CLI identity badge with a colored dot + CLI name.
 * Per Section 7: "A CLI is always shown as a colored dot plus its name, never by color alone."
 */
export const CliBadge: React.FC<CliBadgeProps> = ({
  cliId,
  displayName,
  roleLabel,
  onClick,
  className = '',
  'data-testid': testId,
}) => {
  const name = displayName ?? getCliDisplayName(cliId);
  const dotColor = getCliColor(cliId);
  const fullLabel = roleLabel ? `${name} · ${roleLabel}` : name;

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '5px 12px',
    borderRadius: 'var(--radius-pill, 9999px)',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-ink)',
    fontSize: '12.5px',
    fontWeight: 600,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
  };

  const dotStyle: React.CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: dotColor,
    flexShrink: 0,
    display: 'inline-block',
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={badgeStyle}
        className={`conductor-cli-badge ${className}`.trim()}
        data-testid={testId ?? `cli-badge-${cliId}`}
      >
        <span
          aria-hidden="true"
          className="conductor-cli-dot"
          data-cli-id={cliId}
          style={dotStyle}
        />
        <span className="conductor-cli-name">{fullLabel}</span>
      </button>
    );
  }

  return (
    <span
      style={badgeStyle}
      className={`conductor-cli-badge ${className}`.trim()}
      data-testid={testId ?? `cli-badge-${cliId}`}
    >
      <span aria-hidden="true" className="conductor-cli-dot" data-cli-id={cliId} style={dotStyle} />
      <span className="conductor-cli-name">{fullLabel}</span>
    </span>
  );
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'dashed';
  size?: 'sm' | 'md';
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'default',
  size = 'md',
  style,
  children,
  className = '',
  ...rest
}) => {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    borderRadius: variant === 'dashed' ? 'var(--radius-pill, 9999px)' : 'var(--radius-sm, 8px)',
    padding: size === 'sm' ? '4px 10px' : '6px 14px',
    fontSize: size === 'sm' ? '12px' : '13px',
    fontWeight: variant === 'primary' ? 600 : 500,
    lineHeight: 1.25,
    transition: 'background-color 120ms ease, border-color 120ms ease',
    backgroundColor:
      variant === 'primary'
        ? 'var(--accent-primary)'
        : variant === 'ghost' || variant === 'dashed'
          ? 'transparent'
          : 'var(--bg-surface)',
    color:
      variant === 'primary'
        ? 'var(--accent-primary-text, #FFFFFF)'
        : variant === 'dashed'
          ? 'var(--text-muted)'
          : 'var(--text-ink)',
    border:
      variant === 'primary'
        ? '1px solid var(--accent-primary)'
        : variant === 'dashed'
          ? '1px dashed var(--border-default)'
          : variant === 'ghost'
            ? '1px solid transparent'
            : '1px solid var(--border-default)',
    ...style,
  };

  return (
    <button
      type="button"
      style={baseStyle}
      className={`conductor-btn conductor-btn-${variant} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: string;
}

export const Card: React.FC<CardProps> = ({
  padding = '14px 16px',
  style,
  children,
  className = '',
  ...rest
}) => {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md, 12px)',
        padding,
        ...style,
      }}
      className={`conductor-card ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
};

export interface SlashCommandItem {
  command: string;
  description: string;
}

export const DEFAULT_SLASH_COMMANDS: SlashCommandItem[] = [
  { command: '/teamwork', description: 'Split this task across your CLIs' },
  { command: '/plan', description: 'Draft a plan first' },
  { command: '/review', description: 'Ask another CLI to review' },
  { command: '/cli', description: 'Switch active CLI for this session' },
  { command: '/undo', description: 'Restore previous git checkpoint' },
];

export interface SlashCommandMenuProps {
  query: string;
  commands?: SlashCommandItem[];
  selectedIndex?: number;
  onSelect: (command: string) => void;
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  query,
  commands = DEFAULT_SLASH_COMMANDS,
  selectedIndex = 0,
  onSelect,
}) => {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = commands.filter((item) =>
    item.command.toLowerCase().startsWith(normalizedQuery),
  );

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      data-testid="slash-command-menu"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md, 12px)',
        padding: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        width: '372px',
        maxWidth: '100%',
        boxShadow: '0 4px 16px rgba(27, 43, 34, 0.06)',
      }}
    >
      {filtered.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <button
            key={item.command}
            type="button"
            role="option"
            aria-selected={isSelected}
            data-testid={`slash-option-${item.command.slice(1)}`}
            onClick={() => onSelect(item.command)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              textAlign: 'left',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm, 8px)',
              border: 'none',
              backgroundColor: isSelected ? 'var(--bg-sidebar)' : 'transparent',
              color: 'var(--text-ink)',
              fontWeight: isSelected ? 600 : 400,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: isSelected ? 700 : 500,
              }}
            >
              {item.command}
            </span>
            <span>{item.description}</span>
          </button>
        );
      })}
    </div>
  );
};

export interface ContextChipProps {
  label: string;
  onRemove?: () => void;
}

export const ContextChip: React.FC<ContextChipProps> = ({ label, onRemove }) => {
  return (
    <span
      data-testid={`context-chip-${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 10px',
        borderRadius: 'var(--radius-pill, 9999px)',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        fontSize: '11.5px',
        fontWeight: 600,
        color: 'var(--text-ink)',
      }}
    >
      <span>{label.startsWith('@') ? label : `@${label}`}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          style={{
            border: 'none',
            background: 'transparent',
            padding: '0 2px',
            fontSize: '12px',
            color: 'var(--text-muted)',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
};

export interface ComposerProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  activeCliId?: CliId;
  activeCliRole?: string;
  approvalMode?: ApprovalMode;
  routingMode?: string;
  contextChips?: string[];
  onChange?: (value: string) => void;
  onSend?: (value: string) => void;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  onCliClick?: () => void;
  onAttachClick?: () => void;
  onRemoveChip?: (chip: string) => void;
}

const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  ask: 'Ask for approval',
  'auto-edit': 'Auto-edit',
  'full-auto': 'Full-auto',
};

export const Composer: React.FC<ComposerProps> = ({
  value: controlledValue,
  defaultValue = '',
  placeholder = 'Describe a task, or type / for /teamwork, /plan, /review',
  activeCliId = 'codex',
  activeCliRole = 'Primary',
  approvalMode = 'ask',
  routingMode = 'Auto',
  contextChips = [],
  onChange,
  onSend,
  onApprovalModeChange,
  onCliClick,
  onAttachClick,
  onRemoveChip,
}) => {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const text = controlledValue !== undefined ? controlledValue : internalValue;

  const updateText = (next: string) => {
    if (controlledValue === undefined) {
      setInternalValue(next);
    }
    onChange?.(next);
  };

  const showSlashMenu = text.trimStart().startsWith('/') && !text.trimStart().includes(' ');
  const cliName = getCliDisplayName(activeCliId);
  const cliButtonLabel = activeCliRole ? `${cliName} · ${activeCliRole}` : cliName;

  const cycleApprovalMode = () => {
    const order: ApprovalMode[] = ['ask', 'auto-edit', 'full-auto'];
    const next = order[(order.indexOf(approvalMode) + 1) % order.length];
    onApprovalModeChange?.(next);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend?.(trimmed);
    if (controlledValue === undefined) {
      setInternalValue('');
    }
  };

  return (
    <div
      className="conductor-composer-wrapper"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
      }}
    >
      {showSlashMenu && (
        <SlashCommandMenu query={text.trimStart()} onSelect={(cmd) => updateText(`${cmd} `)} />
      )}
      <div
        data-testid="composer-box"
        className="conductor-composer"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg, 14px)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {contextChips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {contextChips.map((chip) => (
              <ContextChip
                key={chip}
                label={chip}
                onRemove={onRemoveChip ? () => onRemoveChip(chip) : undefined}
              />
            ))}
          </div>
        )}
        <textarea
          aria-label="Task prompt"
          data-testid="composer-input"
          value={text}
          placeholder={placeholder}
          rows={2}
          onChange={(e) => updateText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          style={{
            width: '100%',
            border: 'none',
            resize: 'none',
            backgroundColor: 'transparent',
            color: 'var(--text-ink)',
            fontSize: '13.5px',
            lineHeight: 1.45,
            outline: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button
              aria-label="Add attachment or context"
              data-testid="composer-attach-btn"
              onClick={onAttachClick}
              style={{ width: '32px', height: '30px', padding: 0 }}
            >
              +
            </Button>
            <Button data-testid="composer-approval-btn" onClick={cycleApprovalMode}>
              {APPROVAL_LABELS[approvalMode]}
            </Button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button data-testid="composer-cli-btn" onClick={onCliClick}>
              {cliButtonLabel}
            </Button>
            <Button data-testid="composer-mode-btn">{routingMode}</Button>
            <Button variant="primary" data-testid="composer-send-btn" onClick={handleSend}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export interface EditedFileEntry {
  path: string;
  added: number;
  removed: number;
}

export interface EditedFilesCardProps {
  files: EditedFileEntry[];
  totalCount?: number;
  totalAdded?: number;
  totalRemoved?: number;
  onUndo?: () => void;
  onReview?: () => void;
}

export const EditedFilesCard: React.FC<EditedFilesCardProps> = ({
  files,
  totalCount,
  totalAdded,
  totalRemoved,
  onUndo,
  onReview,
}) => {
  const count = totalCount ?? files.length;
  const added = totalAdded ?? files.reduce((sum, f) => sum + f.added, 0);
  const removed = totalRemoved ?? files.reduce((sum, f) => sum + f.removed, 0);

  return (
    <Card data-testid="edited-files-card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong style={{ color: 'var(--text-ink)' }}>
            Edited {count} {count === 1 ? 'file' : 'files'}
          </strong>
          <span
            data-testid="edited-files-added"
            style={{ color: 'var(--text-diff-add)', fontWeight: 600 }}
          >
            +{added}
          </span>
          {removed > 0 && (
            <span
              data-testid="edited-files-removed"
              style={{ color: 'var(--text-diff-remove)', fontWeight: 600 }}
            >
              -{removed}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button size="sm" data-testid="edited-files-undo-btn" onClick={onUndo}>
            Undo
          </Button>
          <Button size="sm" data-testid="edited-files-review-btn" onClick={onReview}>
            Review
          </Button>
        </div>
      </div>
      {files.length > 0 && (
        <div
          style={{
            marginTop: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-muted)',
          }}
        >
          {files.map((f) => (
            <div key={f.path}>
              <span>{f.path}</span> <span>+{f.added}</span>
              {f.removed > 0 ? <span> -{f.removed}</span> : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export interface ApprovalPromptProps {
  id: string;
  kind: 'command' | 'edit' | 'network';
  detail: string;
  onDecision: (id: string, allow: boolean, scope: 'once' | 'session') => void;
}

export const ApprovalPrompt: React.FC<ApprovalPromptProps> = ({ id, kind, detail, onDecision }) => {
  return (
    <Card data-testid={`approval-prompt-${id}`}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ color: 'var(--text-ink)' }}>Approval required ({kind})</strong>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--text-muted)',
            }}
          >
            {detail}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button
            variant="primary"
            size="sm"
            data-testid="approval-allow-btn"
            onClick={() => onDecision(id, true, 'once')}
          >
            Allow
          </Button>
          <Button
            size="sm"
            data-testid="approval-deny-btn"
            onClick={() => onDecision(id, false, 'once')}
          >
            Deny
          </Button>
          <Button
            size="sm"
            data-testid="approval-allow-session-btn"
            onClick={() => onDecision(id, true, 'session')}
          >
            Allow for this session
          </Button>
        </div>
      </div>
    </Card>
  );
};
