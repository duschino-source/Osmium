import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  WorkspaceService,
  isIgnoredPath,
  type WorkspaceChangeEvent,
} from '../workspace-service.js';

describe('isIgnoredPath', () => {
  it('ignores build and dependency folders at any depth', () => {
    expect(isIgnoredPath('node_modules/foo/index.js')).toBe(true);
    expect(isIgnoredPath('packages/ui/node_modules/x.js')).toBe(true);
    expect(isIgnoredPath('target/debug/osmium')).toBe(true);
    expect(isIgnoredPath('dist/main/index.js')).toBe(true);
    expect(isIgnoredPath('.git/HEAD')).toBe(true);
  });

  it('keeps ordinary source paths', () => {
    expect(isIgnoredPath('src/index.ts')).toBe(false);
    expect(isIgnoredPath('docs/PLAN.md')).toBe(false);
    // A folder that merely contains an ignored name is not ignored.
    expect(isIgnoredPath('src/node_modules_helper.ts')).toBe(false);
  });
});

describe('WorkspaceService', () => {
  let tmpDir: string;
  let service: WorkspaceService;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'osmium-ws-'));
    service = new WorkspaceService(30);
  });

  afterEach(async () => {
    await service.unwatch();
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects a path that is not a directory', async () => {
    const filePath = path.join(tmpDir, 'a.txt');
    await fsp.writeFile(filePath, 'x', 'utf-8');
    await expect(service.setRoot(filePath)).rejects.toThrow(/Not a directory/);
  });

  it('lists files recursively while skipping ignored folders', async () => {
    await fsp.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fsp.mkdir(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    await fsp.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'x', 'utf-8');
    await fsp.writeFile(path.join(tmpDir, 'node_modules', 'pkg', 'index.js'), 'x', 'utf-8');
    await fsp.writeFile(path.join(tmpDir, 'README.md'), 'x', 'utf-8');

    const files = await service.listFiles(tmpDir);
    const paths = files.map((f) => f.relPath);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('README.md');
    expect(paths).not.toContain('node_modules/pkg/index.js');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('reports forward-slashed relative paths', async () => {
    await fsp.mkdir(path.join(tmpDir, 'a', 'b'), { recursive: true });
    await fsp.writeFile(path.join(tmpDir, 'a', 'b', 'c.ts'), 'x', 'utf-8');
    const files = await service.listFiles(tmpDir);
    expect(files.map((f) => f.relPath)).toContain('a/b/c.ts');
  });

  it('emits a debounced change batch for a real file write', async () => {
    await service.setRoot(tmpDir);
    await service.watch();

    const batches: WorkspaceChangeEvent[][] = [];
    service.on('change', (batch: WorkspaceChangeEvent[]) => batches.push(batch));

    await fsp.writeFile(path.join(tmpDir, 'watched.txt'), 'hello', 'utf-8');

    // Wait past the debounce window; the watcher is async.
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(batches.length).toBeGreaterThan(0);
    const flattened = batches.flat();
    const added = flattened.find((e) => e.relPath === 'watched.txt');
    expect(added).toBeDefined();
    expect(added!.type).toBe('add');
    expect(added!.root).toBe(path.resolve(tmpDir));
  });

  it('does not emit events for ignored folders', async () => {
    await fsp.mkdir(path.join(tmpDir, 'node_modules'), { recursive: true });
    await service.setRoot(tmpDir);
    await service.watch();

    const batches: WorkspaceChangeEvent[][] = [];
    service.on('change', (batch: WorkspaceChangeEvent[]) => batches.push(batch));

    await fsp.writeFile(path.join(tmpDir, 'node_modules', 'noise.js'), 'x', 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, 700));

    const flattened = batches.flat();
    expect(flattened.some((e) => e.relPath.includes('node_modules'))).toBe(false);
  });

  it('stops watching after unwatch', async () => {
    await service.setRoot(tmpDir);
    await service.watch();
    expect(service.isWatching()).toBe(true);
    await service.unwatch();
    expect(service.isWatching()).toBe(false);
  });
});
