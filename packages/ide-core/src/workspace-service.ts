import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';

/**
 * Directories that are never walked or watched. Kept in sync with
 * FileService.IGNORED_DIRS plus a few build-output folders that would
 * otherwise flood the watcher on a real project.
 */
export const WORKSPACE_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'target',
  '.turbo',
  '.cache',
  '.next',
  'out',
  'build',
  'coverage',
  '.venv',
  '__pycache__',
  '.perch',
  '.agents',
  'test-results',
  'playwright-report',
  '.vscode',
  '.idea',
]);

export type WorkspaceChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface WorkspaceChangeEvent {
  root: string;
  type: WorkspaceChangeType;
  /** Workspace-relative path, always forward-slashed. */
  relPath: string;
}

export interface WorkspaceFileEntry {
  relPath: string;
  name: string;
  kind: 'file' | 'directory';
}

/** True when any path segment is an ignored directory. */
export function isIgnoredPath(relPath: string): boolean {
  const segments = relPath.replace(/\\/g, '/').split('/');
  return segments.some((segment) => WORKSPACE_IGNORED_DIRS.has(segment));
}

/**
 * Owns the open workspace root, a debounced filesystem watcher, and the flat
 * file index used by Quick Open. Node-only: imported by the Electron main
 * process, never by the renderer.
 */
export class WorkspaceService extends EventEmitter {
  private root: string | null = null;
  private watcher: { close: () => Promise<void> } | null = null;
  private pending = new Map<string, WorkspaceChangeEvent>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(debounceMs = 150) {
    super();
    this.debounceMs = debounceMs;
  }

  getRoot(): string | null {
    return this.root;
  }

  /**
   * Validates and sets the workspace root. Returns the resolved absolute path.
   * Throws when the path is missing or not a directory so the caller can show
   * an honest error instead of silently falling back to process.cwd().
   */
  async setRoot(rootPath: string): Promise<string> {
    const resolved = path.resolve(rootPath);
    const stats = await fsp.stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }
    this.root = resolved;
    return resolved;
  }

  /** Recursively lists files and directories, skipping ignored folders. */
  async listFiles(rootPath?: string, limit = 20000): Promise<WorkspaceFileEntry[]> {
    const root = rootPath ? path.resolve(rootPath) : this.root;
    if (!root) return [];

    const out: WorkspaceFileEntry[] = [];
    const walk = async (dir: string, relBase: string): Promise<void> => {
      if (out.length >= limit) return;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= limit) return;
        if (WORKSPACE_IGNORED_DIRS.has(entry.name)) continue;
        const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
        const isDir = entry.isDirectory();
        out.push({ relPath, name: entry.name, kind: isDir ? 'directory' : 'file' });
        if (isDir) await walk(path.join(dir, entry.name), relPath);
      }
    };

    await walk(root, '');
    return out;
  }

  /**
   * Starts watching the workspace. Events are coalesced per relative path and
   * flushed on a short debounce so a single save does not produce a storm.
   */
  async watch(rootPath?: string): Promise<void> {
    const root = rootPath ? path.resolve(rootPath) : this.root;
    if (!root) throw new Error('No workspace root to watch');
    await this.unwatch();
    this.root = root;

    const chokidar = await import('chokidar');
    const watcher = chokidar.watch(root, {
      ignoreInitial: true,
      persistent: true,
      // chokidar v4 takes a predicate instead of glob strings.
      ignored: (candidate: string) => {
        const rel = path.relative(root, candidate);
        if (!rel) return false;
        return isIgnoredPath(rel);
      },
    });

    const push = (type: WorkspaceChangeType, absPath: string) => {
      const relPath = path.relative(root, absPath).replace(/\\/g, '/');
      if (!relPath || relPath.startsWith('..')) return;
      if (isIgnoredPath(relPath)) return;
      this.pending.set(relPath, { root, type, relPath });
      this.scheduleFlush();
    };

    watcher.on('add', (p: string) => push('add', p));
    watcher.on('change', (p: string) => push('change', p));
    watcher.on('unlink', (p: string) => push('unlink', p));
    watcher.on('addDir', (p: string) => push('addDir', p));
    watcher.on('unlinkDir', (p: string) => push('unlinkDir', p));
    // A watcher error must not take the app down; surface it as an event.
    watcher.on('error', (error: unknown) => this.emit('error', error));

    this.watcher = watcher as unknown as { close: () => Promise<void> };

    // Resolve only once the initial scan is done. Without this, a file written
    // immediately after watch() can be missed entirely.
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      watcher.once('ready', done);
      // Never hang the caller if 'ready' never arrives.
      const timer = setTimeout(done, 5000);
      timer.unref?.();
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const batch = [...this.pending.values()];
      this.pending.clear();
      if (batch.length > 0) this.emit('change', batch);
    }, this.debounceMs);
    // Do not hold the event loop open on quit.
    this.flushTimer.unref?.();
  }

  async unwatch(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending.clear();
    const watcher = this.watcher;
    this.watcher = null;
    if (watcher) {
      try {
        await watcher.close();
      } catch {
        // Closing an already-closed watcher is not an error worth surfacing.
      }
    }
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }
}
