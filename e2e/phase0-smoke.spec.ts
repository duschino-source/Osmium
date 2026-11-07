import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Phase 0 Electron App Shell launches and matches Section 7 design spec', async () => {
  const mainEntry = path.resolve(__dirname, '../apps/desktop/dist/main/index.js');

  const electronApp = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', mainEntry],
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Verify headline & subtitle
    const headline = window.getByTestId('home-headline');
    await expect(headline).toHaveText('What are we building?');

    const subtitle = window.getByTestId('home-subtitle');
    await expect(subtitle).toHaveText(
      'Connect the coding CLIs you already use. CLI detection arrives in Phase 1.',
    );

    // Verify CSS variable tokens and sidebar geometry (216px)
    const tokenValues = await window.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
      return {
        bgGround: rootStyle.getPropertyValue('--bg-ground').trim(),
        bgSidebar: rootStyle.getPropertyValue('--bg-sidebar').trim(),
        borderDefault: rootStyle.getPropertyValue('--border-default').trim(),
        textInk: rootStyle.getPropertyValue('--text-ink').trim(),
        accentPrimary: rootStyle.getPropertyValue('--accent-primary').trim(),
        cliCodex: rootStyle.getPropertyValue('--cli-codex').trim(),
        cliAntigravity: rootStyle.getPropertyValue('--cli-antigravity').trim(),
        cliDeepseek: rootStyle.getPropertyValue('--cli-deepseek').trim(),
        fontSans: rootStyle.getPropertyValue('--font-sans').trim(),
        sidebarWidthPx: sidebar ? sidebar.getBoundingClientRect().width : 0,
      };
    });

    expect(tokenValues.bgGround.toUpperCase()).toBe('#F6F8F5');
    expect(tokenValues.bgSidebar.toUpperCase()).toBe('#EAF1E8');
    expect(tokenValues.borderDefault.toUpperCase()).toBe('#D2DFD0');
    expect(tokenValues.textInk.toUpperCase()).toBe('#1B2B22');
    expect(tokenValues.accentPrimary.toUpperCase()).toBe('#2F6B4F');
    expect(tokenValues.cliCodex.toUpperCase()).toBe('#1B2B22');
    expect(tokenValues.cliAntigravity.toUpperCase()).toBe('#2F5FD0');
    expect(tokenValues.cliDeepseek.toUpperCase()).toBe('#6B4FD0');
    expect(tokenValues.fontSans).toContain('Inter');
    expect(Math.round(tokenValues.sidebarWidthPx)).toBe(216);

    // Verify CLI badges always show colored dot + CLI name
    await expect(window.getByTestId('status-chip-codex')).toContainText('Codex CLI · Primary');
    await expect(window.getByTestId('status-chip-antigravity')).toContainText(
      'Antigravity · Second',
    );
    await expect(window.getByTestId('status-chip-deepseek')).toContainText('DeepSeek CLI');
    await expect(window.getByTestId('connect-cli-chip')).toContainText('+ Connect CLI');

    // Verify typing '/' in Composer opens the SlashCommandMenu popup
    const composerInput = window.getByTestId('composer-input');
    await composerInput.fill('/team');
    const slashMenu = window.getByTestId('slash-command-menu');
    await expect(slashMenu).toBeVisible();
    await expect(slashMenu).toContainText('/teamwork');

    // Verify quick-start buttons exist
    await expect(window.getByTestId('quick-start-review')).toHaveText('Review this repo');
    await expect(window.getByTestId('quick-start-plan')).toHaveText('Plan a feature with /plan');
    await expect(window.getByTestId('quick-start-teamwork')).toHaveText(
      'Split work with /teamwork',
    );
  } finally {
    await electronApp.close();
  }
});
