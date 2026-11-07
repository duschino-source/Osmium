import { describe, it, expect } from 'vitest';
import {
  ProjectConfigSchema,
  parseProjectConfigYaml,
  stringifyProjectConfigYaml,
  TeamworkPlanSchema,
  ExtensionManifestSchema,
  isPathInsideWorkspace,
  assertWorkspaceWriteAllowed,
} from '../index.js';

describe('@osmium/core schemas & boundary guards', () => {
  it('validates a canonical .osmium/project.yaml configuration', () => {
    const sampleYaml = `
version: 1
name: api-gateway
primary: codex
secondary: [antigravity, deepseek]
approvalMode: ask
routing:
  - when: planning
    cli: codex
  - when: browser-check
    cli: antigravity
  - when: tests
    cli: deepseek
fallback:
  onQuotaHit: next-secondary
teamwork:
  maxParallel: 2
  integrationBranch: osmium/integration
`;
    const parsed = parseProjectConfigYaml(sampleYaml);
    expect(parsed.version).toBe(1);
    expect(parsed.name).toBe('api-gateway');
    expect(parsed.primary).toBe('codex');
    expect(parsed.secondary).toEqual(['antigravity', 'deepseek']);
    expect(parsed.approvalMode).toBe('ask');
    expect(parsed.routing).toHaveLength(3);
    expect(parsed.fallback.onQuotaHit).toBe('next-secondary');
    expect(parsed.teamwork.maxParallel).toBe(2);
    expect(parsed.teamwork.integrationBranch).toBe('osmium/integration');
  });

  it('preserves unknown YAML keys at root and nested object levels on parse and stringify', () => {
    const yamlWithUnknowns = `
version: 1
name: api-gateway
primary: codex
customRootField: keep-me
experimentalFlags:
  featureA: true
routing:
  - when: planning
    cli: codex
    priority: 10
fallback:
  onQuotaHit: next-secondary
  notifySlack: false
teamwork:
  maxParallel: 3
  integrationBranch: osmium/integration
  customWorktreePrefix: task-wt
`;
    const parsed = parseProjectConfigYaml(yamlWithUnknowns) as Record<string, any>;
    expect(parsed.customRootField).toBe('keep-me');
    expect(parsed.experimentalFlags).toEqual({ featureA: true });
    expect(parsed.routing[0].priority).toBe(10);
    expect(parsed.fallback.notifySlack).toBe(false);
    expect(parsed.teamwork.customWorktreePrefix).toBe('task-wt');

    // Update a known field via UI and stringify back while preserving unknown keys
    const updatedYaml = stringifyProjectConfigYaml(
      {
        ...parsed,
        approvalMode: 'auto-edit',
        teamwork: {
          ...parsed.teamwork,
          maxParallel: 4,
        },
      },
      yamlWithUnknowns,
    );

    const reparsed = parseProjectConfigYaml(updatedYaml) as Record<string, any>;
    expect(reparsed.approvalMode).toBe('auto-edit');
    expect(reparsed.teamwork.maxParallel).toBe(4);
    expect(reparsed.customRootField).toBe('keep-me');
    expect(reparsed.experimentalFlags).toEqual({ featureA: true });
    expect(reparsed.routing[0].priority).toBe(10);
    expect(reparsed.fallback.notifySlack).toBe(false);
    expect(reparsed.teamwork.customWorktreePrefix).toBe('task-wt');
  });

  it('rejects invalid project.yaml configurations', () => {
    expect(() =>
      ProjectConfigSchema.parse({
        version: 2,
        name: '',
      }),
    ).toThrow();
  });

  it('validates TeamworkPlanSchema and ExtensionManifestSchema', () => {
    const plan = TeamworkPlanSchema.parse({
      goal: 'Add copy review brief',
      tasks: [
        {
          id: 'task-1',
          title: 'Markdown brief builder',
          scope: ['src/lib/brief.ts'],
          dependencies: [],
          taskType: 'implementation',
          assignedCli: 'codex',
        },
      ],
    });
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].title).toBe('Markdown brief builder');

    const manifest = ExtensionManifestSchema.parse({
      name: 'forest-theme',
      version: '1.0.0',
      displayName: 'Forest Theme',
      permissions: ['webview'],
      contributes: {
        themes: [
          {
            id: 'forest-dark',
            label: 'Forest Dark',
            uiTheme: 'dark',
            path: './themes/forest-dark.json',
          },
        ],
      },
    });
    expect(manifest.name).toBe('forest-theme');
    expect(manifest.contributes.themes?.[0].uiTheme).toBe('dark');
  });

  it('enforces workspace write boundary rules (Section 2.5)', () => {
    const root = '/tmp/osmium-project';
    expect(isPathInsideWorkspace(root, 'src/index.ts')).toBe(true);
    expect(isPathInsideWorkspace(root, '.osmium/worktrees/task-1/file.ts')).toBe(true);
    expect(isPathInsideWorkspace(root, '../outside.txt')).toBe(false);
    expect(isPathInsideWorkspace(root, '/etc/passwd')).toBe(false);

    expect(() => assertWorkspaceWriteAllowed(root, '../escape.ts')).toThrow(
      /Workspace boundary violation/,
    );
  });
});
