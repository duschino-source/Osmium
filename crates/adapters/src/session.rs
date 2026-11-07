//! Subprocess session management for external CLI processes.

use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::env::{is_forbidden_env_var, FORBIDDEN_ENV_VARS};
use crate::error::AdapterError;
use crate::normalizer::EventNormalizer;
use osmium_core::types::{
    AgentEvent, AgentSession, ApprovalKind, ApprovalMode, ApprovalScope, SessionState,
    StartOptions, ToolStatus,
};

/// How the per-turn prompt reaches the CLI process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PromptTransport {
    /// Legacy mock-cli protocol: `--cwd`, `--resume`, `--system-context`,
    /// `--write-file` and `--prompt <text>`.
    #[default]
    MockCliFlags,
    /// Write the composed prompt to stdin and close it. No prompt text ever
    /// appears on the command line, which keeps Windows `.cmd` shims away
    /// from untrusted argument parsing.
    StdinPrompt,
}

/// Who owns the approval handshake for a turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ApprovalGate {
    /// The CLI has its own approval protocol and receives JSON lines on stdin.
    #[default]
    CliManaged,
    /// The CLI exposes no approval protocol. The session blocks in `Ask` mode
    /// and waits for `respond_to_approval` before spawning the turn at all.
    OsmiumGate,
}

/// Per-session subprocess behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SubprocessSessionConfig {
    pub prompt_transport: PromptTransport,
    pub approval_gate: ApprovalGate,
    /// Emit a synthetic `status: working` as soon as the child is spawned, so
    /// plain-stdout CLIs still have a visible turn lifecycle.
    pub emit_start_status: bool,
}

impl Default for SubprocessSessionConfig {
    fn default() -> Self {
        Self {
            prompt_transport: PromptTransport::MockCliFlags,
            approval_gate: ApprovalGate::CliManaged,
            emit_start_status: false,
        }
    }
}

struct PendingGate {
    id: String,
    prompt: String,
    attachments: Option<Vec<PathBuf>>,
}

pub struct SubprocessSession {
    id: String,
    binary_path: PathBuf,
    default_args: Vec<String>,
    opts: StartOptions,
    config: SubprocessSessionConfig,
    inner: Arc<Mutex<SessionProcessInner>>,
    event_rx: Option<mpsc::UnboundedReceiver<AgentEvent>>,
}

struct SessionProcessInner {
    state: SessionState,
    stdin: Option<ChildStdin>,
    event_tx: mpsc::UnboundedSender<AgentEvent>,
    turn_id: u64,
    supervisor_task: Option<tokio::task::JoinHandle<()>>,
    kill_tx: Option<oneshot::Sender<()>>,
    pending_gate: Option<PendingGate>,
}

impl SubprocessSession {
    pub fn new(
        id: String,
        binary_path: PathBuf,
        default_args: Vec<String>,
        opts: StartOptions,
    ) -> Self {
        Self::new_with_config(
            id,
            binary_path,
            default_args,
            opts,
            SubprocessSessionConfig::default(),
        )
    }

