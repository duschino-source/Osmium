#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SUITE_SOURCES = [
  { tier: 1, relPath: './suite/tier1/f01-f12.mjs' },
  { tier: 1, relPath: './suite/tier1/f13-f24.mjs' },
  { tier: 2, relPath: './suite/tier2/f01-f12.mjs' },
  { tier: 2, relPath: './suite/tier2/f13-f24.mjs' },
  { tier: 3, relPath: './suite/tier3/pairwise.mjs' },
  { tier: 4, relPath: './suite/tier4/scenarios.mjs' },
];

function parseArgs(argv) {
  const opts = {
    tiers: null, // Set<number> or null for all
    feature: null, // number (1..24) or null
    filter: null, // string or null
    list: false,
    json: false,
    strictWorkspace: process.env.CONDUCTOR_E2E_STRICT === '1',
  };

  for (const arg of argv) {
    if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--strict-workspace') {
      opts.strictWorkspace = true;
    } else if (arg.startsWith('--tier=')) {
      const val = arg.slice('--tier='.length).trim();
      const parsed = val
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      if (!opts.tiers) opts.tiers = new Set();
      for (const n of parsed) opts.tiers.add(n);
    } else if (arg.startsWith('--feature=')) {
      const val = Number.parseInt(arg.slice('--feature='.length).trim(), 10);
      if (!Number.isNaN(val)) {
        opts.feature = val;
      }
    } else if (arg.startsWith('--filter=')) {
      opts.filter = arg.slice('--filter='.length).trim();
    }
  }

  return opts;
}

function testMatchesFeature(test, featureNum) {
  if (featureNum === null) return true;
  if (Number(test.feature) === featureNum) return true;
  if (Array.isArray(test.features) && test.features.map(Number).includes(featureNum)) {
    return true;
  }
  return false;
}

function testMatchesFilter(test, filterStr) {
  if (!filterStr) return true;
  const needle = filterStr.toLowerCase();
  const idMatch = String(test.id || '').toLowerCase().includes(needle);
  const titleMatch = String(test.title || '').toLowerCase().includes(needle);
  return idMatch || titleMatch;
}

async function loadSuites(opts) {
  const allTests = [];
  const missingSources = [];

  for (const src of SUITE_SOURCES) {
    if (opts.tiers && !opts.tiers.has(src.tier)) {
      continue;
    }
    const absPath = path.resolve(__dirname, src.relPath);
    if (!fs.existsSync(absPath)) {
      missingSources.push(src);
      continue;
    }
    const mod = await import(pathToFileURL(absPath).href);
    const exportedTests = mod.tests || mod.default || [];
    if (!Array.isArray(exportedTests)) {
      throw new Error(`Suite ${src.relPath} did not export a valid 'tests' array`);
    }
    for (const t of exportedTests) {
      const normalizedFeatures = Array.isArray(t.features)
        ? t.features.map(Number)
        : t.feature !== undefined
          ? [Number(t.feature)]
          : [];
      allTests.push({
        ...t,
        tier: Number(t.tier ?? src.tier),
        feature: Number(t.feature ?? normalizedFeatures[0] ?? 0),
        features: normalizedFeatures,
      });
    }
  }

  if (opts.tiers && missingSources.length > 0) {
    const missingPaths = missingSources.map((m) => m.relPath).join(', ');
    throw new Error(`Missing required suite files for requested tier(s): ${missingPaths}`);
  }

  return { allTests, missingSources };
}

function buildFeatureStats(items) {
  const byFeature = {};
  for (let f = 1; f <= 24; f++) {
    const fKey = `F${String(f).padStart(2, '0')}`;
    byFeature[fKey] = {
      feature: f,
      total: 0,
      passed: 0,
      failed: 0,
    };
  }

  for (const item of items) {
    const feats = new Set();
    if (item.feature >= 1 && item.feature <= 24) feats.add(item.feature);
    if (Array.isArray(item.features)) {
      for (const f of item.features) {
        if (f >= 1 && f <= 24) feats.add(f);
      }
    }
    for (const f of feats) {
      const fKey = `F${String(f).padStart(2, '0')}`;
      byFeature[fKey].total += 1;
      if (item.status === 'passed') byFeature[fKey].passed += 1;
      if (item.status === 'failed') byFeature[fKey].failed += 1;
    }
  }

  return byFeature;
}

