# Osmium Adapter Host — Rust ↔ Electron Bridge Contract

Status: **M2 wiring slice**. This document is the contract between the Rust
adapter crate (`crates/adapters`) and the Electron main process. It exists so
the renderer never spawns processes and the Rust adapters remain the only
implementation of CLI behavior.

## 1. Why a sidecar

`DeepSeekAdapter` and the other adapters are Rust. Electron is Node. A native
napi addon would tie every Electron target to a native build; a sidecar keeps
the boundary process-shaped and restartable. The main process owns the sidecar
lifecycle; the renderer talks only to typed IPC.

```text
Renderer (React)
   │  window.osmium.cli.* / session.*
   ▼
Electron preload (contextBridge)
   │  ipcRenderer.invoke
   ▼
Electron main (AdapterHostClient)
   │  NDJSON over stdin/stdout
   ▼
osmium-adapter-host (Rust sidecar)
   │  crates/adapters
   ▼
codex / antigravity / deepseek / osmium-mock-cli (child processes)
```

No credential is read, stored, logged, or forwarded. The sidecar is a child
process, and the adapter sessions scrub forbidden environment variables before
spawning a CLI (see `crates/adapters/src/env.rs`).

## 2. Process and transport

- Binary: `osmium-adapter-host` from crate `crates/adapter-host`.
- Debug path (dev): `target/debug/osmium-adapter-host` (`.exe` on Windows).
- Release path (packaged): `target/release/osmium-adapter-host`.
- Arguments:
  - `--mock-cli <path>` — optional; makes the `mock` adapter use that binary.
    Used in dev so `target/debug/osmium-mock-cli` is detected without PATH
    changes.
- stdin/stdout: **newline-delimited UTF-8 JSON**, one object per line.
- stderr: human logs only; never protocol.
- stdout: protocol only; never logs.

## 3. Messages

Request:

```json
{ "id": "1", "method": "detectAll", "params": {} }
```

Success response:

```json
{ "id": "1", "result": { } }
```

Failure response:

```json
{ "id": "1", "error": { "code": "ERR_ADAPTER_BINARY_NOT_FOUND", "message": "…" } }
```

Asynchronous notification:

```json
{ "event": "sessionEvent", "sessionId": "deepseek-session-…", "data": { "type": "message", … } }
{ "event": "sessionEnded", "sessionId": "deepseek-session-…" }
```

`event` is the notification name, so the `AgentEvent` itself travels under
`data` (the same key cannot appear twice in one JSON object). Electron main
maps the notification to the renderer payload `{ "sessionId": …, "event": … }`
for `session.onEvent`. `data` payloads are exactly the `AgentEvent` shapes from
`crates/core/src/types.rs` / `packages/core/src/types.ts`:
`message`, `tool`, `file-edit`, `approval`, `usage`, `status`, `raw`.

Responses may arrive out of order. The client matches on `id`. Every request
must produce exactly one response. Unknown methods return
`ERR_HOST_UNKNOWN_METHOD`.

## 4. Methods

### `ping`

Result: `{ "ok": true, "version": "0.1.0" }`

### `detectAll`

Result: a map keyed by `mock`, `codex`, `antigravity`, `deepseek`:

```json
{
  "deepseek": {
    "installed": false,
    "versionWarning": "Binary not found in PATH",
    "capabilities": {
      "acp": false, "jsonStream": false, "resume": false,
      "approvals": false, "readOnlyMode": false, "reportsUsage": false
    }
  }
}
```

Shapes match `CliDetectionResult & { capabilities: Capabilities }` in
`packages/ide-core/src/ipc-types.ts`. Probes run concurrently in the host.

### `detect`

Params: `{ "cliId": "deepseek" }`

Result: `CliDetectionResult` (`installed`, optional `version`, `path`,
`versionWarning`).

### `capabilities`

Params: `{ "cliId": "deepseek" }`

Result: `Capabilities` (`acp`, `jsonStream`, `resume`, `approvals`,
`readOnlyMode`, `reportsUsage`, optional `testedVersion`).

### `getUsage`

Result: `[]` for now. The host has no persisted usage store; returning invented
numbers is forbidden. The UI must render “no usage data” rather than zeros
dressed up as measurements.

### `start`

Params:

```json
{
  "cliId": "mock",
  "cwd": "E:\\SeriousProject\\Osmium",
  "approvalMode": "ask",
  "resume": null,
  "systemContext": null,
  "readOnly": null
}
```