    pub fn new_with_config(
        id: String,
        binary_path: PathBuf,
        default_args: Vec<String>,
        opts: StartOptions,
        config: SubprocessSessionConfig,
    ) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let inner = SessionProcessInner {
            state: SessionState::Idle,
            stdin: None,
            event_tx: tx,
            turn_id: 0,
            supervisor_task: None,
            kill_tx: None,
            pending_gate: None,
        };
        Self {
            id,
            binary_path,
            default_args,
            opts,
            config,
            inner: Arc::new(Mutex::new(inner)),
            event_rx: Some(rx),
        }
    }

    async fn send_internal(
        &self,
        prompt: &str,
        attachments: Option<&[PathBuf]>,
        allow_gate: bool,
    ) -> anyhow::Result<()> {
        let mut inner = self.inner.lock().await;
        if inner.state == SessionState::Closed {
            return Err(AdapterError::SessionAlreadyClosed {
                session_id: self.id.clone(),
            }
            .into());
        }
        // A pending approval gate owns the turn; reject concurrent sends the
        // same way a running turn is rejected.
        if inner.state == SessionState::Working || inner.state == SessionState::Waiting {
            return Err(AdapterError::AlreadyRunning.into());
        }

        if allow_gate
            && self.config.approval_gate == ApprovalGate::OsmiumGate
            && self.opts.approval_mode == ApprovalMode::Ask
        {
            inner.turn_id += 1;
            let gate_id = format!("osmium-gate-{}", inner.turn_id);
            inner.pending_gate = Some(PendingGate {
                id: gate_id.clone(),
                prompt: prompt.to_string(),
                attachments: attachments.map(|files| files.to_vec()),
            });
            inner.state = SessionState::Waiting;
            let _ = inner.event_tx.send(AgentEvent::Approval {
                id: gate_id,
                kind: ApprovalKind::Command,
                detail: gate_detail(prompt),
            });
            let _ = inner.event_tx.send(AgentEvent::Status {
                state: SessionState::Waiting,
                message: Some("Waiting for Osmium approval gate".to_string()),
            });
            return Ok(());
        }

        // Clean up any previously running supervisor task before launching a new turn
        if let Some(task) = inner.supervisor_task.take() {
            if let Some(tx) = inner.kill_tx.take() {
                let _ = tx.send(());
            }
            drop(inner);
            let _ = tokio::time::timeout(Duration::from_secs(5), task).await;
            inner = self.inner.lock().await;
            if inner.state == SessionState::Closed {
                return Err(AdapterError::SessionAlreadyClosed {
                    session_id: self.id.clone(),
                }
                .into());
            }
            if inner.state == SessionState::Working {
                return Err(AdapterError::AlreadyRunning.into());
            }
        }

        inner.turn_id += 1;
        let turn_id = inner.turn_id;

        let mut cmd = Command::new(&self.binary_path);
        cmd.current_dir(&self.opts.cwd);
        cmd.kill_on_drop(true);

        // Rule 2.2: Zero API Key Invariant (Case-insensitive removal across all environment variables)
        for (key, _) in std::env::vars_os() {
            if let Some(key_str) = key.to_str() {
                if is_forbidden_env_var(key_str) {
                    cmd.env_remove(&key);
                }
            }
        }
        for forbidden in FORBIDDEN_ENV_VARS {
            cmd.env_remove(forbidden);
        }

        // Pass base CLI args
        for arg in &self.default_args {
            cmd.arg(arg);
        }

        // Per-turn arguments depend on the transport. The legacy protocol
        // appends mock-cli flags; the stdin transport deliberately appends
        // nothing, so no CLI-specific flag is invented here.
        let stdin_payload = match self.config.prompt_transport {
            PromptTransport::MockCliFlags => {
                cmd.arg("--cwd").arg(&self.opts.cwd);
                if let Some(resume_id) = &self.opts.resume {
                    cmd.arg("--resume").arg(resume_id);
                }
                if let Some(ctx) = &self.opts.system_context {
                    cmd.arg("--system-context").arg(ctx);
                }
                if self.opts.read_only != Some(true) {
                    cmd.arg("--write-file");
                }
                cmd.arg("--prompt").arg(prompt);
                None
            }
            PromptTransport::StdinPrompt => {
                Some(compose_stdin_payload(&self.opts, prompt, attachments))
            }
        };

        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| AdapterError::SpawnFailed {
            cli_id: self.id.clone(),
            source: e,
        })?;

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let (kill_tx, mut kill_rx) = oneshot::channel();

        inner.state = SessionState::Working;
        if self.config.prompt_transport == PromptTransport::StdinPrompt {
            // The prompt never touches argv. A task owns stdin until it has
            // been written (bounded by a timeout) and closes it so the child
            // sees EOF.
            if let (Some(mut stdin), Some(payload)) = (stdin, stdin_payload) {
                tokio::spawn(async move {
                    let _ = tokio::time::timeout(Duration::from_secs(10), async {
                        let _ = stdin.write_all(payload.as_bytes()).await;
                        let _ = stdin.flush().await;
                    })
                    .await;
                    drop(stdin);
                });
            }
            inner.stdin = None;
        } else {
            inner.stdin = stdin;
        }
        inner.kill_tx = Some(kill_tx);
        let event_tx = inner.event_tx.clone();
        let inner_clone = self.inner.clone();

        if self.config.emit_start_status {
            let _ = event_tx.send(AgentEvent::Status {
                state: SessionState::Working,
                message: Some("Process started".to_string()),
            });
        }

        // Spawn async supervisor task managing stdout reader and child lifecycle
        let supervisor_handle = tokio::spawn(async move {
            let mut normalizer = EventNormalizer::new(None);
            let mut pending_terminal: Option<AgentEvent> = None;
            let mut killed = false;

            if let Some(stdout) = stdout {
                let mut reader = BufReader::new(stdout).lines();
                loop {
                    tokio::select! {
                        biased;

                        _ = &mut kill_rx => {
                            terminate_child_tree(&mut child).await;
                            killed = true;
                            break;
                        }
                        line_res = reader.next_line() => {
                            match line_res {
                                Ok(Some(line)) => {
                                    let events = normalizer.process_line(&line);
                                    for ev in events {
                                        if let AgentEvent::Status { state, .. } = &ev {
                                            if matches!(state, SessionState::Idle | SessionState::Error) {
                                                // Defer terminal status until process exits and state updates
                                                pending_terminal = Some(ev);
                                                continue;
                                            }
                                        }
                                        if event_tx.send(ev).is_err() {
                                            // Receiver dropped
                                            break;
                                        }
                                    }
                                }
                                Ok(None) | Err(_) => {
                                    // stdout reached EOF or read error
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // If killed via kill_rx during stdout streaming, child has already been terminated and reaped
            if killed {
                return;
            }

            // Await child process exit or kill signal to prevent zombie process
            let exit_status = tokio::select! {
                biased;

                _ = &mut kill_rx => {
                    terminate_child_tree(&mut child).await;
                    killed = true;
                    None
                }
                res = tokio::time::timeout(Duration::from_secs(5), child.wait()) => {
                    match res {
                        Ok(Ok(status)) => Some(status),
                        Ok(Err(_)) => None,
                        Err(_) => {
                            terminate_child_tree(&mut child).await;
                            None
                        }
                    }
                }
            };

            if killed {
                return;
            }

            let exit_code = exit_status.and_then(|s| s.code());

            // Check if cancelled or closed before flushing
            {
                let guard = inner_clone.lock().await;
                if guard.turn_id != turn_id
                    || guard.state == SessionState::Cancelled
                    || guard.state == SessionState::Closed
                {
                    return;
                }
            }

            // Flush trailing buffer or emit error status if process exited unexpectedly
            let trailing = normalizer.handle_unexpected_eof(exit_code);
            for ev in trailing {
                if let AgentEvent::Status { state, .. } = &ev {
                    if matches!(state, SessionState::Idle | SessionState::Error) {
                        if pending_terminal.is_none() {
                            pending_terminal = Some(ev);
                        }
                        continue;
                    }
                }
                let _ = event_tx.send(ev);
            }

            // Reset session state for subsequent turns under lock, then emit terminal event
            let mut guard = inner_clone.lock().await;
            if guard.turn_id == turn_id
                && guard.state != SessionState::Cancelled
                && guard.state != SessionState::Closed
            {
                guard.stdin = None;
                guard.supervisor_task = None;
                guard.kill_tx = None;

                if normalizer.current_state() == SessionState::Error
                    || exit_code.unwrap_or(0) != 0
                    || matches!(
                        pending_terminal,
                        Some(AgentEvent::Status {
                            state: SessionState::Error,
                            ..
                        })
                    )
                {
                    guard.state = SessionState::Error;
                    let err_event = pending_terminal.unwrap_or(AgentEvent::Status {
                        state: SessionState::Error,
                        message: Some(format!(
                            "Process exited with code {}",
                            exit_code.unwrap_or(-1)
                        )),
                    });
                    let _ = event_tx.send(err_event);
                } else {
                    guard.state = SessionState::Idle;
                    let idle_event = pending_terminal.unwrap_or(AgentEvent::Status {
                        state: SessionState::Idle,
                        message: None,
                    });
                    let _ = event_tx.send(idle_event);
                }
            }
        });

        inner.supervisor_task = Some(supervisor_handle);

        // Spawn async reader task for stderr (log diagnostics)
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    tracing::warn!(target: "subprocess::stderr", "{line}");
                }
            });
        }

        Ok(())
    }
}

