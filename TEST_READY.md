# Osmium (Argon 4) — E2E Test Suite Readiness Manifest (`TEST_READY.md`)

**Status**: `READY`
**Total E2E Test Cases**: **`276`** (`120` Tier 1 + `120` Tier 2 + `24` Tier 3 + `12` Tier 4)
**Features Covered**: **`24 / 24` (`100%`)** of `/home/antigravity/PROJECT.md § Feature Inventory`

---

## 1. Suite Summary by Tier

| Tier | Methodology Category | Suite Files | Test ID Range | Count | Minimum Required (`N=24`) | Status |
|---|---|---|---|---|---|---|
| **Tier 1** | Feature Coverage (Happy Path) | `e2e/suite/tier1/f01-f12.mjs`, `e2e/suite/tier1/f13-f24.mjs` | `T1-F01-01` .. `T1-F24-05` | **120** (`5` per feature) | `>= 120` (`5N`) | **READY (120/120 PASS)** |
| **Tier 2** | Boundary, Edge & Negative Cases | `e2e/suite/tier2/f01-f12.mjs`, `e2e/suite/tier2/f13-f24.mjs` | `T2-F01-01` .. `T2-F24-05` | **120** (`5` per feature) | `>= 120` (`5N`) | **READY (120/120 PASS)** |
| **Tier 3** | Cross-Feature Pairwise Combinations | `e2e/suite/tier3/pairwise.mjs` | `T3-PW-01` .. `T3-PW-24` | **24** | `>= 24` (`N`) | **READY (24/24 PASS)** |
| **Tier 4** | Real-World Application Scenarios | `e2e/suite/tier4/scenarios.mjs` | `T4-SC-01` .. `T4-SC-12` | **12** | `>= 12` (`0.5N`) | **READY (12/12 PASS)** |
| **Total** | **All 4 Tiers** | **6 Suite Modules + 3 Harnesses** | **All `276` Test IDs** | **276** | **`>= 276`** | **READY (276/276 PASS)** |

---

## 2. How to Run the E2E Test Suite

```bash
# Run the complete 276-test 4-Tier E2E Suite
node /home/antigravity/e2e/runner.mjs

# Run individual tiers
node /home/antigravity/e2e/runner.mjs --tier=1
node /home/antigravity/e2e/runner.mjs --tier=2
node /home/antigravity/e2e/runner.mjs --tier=3
node /home/antigravity/e2e/runner.mjs --tier=4

# Filter by Feature (1..24) or Test ID substring
node /home/antigravity/e2e/runner.mjs --feature=8
node /home/antigravity/e2e/runner.mjs --filter=T4-SC-06

# List all 276 registered tests and per-tier / per-feature counts
node /home/antigravity/e2e/runner.mjs --list

# Output structured JSON results
node /home/antigravity/e2e/runner.mjs --json

# Run with strict workspace package enforcement (for Milestone 5 full-repo verification)
node /home/antigravity/e2e/runner.mjs --strict-workspace
```

---

## 3. Complete 24-Feature Traceability Matrix (`PROJECT.md § Feature Inventory`)

