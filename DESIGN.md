# OsmiumIDE Design System — Base Rules for All UI Work

This is the canonical rulebook. Every human and every AI agent reads this
file **before** writing or changing UI. `AGENTS.md` carries the short
mandatory gate; this file carries the substance. In a conflict, this file
wins over habit, over generic AI taste, and over older screenshots.

Reference product: **Xcode** (and Apple system apps generally). Not VS Code
chrome, not a web landing page. The feeling to produce: quiet neutral
materials, one tint, hairline separators, precise spacing rhythm — the
difference is felt, not decorated.

## 1. Non-negotiables (the bans)

Fail any of these and the change does not ship. `scripts/check-ui-rules.mjs`
enforces the machine-checkable ones in CI.

1. **No emoji or text glyphs as icons.** No 📁 🔍 🤖 🔄, no `▸ ▾ ⎇ ✕ ⚠`,
   no `TS`/`JS` letter chips. Every icon is the shared `Icon` component
   (`packages/ui/src/ide/Icon.tsx`, 24px grid, 1.6 stroke, round caps).
   Need an icon that does not exist? Add it there, in the same weight.
2. **No hardcoded colors in components.** No hex, `rgb()`, or named colors
   in `.tsx` files or in `workbench.css`. Colors live only in
   `packages/ui/src/tokens.css` (and syntax token mapping in
   `packages/ui/src/ide/syntax.ts` stays token-driven via `.syn-*`).
3. **No inline `style={{}}` for chrome.** Layout and appearance belong in
   classes. Sanctioned exceptions: truly dynamic values (CLI dot color
   from data via `getCliCssVariable`, caret-line offset, tree indent,
   show/hide display toggle) and a shared component's sizing/placement
   `style` prop (e.g. `DropdownMenu` min-width/placement). Static
   colors, spacing, or layout in a `style` prop are never sanctioned.
   `workbench.css` classes (`.xc-*` toolbar, `.os-*` shared controls,
   `.ed-*` editor, `.wb-*` workbench panels, `.app-*` shell). A dynamic
   value that truly cannot be a class (e.g. a CLI dot color from data)
   uses the existing CSS-variable/token pattern, never a literal.
