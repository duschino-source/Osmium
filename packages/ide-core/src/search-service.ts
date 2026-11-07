import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  ReplaceAcrossFilesOptions,
  ReplaceFilePreview,
  SearchMatch,
  SearchOptions,
} from './ipc-types.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', '.turbo', '.cache', 'build']);
const MAX_SEARCH_RESULTS_DEFAULT = 200;
const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.pdf',
  '.exe',
  '.dll',
  '.node',
  '.woff',
  '.woff2',
  '.zip',
  '.tar',
  '.gz',
]);

export class SearchService {
  /**
   * Search across workspace files for query string or regex pattern
   */
  async search(opts: SearchOptions): Promise<SearchMatch[]> {
    const {
      cwd,
      query,
      isRegex = false,
      caseSensitive = false,
      wholeWord = false,
      maxResults = MAX_SEARCH_RESULTS_DEFAULT,
    } = opts;
    if (!query || query.trim() === '') {
      return [];
    }

    let regex: RegExp;
    try {
      let pattern = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) {
        pattern = `\\b${pattern}\\b`;
      }
      regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return [];
    }

    const matches: SearchMatch[] = [];
    await this.traverseDir(cwd, cwd, regex, matches, maxResults);
    return matches;
  }

  private async traverseDir(
    rootDir: string,
    currentDir: string,
    regex: RegExp,
    results: SearchMatch[],
    maxResults: number,
  ): Promise<void> {
    if (results.length >= maxResults) return;

    let entries;
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await this.traverseDir(
            rootDir,
            path.join(currentDir, entry.name),
            regex,
            results,
            maxResults,
          );
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTS.has(ext)) continue;

        const filePath = path.join(currentDir, entry.name);
        const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');

        try {
          const content = await fsp.readFile(filePath, 'utf-8');
          const lines = content.split(/\r?\n/);

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) return;
            const lineText = lines[i];
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = regex.exec(lineText)) !== null) {
              results.push({
                filePath,
                relPath,
                line: i + 1,
                column: match.index + 1,
                lineText: lineText.trim(),
                matchText: match[0],
              });

              if (!regex.global || results.length >= maxResults) break;
            }
          }
        } catch {
          // ignore unreadable files
        }
      }
    }
  }

  /**
   * Replace across workspace files
   */
  async replaceAcrossFiles(opts: ReplaceAcrossFilesOptions): Promise<ReplaceFilePreview[]> {
    const matches = await this.search(opts);
    const byFile = new Map<string, SearchMatch[]>();

    for (const m of matches) {
      const list = byFile.get(m.filePath) || [];
      list.push(m);
      byFile.set(m.filePath, list);
    }

    const previews: ReplaceFilePreview[] = [];

    for (const [filePath, fileMatches] of byFile) {
      try {
        const original = await fsp.readFile(filePath, 'utf-8');
        let regex: RegExp;
        let pattern = opts.isRegex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (opts.wholeWord) pattern = `\\b${pattern}\\b`;
        regex = new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');

        const updated = original.replace(regex, opts.replacement);

        if (!opts.previewOnly) {
          await fsp.writeFile(filePath, updated, 'utf-8');
        }

        previews.push({
          filePath,
          relPath: path.relative(opts.cwd, filePath).replace(/\\/g, '/'),
          replacementsCount: fileMatches.length,
          beforePreview: fileMatches[0]?.lineText || '',
          afterPreview: (fileMatches[0]?.lineText || '').replace(regex, opts.replacement),
        });
      } catch {
        // ignore errors on individual file replace
      }
    }

    return previews;
  }
}