function buildTierStats(items) {
  const byTier = {
    1: { tier: 1, name: 'Feature Coverage', total: 0, passed: 0, failed: 0 },
    2: { tier: 2, name: 'Boundary & Corner Cases', total: 0, passed: 0, failed: 0 },
    3: { tier: 3, name: 'Cross-Feature Combinations', total: 0, passed: 0, failed: 0 },
    4: { tier: 4, name: 'Real-World Scenarios', total: 0, passed: 0, failed: 0 },
  };

  for (const item of items) {
    const t = byTier[item.tier];
    if (t) {
      t.total += 1;
      if (item.status === 'passed') t.passed += 1;
      if (item.status === 'failed') t.failed += 1;
    }
  }

  return byTier;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { allTests, missingSources } = await loadSuites(opts);

  const selectedTests = allTests.filter((t) => {
    if (opts.tiers && !opts.tiers.has(t.tier)) return false;
    if (!testMatchesFeature(t, opts.feature)) return false;
    if (!testMatchesFilter(t, opts.filter)) return false;
    return true;
  });

  if (opts.list) {
    const tierStats = buildTierStats(selectedTests);
    const featureStats = buildFeatureStats(selectedTests);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            mode: 'list',
            total: selectedTests.length,
            byTier: tierStats,
            byFeature: featureStats,
            tests: selectedTests.map((t) => ({
              id: t.id,
              tier: t.tier,
              feature: t.feature,
              features: t.features,
              title: t.title,
            })),
          },
          null,
          2
        )
      );
      process.exit(selectedTests.length > 0 ? 0 : 1);
    }

    console.log('=== Conductor E2E Test Inventory ===');
    for (const t of selectedTests) {
      const featsLabel = (t.features || [t.feature])
        .map((f) => `F${String(f).padStart(2, '0')}`)
        .join(',');
      console.log(`  [Tier ${t.tier}] [${featsLabel}] ${t.id}: ${t.title}`);
    }
    console.log('\n--- Counts by Tier ---');
    for (const tNum of [1, 2, 3, 4]) {
      const ts = tierStats[tNum];
      console.log(`  Tier ${tNum} (${ts.name}): ${ts.total} tests`);
    }
    console.log('\n--- Counts by Feature (F01..F24) ---');
    for (const [fKey, fsStat] of Object.entries(featureStats)) {
      console.log(`  ${fKey}: ${fsStat.total} tests`);
    }
    console.log(`\nTotal Registered Tests Matching Filter: ${selectedTests.length}`);
    if (missingSources.length > 0) {
      console.log(
        `Note: ${missingSources.length} suite file(s) not yet present: ${missingSources.map((s) => s.relPath).join(', ')}`
      );
    }
    process.exit(selectedTests.length > 0 ? 0 : 1);
  }

  if (selectedTests.length === 0) {
    console.error('No E2E tests matched the given filter criteria.');
    process.exit(1);
  }

  const results = [];
  const suiteStart = Date.now();

  if (!opts.json) {
    console.log(
      `Running ${selectedTests.length} Conductor E2E test(s)${opts.strictWorkspace ? ' [STRICT WORKSPACE]' : ''}...\n`
    );
  }

  for (const test of selectedTests) {
    const startMs = Date.now();
    let status = 'passed';
    let errorMessage = null;
    let errorStack = null;

    try {
      const runnerFn = test.fn || test.run;
      if (typeof runnerFn !== 'function') {
        throw new Error(`Test ${test.id} is missing an executable fn(ctx) function`);
      }
      await runnerFn({
        rootDir: ROOT_DIR,
        strictWorkspace: opts.strictWorkspace,
        testId: test.id,
        tier: test.tier,
        feature: test.feature,
        features: test.features,
      });
    } catch (err) {
      status = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      errorStack = err instanceof Error ? err.stack : String(err);
    }

    const durationMs = Date.now() - startMs;
    const resultRecord = {
      id: test.id,
      tier: test.tier,
      feature: test.feature,
      features: test.features,
      title: test.title,
      status,
      durationMs,
      error: errorMessage,
      stack: errorStack,
    };
    results.push(resultRecord);

    if (!opts.json) {
      if (status === 'passed') {
        console.log(`PASS  ${test.id} (${durationMs}ms) — ${test.title}`);
      } else {
        console.error(`FAIL  ${test.id} (${durationMs}ms) — ${test.title}`);
        console.error(`      Error: ${errorMessage}`);
      }
    }
  }

  const totalDurationMs = Date.now() - suiteStart;
  const passedCount = results.filter((r) => r.status === 'passed').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const tierStats = buildTierStats(results);
  const featureStats = buildFeatureStats(results);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          total: results.length,
          passed: passedCount,
          failed: failedCount,
          durationMs: totalDurationMs,
          strictWorkspace: opts.strictWorkspace,
          byTier: tierStats,
          byFeature: featureStats,
          results: results.map(({ stack, ...rest }) => rest),
        },
        null,
        2
      )
    );
  } else {
    console.log('\n============================================================');
    console.log('Conductor E2E Summary by Tier:');
    for (const tNum of [1, 2, 3, 4]) {
      const ts = tierStats[tNum];
      if (ts.total > 0 || !opts.tiers || opts.tiers.has(tNum)) {
        console.log(
          `  Tier ${tNum} (${ts.name.padEnd(26)}): ${ts.passed}/${ts.total} passed, ${ts.failed} failed`
        );
      }
    }
    console.log('------------------------------------------------------------');
    console.log('Conductor E2E Summary by Feature (F01..F24):');
    const featureLines = [];
    for (const [fKey, fsStat] of Object.entries(featureStats)) {
      if (fsStat.total > 0) {
        featureLines.push(`${fKey}: ${fsStat.passed}/${fsStat.total}`);
      }
    }
    for (let i = 0; i < featureLines.length; i += 6) {
      console.log('  ' + featureLines.slice(i, i + 6).join('  |  '));
    }
    console.log('------------------------------------------------------------');
    console.log(
      `Total: ${results.length} executed, ${passedCount} passed, ${failedCount} failed (${totalDurationMs}ms)`
    );
    console.log('============================================================');
  }

  process.exit(failedCount === 0 && results.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal E2E Runner Error:', err);
  process.exit(1);
});
