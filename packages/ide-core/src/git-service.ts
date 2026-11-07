import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitDiffHunk, GitFileDiff, GitFileStatus } from './ipc-types.js';

const execFileAsync = promisify(execFile);

export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
}

export interface GitCommitResult {
  commitSha: string;
  branch: string;
  filesChanged: number;
}

export class GitService {
  private async runGit(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
      return stdout;
    } catch (err: any) {
      if (err.stdout) return err.stdout;
      throw err;
    }
  }

  /**
   * Retrieves Git status porcelain list
   */
  async gitStatus(cwd: string): Promise<GitFileStatus[]> {
    try {
      const stdout = await this.runGit(cwd, ['status', '--porcelain=v1']);
      const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const results: GitFileStatus[] = [];

      for (const line of lines) {
        if (line.length < 3) continue;
        const x = line[0];
        const y = line[1];
        const filePath = line.slice(3).trim();

        if (x !== ' ' && x !== '?') {
          results.push({
            path: filePath,
            status: x === 'M' || x === 'A' || x === 'D' || x === 'R' ? x : 'M',
            staged: true,
          });
        }
        if (y !== ' ') {
          results.push({
            path: filePath,
            status: y === '?' ? '?' : y === 'M' || y === 'A' || y === 'D' ? y : 'M',
            staged: false,
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Retrieves parsed diff for working tree or specific file
   */
  async gitDiff(cwd: string, filePath?: string): Promise<GitFileDiff> {
    try {
      const args = ['diff'];
      if (filePath) args.push(filePath);
      const rawDiff = await this.runGit(cwd, args);
      const hunks = this.parseDiffHunks(rawDiff);

      return {
        filePath: filePath || 'working-tree',
        hunks,
        rawDiff,
      };
    } catch {
      return {
        filePath: filePath || 'working-tree',
        hunks: [],
        rawDiff: '',
      };
    }
  }

  private parseDiffHunks(rawDiff: string): GitDiffHunk[] {
    const hunks: GitDiffHunk[] = [];
    const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/gm;
    const matches = Array.from(rawDiff.matchAll(hunkRegex));

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const oldStart = parseInt(match[1], 10);
      const oldLines = match[2] ? parseInt(match[2], 10) : 1;
      const newStart = parseInt(match[3], 10);
      const newLines = match[4] ? parseInt(match[4], 10) : 1;
      const summary = match[5]?.trim() || '';

      const startIndex = match.index + match[0].length;
      const nextMatch = matches[i + 1];
      const endIndex = nextMatch ? nextMatch.index : rawDiff.length;
      const body = rawDiff.slice(startIndex, endIndex);

      const lines: GitDiffHunk['lines'] = [];
      let added = 0;
      let removed = 0;
      let curOld = oldStart;
      let curNew = newStart;

      for (const line of body.split(/\r?\n/)) {
        if (!line && lines.length === 0) continue;
        if (line.startsWith('+')) {
          added++;
          lines.push({ type: 'add', newLineNumber: curNew++, content: line.slice(1) });
        } else if (line.startsWith('-')) {
          removed++;
          lines.push({ type: 'del', oldLineNumber: curOld++, content: line.slice(1) });
        } else if (line.startsWith(' ')) {
          lines.push({
            type: 'context',
            oldLineNumber: curOld++,
            newLineNumber: curNew++,
            content: line.slice(1),
          });
        }
      }

      hunks.push({
        index: i,
        header: match[0],
        summary,
        oldStart,
        oldLines,
        newStart,
        newLines,
        added,
        removed,
        lines,
      });
    }

    return hunks;
  }

  async gitStageFile(cwd: string, filePath: string): Promise<void> {
    await this.runGit(cwd, ['add', filePath]);
  }

  async gitUnstageFile(cwd: string, filePath: string): Promise<void> {
    await this.runGit(cwd, ['reset', 'HEAD', filePath]);
  }

  async gitCommit(cwd: string, message: string): Promise<GitCommitResult> {
    const stdout = await this.runGit(cwd, ['commit', '-m', message]);
    const shaMatch = stdout.match(/\[([^\s]+)\s+([a-f0-9]+)\]/);
    const branch = shaMatch ? shaMatch[1] : 'main';
    const commitSha = shaMatch ? shaMatch[2] : 'HEAD';

    return {
      commitSha,
      branch,
      filesChanged: 1,
    };
  }

  async gitBranches(cwd: string): Promise<GitBranch[]> {
    try {
      const stdout = await this.runGit(cwd, ['branch', '--list']);
      const branches: GitBranch[] = [];

      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const current = trimmed.startsWith('*');
        const name = current ? trimmed.slice(1).trim() : trimmed;
        branches.push({ name, current });
      }

      return branches;
    } catch {
      return [{ name: 'main', current: true }];
    }
  }

  async gitCheckout(cwd: string, branch: string, create: boolean = false): Promise<void> {
    const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
    await this.runGit(cwd, args);
  }
}