/// Composes the stdin payload for transports that deliver the prompt over a
/// pipe. System context and attachment paths are plain text; no CLI flag is
/// invented to carry them.
fn compose_stdin_payload(
    opts: &StartOptions,
    prompt: &str,
    attachments: Option<&[PathBuf]>,
) -> String {
    let mut payload = String::new();
    if let Some(context) = &opts.system_context {
        if !context.is_empty() {
            payload.push_str("[Osmium session context]\n");
            payload.push_str(context);
            payload.push_str("\n[/Osmium session context]\n\n");
        }
    }
    if let Some(files) = attachments {
        if !files.is_empty() {
            payload.push_str("[Attached files]\n");
            for file in files {
                payload.push_str("- ");
                payload.push_str(&file.to_string_lossy());
                payload.push('\n');
            }
            payload.push('\n');
        }
    }
    payload.push_str(prompt);
    payload
}

fn gate_detail(prompt: &str) -> String {
    let preview: String = prompt.chars().take(160).collect();
    let suffix = if prompt.chars().count() > 160 {
        "…"
    } else {
        ""
    };
    format!(
        "Osmium approval gate (this CLI exposes no approval protocol). Send this prompt? \"{preview}{suffix}\""
    )
}

/// Terminates the child and, on Windows, its whole process tree. Batch-file
/// shims (`npm install -g` creates `.cmd` files) run under `cmd.exe`, so
/// killing only the direct child would orphan the real CLI process.
async fn terminate_child_tree(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    {
        if let Some(pid) = child.id() {
            let pid = pid.to_string();
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                Command::new("taskkill")
                    .args(["/T", "/F", "/PID", pid.as_str()])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status(),
            )
            .await;
        }
    }
    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
}

