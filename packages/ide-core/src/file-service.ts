import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FileReadResult, FileTreeNode, FileWriteResult } from './ipc-types.js';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.turbo', '.cache']);
const MAX_SAFE_FILE_SIZE = 2 * 1024 * 1024; // 2MB

export class FileService {
  /**
   * Reads directory structure lazily or recursively
   */
  async readTree(
    rootPath: string,
    relPath: string = '',
    maxDepth: number = 2,
  ): Promise<FileTreeNode[]> {
    const targetDir = relPath ? path.resolve(rootPath, relPath) : path.resolve(rootPath);
    try {
      const entries = await fsp.readdir(targetDir, { withFileTypes: true });
      const nodes: FileTreeNode[] = [];

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }

        const entryRelPath = relPath
          ? path.join(relPath, entry.name).replace(/\\/g, '/')
          : entry.name;
        const entryAbsPath = path.resolve(targetDir, entry.name);
        const isDir = entry.isDirectory();

        let sizeBytes: number | undefined;
        let mtimeMs: number | undefined;

        try {
          const stats = await fsp.stat(entryAbsPath);
          sizeBytes = stats.size;
          mtimeMs = stats.mtimeMs;
        } catch {
          // ignore stat errors on broken links or locked files
        }

        const node: FileTreeNode = {
          name: entry.name,
          relPath: entryRelPath,
          absPath: entryAbsPath,
          kind: isDir ? 'directory' : 'file',
          sizeBytes,
          mtimeMs,
          childrenLoaded: false,
        };

        if (isDir && maxDepth > 1) {
          node.children = await this.readTree(rootPath, entryRelPath, maxDepth - 1);
          node.childrenLoaded = true;
        }

        nodes.push(node);
      }

      // Sort: directories first, then alphabetical
      nodes.sort((a, b) => {
        if (a.kind === b.kind) {
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        }
        return a.kind === 'directory' ? -1 : 1;
      });

      return nodes;
    } catch {
      return [];
    }
  }

  /**
   * Reads file content with size limits and line ending detection
   */
  async readFile(filePath: string): Promise<FileReadResult> {
    const absPath = path.resolve(filePath);
    const stats = await fsp.stat(absPath);

    if (stats.size > MAX_SAFE_FILE_SIZE) {
      return {
        filePath: absPath,
        content: `// [LARGE FILE WARNING] File size (${(stats.size / 1024 / 1024).toFixed(2)} MB) exceeds 2MB threshold.\n// Viewing is in safe read-only preview mode.\n`,
        encoding: 'utf-8',
        lineEnding: 'LF',
        mtimeMs: stats.mtimeMs,
        sizeBytes: stats.size,
        largeFileSafeMode: true,
      };
    }

    const content = await fsp.readFile(absPath, 'utf-8');
    const lineEnding = content.includes('\r\n') ? 'CRLF' : 'LF';

    return {
      filePath: absPath,
      content,
      encoding: 'utf-8',
      lineEnding,
      mtimeMs: stats.mtimeMs,
      sizeBytes: stats.size,
      largeFileSafeMode: false,
    };
  }

  /**
   * Writes file content to disk with directory creation
   */
  async writeFile(
    filePath: string,
    content: string,
    expectedMtimeMs?: number,
  ): Promise<FileWriteResult> {
    const absPath = path.resolve(filePath);

    if (expectedMtimeMs && fs.existsSync(absPath)) {
      const stats = await fsp.stat(absPath);
      if (Math.abs(stats.mtimeMs - expectedMtimeMs) > 1000) {
        const diskContent = await fsp.readFile(absPath, 'utf-8');
        return {
          filePath: absPath,
          mtimeMs: stats.mtimeMs,
          conflict: {
            diskContent,
            diskMtimeMs: stats.mtimeMs,
          },
        };
      }
    }

    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await fsp.writeFile(absPath, content, 'utf-8');
    const stats = await fsp.stat(absPath);

    return {
      filePath: absPath,
      mtimeMs: stats.mtimeMs,
    };
  }

  /**
   * Creates file or directory
   */
  async createEntry(targetPath: string, kind: 'file' | 'directory'): Promise<void> {
    const absPath = path.resolve(targetPath);
    if (kind === 'directory') {
      await fsp.mkdir(absPath, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(absPath), { recursive: true });
      if (!fs.existsSync(absPath)) {
        await fsp.writeFile(absPath, '', 'utf-8');
      }
    }
  }

  /**
   * Renames file or directory
   */
  async renameEntry(oldPath: string, newPath: string): Promise<void> {
    const src = path.resolve(oldPath);
    const dest = path.resolve(newPath);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(src, dest);
  }

  /**
   * Deletes file or directory
   */
  async deleteEntry(targetPath: string): Promise<void> {
    const absPath = path.resolve(targetPath);
    await fsp.rm(absPath, { recursive: true, force: true });
  }
}
