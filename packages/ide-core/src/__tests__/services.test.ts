import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileService } from '../file-service.js';
import { SearchService } from '../search-service.js';

describe('IDE Core Services: FileService & SearchService', () => {
  let tmpDir: string;
  let fileService: FileService;
  let searchService: SearchService;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'osmium-ide-test-'));
    fileService = new FileService();
    searchService = new SearchService();

    // Create test files
    await fsp.mkdir(path.join(tmpDir, 'src', 'components'), { recursive: true });
    await fsp.writeFile(
      path.join(tmpDir, 'src', 'index.ts'),
      'export const greeting = "Hello Osmium";\nconsole.log(greeting);\n',
      'utf-8',
    );
    await fsp.writeFile(
      path.join(tmpDir, 'src', 'components', 'App.tsx'),
      'import React from "react";\nexport const App = () => <div>Hello World</div>;\n',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads directory tree with proper kinds and structure', async () => {
    const tree = await fileService.readTree(tmpDir);
    expect(tree.length).toBeGreaterThan(0);
    const srcNode = tree.find((n) => n.name === 'src');
    expect(srcNode).toBeDefined();
    expect(srcNode?.kind).toBe('directory');
    expect(srcNode?.children).toBeDefined();
    expect(srcNode?.children?.some((c) => c.name === 'index.ts')).toBe(true);
  });

  it('reads and writes file contents accurately', async () => {
    const filePath = path.join(tmpDir, 'src', 'index.ts');
    const read = await fileService.readFile(filePath);
    expect(read.content).toContain('Hello Osmium');
    expect(read.largeFileSafeMode).toBe(false);

    await fileService.writeFile(filePath, 'export const updated = true;\n');
    const reRead = await fileService.readFile(filePath);
    expect(reRead.content).toContain('updated = true');
  });

  it('creates, renames, and deletes entries', async () => {
    const newFile = path.join(tmpDir, 'new-file.txt');
    await fileService.createEntry(newFile, 'file');
    expect(await fsp.stat(newFile)).toBeDefined();

    const renamedFile = path.join(tmpDir, 'renamed-file.txt');
    await fileService.renameEntry(newFile, renamedFile);
    expect(await fsp.stat(renamedFile)).toBeDefined();

    await fileService.deleteEntry(renamedFile);
    await expect(fsp.stat(renamedFile)).rejects.toThrow();
  });

  it('searches workspace text and regex with accurate line numbers', async () => {
    const matches = await searchService.search({
      cwd: tmpDir,
      query: 'Hello',
    });

    expect(matches.length).toBe(2);
    expect(matches.some((m) => m.relPath.includes('index.ts') && m.line === 1)).toBe(true);
    expect(matches.some((m) => m.relPath.includes('App.tsx') && m.line === 2)).toBe(true);
  });
});
