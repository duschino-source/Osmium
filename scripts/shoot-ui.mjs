#!/usr/bin/env node
/**
 * OsmiumIDE screenshot gate (DESIGN.md §5.4) — Taste Skill's browser
 * check, translated to Electron. Captures the renderer via Playwright
 * at the three sanctioned window sizes in light and dark.
 *
 * Prereq: `pnpm build` (needs apps/desktop/dist). Output: .agents/ui-shots/
 * Usage: node scripts/shoot-ui.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* global document */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.agents', 'ui-shots');
// Some agent shells inherit ELECTRON_RUN_AS_NODE=1; Electron would then run the
// main entry as plain Node and `require('electron')` returns the npm shim.
delete process.env.ELECTRON_RUN_AS_NODE;
const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1200x720', width: 1200, height: 720 },
  { name: '960x600', width: 960, height: 600 },
];
const THEMES = ['light', 'dark'];

async function shot(page, name) {
  const file = path.join(outDir, name);
  // A transient 30s default timeout was observed while the sidecar was busy;
  // screenshots are cheap and this gate should not flake.
  await page.screenshot({ path: file, timeout: 60_000 });
  console.log(`shot ${file}`);
}

async function waitForDetection(page) {
  // Let the adapter host finish CLI detection so screenshots are deterministic.
  await page
    .waitForFunction(
      () => {
        const chip = document.querySelector('[data-testid="status-chip-mock"]');
        return !!chip && chip.getAttribute('data-state') !== 'checking';
      },
      { timeout: 10000 },
    )
    .catch(() => {});
}

async function main() {
  let electron;
  try {
    ({ _electron: electron } = await import('playwright'));
  } catch {
    ({ _electron: electron } = await import('@playwright/test'));
  }
  fs.mkdirSync(outDir, { recursive: true });
  const app = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      path.join(root, 'apps/desktop/dist/main/index.js'),
    ],
  });
  try {
    const page = await app.firstWindow();
    await page.waitForTimeout(700);
    // The sidebar is user-collapsible; make sure the footer/nav is reachable.
    const sidebarPressed = await page
      .locator('[data-testid="sidebar-toggle"]')
      .getAttribute('aria-pressed');
    if (sidebarPressed === 'false') {
      await page.locator('[data-testid="sidebar-toggle"]').click();
    }
    for (const theme of THEMES) {
      // Drive the real Settings UI so the app state and <html> attributes agree;
      // writing only data-theme races the async settings load.
      await page.locator('[data-testid="footer-item-settings"]').click();
      await page.locator(`[data-testid="settings-theme-${theme}"]`).click();
      await page.locator('[data-testid="settings-palette-blue"]').click();
      await page.locator('[data-testid="mode-btn-code"]').click();
      await page.locator('[data-testid="activity-btn-explorer"]').click();
      await page.waitForTimeout(250);
      for (const s of SIZES) {
        await page.setViewportSize({ width: s.width, height: s.height });
        await page.waitForTimeout(300);
        await shot(page, `${theme}-${s.name}.png`);

        await page.locator('[data-testid="mode-btn-chat"]').click();
        await waitForDetection(page);
        await page.waitForTimeout(250);
        await shot(page, `${theme}-${s.name}-home.png`);

        // Live session: the verified mock CLI streams real AgentEvents
        // through the Rust sidecar and the main-process bridge.
        await page.locator('[data-testid="composer-input"]').fill('Summarize the workspace');
        await page.locator('[data-testid="composer-send-btn"]').click();
        await page
          .locator('[data-testid="session-view"]')
          .waitFor({ timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(1200);
        await shot(page, `${theme}-${s.name}-session.png`);
        await page
          .locator('[data-testid="session-new-btn"]')
          .click()
          .catch(() => {});
        await page.waitForTimeout(200);

        // Approval surface: the mock infers its approval scenario from the prompt.
        await page.locator('[data-testid="composer-input"]').fill('Request approval for a command');
        await page.locator('[data-testid="composer-send-btn"]').click();
        await page
          .locator('[data-testid^="approval-prompt-"]')
          .first()
          .waitFor({ timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(300);
        await shot(page, `${theme}-${s.name}-approval.png`);
        await page
          .locator('[data-testid="approval-allow-btn"]')
          .click()
          .catch(() => {});
        await page.waitForTimeout(800);
        await page
          .locator('[data-testid="session-new-btn"]')
          .click()
          .catch(() => {});
        await page.waitForTimeout(200);

        // CLI Hub is part of the wired surface (DESIGN.md §5.4).
        await page.locator('[data-testid="footer-item-cli-hub"]').click();
        await page.waitForTimeout(350);
        await shot(page, `${theme}-${s.name}-cli-hub.png`);

        // Settings: theme modes and accent palettes.
        await page.locator('[data-testid="footer-item-settings"]').click();
        await page.waitForTimeout(350);
        await shot(page, `${theme}-${s.name}-settings.png`);
        await page.locator('[data-testid="mode-btn-code"]').click();
        await page.locator('[data-testid="activity-btn-explorer"]').click();
        await page.waitForTimeout(200);
      }
    }
  } finally {
    await app.close();
  }
  console.log('Screenshot gate: review .agents/ui-shots/ against docs/design/ and DESIGN.md.');
}

main().catch((e) => {
  console.error('shoot-ui failed:', e.message);
  process.exit(1);
});