| Feature # | Feature Name | Tier 1 (Happy Path) | Tier 2 (Boundary & Negative) | Tier 3 (Pairwise Combinations) | Tier 4 (End-to-End Scenarios) |
|---|---|---|---|---|---|
| **F01** | `docs/PLAN.md` & `docs/PROGRESS.md` | `T1-F01-01` .. `T1-F01-05` (5) | `T2-F01-01` .. `T2-F01-05` (5) | `T3-PW-11`, `T3-PW-24` | `T4-SC-01`, `T4-SC-07`, `T4-SC-12` |
| **F02** | Child-Process-Only CLI Execution & Zero API Keys | `T1-F02-01` .. `T1-F02-05` (5) | `T2-F02-01` .. `T2-F02-05` (5) | `T3-PW-21` | `T4-SC-01`, `T4-SC-02`, `T4-SC-12` |
| **F03** | Workspace Write Boundary Guard | `T1-F03-01` .. `T1-F03-05` (5) | `T2-F03-01` .. `T2-F03-05` (5) | `T3-PW-09`, `T3-PW-14`, `T3-PW-22` | `T4-SC-03`, `T4-SC-06`, `T4-SC-09`, `T4-SC-12` |
| **F04** | CLI Detection, Probing & Version Warnings | `T1-F04-01` .. `T1-F04-05` (5) | `T2-F04-01` .. `T2-F04-05` (5) | `T3-PW-05`, `T3-PW-21` | `T4-SC-01`, `T4-SC-04`, `T4-SC-12` |
| **F05** | Multi-Transport Session Normalization | `T1-F05-01` .. `T1-F05-05` (5) | `T2-F05-01` .. `T2-F05-05` (5) | `T3-PW-05`, `T3-PW-07` | `T4-SC-02`, `T4-SC-04`, `T4-SC-05` |
| **F06** | `packages/mock-cli` Scripted CLI | `T1-F06-01` .. `T1-F06-05` (5) | `T2-F06-01` .. `T2-F06-05` (5) | `T3-PW-01`, `T3-PW-03`, `T3-PW-19` | `T4-SC-02`, `T4-SC-03`, `T4-SC-08`, `T4-SC-11` |
| **F07** | Session Manager & SQLite Event Log | `T1-F07-01` .. `T1-F07-05` (5) | `T2-F07-01` .. `T2-F07-05` (5) | `T3-PW-01`, `T3-PW-02`, `T3-PW-04`, `T3-PW-10`, `T3-PW-11`, `T3-PW-23` | `T4-SC-02`, `T4-SC-04`, `T4-SC-07`, `T4-SC-08` |
| **F08** | Pre-Turn Git Checkpoints & Undo | `T1-F08-01` .. `T1-F08-05` (5) | `T2-F08-01` .. `T2-F08-05` (5) | `T3-PW-01`, `T3-PW-02`, `T3-PW-03`, `T3-PW-06`, `T3-PW-07`, `T3-PW-15`, `T3-PW-17` | `T4-SC-03`, `T4-SC-05`, `T4-SC-10` |
| **F09** | `.osmium/project.yaml` Config | `T1-F09-01` .. `T1-F09-05` (5) | `T2-F09-01` .. `T2-F09-05` (5) | `T3-PW-04`, `T3-PW-08`, `T3-PW-24` | `T4-SC-01`, `T4-SC-04`, `T4-SC-06` |
| **F10** | Mid-Session CLI Handoff | `T1-F10-01` .. `T1-F10-05` (5) | `T2-F10-01` .. `T2-F10-05` (5) | `T3-PW-04`, `T3-PW-05` | `T4-SC-04`, `T4-SC-08` |
| **F11** | Interactive Approval Gate | `T1-F11-01` .. `T1-F11-05` (5) | `T2-F11-01` .. `T2-F11-05` (5) | `T3-PW-03`, `T3-PW-06` | `T4-SC-02`, `T4-SC-05` |
| **F12** | Slash Commands (`/plan`, `/review`, `/teamwork`, `/cli`, `/undo`) | `T1-F12-01` .. `T1-F12-05` (5) | `T2-F12-01` .. `T2-F12-05` (5) | `T3-PW-02`, `T3-PW-06`, `T3-PW-07`, `T3-PW-08` | `T4-SC-03`, `T4-SC-05`, `T4-SC-06` |
| **F13** | `/teamwork` Planner, Router, Worktrees, Scheduler & Merge | `T1-F13-01` .. `T1-F13-05` (5) | `T2-F13-01` .. `T2-F13-05` (5) | `T3-PW-08`, `T3-PW-09`, `T3-PW-10`, `T3-PW-11`, `T3-PW-12` | `T4-SC-06`, `T4-SC-07`, `T4-SC-08`, `T4-SC-10` |
| **F14** | Usage Meter & Quota Fallback | `T1-F14-01` .. `T1-F14-05` (5) | `T2-F14-01` .. `T2-F14-05` (5) | `T3-PW-10` | `T4-SC-08` |
| **F15** | IDE Explorer & File Watcher | `T1-F15-01` .. `T1-F15-05` (5) | `T2-F15-01` .. `T2-F15-05` (5) | `T3-PW-13`, `T3-PW-14` | `T4-SC-09` |
| **F16** | Monaco Multi-Tab & Split Editor | `T1-F16-01` .. `T1-F16-05` (5) | `T2-F16-01` .. `T2-F16-05` (5) | `T3-PW-13`, `T3-PW-14`, `T3-PW-15`, `T3-PW-18`, `T3-PW-19`, `T3-PW-23` | `T4-SC-09`, `T4-SC-11` |
| **F17** | Ripgrep Project Search & Replace | `T1-F17-01` .. `T1-F17-05` (5) | `T2-F17-01` .. `T2-F17-05` (5) | `T3-PW-15` | `T4-SC-09` |
| **F18** | Integrated Multi-Tab Split Terminal (`node-pty`) | `T1-F18-01` .. `T1-F18-05` (5) | `T2-F18-01` .. `T2-F18-05` (5) | `T3-PW-16`, `T3-PW-20` | `T4-SC-09` |
| **F19** | Source Control & Inline Hunk Review | `T1-F19-01` .. `T1-F19-05` (5) | `T2-F19-01` .. `T2-F19-05` (5) | `T3-PW-09`, `T3-PW-12`, `T3-PW-13`, `T3-PW-17` | `T4-SC-03`, `T4-SC-06`, `T4-SC-10` |
| **F20** | Code Intelligence & LSP Manager | `T1-F20-01` .. `T1-F20-05` (5) | `T2-F20-01` .. `T2-F20-05` (5) | `T3-PW-18`, `T3-PW-20` | `T4-SC-11` |
| **F21** | Docked Agent Panel, Context Chips & Follow Agent | `T1-F21-01` .. `T1-F21-05` (5) | `T2-F21-01` .. `T2-F21-05` (5) | `T3-PW-12`, `T3-PW-16`, `T3-PW-17`, `T3-PW-18`, `T3-PW-19` | `T4-SC-09`, `T4-SC-10`, `T4-SC-11` |
| **F22** | Tasks Runner & DAP Debugger | `T1-F22-01` .. `T1-F22-05` (5) | `T2-F22-01` .. `T2-F22-05` (5) | `T3-PW-16`, `T3-PW-20` | `T4-SC-11` |
| **F23** | Adapter SDK & `~/.osmium/extensions/` API | `T1-F23-01` .. `T1-F23-05` (5) | `T2-F23-01` .. `T2-F23-05` (5) | `T3-PW-21`, `T3-PW-22` | `T4-SC-12` |
| **F24** | Design System, Command Registry, Palette, Replay, Dark Theme & Release | `T1-F24-01` .. `T1-F24-05` (5) | `T2-F24-01` .. `T2-F24-05` (5) | `T3-PW-22`, `T3-PW-23`, `T3-PW-24` | `T4-SC-01`, `T4-SC-12` |

