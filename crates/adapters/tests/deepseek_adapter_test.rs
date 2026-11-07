//! DeepSeek adapter integration tests.
//!
//! No real `deepseek` binary is installed on the development host, so these
//! tests drive the real adapter (spawn, stdio, normalizer, cancel/close) with
//! `tests/fixtures/deepseek/fake-deepseek.mjs`. The fake rejects every argv
//! token the adapter did not derive from `--help`; that is what makes these
//! tests fail if an invented command line (`chat --json` and friends) comes
//! back.

use osmium_adapters::*;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::TempDir;
use tokio::sync::mpsc::UnboundedReceiver;

struct FakeCli {
    _dir: TempDir,
    path: PathBuf,
}

fn node_binary() -> Option<PathBuf> {
    find_in_path("node").or_else(|| find_in_path("node.exe"))
}

/// Builds a wrapper in a directory whose name contains a space, so every test
/// also covers "paths with spaces" on Windows.
fn fake_cli(profile: &str) -> Option<FakeCli> {
    let node = node_binary()?;
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("deepseek");
    let script = fixtures.join("fake-deepseek.mjs");
    if !script.is_file() {
        return None;
    }

    let dir = tempfile::Builder::new()
        .prefix("deepseek fake ")
        .tempdir()
        .ok()?;

    #[cfg(windows)]
    let wrapper = {
        let path = dir.path().join("fake-deepseek.cmd");
        let body = format!(
            "@echo off\r\n\"{}\" \"{}\" --fake-profile {} %*\r\n",
            node.display(),
            script.display(),
            profile
        );
        std::fs::write(&path, body).ok()?;
        path
    };

    #[cfg(unix)]
    let wrapper = {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.path().join("fake-deepseek");
        let body = format!(
            "#!/bin/sh\nexec \"{}\" \"{}\" --fake-profile {} \"$@\"\n",
            node.display(),
            script.display(),
            profile
        );
        std::fs::write(&path, body).ok()?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).ok()?;
        path
    };

    Some(FakeCli {
        _dir: dir,
        path: wrapper,
    })
}

fn start_opts(cwd: &Path, approval_mode: ApprovalMode) -> StartOptions {
    StartOptions {
        cwd: cwd.to_string_lossy().to_string(),
        approval_mode,
        resume: None,
        system_context: None,
        read_only: None,
    }
}

fn work_dir() -> TempDir {
    tempfile::Builder::new()
        .prefix("deepseek cwd ")
        .tempdir()
        .expect("temp dir")
}

async fn recv_one(rx: &mut UnboundedReceiver<AgentEvent>, timeout: Duration) -> Option<AgentEvent> {
    tokio::time::timeout(timeout, rx.recv())
        .await
        .ok()
        .flatten()
}

async fn collect_until_terminal(
    rx: &mut UnboundedReceiver<AgentEvent>,
    timeout: Duration,
) -> Vec<AgentEvent> {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut events = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match recv_one(rx, remaining).await {
            Some(event) => {
                let terminal = matches!(
                    &event,
                    AgentEvent::Status {
                        state: SessionState::Idle | SessionState::Error | SessionState::Cancelled,
                        ..
                    }
                );
                events.push(event);
                if terminal {
                    break;
                }
            }
            None => break,
        }
    }
    events
}

