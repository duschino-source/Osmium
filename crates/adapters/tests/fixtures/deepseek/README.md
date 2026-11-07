# DeepSeek adapter fixtures

These are **synthetic** fixtures, not recordings of a real DeepSeek CLI. No
real `deepseek` binary was installed on the development host when the adapter
was written. They exist to exercise the real adapter code paths:

- `fake-deepseek.mjs` — executable used by
  `crates/adapters/tests/deepseek_adapter_test.rs`. It reads the prompt from
  stdin, rejects any argv token the adapter did not derive from `--help`, and
  prints one of the fixtures below.
- `help-rich.txt` — advertises `--json`, `--resume`, `--read-only`, `--usage`.
- `help-minimal.txt` — advertises no flags (the conservative case).
- `version.txt` — `deepseek 2.0.0`. The adapter has no tested version, so
  detection must not emit a "newer than tested" warning for it.
- `stream-json.ndjson` — a normalized NDJSON stream (message, tool,
  file-edit, usage, status).
- `plain-output.txt` — unstructured stdout that must survive as `raw`.

The fixtures contain no credentials. Do not add real CLI output unless it was
actually recorded from a real binary; label it with the version and date.