#[async_trait]
impl AgentSession for SubprocessSession {
    fn id(&self) -> &str {
        &self.id
    }

    fn take_event_receiver(&mut self) -> Option<mpsc::UnboundedReceiver<AgentEvent>> {
        self.event_rx.take()
    }

    async fn send(&self, prompt: &str, attachments: Option<&[PathBuf]>) -> anyhow::Result<()> {
        self.send_internal(prompt, attachments, true).await
    }

    async fn respond_to_approval(
        &self,
        id: &str,
        allow: bool,
        scope: Option<ApprovalScope>,
    ) -> anyhow::Result<()> {
        if self.config.approval_gate == ApprovalGate::OsmiumGate {
            let pending = {
                let mut inner = self.inner.lock().await;
                if inner.state == SessionState::Closed {
                    return Err(AdapterError::SessionAlreadyClosed {
                        session_id: self.id.clone(),
                    }
                    .into());
                }
                match inner.pending_gate.take() {
                    Some(pending) if pending.id == id => Some(pending),
                    other => {
                        inner.pending_gate = other;
                        None
                    }
                }
            };

            let Some(pending) = pending else {
                return Err(AdapterError::ApprovalNotFound {
                    approval_id: id.to_string(),
                }
                .into());
            };

            if !allow {
                let mut inner = self.inner.lock().await;
                let _ = inner.event_tx.send(AgentEvent::Tool {
                    id: pending.id.clone(),
                    name: "approval".to_string(),
                    status: ToolStatus::Error,
                    summary: Some("Denied by user at the Osmium approval gate".to_string()),
                    duration_sec: None,
                });
                let _ = inner.event_tx.send(AgentEvent::Status {
                    state: SessionState::Idle,
                    message: Some("Prompt denied before it was sent".to_string()),
                });
                if inner.state == SessionState::Waiting {
                    inner.state = SessionState::Idle;
                }
                return Ok(());
            }

            {
                let mut inner = self.inner.lock().await;
                if inner.state == SessionState::Waiting {
                    inner.state = SessionState::Idle;
                }
            }
            let attachments = pending.attachments;
            return self
                .send_internal(&pending.prompt, attachments.as_deref(), false)
                .await;
        }

        let mut inner = self.inner.lock().await;
        if inner.state == SessionState::Closed {
            return Err(AdapterError::SessionAlreadyClosed {
                session_id: self.id.clone(),
            }
            .into());
        }
        let Some(ref mut stdin) = inner.stdin else {
            return Err(AdapterError::SessionAlreadyClosed {
                session_id: self.id.clone(),
            }
            .into());
        };

        let payload = serde_json::json!({
            "id": id,
            "allow": allow,
            "scope": scope.map(|s| match s {
                ApprovalScope::Once => "once",
                ApprovalScope::Session => "session",
            }),
        });

        let line = format!("{}\n", payload);
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(AdapterError::Io)?;
        stdin.flush().await.map_err(AdapterError::Io)?;
        Ok(())
    }

    async fn cancel(&self) -> anyhow::Result<()> {
        let (supervisor_task, kill_tx) = {
            let mut inner = self.inner.lock().await;
            // Invariant: Closed is an irreversible terminal state. Reject cancel on Closed sessions.
            if inner.state == SessionState::Closed {
                return Err(AdapterError::SessionAlreadyClosed {
                    session_id: self.id.clone(),
                }
                .into());
            }
            // Invariant: Cancellation is idempotent. Repeated or concurrent cancels are safe no-ops.
            if inner.state == SessionState::Cancelled {
                return Ok(());
            }

            inner.stdin = None;
            inner.pending_gate = None;
            inner.state = SessionState::Cancelled;
            let _ = inner.event_tx.send(AgentEvent::Status {
                state: SessionState::Cancelled,
                message: Some("Session cancelled by user".to_string()),
            });

            (inner.supervisor_task.take(), inner.kill_tx.take())
        };

        if let Some(tx) = kill_tx {
            let _ = tx.send(());
        }
        if let Some(task) = supervisor_task {
            let _ = tokio::time::timeout(Duration::from_secs(5), task).await;
        }

        Ok(())
    }

    async fn close(&self) -> anyhow::Result<()> {
        let (supervisor_task, kill_tx) = {
            let mut inner = self.inner.lock().await;
            if inner.state == SessionState::Closed {
                return Ok(());
            }
            inner.state = SessionState::Closed;
            inner.stdin = None;
            inner.pending_gate = None;
            (inner.supervisor_task.take(), inner.kill_tx.take())
        };

        if let Some(tx) = kill_tx {
            let _ = tx.send(());
        }
        if let Some(task) = supervisor_task {
            let _ = tokio::time::timeout(Duration::from_secs(5), task).await;
        }

        Ok(())
    }
}
