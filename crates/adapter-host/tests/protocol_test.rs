//! End-to-end protocol tests: spawn the real `osmium-adapter-host` binary and
//! speak the NDJSON protocol to it with the real `osmium-mock-cli`.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const MESSAGE_TIMEOUT: Duration = Duration::from_secs(60);
const TERMINAL_TIMEOUT: Duration = Duration::from_secs(30);
const EXIT_TIMEOUT: Duration = Duration::from_secs(15);

fn host_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_osmium-adapter-host"))
}

/// The real mock CLI next to the host binary (`target/debug`), building it once
/// if it has not been built yet. A missing mock CLI is a hard failure, never a
/// silent skip.
fn mock_cli_binary() -> PathBuf {
    static MOCK_CLI: OnceLock<PathBuf> = OnceLock::new();
    MOCK_CLI
        .get_or_init(|| {
            let host = host_binary();
            let dir = host
                .parent()
                .expect("the host binary has a parent directory")
                .to_path_buf();
            let candidate = dir.join(format!("osmium-mock-cli{}", std::env::consts::EXE_SUFFIX));
            if candidate.is_file() {
                return candidate;
            }

            eprintln!(
                "[protocol_test] {} is missing; running `cargo build -p osmium-mock-cli`",
                candidate.display()
            );
            let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(Path::parent)
                .expect("the crate lives two levels below the workspace root")
                .to_path_buf();
            let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
            let status = Command::new(&cargo)
                .args(["build", "-p", "osmium-mock-cli"])
                .current_dir(&workspace_root)
                .status()
                .unwrap_or_else(|error| {
                    panic!("failed to run `cargo build -p osmium-mock-cli`: {error}")
                });
            assert!(
                status.success(),
                "`cargo build -p osmium-mock-cli` failed with {status}"
            );
            assert!(
                candidate.is_file(),
                "osmium-mock-cli is still missing at {} after building it; run \
                 `cargo build -p osmium-mock-cli` before `cargo test -p osmium-adapter-host`",
                candidate.display()
            );
            candidate
        })
        .clone()
}

struct Host {
    child: Child,
    stdin: ChildStdin,
    messages: Receiver<Value>,
    stderr: Arc<Mutex<String>>,
    notifications: Vec<Value>,
    next_id: u64,
}

impl Host {
    fn spawn() -> Self {
        let mock_cli = mock_cli_binary();
        let mut child = Command::new(host_binary())
            .arg("--mock-cli")
            .arg(&mock_cli)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn osmium-adapter-host");
        let stdin = child.stdin.take().expect("host stdin");
        let stdout = child.stdout.take().expect("host stdout");
        let stderr = child.stderr.take().expect("host stderr");

        let (tx, messages) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let line = match line {
                    Ok(line) => line,
                    Err(error) => {
                        eprintln!("[protocol_test] host stdout read error: {error}");
                        break;
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(&line) {
                    Ok(message) => {
                        if tx.send(message).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        eprintln!(
                            "[protocol_test] non-JSON line on host stdout: {line:?} ({error})"
                        );
                    }
                }
            }
        });