4. **One tint.** `--tint` / `--accent-primary` (`#0071e3`) is the only
   accent hue. In dark, `--tint` is the lighter variant of the same hue
   for text/icons while `--accent-primary` stays the fill ? that is one
   hue at two luminosities (Apple's own practice), not two accents. Green exists only as the semantic
   `--state-ok` / `--git-added`. No second brand color, no purple or
   indigo accents, no gradients of any kind as decoration.
   **Logo exception.** The owner-supplied OsmiumIDE mark is the only
   brand asset. Its ink and core use `--brand-mark-ink` and
   `--brand-mark-accent`; those tokens are logo-only and never UI
   chrome, so the one-tint rule still governs every interface surface.
5. **No AI slop.** No purple-to-blue gradients, no gradient text, no
   aurora blobs or glowing shadows, no identical glow on every card, no
   cards nested in cards, no left-border accent cards, no glassmorphism
   on every surface (translucency is for popovers/menus only), no
   `hover: scale()` lifts on chrome, no spring overshoot
   (`cubic-bezier` with bounce, `scale(1.02)`, `translateX` slides) on
   workbench controls.
   Sanctioned typographic labels (not icons): the search toggles
   `Aa` / whole-word / `.*` keep their VS Code-conventional labels as
   text buttons with `title` + `aria-pressed`, and the terminal `$` is
   prompt content, not an icon.
6. **CLI identity is dot + name, never color alone** (accessibility and
   an existing product rule). `CliBadge` is the only way to show a CLI.
7. **Both themes, always.** Every new surface is checked in light and
   dark before it is called done. `data-theme` token swaps only — no
   per-theme component branches.
8. **Preserve the contract.** `data-testid` attributes, ARIA roles, and
   keyboard behavior do not change in a visual pass.

## 2. Tokens (the only palette)

Defined in `packages/ui/src/tokens.css`. Use the variable, never the value.

| Role | Variable | Light intent |
| --- | --- | --- |
| Content ground | `--bg-ground` | white editor/content |
| Chrome (toolbar, tab bar) | `--bg-chrome` | neutral light gray |
| Source-list sidebar | `--bg-sidebar` | neutral, same family as chrome |
| Panel surface | `--bg-ide-panel`, `--bg-surface` | panel / raised surface |
| Sunken field | `--bg-sunken` | inset inputs, composer bar |
| Controls | `--bg-control` (+hover/active) | translucent neutral fills |
| Separators | `--border-default`, `--border-subtle`, `--border-strong` | hairlines, subtle first |
| Text | `--text-ink`, `--text-muted`, `--text-faint` | ink for body; muted only for secondary |
| Tint | `--tint`, `--accent-primary` (+hover/active) | the single accent |
| Brand mark | `--brand-mark-ink`, `--brand-mark-accent` | owner-supplied logo only; never UI chrome |
| Semantic | `--state-ok/warn/error`, `--git-*`, `--bg-diff-*` | meaning, not branding |
| Editor | `--editor-*`, `--syn-*`, `--term-*` | Xcode Default syntax, both themes |

Typography: `--font-sans` (system SF/Segoe first, bundled Inter as the
shipped face), `--font-mono` for code. Body 13px, small 12px, caption
11px. Numbers that align (line/column, counts, timers) use tabular
numerals (`.osmium-tabular`). Hierarchy comes from size/weight/color —
never from a single weight everywhere, never tracked all-caps kickers
above every section (panel headers are the one sanctioned caption style:
11px, 600, `0.04em`, muted).

Radii: `--radius-xs/sm/md/lg` (4/6/10/12). Pills only for tiny status
chips and the send button. Never one radius on everything.
Elevation: `--shadow-sm` for resting controls, `--shadow-popover` only
for menus/popovers/palette. No colored shadows, no glow.
Motion: `--transition-quick` (120ms) / `--transition-smooth` (200ms),
`--ease-out` exponential. Motion expresses state (open, selected,
pressed), never decoration. `prefers-reduced-motion` is already honored
globally — do not reintroduce animation that bypasses it.

**Theme palettes.** Settings exposes Light / Dark / System and four accent
palettes (Blue, Teal, Forest, Graphite). A palette swaps only the
`--tint` / `--accent-primary` trio and its text-on-accent pair; each palette
still uses exactly one accent hue. No palette introduces a gradient, glow, or
second simultaneous accent.

## 3. Layout grammar

- Unified toolbar **44px** (`--toolbar-height`) — titlebar, toolbar, and
  window chrome are one bar, Xcode-style. No second menu bar.
- App navigation sidebar `--sidebar-width`; IDE navigator
  `--navigator-width`; inspector/agent `--inspector-width`; activity bar
  `--activity-bar-width` (44px); status bar `--status-bar-height` (24px).
- Status bar is neutral chrome with a hairline top border. It is never a
  solid brand-color bar.
- Spacing rhythm: 4px base (4/6/8/10/12/16). Panel headers 8px 12px.
  Rows: tree rows 24px, menu items 28px, tabs 32px. If a value is not on
  the rhythm, it is a bug or a token.
- Separators are hairlines (`--border-subtle` first). Boxes earn a
  border + shadow only when they float (menu, popover, palette, dialog).

## 4. Components — reuse before inventing

In `packages/ui/src/components.tsx` and `packages/ui/src/ide/`:
`Button` (default/primary/ghost), `Card`, `CliBadge`, `Composer`,
`DropdownMenu`, `ContextChip`, `SlashCommandMenu`, `EditedFilesCard`,
`ApprovalPrompt`, `Icon`, and the workbench pieces (`FileExplorer`,
`EditorWorkspace`, `SearchPanel`, `SourceControlPanel`, `TerminalPanel`,
`AgentDockedPanel`, `StatusBar`, `IdeWorkbench`).

- A new control is added to the shared set with its states (rest, hover,
  pressed, focus-visible, disabled, selected) or it is not added at all.
- Segmented controls (`.xc-segmented`) for mode switches; pane toggles
  (`.xc-pane-btn`) for showing/hiding regions; popover menus (`.os-menu`)
  for all dropdowns — one menu implementation, keyboard included.
- Focus is visible: the global `:focus-visible` tint ring is the style;
  never `outline: none` without its replacement.

## 5. Process rules (how UI work is done)

Adapted from Impeccable (steer/review vocabulary, slop detection) and
Taste Skill (reference-first, real-render finish gate), translated from
web pages to this Electron IDE:

1. **Reference first.** Open the target in `docs/design/` and, for
   workbench work, Xcode's actual layout before writing CSS. State in
   the change what the reference is.
2. **Tokens → classes → components → screens**, in that order. Never
   style a screen around a missing primitive; build the primitive.
3. **Narrow critique.** Review one surface at a time (Impeccable:
   `critique` for usability ranking, `audit` for a11y/perf/theming,
   P0 blocking → P3 polish; then `polish`). A whole-app glance is not
   a review.
4. **Screenshot gate.** `scripts/shoot-ui.mjs` captures each changed
   surface at 1440px, 1200×720 (default window), 960×600 (minimum), in
   light and dark. No fixable FAIL may remain; at most 3
   critique→fix rounds, then escalate to the human instead of looping.
5. **Checker before commit.** `node scripts/check-ui-rules.mjs` must
   pass. Do not add allowlist entries to make a red check quiet; fix
   the violation or amend this file with a reason.
6. **Amending these rules** means editing this file in the same change,
   with the reason in the commit/PR. Silent drift is the failure mode
   this file exists to prevent.

## 6. Skill pins

Vendored for reproducibility (see `.agents/skills/`): Impeccable
(design vocabulary: `critique`/`audit`/`polish`, 62-rule slop detector)
and Taste Skill `design-taste-frontend` v2.5.1 (reference-first,
browser-check finish gate). Their web-page-specific rules (heroes,
photography, sections) do not apply here; Sections 1–5 above are the
applicable translation, and this file outranks both skills on conflict.
