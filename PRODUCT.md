# OsmiumIDE — Product Context

Read by every design command (Impeccable) before UI work. See [DESIGN.md](DESIGN.md) for the visual system.

## What this is

OsmiumIDE (Osmium) is a local-first desktop IDE and multi-CLI orchestrator
(Electron + React + TypeScript, `pnpm` monorepo). It runs the coding CLIs a
developer already subscribes to — Codex, Antigravity, DeepSeek, plus a
deterministic mock CLI — as child processes, and never touches provider
tokens, cookies, or API keys.

## Who it is for

Professional developers who live in an IDE all day and run more than one
coding CLI. They compare OsmiumIDE against Xcode and VS Code unconsciously,
in that order of polish expectation.

## What it must do

- Two modes over one workspace: **Chat** (orchestrator: composer, `/plan`,
  `/review`, `/teamwork`, `/cli`, `/undo`) and **Code** (IDE workbench:
  explorer, editor, search, source control, terminal, docked agent panel).
- Sessions, pre-turn git checkpoints with exact undo, teamwork task graphs
  in isolated worktrees, quota-aware CLI fallback.
- Everything local-first and offline-capable; bundled fonts, no CDN calls.

## Constraints

- Electron on Windows first (custom titlebar, right-side window controls),
  macOS conventions for the visual language (Xcode is the reference).
- React 19 + plain CSS custom properties. No Tailwind, no CSS-in-JS, no new
  UI dependencies without a DESIGN.md amendment.
- All `data-testid` attributes are a public contract for the e2e suite and
  must survive any visual change.
- Light and dark themes are both first-class (`data-theme` on `<html>`).

## Design intent in one line

Quiet, neutral, native-feeling workbench chrome that disappears behind the
code — the difference is felt in hairlines, spacing rhythm, and states,
never in decoration.