        let stderr_buffer = Arc::new(Mutex::new(String::new()));
        let stderr_sink = Arc::clone(&stderr_buffer);
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut buffer) = stderr_sink.lock() {
                    buffer.push_str(&line);
                    buffer.push('\n');
                }
            }
        });

        Self {
            child,
            stdin,
            messages,
            stderr: stderr_buffer,
            notifications: Vec::new(),
            next_id: 1,
        }
    }

    fn stderr_text(&self) -> String {
        self.stderr
            .lock()
            .map(|buffer| buffer.clone())
            .unwrap_or_default()
    }

    fn recv(&self, deadline: Instant) -> Value {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match self.messages.recv_timeout(remaining) {
            Ok(message) => message,
            Err(RecvTimeoutError::Timeout) => {
                panic!(
                    "timed out waiting for the adapter host; stderr:\n{}",
                    self.stderr_text()
                )
            }
            Err(RecvTimeoutError::Disconnected) => {
                panic!(
                    "the adapter host closed stdout before replying; stderr:\n{}",
                    self.stderr_text()
                )
            }
        }
    }

    fn send_raw(&mut self, line: &str) {
        writeln!(self.stdin, "{line}").expect("write to host stdin");
        self.stdin.flush().expect("flush host stdin");
    }

    /// Sends one request and returns its full response object (`id` plus
    /// `result` or `error`), collecting notifications that arrive meanwhile.
    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = format!("req-{}", self.next_id);
        self.next_id += 1;
        self.send_raw(&json!({ "id": id, "method": method, "params": params }).to_string());

        let deadline = Instant::now() + MESSAGE_TIMEOUT;
        loop {
            let message = self.recv(deadline);
            if message.get("event").is_some() {
                self.notifications.push(message);
                continue;
            }
            if message.get("id").and_then(Value::as_str) == Some(id.as_str()) {
                return message;
            }
            panic!("unexpected host message while waiting for {method}: {message}");
        }
    }

    fn ok(&mut self, method: &str, params: Value) -> Value {
        let response = self.request(method, params);
        if let Some(error) = response.get("error") {
            panic!("{method} failed: {error}; stderr:\n{}", self.stderr_text());
        }
        response.get("result").cloned().unwrap_or(Value::Null)
    }

    fn error(&mut self, method: &str, params: Value) -> Value {
        let response = self.request(method, params);
        match response.get("error") {
            Some(error) => error.clone(),
            None => panic!(
                "expected {method} to fail, got: {response}; stderr:\n{}",
                self.stderr_text()
            ),
        }
    }

    /// Sends a raw (possibly malformed) line and returns the next message that
    /// is not a notification.
    fn raw(&mut self, line: &str) -> Value {
        self.send_raw(line);
        let deadline = Instant::now() + MESSAGE_TIMEOUT;
        loop {
            let message = self.recv(deadline);
            if message.get("event").is_some() {
                self.notifications.push(message);
                continue;
            }
            return message;
        }
    }

    fn session_events(&self, session_id: &str) -> Vec<Value> {
        self.notifications
            .iter()
            .filter(|notification| {
                notification.get("event").and_then(Value::as_str) == Some("sessionEvent")
                    && notification.get("sessionId").and_then(Value::as_str) == Some(session_id)
            })
            .filter_map(|notification| notification.get("data").cloned())
            .collect()
    }

    fn wait_for_terminal(&mut self, session_id: &str) -> Vec<Value> {
        let deadline = Instant::now() + TERMINAL_TIMEOUT;
        loop {
            let events = self.session_events(session_id);
            if events.iter().any(is_terminal_status) {
                return events;
            }
            let message = self.recv(deadline);
            assert!(
                message.get("event").is_some(),
                "unexpected host message while waiting for session {session_id}: {message}"
            );
            self.notifications.push(message);
        }
    }

    fn wait_for_event(
        &mut self,
        session_id: &str,
        mut predicate: impl FnMut(&Value) -> bool,
    ) -> Value {
        let deadline = Instant::now() + TERMINAL_TIMEOUT;
        loop {
            if let Some(event) = self
                .session_events(session_id)
                .into_iter()
                .find(|event| predicate(event))
            {
                return event;
            }
            let message = self.recv(deadline);
            assert!(
                message.get("event").is_some(),
                "unexpected host message while waiting for a {session_id} event: {message}"
            );
            self.notifications.push(message);
        }
    }

    fn wait_for_exit(&mut self, timeout: Duration) -> ExitStatus {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.child.try_wait().expect("try_wait on the host") {
                return status;
            }
            if Instant::now() >= deadline {
                let _ = self.child.kill();
                panic!(
                    "the adapter host did not exit within {timeout:?}; stderr:\n{}",
                    self.stderr_text()
                );
            }
            thread::sleep(Duration::from_millis(25));
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn is_terminal_status(event: &Value) -> bool {
    event.get("type").and_then(Value::as_str) == Some("status")
        && matches!(
            event.get("state").and_then(Value::as_str),
            Some("idle" | "error" | "cancelled" | "closed")
        )
}

fn start_mock(host: &mut Host, cwd: &Path) -> String {
    let cwd_text = cwd.to_string_lossy().to_string();
    let started = host.ok(
        "start",
        json!({
            "cliId": "mock",
            "cwd": cwd_text,
            "approvalMode": "ask",
            "resume": null,
            "systemContext": null,
            "readOnly": null,
        }),
    );
    assert_eq!(started["cliId"], "mock");
    assert_eq!(started["cwd"].as_str(), Some(cwd_text.as_str()));
    let session_id = started["sessionId"]
        .as_str()
        .unwrap_or_else(|| panic!("start result has no sessionId: {started}"))
        .to_string();
    assert!(
        session_id.starts_with("mock-session-"),
        "unexpected mock session id: {session_id}"
    );
    session_id
}

#[test]
fn ping_reports_protocol_version() {
    let mut host = Host::spawn();
    let pong = host.ok("ping", json!({}));
    assert_eq!(pong["ok"], true);
    assert_eq!(pong["version"], "0.1.0");
}

#[test]
fn detect_all_probes_every_builtin_concurrently() {
    let mut host = Host::spawn();

    let detected = host.ok("detectAll", json!({}));
    for cli_id in ["mock", "codex", "antigravity", "deepseek"] {
        let entry = detected
            .get(cli_id)
            .unwrap_or_else(|| panic!("detectAll is missing {cli_id}: {detected}"));
        assert!(
            entry.get("capabilities").is_some(),
            "detectAll entry {cli_id} has no capabilities: {entry}"
        );
    }

    assert_eq!(
        detected["mock"]["installed"], true,
        "mock should be installed through --mock-cli: {detected}"
    );
    assert_eq!(detected["mock"]["version"], "0.1.0");
    assert_eq!(detected["mock"]["capabilities"]["jsonStream"], true);
    assert_eq!(
        detected["deepseek"]["installed"], false,
        "deepseek is unexpectedly installed on this host: {detected}"
    );
    assert!(
        detected["deepseek"]["versionWarning"].is_string(),
        "deepseek should explain why it is not installed: {detected}"
    );

    // A CLI that is not installed must not advertise capabilities.
    for cli_id in ["mock", "codex", "antigravity", "deepseek"] {
        if detected[cli_id]["installed"] == false {
            for capability in [
                "acp",
                "jsonStream",
                "resume",
                "approvals",
                "readOnlyMode",
                "reportsUsage",
            ] {
                assert_eq!(
                    detected[cli_id]["capabilities"][capability], false,
                    "{cli_id} is not installed but advertises {capability}: {detected}"
                );
            }
        }
    }

    let detection = host.ok("detect", json!({ "cliId": "mock" }));
    assert_eq!(detection["installed"], true);
    assert_eq!(detection["version"], "0.1.0");

    let capabilities = host.ok("capabilities", json!({ "cliId": "mock" }));
    assert_eq!(capabilities["jsonStream"], true);
    assert_eq!(capabilities["approvals"], true);

    assert_eq!(host.ok("getUsage", json!({})), json!([]));
}

#[test]
fn start_and_send_stream_session_events() {
    let cwd = tempfile::tempdir().expect("temp cwd");
    let mut host = Host::spawn();
    let session_id = start_mock(&mut host, cwd.path());

    let sessions = host.ok("listSessions", json!({}));
    let listed = sessions
        .as_array()
        .unwrap_or_else(|| panic!("listSessions is not an array: {sessions}"));
    assert_eq!(listed.len(), 1, "unexpected sessions: {sessions}");
    assert_eq!(listed[0]["sessionId"].as_str(), Some(session_id.as_str()));
    assert_eq!(listed[0]["cliId"], "mock");
    assert!(listed[0]["startedAt"].as_i64().unwrap_or(0) > 0);

    host.ok(
        "send",
        json!({
            "sessionId": session_id,
            "prompt": "edit the comparison route",
            "attachments": [],
        }),
    );

    let events = host.wait_for_terminal(&session_id);
    assert!(
        events
            .iter()
            .any(|event| event["type"] == "message" && event["final"] == true),
        "no final assistant message in {events:#?}"
    );
    assert!(
        events
            .iter()
            .any(|event| event["type"] == "tool" && event["status"] == "done"),
        "no completed tool event in {events:#?}"
    );
    let file_edit = events
        .iter()
        .find(|event| event["type"] == "file-edit")
        .unwrap_or_else(|| panic!("no file-edit event in {events:#?}"));
    assert!(
        file_edit["path"]
            .as_str()
            .unwrap_or_default()
            .contains("compare.ts"),
        "unexpected file-edit path: {file_edit}"
    );
    assert!(
        events.iter().any(is_terminal_status),
        "no terminal status in {events:#?}"
    );

    for notification in host.notifications.iter().filter(|notification| {
        notification.get("sessionId").and_then(Value::as_str) == Some(session_id.as_str())
    }) {
        assert_eq!(notification["event"], "sessionEvent");
        assert!(
            notification["data"].is_object(),
            "sessionEvent payload must be the AgentEvent object: {notification}"
        );
    }

    host.ok("close", json!({ "sessionId": session_id }));
}

#[test]
fn respond_to_approval_continues_the_turn() {
    let cwd = tempfile::tempdir().expect("temp cwd");
    let mut host = Host::spawn();
    let session_id = start_mock(&mut host, cwd.path());

    host.ok(
        "send",
        json!({
            "sessionId": session_id,
            "prompt": "approval required",
            "attachments": [],
        }),
    );

    let approval = host.wait_for_event(&session_id, |event| event["type"] == "approval");
    let approval_id = approval["id"]
        .as_str()
        .unwrap_or_else(|| panic!("approval event has no id: {approval}"))
        .to_string();

    host.ok(
        "respondToApproval",
        json!({
            "sessionId": session_id,
            "approvalId": approval_id,
            "allow": true,
            "scope": "once",
        }),
    );

    let events = host.wait_for_terminal(&session_id);
    assert!(
        events.iter().any(|event| {
            event["type"] == "message"
                && event["final"] == true
                && event["text"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("Approved")
        }),
        "the approved turn did not complete in {events:#?}"
    );

    host.ok("close", json!({ "sessionId": session_id }));
}

#[test]
fn cancel_is_idempotent() {
    let cwd = tempfile::tempdir().expect("temp cwd");
    let mut host = Host::spawn();
    let session_id = start_mock(&mut host, cwd.path());

    host.ok("cancel", json!({ "sessionId": session_id }));
    host.ok("cancel", json!({ "sessionId": session_id }));
    host.ok("close", json!({ "sessionId": session_id }));
}

#[test]
fn send_after_close_reports_session_closed() {
    let cwd = tempfile::tempdir().expect("temp cwd");
    let mut host = Host::spawn();
    let session_id = start_mock(&mut host, cwd.path());

    host.ok("close", json!({ "sessionId": session_id }));
    let error = host.error(
        "send",
        json!({
            "sessionId": session_id,
            "prompt": "hello after close",
            "attachments": [],
        }),
    );
    assert_eq!(
        error["code"], "ERR_ADAPTER_SESSION_CLOSED",
        "unexpected error after close: {error}"
    );

    let unknown = host.error(
        "send",
        json!({
            "sessionId": "no-such-session",
            "prompt": "hello",
            "attachments": [],
        }),
    );
    assert_eq!(unknown["code"], "ERR_HOST_SESSION_NOT_FOUND");
}

#[test]
fn start_with_missing_deepseek_reports_binary_not_found() {
    let cwd = tempfile::tempdir().expect("temp cwd");
    let mut host = Host::spawn();
    let error = host.error(
        "start",
        json!({
            "cliId": "deepseek",
            "cwd": cwd.path().to_string_lossy(),
            "approvalMode": "ask",
        }),
    );
    assert_eq!(error["code"], "ERR_ADAPTER_BINARY_NOT_FOUND");
}

#[test]
fn unknown_method_and_malformed_json_are_reported() {
    let mut host = Host::spawn();

    let error = host.error("notARealMethod", json!({}));
    assert_eq!(error["code"], "ERR_HOST_UNKNOWN_METHOD");

    let response = host.raw("this is not JSON");
    assert_eq!(response["id"], Value::Null);
    assert_eq!(response["error"]["code"], "ERR_HOST_BAD_REQUEST");
}

#[test]
fn shutdown_replies_then_exits_zero() {
    let mut host = Host::spawn();
    host.ok("ping", json!({}));

    let result = host.ok("shutdown", json!({}));
    assert_eq!(result, json!({}));

    let status = host.wait_for_exit(EXIT_TIMEOUT);
    assert_eq!(
        status.code(),
        Some(0),
        "the adapter host exited with {status}; stderr:\n{}",
        host.stderr_text()
    );
}
