#!/usr/bin/env node
/**
 * OsmiumIDE UI base-rules checker (DESIGN.md §1, §5).
 * Fails on: emoji/glyph icons, hardcoded colors in .tsx, inline-style
 * color literals. Token files are the only place colors may live.
 * Usage: node scripts/check-ui-rules.mjs [--warn]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const warnOnly = process.argv.includes('--warn');

const SCAN_DIRS = ['packages/ui/src', 'apps/desktop/src/renderer'];
const TOKEN_FILES = new Set([
  path.normalize('packages/ui/src/tokens.css'),
  path.normalize('packages/ui/src/ide/syntax.ts'),
]);

const EMOJI = /\p{Extended_Pictographic}/u;
const GLYPH_ICON = /[\u25B8\u25BE\u2387\u2715\u26A0]/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOR_FN = /\b(?:rgb|rgba|hsl|hsla)\s*\(/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') continue;
      walk(p, out);
    } else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const d of SCAN_DIRS) {
  for (const file of walk(path.join(root, d))) {
    const rel = path.relative(root, file);
    if (TOKEN_FILES.has(path.normalize(rel))) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const at = `${rel}:${i + 1}`;
      if (EMOJI.test(line) || GLYPH_ICON.test(line))
        violations.push(`${at} emoji/glyph icon — use the Icon component (DESIGN.md §1.1)`);
      if (/\.tsx$/.test(file) && HEX.test(line))
        violations.push(`${at} hardcoded hex color — use a tokens.css variable (DESIGN.md §1.2)`);
      if (/\.tsx$/.test(file) && COLOR_FN.test(line) && /style/.test(line))
        violations.push(`${at} inline color literal — use a tokens.css variable (DESIGN.md §1.3)`);
      if (/\.css$/.test(file) && HEX.test(line))
        violations.push(`${at} hex color outside tokens.css — move it to a token (DESIGN.md §1.2)`);
    });
  }
}

if (violations.length) {
  console.log(`UI rules: ${violations.length} violation(s)`);
  for (const v of violations) console.log(`  ${v}`);
  if (!warnOnly) process.exit(1);
  console.log('(warn mode — not failing)');
} else {
  console.log('UI rules: clean (no emoji icons, no hardcoded colors outside tokens).');
}