`approvalMode` is `"ask" | "auto-edit" | "full-auto"`.
Result: `{ "sessionId": "mock-session-…", "cliId": "mock", "cwd": "…" }`.

The host stores the session and starts forwarding its `AgentEvent`s as
`sessionEvent` notifications. `start` may probe `--help`, so give it up to
~30 s. If the binary is missing, return `ERR_ADAPTER_BINARY_NOT_FOUND`.

### `send`

Params: `{ "sessionId": "…", "prompt": "…", "attachments": [] }`

Result: `{}`. One turn at a time; a busy session returns
`ERR_ADAPTER_ALREADY_RUNNING`. In `ask` mode a DeepSeek/Mock session emits an
`approval` event and waits for `respondToApproval`.

### `respondToApproval`

Params:

```json
{ "sessionId": "…", "approvalId": "…", "allow": true, "scope": "once" }
```

`scope` is `"once" | "session"` or omitted. Result: `{}`.

### `cancel`

Params: `{ "sessionId": "…" }`

Result: `{}`. Idempotent; kills the child process tree (Windows `taskkill /T`).

### `close`

Params: `{ "sessionId": "…" }`

Result: `{}`. Terminal and irreversible for that session; removes it from the
host map.

### `listSessions`

Result: `[{ "sessionId": "…", "cliId": "mock", "cwd": "…", "startedAt": 0 }]`

### `shutdown`

Result: `{}`, then the host closes all sessions and exits `0`. Electron also
kills the child on quit as a backstop.

## 5. Errors

| Code | Meaning |
|---|---|
| `ERR_HOST_UNKNOWN_METHOD` | Unsupported method name. |
| `ERR_HOST_BAD_REQUEST` | Malformed JSON / missing params. |
| `ERR_HOST_SESSION_NOT_FOUND` | Unknown `sessionId`. |
| `ERR_ADAPTER_BINARY_NOT_FOUND` | CLI is not installed / not executable. |
| `ERR_ADAPTER_UNSUPPORTED_CAPABILITY` | e.g. resume/read-only not advertised. |
| `ERR_ADAPTER_ALREADY_RUNNING` | Turn already in progress or awaiting approval. |
| `ERR_ADAPTER_SESSION_CLOSED` | `send`/`cancel`/approval on a closed session. |
| `ERR_ADAPTER_APPROVAL_NOT_FOUND` | Unknown approval id. |
| `ERR_ADAPTER_*` | Passed through from `crates/adapters/src/error.rs`. |

## 6. Electron main responsibilities

1. Spawn the host lazily; resolve the binary from
   `OSMIUM_ADAPTER_HOST`, then `target/debug`/`target/release`, then the
   packaged resources directory.
2. Pass `--mock-cli <path>` when the dev mock binary exists.
3. Match responses by `id`, reject pending requests on host exit, and allow a
   later request to respawn the host.
4. Forward `sessionEvent` (`data` field) to the renderer on `session:onEvent`
   with `{ sessionId, event }`; maintain an in-memory event log per session for
   `session:getEvents`.
5. Replace the hardcoded `cli:detectAll`. Implement `cli:detect`,
   `cli:getCapabilities`, `cli:test`, `cli:getUsage`, and
   `session:start/send/cancel/respondToApproval/close/list/getEvents`.
6. Default `session.start.cwd` to `process.cwd()` when the renderer omits it.
7. Kill the host on `before-quit`; never leave a zombie.

## 7. Renderer responsibilities

- Never spawn processes; never call the DeepSeek HTTP API.
- Show detection honestly: installed + version, or “Not installed”; never a
  green “connected” state without a detected binary.
- Render every `AgentEvent`: unknown output stays visible as `raw`.
- `approval` events render `ApprovalPrompt` and call `respondToApproval`.
- `file-edit` events accumulate into `EditedFilesCard`.
- `usage` events render a note; no invented quotas.
- `cancel` is available while a turn is running; `close`/new-chat is terminal.

## 8. Verification

```bash
cargo test -p osmium-adapters -p osmium-adapter-host
pnpm test
pnpm --filter @osmium/adapters build && pnpm --filter @osmium/adapters typecheck
node scripts/check-ui-rules.mjs
```

The sidecar protocol is tested by spawning the real host binary and driving it
with the real `osmium-mock-cli`; the renderer is tested with mocked IPC.
