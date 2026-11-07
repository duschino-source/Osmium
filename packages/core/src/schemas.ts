import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import YAML from 'yaml';

export const RoutingRuleSchema = z
  .object({
    when: z.enum(['planning', 'browser-check', 'tests']).or(z.string().min(1)),
    cli: z.string().min(1),
  })
  .passthrough();

export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

export const FallbackConfigSchema = z
  .object({
    onQuotaHit: z.enum(['next-secondary', 'ask', 'stop']).default('next-secondary'),
  })
  .passthrough();

export const TeamworkConfigSchema = z
  .object({
    maxParallel: z.number().int().positive().default(2),
    integrationBranch: z.string().min(1).default('conductor/integration'),
  })
  .passthrough();

export const ProjectConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1),
    primary: z.string().min(1).default('codex'),
    secondary: z.array(z.string().min(1)).default(['antigravity', 'deepseek']),
    approvalMode: z.enum(['ask', 'auto-edit', 'full-auto']).default('ask'),
    routing: z.array(RoutingRuleSchema).default([]),
    fallback: FallbackConfigSchema.default({ onQuotaHit: 'next-secondary' }),
    teamwork: TeamworkConfigSchema.default({
      maxParallel: 2,
      integrationBranch: 'conductor/integration',
    }),
  })
  .passthrough();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMergePreservingUnknown(
  base: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(updates)) {
    if (isPlainObject(val) && isPlainObject(result[key])) {
      result[key] = deepMergePreservingUnknown(result[key] as Record<string, unknown>, val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Parses and validates `.conductor/project.yaml` content using ProjectConfigSchema
 * while preserving all unknown keys at both root and nested object levels.
 */
export function parseProjectConfigYaml(yamlText: string): ProjectConfig {
  const raw = YAML.parse(yamlText);
  if (!isPlainObject(raw)) {
    throw new Error('Invalid project.yaml: root value must be a YAML mapping object');
  }
  return ProjectConfigSchema.parse(raw);
}

/**
 * Validates and serializes a ProjectConfig object back to YAML.
 * If `originalYamlText` is provided, merges `config` over the original YAML object
 * first so that any unknown keys from the existing file are never deleted.
 */
export function stringifyProjectConfigYaml(
  config: Record<string, unknown>,
  originalYamlText?: string,
): string {
  let merged: Record<string, unknown> = config;
  if (originalYamlText && originalYamlText.trim().length > 0) {
    const existing = YAML.parse(originalYamlText);
    if (isPlainObject(existing)) {
      merged = deepMergePreservingUnknown(existing, config);
    }
  }
  const validated = ProjectConfigSchema.parse(merged);
  return YAML.stringify(validated);
}

export const PlannedTaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  scope: z.array(z.string().min(1)).min(1),
  dependencies: z.array(z.string()).default([]),
  taskType: z.enum(['planning', 'browser-check', 'tests', 'implementation']).or(z.string().min(1)),
  assignedCli: z.string().optional(),
});

export type PlannedTask = z.infer<typeof PlannedTaskSchema>;

export const TeamworkPlanSchema = z.object({
  goal: z.string().min(1),
  tasks: z.array(PlannedTaskSchema).min(1),
});

export type TeamworkPlan = z.infer<typeof TeamworkPlanSchema>;

export const ExtensionManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.enum(['node-process', 'filesystem', 'network', 'webview'])).default([]),
  contributes: z
    .object({
      themes: z
        .array(
          z.object({
            id: z.string().min(1),
            label: z.string().min(1),
            uiTheme: z.enum(['light', 'dark']),
            path: z.string().min(1),
          }),
        )
        .optional(),
      snippets: z
        .array(
          z.object({
            language: z.string().min(1),
            path: z.string().min(1),
          }),
        )
        .optional(),
      languageServers: z
        .array(
          z.object({
            id: z.string().min(1),
            languages: z.array(z.string().min(1)).min(1),
            command: z.string().min(1),
            args: z.array(z.string()).optional(),
          }),
        )
        .optional(),
      cliAdapters: z
        .array(
          z.object({
            id: z.string().min(1),
            displayName: z.string().min(1),
            entry: z.string().min(1),
          }),
        )
        .optional(),
      commands: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1),
            keybinding: z.string().optional(),
          }),
        )
        .optional(),
      panels: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1),
            htmlPath: z.string().min(1),
          }),
        )
        .optional(),
    })
    .default({}),
});

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;

/**
 * Checks whether `targetPath` is safely inside `projectRoot` (which includes
 * `.conductor/worktrees/`) or `~/.conductor/` (for global user extensions/settings).
 * Enforces Section 2.5: "The app never writes outside the project root or its own worktrees."
 */
export function isPathInsideWorkspace(
  projectRoot: string,
  targetPath: string,
  allowGlobalConductorDir = false,
): boolean {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTarget = path.resolve(projectRoot, targetPath);

  const rel = path.relative(resolvedRoot, resolvedTarget);
  const insideRoot = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));

  if (insideRoot) {
    return true;
  }

  if (allowGlobalConductorDir) {
    const globalConductor = path.resolve(os.homedir(), '.conductor');
    const globalRel = path.relative(globalConductor, resolvedTarget);
    if (globalRel === '' || (!globalRel.startsWith('..') && !path.isAbsolute(globalRel))) {
      return true;
    }
  }

  return false;
}

export function assertWorkspaceWriteAllowed(
  projectRoot: string,
  targetPath: string,
  allowGlobalConductorDir = false,
): string {
  if (!isPathInsideWorkspace(projectRoot, targetPath, allowGlobalConductorDir)) {
    throw new Error(
      `Workspace boundary violation: refusing to write to "${targetPath}" outside project root "${projectRoot}"`,
    );
  }
  return path.resolve(projectRoot, targetPath);
}