fn raw_text(events: &[AgentEvent]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::Raw { data } => Some(data.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn message_text(events: &[AgentEvent]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::Message { role, text, .. } if *role == MessageRole::Assistant => {
                Some(text.as_str())
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

async fn wait_for_file(path: &Path, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if path.is_file() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    path.is_file()
}

#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    let filter = format!("PID eq {pid}");
    match std::process::Command::new("tasklist")
        .args(["/FI", &filter, "/NH"])
        .output()
    {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .split_whitespace()
            .any(|token| token == pid.to_string()),
        Err(_) => false,
    }
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

async fn wait_for_death(pid: u32, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if !process_alive(pid) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    !process_alive(pid)
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

#[tokio::test]
async fn detects_fake_deepseek_and_reports_its_version() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let adapter = DeepSeekAdapter::with_binary_path(fake.path.clone());
    let detection = adapter.detect().await.unwrap();
    assert!(detection.installed);
    assert_eq!(detection.version.as_deref(), Some("2.0.0"));
    assert!(detection
        .path
        .as_deref()
        .unwrap_or_default()
        .contains("fake-deepseek"));
    assert!(
        detection.version_warning.is_none(),
        "no verified version means no newer-than-tested warning"
    );
}

#[tokio::test]
async fn capabilities_are_all_false_without_a_binary() {
    let adapter =
        DeepSeekAdapter::with_binary_path(PathBuf::from("definitely-not-a-deepseek-binary"));
    let caps = adapter.capabilities().await.unwrap();
    assert!(!caps.acp);
    assert!(!caps.json_stream);
    assert!(!caps.resume);
    assert!(!caps.approvals);
    assert!(!caps.read_only_mode);
    assert!(!caps.reports_usage);
    assert!(caps.tested_version.is_none());
}

#[tokio::test]
async fn capabilities_reject_flags_the_help_screen_does_not_show() {
    let Some(fake) = fake_cli("minimal") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let caps = adapter.capabilities().await.unwrap();
    assert!(!caps.acp);
    assert!(!caps.json_stream);
    assert!(!caps.resume);
    assert!(!caps.approvals);
    assert!(!caps.read_only_mode);
    assert!(!caps.reports_usage);
    assert!(caps.tested_version.is_none());
}

#[tokio::test]
async fn capabilities_follow_the_advertised_help_flags() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let caps = adapter.capabilities().await.unwrap();
    assert!(caps.json_stream, "--json was advertised");
    assert!(caps.resume, "--resume was advertised");
    assert!(caps.read_only_mode, "--read-only was advertised");
    assert!(caps.reports_usage, "--usage was advertised");
    // Not implemented by this adapter, so they must never be claimed.
    assert!(!caps.acp);
    assert!(!caps.approvals);
    assert!(caps.tested_version.is_none());
}

// ---------------------------------------------------------------------------
// Streaming and normalization
// ---------------------------------------------------------------------------

#[tokio::test]
async fn streams_normalized_events_from_the_json_transport() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut session = adapter
        .start(start_opts(cwd.path(), ApprovalMode::FullAuto))
        .await
        .unwrap();
    let mut rx = session.take_event_receiver().unwrap();
    session.send("hello", None).await.unwrap();

    let events = collect_until_terminal(&mut rx, Duration::from_secs(15)).await;
    assert!(
        events.iter().any(|event| matches!(
            event,
            AgentEvent::Message { final_: true, text, .. } if text.contains("Updated src/main.ts")
        )),
        "missing final assistant message: {events:?}"
    );
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::Tool {
            status: ToolStatus::Done,
            ..
        }
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::FileEdit { path, added, removed }
            if path == "src/main.ts" && *added == 4 && *removed == 1
    )));
    assert!(events
        .iter()
        .any(|event| matches!(event, AgentEvent::Usage { .. })));
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::Status {
            state: SessionState::Idle,
            ..
        }
    )));

    session.close().await.unwrap();
}

#[tokio::test]
async fn plain_stdout_is_preserved_as_raw_and_never_guessed() {
    let Some(fake) = fake_cli("minimal") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut session = adapter
        .start(start_opts(cwd.path(), ApprovalMode::FullAuto))
        .await
        .unwrap();
    let mut rx = session.take_event_receiver().unwrap();
    session.send("hello", None).await.unwrap();

    let events = collect_until_terminal(&mut rx, Duration::from_secs(15)).await;
    let raw = raw_text(&events);
    assert!(
        raw.contains("DeepSeek CLI (synthetic fixture)"),
        "raw was {raw:?}"
    );
    assert!(
        raw.contains("Updated src/main.ts (+4 -1)"),
        "raw was {raw:?}"
    );
    assert!(raw.contains("Done."), "raw was {raw:?}");
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, AgentEvent::Message { .. })),
        "unstructured text must not be invented as assistant messages"
    );

    session.close().await.unwrap();
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ask_mode_blocks_before_spawning_and_allow_runs_the_turn() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut session = adapter
        .start(start_opts(cwd.path(), ApprovalMode::Ask))
        .await
        .unwrap();
    let mut rx = session.take_event_receiver().unwrap();

    session.send("hello", None).await.unwrap();
    let first = recv_one(&mut rx, Duration::from_secs(5))
        .await
        .expect("approval event");
    let AgentEvent::Approval { id, kind, detail } = first else {
        panic!("expected approval first, got {first:?}");
    };
    assert_eq!(kind, ApprovalKind::Command);
    assert!(
        detail.contains("Osmium approval gate"),
        "detail was {detail:?}"
    );
    assert!(
        !cwd.path().join(".fake-spawned").exists(),
        "the CLI must not be spawned before approval"
    );

    session
        .respond_to_approval(&id, true, Some(ApprovalScope::Once))
        .await
        .unwrap();
    let events = collect_until_terminal(&mut rx, Duration::from_secs(15)).await;
    assert!(
        events.iter().any(|event| matches!(
            event,
            AgentEvent::Message { final_: true, text, .. } if text.contains("Updated src/main.ts")
        )),
        "allowed turn produced no assistant message: {events:?}"
    );
    assert!(cwd.path().join(".fake-spawned").exists());
}

