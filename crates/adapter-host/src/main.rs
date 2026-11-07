//! `osmium-adapter-host` — the Rust sidecar that exposes `crates/adapters`
//! over newline-delimited JSON on stdin/stdout (see `docs/ADAPTER_BRIDGE.md`).
//!
//! stdout carries protocol lines only; stderr carries human logs. No credential
//! is read, stored, logged, or forwarded: the adapter sessions scrub forbidden
//! environment variables themselves before spawning a CLI.

mod host;
mod protocol;

use host::{write_stdout, HostState};
use osmium_adapters::{builtin_adapters, CliAdapter, CliId, MockCliAdapter};
use protocol::{failure_response, parse_line, success_response, ParsedLine, RpcError};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

/// How long shutdown waits for queued stdout lines to drain before exiting.
const WRITER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

struct HostArgs {
    mock_cli: Option<PathBuf>,
}

#[tokio::main]
async fn main() {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("[adapter-host] {message}");
            std::process::exit(2);
        }
    };

    let mock_cli = args.mock_cli.map(absolutize);
    if let Some(path) = &mock_cli {
        eprintln!("[adapter-host] using mock CLI binary at {}", path.display());
    }

    let adapters = build_adapters(mock_cli);
    let (out_tx, out_rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(write_stdout(out_rx));
    let state = Arc::new(HostState::new(adapters, out_tx.clone()));
    let (shutdown_tx, mut shutdown_rx) = mpsc::unbounded_channel::<()>();

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    loop {
        tokio::select! {
            biased;

            // `shutdown` is answered by its request task, which then wakes the
            // main loop so the process can close sessions and exit cleanly.
            _ = shutdown_rx.recv() => break,
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) => handle_line(&state, &shutdown_tx, line.trim()),
                    Ok(None) => break, // stdin EOF: the client went away.
                    Err(error) => {
                        eprintln!("[adapter-host] stdin read error: {error}");
                        break;
                    }
                }
            }
        }
    }

    drop(shutdown_tx);
    state.close_all().await;
    drop(out_tx);
    drop(state);

    if tokio::time::timeout(WRITER_SHUTDOWN_TIMEOUT, writer)
        .await
        .is_err()
    {
        eprintln!("[adapter-host] timed out waiting for the stdout writer to drain");
    }
    std::process::exit(0);
}

fn handle_line(state: &Arc<HostState>, shutdown_tx: &mpsc::UnboundedSender<()>, line: &str) {
    if line.is_empty() {
        return;
    }

    match parse_line(line) {
        ParsedLine::Request {
            id,
            method,
            params: _,
        } if method == "shutdown" => {
            // Reply first, then wake the main loop so the process can close
            // sessions, drain stdout and exit cleanly.
            let state = Arc::clone(state);
            let shutdown_tx = shutdown_tx.clone();
            tokio::spawn(async move {
                state.enqueue(&success_response(id, serde_json::json!({})));
                let _ = shutdown_tx.send(());
            });
        }
        ParsedLine::Request { id, method, params } => {
            let state = Arc::clone(state);
            tokio::spawn(async move {
                let response = match state.dispatch(&method, &params).await {
                    Ok(result) => success_response(id, result),
                    Err(error) => failure_response(id, error),
                };
                state.enqueue(&response);
            });
        }
        ParsedLine::Invalid { id, message } => {
            state.enqueue(&failure_response(id, RpcError::bad_request(message)));
        }
    }
}

/// Builds the adapter list. `--mock-cli` replaces only the mock entry so the
/// remaining built-ins keep `builtin_adapters()` behavior.
fn build_adapters(mock_cli: Option<PathBuf>) -> Vec<Arc<dyn CliAdapter>> {
    let adapters = builtin_adapters();
    let Some(mock_cli) = mock_cli else {
        return adapters;
    };
    adapters
        .into_iter()
        .map(|adapter| {
            if adapter.id() == &CliId::Mock {
                Arc::new(MockCliAdapter::with_binary_path(mock_cli.clone())) as Arc<dyn CliAdapter>
            } else {
                adapter
            }
        })
        .collect()
}

/// Parses `--mock-cli <path>` / `--mock-cli=<path>`; anything else is an error
/// so a typo can never be mistaken for a protocol option.
fn parse_args() -> Result<HostArgs, String> {
    let mut args = std::env::args_os().skip(1);
    let mut mock_cli = None;

    while let Some(arg) = args.next() {
        let arg = arg.to_string_lossy();
        if arg == "--mock-cli" {
            let value = args
                .next()
                .ok_or_else(|| "--mock-cli requires a path argument".to_string())?;
            mock_cli = Some(PathBuf::from(value));
        } else if let Some(value) = arg.strip_prefix("--mock-cli=") {
            if value.is_empty() {
                return Err("--mock-cli requires a path argument".to_string());
            }
            mock_cli = Some(PathBuf::from(value));
        } else {
            return Err(format!("unknown argument: {arg}"));
        }
    }

    Ok(HostArgs { mock_cli })
}

/// Relative `--mock-cli` paths are anchored to the host's working directory so
/// the adapter's probe and spawn both resolve the same file.
fn absolutize(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }
    std::env::current_dir()
        .map(|cwd| cwd.join(&path))
        .unwrap_or(path)
}
