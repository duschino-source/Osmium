# OsmiumIDE — Agent Instructions

## Mandatory UI gate (read before any UI work)

1. Read [DESIGN.md](DESIGN.md) and [PRODUCT.md](PRODUCT.md) first.
2. UI lives in `packages/ui` (design system) and
   `apps/desktop/src/renderer` (shell). Style only through
   `packages/ui/src/tokens.css` variables and `workbench.css` classes.
3. Never: emoji/glyph icons (use `Icon`), hardcoded colors in `.tsx`,
   inline `style={{}}` chrome, gradients/glows, a second accent color.
4. One tint (`--tint`), both themes, hairline separators, 44px toolbar.
5. Preserve every `data-testid`, ARIA role, and keyboard behavior.
6. Before calling UI work done: run `node scripts/check-ui-rules.mjs`
   and the screenshot gate in DESIGN.md §5. Fix violations; never
   allowlist them silently.

## Project facts

- Electron + React 19 + TypeScript (strict) + Vite, `pnpm` monorepo:
  `apps/desktop`, `packages/core`, `packages/ide-core`,
  `packages/adapters`, `packages/ui`, `packages/mock-cli`.
- Verify with `pnpm build`, `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm test`. See `docs/PROGRESS.md` for state.