#[tokio::test]
async fn deny_mode_never_spawns_the_cli() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut session = adapter
        .start(start_opts(cwd.path(), ApprovalMode::Ask))
        .await
        .unwrap();
    let mut rx = session.take_event_receiver().unwrap();

    session.send("hello", None).await.unwrap();
    let first = recv_one(&mut rx, Duration::from_secs(5))
        .await
        .expect("approval event");
    let AgentEvent::Approval { id, .. } = first else {
        panic!("expected approval first, got {first:?}");
    };
    session.respond_to_approval(&id, false, None).await.unwrap();

    let events = collect_until_terminal(&mut rx, Duration::from_secs(5)).await;
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::Tool {
            status: ToolStatus::Error,
            ..
        }
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::Status {
            state: SessionState::Idle,
            ..
        }
    )));
    assert!(
        !cwd.path().join(".fake-spawned").exists(),
        "a denied prompt must never reach the CLI"
    );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cancel_kills_the_process_tree_and_is_idempotent() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut session = adapter
        .start(start_opts(cwd.path(), ApprovalMode::FullAuto))
        .await
        .unwrap();
    let mut rx = session.take_event_receiver().unwrap();

    session.send("SLOW", None).await.unwrap();
    let pid_path = cwd.path().join(".fake-pid");
    assert!(
        wait_for_file(&pid_path, Duration::from_secs(10)).await,
        "fake CLI never started"
    );
    let pid: u32 = std::fs::read_to_string(&pid_path)
        .unwrap()
        .trim()
        .parse()
        .unwrap();

    session.cancel().await.unwrap();
    // Cancellation is idempotent.
    session.cancel().await.unwrap();

    let events = collect_until_terminal(&mut rx, Duration::from_secs(5)).await;
    assert!(
        events.iter().any(|event| matches!(
            event,
            AgentEvent::Status {
                state: SessionState::Cancelled,
                ..
            }
        )),
        "missing cancelled status: {events:?}"
    );
    assert!(
        wait_for_death(pid, Duration::from_secs(5)).await,
        "cancelling the .cmd wrapper left the Node child running (pid {pid})"
    );
}

#[tokio::test]
async fn close_is_terminal_and_idempotent() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut session = adapter
        .start(start_opts(cwd.path(), ApprovalMode::FullAuto))
        .await
        .unwrap();
    let mut rx = session.take_event_receiver().unwrap();
    session.send("hello", None).await.unwrap();
    let _ = collect_until_terminal(&mut rx, Duration::from_secs(15)).await;

    session.close().await.unwrap();
    session.close().await.unwrap();
    let err = session.send("again", None).await.unwrap_err();
    assert_eq!(
        err.downcast_ref::<AdapterError>()
            .map(AdapterError::error_code),
        Some("ERR_ADAPTER_SESSION_CLOSED")
    );
}

// ---------------------------------------------------------------------------
// Prompt transport and options
// ---------------------------------------------------------------------------

