import React from 'react';
import type { Capabilities, CliId } from '@osmium/core';
import { Button, CliBadge, Icon } from '@osmium/ui';

export interface CliHubEntry {
  id: CliId;
  installed: boolean;
  verified?: boolean;
  version?: string;
  path?: string;
  versionWarning?: string;
  capabilities?: Capabilities;
}

export interface CliTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface CliHubViewProps {
  entries: CliHubEntry[];
  loading: boolean;
  error?: string;
  testResults: Partial<Record<CliId, CliTestResult>>;
  onRefresh: () => void;
  onTest: (id: CliId) => void;
}

const CAPABILITY_ORDER: Array<[keyof Capabilities, string]> = [
  ['jsonStream', 'JSON stream'],
  ['resume', 'Resume'],
  ['readOnlyMode', 'Read-only'],
  ['reportsUsage', 'Usage'],
  ['acp', 'ACP'],
  ['approvals', 'Approvals'],
];

function capabilityLabels(capabilities?: Capabilities): string[] {
  if (!capabilities) return [];
  return CAPABILITY_ORDER.filter(([key]) => capabilities[key] === true).map(([, label]) => label);
}

export const CliHubView: React.FC<CliHubViewProps> = ({
  entries,
  loading,
  error,
  testResults,
  onRefresh,
  onTest,
}) => (
  <main data-testid="cli-hub" className="app-cli-hub">
    <div className="app-cli-hub-inner">
      <header className="app-cli-hub-head">
        <div>
          <h1 className="app-cli-hub-title">CLI Hub</h1>
          <p className="app-cli-hub-subtitle">
            Detected locally from PATH. Nothing is sent anywhere and no credential is read.
          </p>
        </div>
        <Button size="sm" data-testid="cli-hub-refresh" onClick={onRefresh} disabled={loading}>
          <Icon name="refresh" size={12} />
          {loading ? 'Checking…' : 'Refresh'}
        </Button>
      </header>

      {error && (
        <div data-testid="cli-hub-error" className="app-session-error" role="alert">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="app-cli-hub-list">
        {entries.map((entry) => {
          // Only adapters verified against a real CLI may advertise capability
          // flags; the others are detection-only in this build.
          const labels =
            entry.installed && entry.verified ? capabilityLabels(entry.capabilities) : [];
          const unverified = entry.installed && !entry.verified;
          const test = testResults[entry.id];
          return (
            <section
              key={entry.id}
              data-testid={`cli-hub-row-${entry.id}`}
              className="app-cli-hub-row"
              data-state={entry.installed ? 'installed' : 'missing'}
            >
              <div className="app-cli-hub-identity">
                <CliBadge cliId={entry.id} />
                <span className="app-cli-hub-status">
                  {entry.installed
                    ? `Installed${entry.version ? ` · ${entry.version}` : ''}`
                    : 'Not installed'}
                </span>
              </div>

              <div className="app-cli-hub-detail">
                {entry.path && <span className="app-cli-hub-path">{entry.path}</span>}
                {entry.versionWarning && (
                  <span className="app-cli-hub-warning">{entry.versionWarning}</span>
                )}
                <div className="app-cli-hub-caps">
                  {unverified ? (
                    <span className="app-cli-hub-none">
                      Detection only — adapter not verified in this build
                    </span>
                  ) : labels.length > 0 ? (
                    labels.map((label) => (
                      <span key={label} className="os-badge">
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="app-cli-hub-none">No capabilities verified</span>
                  )}
                </div>
                {test && (
                  <span className="app-cli-hub-test-result" data-state={test.ok ? 'ok' : 'error'}>
                    {test.ok ? 'Responded' : 'Failed'} in {test.latencyMs}ms · {test.message}
                  </span>
                )}
              </div>

              <div className="app-cli-hub-actions">
                <Button
                  size="sm"
                  data-testid={`cli-hub-test-${entry.id}`}
                  onClick={() => onTest(entry.id)}
                >
                  Test
                </Button>
              </div>
            </section>
          );
        })}
      </div>

      {entries.length === 0 && (
        <div className="app-cli-hub-empty">
          {loading ? 'Checking installed CLIs…' : 'No CLIs were reported by the adapter host.'}
        </div>
      )}
    </div>
  </main>
);
