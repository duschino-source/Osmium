import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type { ApprovalMode, CliId } from '@osmium/core';
import { getCliCssVariable, getCliDisplayName } from '@osmium/adapters';
import { Icon } from './ide/Icon.js';

export { Icon } from './ide/Icon.js';
export type { IconName } from './ide/Icon.js';

/* ----------------------------------------------------------------------------
 * CliBadge
 * "A CLI is always shown as a colored dot plus its name, never by color alone."
 * -------------------------------------------------------------------------- */

export interface CliBadgeProps {
  cliId: CliId;
  displayName?: string;
  roleLabel?: 'Primary' | 'Second' | string;
  onClick?: () => void;
  className?: string;
  'data-testid'?: string;
}

export const CliBadge: React.FC<CliBadgeProps> = ({
  cliId,
  displayName,
  roleLabel,
  onClick,
  className = '',
  'data-testid': testId,
}) => {
  const name = displayName ?? getCliDisplayName(cliId);
  const fullLabel = roleLabel ? `${name} · ${roleLabel}` : name;
  const content = (
    <>
      <span
        aria-hidden="true"
        className="osmium-cli-dot os-dot"
        data-cli-id={cliId}
        style={{ backgroundColor: getCliCssVariable(cliId) }}
      />
      <span className="osmium-cli-name">{fullLabel}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`osmium-cli-badge os-badge os-badge-button ${className}`.trim()}
        data-testid={testId ?? `cli-badge-${cliId}`}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={`osmium-cli-badge os-badge ${className}`.trim()}
      data-testid={testId ?? `cli-badge-${cliId}`}
    >
      {content}
    </span>
  );
};

/* ----------------------------------------------------------------------------
 * Button
 * -------------------------------------------------------------------------- */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'dashed';
  size?: 'sm' | 'md';
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'default',
  size = 'md',
  children,
  className = '',
  ...rest
}) => (
  <button
    type="button"
    className={`os-btn os-btn-${variant} os-btn-${size} ${className}`.trim()}
    {...rest}
  >
    {children}
  </button>
);

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: string;
}

export const Card: React.FC<CardProps> = ({
  padding,
  style,
  children,
  className = '',
  ...rest
}) => (
  <div
    className={`os-card ${className}`.trim()}
    style={padding ? { padding, ...style } : style}
    {...rest}
  >
    {children}
  </div>
);

/* ----------------------------------------------------------------------------
 * Slash commands
 * -------------------------------------------------------------------------- */

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

export const filterSlashCommands = (
  query: string,
  commands: SlashCommandItem[] = DEFAULT_SLASH_COMMANDS,
): SlashCommandItem[] => {
  const normalized = query.trim().toLowerCase();
  return commands.filter((item) => item.command.toLowerCase().startsWith(normalized));
};

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
  const filtered = filterSlashCommands(query, commands);
  if (filtered.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      data-testid="slash-command-menu"
      className="os-menu os-slash-menu osmium-animate-dropdown"
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
            data-active={isSelected || undefined}
            className="os-menu-item"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item.command)}
          >
            <span className="os-slash-command">{item.command}</span>
            <span className="os-menu-description">{item.description}</span>
          </button>
        );
      })}
    </div>
  );
};

/* ----------------------------------------------------------------------------
 * ContextChip
 * -------------------------------------------------------------------------- */

export interface ContextChipProps {
  label: string;
  onRemove?: () => void;
}

export const ContextChip: React.FC<ContextChipProps> = ({ label, onRemove }) => (
  <span data-testid={`context-chip-${label}`} className="os-chip osmium-animate-fade">
    <span>{label.startsWith('@') ? label : `@${label}`}</span>
    {onRemove && (
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="os-chip-remove"
      >
        <Icon name="x" size={10} strokeWidth={2} />
      </button>
    )}
  </span>
);

/* ----------------------------------------------------------------------------
 * DropdownMenu
 * -------------------------------------------------------------------------- */

