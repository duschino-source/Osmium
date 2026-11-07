import React, { useEffect, useState } from 'react';
import type { ApprovalMode, CliId } from '@osmium/core';
import { getCliColor } from '@osmium/adapters';
import { Button, CliBadge, Composer } from '@osmium/ui';

export interface SidebarProjectItem {
  id: string;
  name: string;
  primaryCli: CliId;
}

const INITIAL_PROJECTS: SidebarProjectItem[] = [
  { id: 'api-gateway', name: 'api-gateway', primaryCli: 'codex' },
  { id: 'landing-site', name: 'landing-site', primaryCli: 'antigravity' },
  { id: 'cli-playground', name: 'cli-playground', primaryCli: 'deepseek' },
];

const RECENT_SESSIONS: string[] = ['Add copy review brief', 'Fix auth redirect'];

const PRIMARY_NAV_ITEMS = ['New Task', 'Projects', 'Teamwork', 'Search'] as const;
const FOOTER_NAV_ITEMS = ['CLI Hub', 'Automations', 'Extensions'] as const;

export const App: React.FC = () => {
  const [topMode, setTopMode] = useState<'code' | 'chat'>('code');
  const [activeNav, setActiveNav] = useState<string>('New Task');
  const [promptText, setPromptText] = useState<string>('');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('ask');
  const [activeCliId, setActiveCliId] = useState<CliId>('codex');
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const cycleCli = () => {
    const order: CliId[] = ['codex', 'antigravity', 'deepseek'];
    const next = order[(order.indexOf(activeCliId) + 1) % order.length];
    setActiveCliId(next);
  };

  return (
    <div
      data-testid="app-shell"
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        backgroundColor: 'var(--bg-ground)',
        color: 'var(--text-ink)',
        overflow: 'hidden',
      }}
    >
      {/* Left Navigation Sidebar (216px) */}
      <aside
        aria-label="Primary Sidebar"
        data-testid="app-sidebar"
        style={{
          width: 'var(--sidebar-width, 216px)',
          minWidth: 'var(--sidebar-width, 216px)',
          maxWidth: 'var(--sidebar-width, 216px)',
          height: '100%',
          backgroundColor: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '14px 12px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Code / Chat Top Switcher */}
          <div
            role="group"
            aria-label="Workspace mode"
            data-testid="mode-switcher"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {(['code', 'chat'] as const).map((mode) => {
              const isActive = topMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  data-testid={`mode-btn-${mode}`}
                  aria-pressed={isActive}
                  onClick={() => setTopMode(mode)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-pill, 9999px)',
                    backgroundColor: isActive ? 'var(--bg-surface)' : 'transparent',
                    border: isActive ? '1px solid var(--border-default)' : '1px solid transparent',
                    fontWeight: 600,
                    fontSize: '12.5px',
                    color: isActive ? 'var(--text-ink)' : 'var(--text-muted)',
                  }}
                >
                  {mode === 'code' ? 'Code' : 'Chat'}
                </button>
              );
            })}
          </div>

          {/* Primary Navigation Items */}
          <nav
            aria-label="Main navigation"
            style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
          >
            {PRIMARY_NAV_ITEMS.map((item) => {
              const isActive = activeNav === item;
              return (
                <button
                  key={item}
                  type="button"
                  data-testid={`nav-item-${item.toLowerCase().replace(/\s+/g, '-')}`}
                  onClick={() => setActiveNav(item)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm, 8px)',
                    border: 'none',
                    backgroundColor: isActive ? 'var(--bg-surface)' : 'transparent',
                    color: 'var(--text-ink)',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: '13.5px',
                  }}
                >
                  {item}
                </button>
              );
            })}
          </nav>

          {/* PROJECTS Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
                padding: '0 8px',
              }}
            >
              PROJECTS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {INITIAL_PROJECTS.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  data-testid={`sidebar-project-${proj.id}`}
                  onClick={() => setActiveNav(`project:${proj.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm, 8px)',
                    border: 'none',
                    backgroundColor:
                      activeNav === `project:${proj.id}` ? 'var(--bg-surface)' : 'transparent',
                    color: 'var(--text-ink)',
                    fontSize: '13px',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="osmium-project-dot"
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: getCliColor(proj.primaryCli),
                      flexShrink: 0,
                    }}
                  />
                  <span>{proj.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* RECENT Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
                padding: '0 8px',
              }}
            >
              RECENT
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {RECENT_SESSIONS.map((title) => (
                <button
                  key={title}
                  type="button"
                  data-testid={`sidebar-recent-${title.toLowerCase().replace(/\s+/g, '-')}`}
                  onClick={() => setActiveNav(`recent:${title}`)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm, 8px)',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {title}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Navigation */}
        <div
          aria-label="Footer navigation"
          style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}
        >
          {FOOTER_NAV_ITEMS.map((item) => (
            <button
              key={item}
              type="button"
              data-testid={`footer-item-${item.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => setActiveNav(item)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '7px 8px',
                borderRadius: 'var(--radius-sm, 8px)',
                border: 'none',
                backgroundColor: activeNav === item ? 'var(--bg-surface)' : 'transparent',
                color: 'var(--text-ink)',
                fontWeight: activeNav === item ? 600 : 400,
                fontSize: '13px',
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </aside>

      {/* Main Content Area (#F6F8F5) */}
      <main
        data-testid="app-main"
        style={{
          flex: 1,
          height: '100%',
          backgroundColor: 'var(--bg-ground)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 24px',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '656px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <h1
            data-testid="home-headline"
            style={{
              margin: 0,
              fontSize: 'var(--font-size-heading-lg, 30px)',
              fontWeight: 700,
              color: 'var(--text-ink)',
              textAlign: 'center',
              letterSpacing: '-0.02em',
            }}
          >
            What are we building?
          </h1>

          <p
            data-testid="home-subtitle"
            style={{
              margin: '8px 0 0 0',
              fontSize: '14.5px',
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            Connect the coding CLIs you already use. CLI detection arrives in Phase 1.
          </p>

          {/* CLI Status Chips Row */}
          <div
            data-testid="cli-status-row"
            style={{
              marginTop: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <CliBadge
              cliId="codex"
              roleLabel="Primary"
              data-testid="status-chip-codex"
              onClick={() => setActiveCliId('codex')}
            />
            <CliBadge
              cliId="antigravity"
              roleLabel="Second"
              data-testid="status-chip-antigravity"
              onClick={() => setActiveCliId('antigravity')}
            />
            <CliBadge
              cliId="deepseek"
              data-testid="status-chip-deepseek"
              onClick={() => setActiveCliId('deepseek')}
            />
            <Button
              variant="dashed"
              data-testid="connect-cli-chip"
              onClick={() => setActiveNav('CLI Hub')}
            >
              + Connect CLI
            </Button>
          </div>

          {/* Large Composer */}
          <div style={{ marginTop: '22px', width: '100%' }}>
            <Composer
              value={promptText}
              onChange={setPromptText}
              activeCliId={activeCliId}
              activeCliRole={
                activeCliId === 'codex'
                  ? 'Primary'
                  : activeCliId === 'antigravity'
                    ? 'Second'
                    : undefined
              }
              approvalMode={approvalMode}
              onApprovalModeChange={setApprovalMode}
              onCliClick={cycleCli}
              onSend={() => {
                setPromptText('');
              }}
            />
          </div>

          {/* Three Quick-Start Action Buttons */}
          <div
            data-testid="quick-start-row"
            style={{
              marginTop: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <Button data-testid="quick-start-review" onClick={() => setPromptText('/review ')}>
              Review this repo
            </Button>
            <Button data-testid="quick-start-plan" onClick={() => setPromptText('/plan ')}>
              Plan a feature with /plan
            </Button>
            <Button data-testid="quick-start-teamwork" onClick={() => setPromptText('/teamwork ')}>
              Split work with /teamwork
            </Button>
          </div>
        </div>
      </main>

      {/* Command Palette Modal (Ctrl/Cmd + K) */}
      {paletteOpen && (
        <div
          role="dialog"
          aria-label="Command Palette"
          data-testid="command-palette-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(27, 43, 34, 0.25)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '80px',
            zIndex: 1000,
          }}
          onClick={() => setPaletteOpen(false)}
        >
          <div
            style={{
              width: '480px',
              maxWidth: '90vw',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md, 12px)',
              padding: '12px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              placeholder="Type a command..."
              aria-label="Command Palette Input"
              autoFocus
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm, 8px)',
                border: '1px solid var(--border-default)',
                backgroundColor: 'var(--bg-ground)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