#[tokio::test]
async fn prompt_with_shell_metacharacters_survives_stdin() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let prompt = "ECHO_MARKER a&b | c > d 50% \"quoted\" <tag> ^caret";
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut session = adapter
        .start(start_opts(cwd.path(), ApprovalMode::FullAuto))
        .await
        .unwrap();
    let mut rx = session.take_event_receiver().unwrap();
    session.send(prompt, None).await.unwrap();

    let events = collect_until_terminal(&mut rx, Duration::from_secs(15)).await;
    let text = message_text(&events);
    assert!(text.contains("STDIN_BEGIN"), "message was {text:?}");
    assert!(
        text.contains(prompt),
        "prompt was mangled by the shell/CLI boundary: {text:?}"
    );
    assert!(text.contains("STDIN_END"), "message was {text:?}");
}

#[tokio::test]
async fn system_context_is_delivered_with_the_prompt() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut opts = start_opts(cwd.path(), ApprovalMode::FullAuto);
    opts.system_context = Some("PROJECT RULES: use tabs".to_string());
    let mut session = adapter.start(opts).await.unwrap();
    let mut rx = session.take_event_receiver().unwrap();
    session.send("ECHO_MARKER hello", None).await.unwrap();

    let events = collect_until_terminal(&mut rx, Duration::from_secs(15)).await;
    let text = message_text(&events);
    assert!(
        text.contains("[Osmium session context]"),
        "message was {text:?}"
    );
    assert!(
        text.contains("PROJECT RULES: use tabs"),
        "message was {text:?}"
    );
    assert!(text.contains("hello"), "message was {text:?}");
}

#[tokio::test]
async fn resume_flag_is_forwarded_only_when_advertised() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut opts = start_opts(cwd.path(), ApprovalMode::FullAuto);
    opts.resume = Some("sess-123".to_string());
    let mut session = adapter.start(opts).await.unwrap();
    let mut rx = session.take_event_receiver().unwrap();
    session.send("hello", None).await.unwrap();

    let events = collect_until_terminal(&mut rx, Duration::from_secs(15)).await;
    assert!(
        raw_text(&events).contains("RESUME=sess-123"),
        "resume flag was not forwarded: {events:?}"
    );
}

#[tokio::test]
async fn resume_is_rejected_when_the_cli_does_not_advertise_it() {
    let Some(fake) = fake_cli("minimal") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut opts = start_opts(cwd.path(), ApprovalMode::FullAuto);
    opts.resume = Some("sess-123".to_string());
    let err = match adapter.start(opts).await {
        Ok(_) => panic!("start must reject an unsupported resume request"),
        Err(err) => err,
    };
    assert_eq!(
        err.downcast_ref::<AdapterError>()
            .map(AdapterError::error_code),
        Some("ERR_ADAPTER_UNSUPPORTED_CAPABILITY")
    );
}

#[tokio::test]
async fn read_only_is_rejected_when_the_cli_does_not_advertise_it() {
    let Some(fake) = fake_cli("minimal") else {
        eprintln!("skipping: node is not available");
        return;
    };
    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut opts = start_opts(cwd.path(), ApprovalMode::FullAuto);
    opts.read_only = Some(true);
    let err = match adapter.start(opts).await {
        Ok(_) => panic!("start must reject an unsupported read-only request"),
        Err(err) => err,
    };
    assert_eq!(
        err.downcast_ref::<AdapterError>()
            .map(AdapterError::error_code),
        Some("ERR_ADAPTER_UNSUPPORTED_CAPABILITY")
    );
}

// ---------------------------------------------------------------------------
// Zero API key invariant
// ---------------------------------------------------------------------------

struct EnvRestore;

impl Drop for EnvRestore {
    fn drop(&mut self) {
        std::env::remove_var("DEEPSEEK_API_KEY");
        std::env::remove_var("DEEPSEEK_SESSION_TOKEN");
    }
}