export interface DropdownItem<T = string> {
  key: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  dotColor?: string;
  /** Right-aligned hint, typically a keyboard shortcut. */
  badge?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface DropdownMenuProps<T = string> {
  isOpen: boolean;
  onClose: () => void;
  items: DropdownItem<T>[];
  selectedKey?: T;
  onSelect: (key: T) => void;
  style?: React.CSSProperties;
  align?: 'left' | 'right';
  placement?: 'top' | 'bottom';
  title?: string;
  'data-testid'?: string;
}

export const DropdownMenu = <T extends string = string>({
  isOpen,
  onClose,
  items,
  selectedKey,
  onSelect,
  style,
  align = 'left',
  placement = 'top',
  title,
  'data-testid': testId,
}: DropdownMenuProps<T>) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const menu = menuRef.current;
      if (!menu) return;
      const target = e.target as Node;
      // The trigger lives in the same wrapper; it toggles the menu itself.
      if (menu.contains(target) || menu.parentElement?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useLayoutEffect(() => {
    if (isOpen) menuRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  if (!isOpen) return null;

  const hasSelection = selectedKey !== undefined;

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (enabled.length === 0) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % enabled.length;
    else if (e.key === 'ArrowUp') next = current <= 0 ? enabled.length - 1 : current - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next >= 0) {
      e.preventDefault();
      enabled[next]?.focus();
    }
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      data-testid={testId || 'dropdown-menu'}
      data-placement={placement}
      className="os-menu os-dropdown osmium-animate-dropdown"
      onKeyDown={onMenuKeyDown}
      style={{
        ...(placement === 'bottom' ? { top: 'calc(100% + 4px)' } : { bottom: 'calc(100% + 6px)' }),
        ...(align === 'left' ? { left: 0 } : { right: 0 }),
        ...style,
      }}
    >
      {title && <div className="os-menu-title">{title}</div>}
      {items.map((item) => {
        const isSelected = selectedKey === item.key;
        return (
          <React.Fragment key={item.key}>
            {item.separatorBefore && <div className="os-menu-separator" role="separator" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              data-testid={`dropdown-item-${item.key}`}
              data-selected={isSelected || undefined}
              className="os-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(item.key);
                onClose();
              }}
            >
              {hasSelection && (
                <span className="os-menu-check" aria-hidden="true">
                  {isSelected && <Icon name="check" size={13} strokeWidth={2} />}
                </span>
              )}
              {item.dotColor && (
                <span
                  className="os-dot"
                  style={{ backgroundColor: item.dotColor, borderRadius: '50%' }}
                  aria-hidden="true"
                />
              )}
              {item.icon && <span className="os-menu-icon">{item.icon}</span>}
              <span className="os-menu-body">
                <span className="os-menu-label">{item.label}</span>
                {item.description && (
                  <span className="os-menu-description">{item.description}</span>
                )}
              </span>
              {item.badge && <span className="os-menu-shortcut">{item.badge}</span>}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

/* ----------------------------------------------------------------------------
 * Composer
 * -------------------------------------------------------------------------- */

export interface ComposerProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  activeCliId?: CliId;
  activeCliRole?: string;
  approvalMode?: ApprovalMode;
  routingMode?: string;
  contextChips?: string[];
  compact?: boolean;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onSend?: (value: string) => void;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  onCliChange?: (cliId: CliId) => void;
  onCliClick?: () => void;
  onRoutingModeChange?: (mode: string) => void;
  onAttachClick?: () => void;
  onAttachAction?: (action: 'file' | 'folder' | 'git' | 'clear') => void;
  onRemoveChip?: (chip: string) => void;
}

const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  ask: 'Ask for approval',
  'auto-edit': 'Auto-edit',
  'full-auto': 'Full-auto',
};

/** Semantic state tokens: how much the CLI may do without asking. */
export const APPROVAL_DOT_COLORS: Record<ApprovalMode, string> = {
  ask: 'var(--state-ok)',
  'auto-edit': 'var(--state-warn)',
  'full-auto': 'var(--state-error)',
};

const PopupChevron: React.FC = () => (
  <Icon name="chevronUpDown" size={11} strokeWidth={2} className="os-popup-chevron" />
);

export const Composer: React.FC<ComposerProps> = ({
  value: controlledValue,
  defaultValue = '',
  placeholder = 'Describe a task, or type / for /teamwork, /plan, /review',
  activeCliId = 'codex',
  activeCliRole = 'Primary',
  approvalMode = 'ask',
  routingMode = 'Auto',
  contextChips = [],
  compact = false,
  disabled = false,
  onChange,
  onSend,
  onApprovalModeChange,
  onCliChange,
  onCliClick,
  onRoutingModeChange,
  onAttachClick,
  onAttachAction,
  onRemoveChip,
}) => {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [openMenu, setOpenMenu] = useState<'cli' | 'approval' | 'routing' | 'attach' | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const text = controlledValue !== undefined ? controlledValue : internalValue;

  const updateText = (next: string) => {
    if (controlledValue === undefined) setInternalValue(next);
    onChange?.(next);
    setSlashIndex(0);
  };

  const trimmedStart = text.trimStart();
  const showSlashMenu = trimmedStart.startsWith('/') && !trimmedStart.includes(' ');
  const slashMatches = showSlashMenu ? filterSlashCommands(trimmedStart) : [];
  const cliName = getCliDisplayName(activeCliId);
  const cliButtonLabel = activeCliRole ? `${cliName} · ${activeCliRole}` : cliName;
  const canSend = text.trim().length > 0 && !disabled;

  // Grow with content up to ~8 lines, then scroll. Home mounts this composer
  // while it is display:none in Code mode; a hidden textarea reports
  // scrollHeight 0, so never write a 0px height (the CSS rows=2 default is
  // correct until the surface is visible and text changes).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, 8 * 20);
    if (nextHeight > 0) el.style.height = `${nextHeight}px`;
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend?.(trimmed);
    if (controlledValue === undefined) setInternalValue('');
  };

  const toggleMenu = (menu: 'cli' | 'approval' | 'routing' | 'attach') =>
    setOpenMenu((current) => (current === menu ? null : menu));

  return (
    <div className="os-composer-wrap osmium-composer-wrapper">
      {showSlashMenu && slashMatches.length > 0 && (
        <SlashCommandMenu
          query={trimmedStart}
          selectedIndex={Math.min(slashIndex, slashMatches.length - 1)}
          onSelect={(cmd) => {
            updateText(`${cmd} `);
            inputRef.current?.focus();
          }}
        />
      )}
      <div
        data-testid="composer-box"
        className="os-composer osmium-composer"
        data-compact={compact || undefined}
      >
        {contextChips.length > 0 && (
          <div className="os-composer-chips">
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
          ref={inputRef}
          aria-label="Task prompt"
          data-testid="composer-input"
          className="os-composer-input"
          value={text}
          placeholder={placeholder}
          rows={compact ? 1 : 2}
          onChange={(e) => updateText(e.target.value)}
          onKeyDown={(e) => {
            if (showSlashMenu && slashMatches.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashIndex((i) => (i + 1) % slashMatches.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                const pick = slashMatches[Math.min(slashIndex, slashMatches.length - 1)];
                if (pick) updateText(`${pick.command} `);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <div className="os-composer-bar">
          <div className="os-composer-group">
            <div className="os-anchor">
              <button
                type="button"
                aria-label="Add attachment or context"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'attach'}
                data-testid="composer-attach-btn"
                className="os-icon-btn"
                onClick={() => {
                  toggleMenu('attach');
                  onAttachClick?.();
                }}
              >
                <Icon name="plus" size={15} strokeWidth={1.8} />
              </button>
              <DropdownMenu<string>
                isOpen={openMenu === 'attach'}
                onClose={() => setOpenMenu(null)}
                title="Attach context"
                align="left"
                items={[
                  {
                    key: 'file',
                    label: 'Add File',
                    description: 'Attach file contents to prompt',
                    icon: <Icon name="file" size={15} />,
                  },
                  {
                    key: 'folder',
                    label: 'Add Folder',
                    description: 'Attach directory tree snapshot',
                    icon: <Icon name="folder" size={15} />,
                  },
                  {
                    key: 'git',
                    label: 'Git Diff',
                    description: 'Include working tree diff',
                    icon: <Icon name="branch" size={15} />,
                  },
                  {
                    key: 'clear',
                    label: 'Clear Context',
                    description: 'Remove all active chips',
                    icon: <Icon name="x" size={15} />,
                    separatorBefore: true,
                  },
                ]}
                onSelect={(action) => {
                  if (
                    action === 'file' ||
                    action === 'folder' ||
                    action === 'git' ||
                    action === 'clear'
                  ) {
                    onAttachAction?.(action);
                  }
                }}
              />
            </div>

            <div className="os-anchor">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'approval'}
                data-testid="composer-approval-btn"
                className="os-popup-btn"
                onClick={() => toggleMenu('approval')}
              >
                <span
                  className="osmium-approval-dot os-dot"
                  style={{ backgroundColor: APPROVAL_DOT_COLORS[approvalMode] }}
                />
                <span>{APPROVAL_LABELS[approvalMode]}</span>
                <PopupChevron />
              </button>
              <DropdownMenu<ApprovalMode>
                isOpen={openMenu === 'approval'}
                onClose={() => setOpenMenu(null)}
                title="Approval policy"
                selectedKey={approvalMode}
                align="left"
                items={[
                  {
                    key: 'ask',
                    label: 'Ask for approval',
                    description: 'Confirm before writing files or running terminal commands',
                    dotColor: APPROVAL_DOT_COLORS['ask'],
                  },
                  {
                    key: 'auto-edit',
                    label: 'Auto-edit files',
                    description: 'Auto-apply file diffs, prompt for terminal commands',
                    dotColor: APPROVAL_DOT_COLORS['auto-edit'],
                  },
                  {
                    key: 'full-auto',
                    label: 'Full-auto',
                    description: 'Run completely autonomously without approval prompts',
                    dotColor: APPROVAL_DOT_COLORS['full-auto'],
                  },
                ]}
                onSelect={(mode) => onApprovalModeChange?.(mode)}
              />
            </div>
          </div>

          <div className="os-composer-group">
            <div className="os-anchor">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'cli'}
                data-testid="composer-cli-btn"
                className="os-popup-btn"
                onClick={() => {
                  toggleMenu('cli');
                  onCliClick?.();
                }}
              >
                <span
                  className="osmium-cli-dot os-dot"
                  style={{ backgroundColor: getCliCssVariable(activeCliId) }}
                />
                <span>{cliButtonLabel}</span>
                <PopupChevron />
              </button>
              <DropdownMenu<CliId>
                isOpen={openMenu === 'cli'}
                onClose={() => setOpenMenu(null)}
                title="Active coding CLI"
                selectedKey={activeCliId}
                align="right"
                items={[
                  {
                    key: 'codex',
                    label: 'Codex CLI',
                    description: 'OpenAI official terminal agent',
                    dotColor: getCliCssVariable('codex'),
                  },
                  {
                    key: 'antigravity',
                    label: 'Antigravity',
                    description: 'Google DeepMind advanced coding CLI',
                    dotColor: getCliCssVariable('antigravity'),
                  },
                  {
                    key: 'deepseek',
                    label: 'DeepSeek CLI',
                    description: 'DeepSeek reasoning & architecture CLI',
                    dotColor: getCliCssVariable('deepseek'),
                  },
                  {
                    key: 'mock',
                    label: 'Mock CLI',
                    description: 'Deterministic local test engine',
                    dotColor: getCliCssVariable('mock'),
                  },
                ]}
                onSelect={(cli) => onCliChange?.(cli)}
              />
            </div>

            <div className="os-anchor">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'routing'}
                data-testid="composer-mode-btn"
                className="os-popup-btn"
                onClick={() => toggleMenu('routing')}
              >
                <span>{routingMode}</span>
                <PopupChevron />
              </button>
              <DropdownMenu<string>
                isOpen={openMenu === 'routing'}
                onClose={() => setOpenMenu(null)}
                title="Routing"
                selectedKey={routingMode}
                align="right"
                items={[
                  {
                    key: 'Auto',
                    label: 'Auto-Route',
                    description: 'Smart fallback on quota limits or execution errors',
                  },
                  {
                    key: 'Pinned',
                    label: 'Pin CLI',
                    description: 'Lock to selected CLI with zero automatic fallback',
                  },
                  {
                    key: 'Teamwork',
                    label: 'Teamwork DAG',
                    description: 'Decompose goal across all active CLIs in parallel',
                  },
                ]}
                onSelect={(mode) => onRoutingModeChange?.(mode)}
              />
            </div>

            <button
              type="button"
              aria-label="Send"
              title="Send (Return)"
              data-testid="composer-send-btn"
              className="os-send-btn"
              disabled={!canSend}
              onClick={handleSend}
            >
              <Icon name="arrowUp" size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------------------
 * EditedFilesCard
 * -------------------------------------------------------------------------- */

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
  const added = totalAdded ?? files.reduce((acc, f) => acc + f.added, 0);
  const removed = totalRemoved ?? files.reduce((acc, f) => acc + f.removed, 0);

  return (
    <Card data-testid="edited-files-card" className="os-edited-card">
      <div className="os-edited-head">
        <div className="os-edited-title">
          <strong>Edited {count} files</strong>
          <span data-testid="edited-files-added" className="os-diff-stat os-diff-add">
            +{added}
          </span>
          <span data-testid="edited-files-removed" className="os-diff-stat os-diff-remove">
            -{removed}
          </span>
        </div>
        <div className="os-edited-actions">
          <Button size="sm" data-testid="edited-files-undo-btn" onClick={onUndo}>
            Undo
          </Button>
          <Button
            size="sm"
            variant="primary"
            data-testid="edited-files-review-btn"
            onClick={onReview}
          >
            Review
          </Button>
        </div>
      </div>
      <div className="os-edited-list">
        {files.map((file) => (
          <div key={file.path} className="os-edited-row">
            <span className="os-edited-path">{file.path}</span>
            <span className="os-edited-delta">
              <span className="os-diff-add-text">+{file.added}</span>{' '}
              <span className="os-diff-remove-text">-{file.removed}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};

/* ----------------------------------------------------------------------------
 * ApprovalPrompt
 * -------------------------------------------------------------------------- */

export interface ApprovalPromptProps {
  id: string;
  kind: 'command' | 'edit' | 'network';
  detail: string;
  onDecision: (id: string, allow: boolean, scope: 'once' | 'session') => void;
}

export const ApprovalPrompt: React.FC<ApprovalPromptProps> = ({ id, kind, detail, onDecision }) => (
  <Card data-testid={`approval-prompt-${id}`} className="os-approval">
    <div className="os-approval-head">
      <strong>Approval required ({kind})</strong>
      <span className="os-approval-id">{id}</span>
    </div>
    <div className="os-approval-detail">{detail}</div>
    <div className="os-approval-actions">
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
  </Card>
);
