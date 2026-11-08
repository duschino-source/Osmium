import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Phase 0 Electron App Shell launches and matches DESIGN.md design spec', async () => {
  const mainEntry = path.resolve(__dirname, '../apps/desktop/dist/main/index.js');

  const electronApp = await electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', mainEntry],
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Home is the Chat surface; Code is the default mode, so switch first.
    await expect(window.getByTestId('titlebar-app-name')).toHaveText('OsmiumIDE');
    // The IDE terminal is a real PTY-backed xterm, not a simulated log.
    await expect(window.getByTestId('terminal-xterm')).toBeVisible();
    await expect(window.getByTestId('terminal-shell-label')).toContainText(/powershell|bash|sh/i);
    // The navigation sidebar closes and reopens from the titlebar.
    await expect(window.getByTestId('app-sidebar')).toBeVisible();
    await window.getByTestId('sidebar-toggle').click();
    await expect(window.getByTestId('app-sidebar')).toHaveCount(0);
    await window.getByTestId('sidebar-toggle').click();
    await expect(window.getByTestId('app-sidebar')).toBeVisible();
    await window.getByTestId('mode-btn-chat').click();
    await expect(window.getByTestId('titlebar-app-name')).toHaveText('Osmium');

    // Verify headline & subtitle
    const headline = window.getByTestId('home-headline');
    await expect(headline).toHaveText('What are we building?');

    const subtitle = window.getByTestId('home-subtitle');
    await expect(subtitle).toHaveText(
      'Connect the coding CLIs you already use. Detection runs locally; nothing leaves this machine.',
    );

    // Verify CSS variable tokens and sidebar geometry (DESIGN.md palette, 232px).
    // Persisted settings may legitimately open the app in dark mode; force the
    // light token set for this deterministic design assertion, then restore.
    const previousTheme = await window.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    const previousPalette = await window.evaluate(() =>
      document.documentElement.getAttribute('data-palette'),
    );
    await window.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.setAttribute('data-palette', 'blue');
    });
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
    await window.evaluate(
      ({ theme, palette }) => {
        if (theme) document.documentElement.setAttribute('data-theme', theme);
        else document.documentElement.removeAttribute('data-theme');
        if (palette) document.documentElement.setAttribute('data-palette', palette);
        else document.documentElement.removeAttribute('data-palette');
      },
      { theme: previousTheme, palette: previousPalette },
    );

    expect(tokenValues.bgGround.toUpperCase()).toBe('#FFFFFF');
    expect(tokenValues.bgSidebar.toUpperCase()).toBe('#F5F5F7');
    expect(tokenValues.borderDefault.toUpperCase()).toBe('#D1D1D6');
    expect(tokenValues.textInk.toUpperCase()).toBe('#1D1D1F');
    expect(tokenValues.accentPrimary.toUpperCase()).toBe('#0071E3');
    expect(tokenValues.cliCodex.toUpperCase()).toBe('#1D1D1F');
    expect(tokenValues.cliAntigravity.toUpperCase()).toBe('#2F5FD0');
    expect(tokenValues.cliDeepseek.toUpperCase()).toBe('#6B4FD0');
    expect(tokenValues.fontSans).toContain('Inter');
    expect(Math.round(tokenValues.sidebarWidthPx)).toBe(232);

    // Home lives in Chat mode (app defaults to Code)
    await window.getByTestId('mode-btn-chat').click();

    // Verify CLI badges always show colored dot + CLI name
    await expect(window.getByTestId('status-chip-codex')).toContainText('Codex CLI · Primary');
    await expect(window.getByTestId('status-chip-antigravity')).toContainText(
      'Antigravity · Second',
    );
    await expect(window.getByTestId('status-chip-deepseek')).toContainText('DeepSeek CLI');
    await expect(window.getByTestId('status-chip-mock')).toContainText('Mock CLI · Test engine');
    await expect(window.getByTestId('connect-cli-chip')).toContainText('Connect CLI');

    // CLI Hub is a real screen, not a highlighted nav item.
    await window.getByTestId('footer-item-cli-hub').click();
    await expect(window.getByTestId('cli-hub')).toBeVisible();
    await expect(window.getByTestId('cli-hub-row-deepseek')).toContainText('Not installed');
    // Settings is a real IDE surface with theme palettes.
    await window.getByTestId('footer-item-settings').click();
    await expect(window.getByTestId('ide-settings-panel')).toBeVisible();
    await expect(window.getByTestId('settings-palette-forest')).toBeVisible();
    // Back to Chat: the composer lives in Home (before a session) and in the
    // session footer afterwards, never in the Code workbench.
    await window.getByTestId('mode-btn-chat').click();

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