#[tokio::test]
async fn credentials_are_absent_from_the_child_environment() {
    let Some(fake) = fake_cli("rich") else {
        eprintln!("skipping: node is not available");
        return;
    };

    // Environment variables are process-global; serialise with the only other
    // test that mutates them.
    static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = ENV_LOCK.lock().await;

    std::env::set_var("DEEPSEEK_API_KEY", "sk-test-must-not-leak");
    std::env::set_var("DEEPSEEK_SESSION_TOKEN", "session-test-must-not-leak");
    let _restore = EnvRestore;

    let cwd = work_dir();
    let adapter = DeepSeekAdapter::with_binary_path(fake.path);
    let mut session = adapter
        .start(start_opts(cwd.path(), ApprovalMode::FullAuto))
        .await
        .unwrap();
    let mut rx = session.take_event_receiver().unwrap();
    session.send("REPORT_ENV", None).await.unwrap();

    let events = collect_until_terminal(&mut rx, Duration::from_secs(15)).await;
    let raw = raw_text(&events);
    assert!(raw.contains("ENV "), "no env report in {events:?}");
    assert!(
        raw.contains("DEEPSEEK_API_KEY=absent"),
        "DEEPSEEK_API_KEY leaked into the child: {raw:?}"
    );
    assert!(
        raw.contains("DEEPSEEK_SESSION_TOKEN=absent"),
        "DEEPSEEK_SESSION_TOKEN leaked into the child: {raw:?}"
    );
    assert!(!raw.contains("sk-test-must-not-leak"));
    assert!(!raw.contains("session-test-must-not-leak"));
}

#[test]
fn forbidden_environment_list_covers_deepseek_credentials() {
    for key in [
        "DEEPSEEK_API_KEY",
        "DEEPSEEK_SESSION_TOKEN",
        "DEEPSEEK_AUTH_TOKEN",
        "DEEPSEEK_ACCESS_TOKEN",
        "DEEPSEEK_REFRESH_TOKEN",
    ] {
        assert!(
            osmium_adapters::env::is_forbidden_env_var(key),
            "{key} must be scrubbed before spawning a CLI"
        );
    }
    // Non-credential configuration must survive.
    assert!(!osmium_adapters::env::is_forbidden_env_var(
        "DEEPSEEK_BASE_URL"
    ));
}

// ---------------------------------------------------------------------------
// Fixture replay and probe hardening
// ---------------------------------------------------------------------------

#[test]
fn recorded_stream_replays_through_the_real_normalizer() {
    let fixture = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("deepseek")
            .join("stream-json.ndjson"),
    )
    .expect("stream fixture");

    for input in [fixture.clone(), fixture.replace('\n', "\r\n")] {
        let mut parser = EventNormalizer::new(None);
        let events: Vec<AgentEvent> = input
            .split('\n')
            .flat_map(|line| parser.process_line(line))
            .collect();

        assert_eq!(events.len(), 8, "events: {events:?}");
        assert!(matches!(
            events[0],
            AgentEvent::Status {
                state: SessionState::Working,
                ..
            }
        ));
        assert!(matches!(
            events[1],
            AgentEvent::Message { final_: false, .. }
        ));
        assert!(matches!(
            events[2],
            AgentEvent::Tool {
                status: ToolStatus::Running,
                ..
            }
        ));
        assert!(matches!(
            events[3],
            AgentEvent::Tool {
                status: ToolStatus::Done,
                ..
            }
        ));
        assert!(matches!(
            events[4],
            AgentEvent::FileEdit { ref path, added: 4, removed: 1 } if path == "src/main.ts"
        ));
        assert!(matches!(
            events[5],
            AgentEvent::Message { final_: true, .. }
        ));
        assert!(matches!(events[6], AgentEvent::Usage { .. }));
        assert!(matches!(
            events[7],
            AgentEvent::Status {
                state: SessionState::Idle,
                ..
            }
        ));
    }
}

#[tokio::test]
async fn capability_probe_ignores_usage_headings_and_bare_ask() {
    let prober = CliProber::default();
    let help = "Usage: minimal [options]\nAsk the agent anything.\nRun a task.\n";
    let caps = prober.probe_capabilities("minimal", None, help, "").await;
    assert!(!caps.reports_usage, "\"Usage:\" is a heading, not a flag");
    assert!(!caps.approvals, "the word \"ask\" is not an approval flag");
}

#[test]
fn version_warning_is_silent_without_a_tested_version() {
    assert!(create_version_warning("deepseek", Some("1.2.3"), None).is_none());
    assert!(
        create_version_warning("deepseek", Some("1.2.3"), Some("")).is_none(),
        "an empty tested version is \"unverified\", not \"older than everything\""
    );
}