---

## 4. Tier 4 Real-World Application Scenarios (`T4-SC-01` .. `T4-SC-12`)

1. **`T4-SC-01`**: First Run, Project Open, & CLI Hub Detection + Capability Probe + Home Screen Status Chips
2. **`T4-SC-02`**: Full Chat Session with `mock-cli` (Streaming, Tool Lines, Approval Prompt, Cancel, SQLite Restart Persistence)
3. **`T4-SC-03`**: Agent File Edit, Right-Pane Diff Inspection, and Checkpoint `Undo` Restoring Working Tree Byte-for-Byte
4. **`T4-SC-04`**: Multi-CLI Project (`codex` Primary, `antigravity` & `deepseek` Secondary) with Mid-Session Switch & Handoff Line
5. **`T4-SC-05`**: `/plan` & `/review` End-to-End Workflow (Editable Checklist Gate + Secondary CLI Read-Only Review)
6. **`T4-SC-06`**: `/teamwork` Happy Path Splitting a Goal into 4 Tasks Across 3 CLIs in Isolated `.osmium/worktrees/` and Merging Cleanly into `osmium/integration`
7. **`T4-SC-07`**: App Kill and Restart Mid-`/teamwork` Run with Automatic Scheduler Resumption
8. **`T4-SC-08`**: Simulated Quota Limit Hit (`limitHit: true`) Moving a Running Task to the Next Secondary CLI
9. **`T4-SC-09`**: IDE Workbench Workflow: Lazy Explorer, Multi-Tab Monaco Edit, Disk-Conflict Guard, Ripgrep Search & Replace, Terminal `Fix this error`
10. **`T4-SC-10`**: Source Control Inline Hunk Review (`Accept`, `Reject`, `Ask to change`, `Accept all`, `Reject all`), Commit, and 3-Way Merge Conflict Resolution
11. **`T4-SC-11`**: IDE Code Intelligence (TS/Python Diagnostics, Problems Panel, Context Chips `@compare.ts`, `@selection`, `@problems`, `Follow agent`)
12. **`T4-SC-12`**: Third-Party Adapter SDK Template Loading & `~/.osmium/extensions/` Theme/LSP Loading + Dark Theme Token Swap & Governance Docs
