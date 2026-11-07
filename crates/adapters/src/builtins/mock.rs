//! Mock CLI adapter supporting both subprocess and in-process execution.

use crate::error::AdapterError;
use crate::probe::{find_in_path, probe_cli_executable};
use crate::session::SubprocessSession;
use async_trait::async_trait;
use osmium_core::types::{
    AgentEvent, AgentSession, ApprovalScope, Capabilities, CliAdapter, CliDetectionResult, CliId,
    MessageRole, SessionState, StartOptions, ToolStatus,
};
use std::path::PathBuf;
use std::time::Duration;

pub const MOCK_CLI_TESTED_VERSION: &str = "0.1.0";

#[derive(Debug, Clone)]
pub enum MockExecutionMode {
    Subprocess { binary_path: Option<PathBuf> },
    InProcess,
}

pub struct MockCliAdapter {
    id: CliId,
    mode: MockExecutionMode,
}

impl Default for MockCliAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl MockCliAdapter {
    pub fn new() -> Self {
        Self {
            id: CliId::Mock,
            mode: MockExecutionMode::Subprocess { binary_path: None },
        }
    }

    pub fn with_binary_path(path: PathBuf) -> Self {
        Self {
            id: CliId::Mock,
            mode: MockExecutionMode::Subprocess {
                binary_path: Some(path),
            },
        }
    }

    pub fn in_process() -> Self {
        Self {
            id: CliId::Mock,
            mode: MockExecutionMode::InProcess,
        }
    }

    pub fn execution_mode(&self) -> &MockExecutionMode {
        &self.mode
    }

    fn resolve_binary(&self) -> Option<PathBuf> {
        match &self.mode {
            MockExecutionMode::Subprocess {
                binary_path: Some(p),
            } => Some(p.clone()),
            MockExecutionMode::Subprocess { binary_path: None } => {
                find_in_path("osmium-mock-cli").or_else(|| find_in_path("mock-cli"))
            }
            MockExecutionMode::InProcess => None,
        }
    }
}

#[async_trait]
impl CliAdapter for MockCliAdapter {
    fn id(&self) -> &CliId {
        &self.id
    }

    fn display_name(&self) -> &str {
        "Mock CLI"
    }

    async fn detect(&self) -> anyhow::Result<CliDetectionResult> {
        if matches!(self.mode, MockExecutionMode::InProcess) {
            return Ok(CliDetectionResult {
                installed: true,
                version: Some(MOCK_CLI_TESTED_VERSION.to_string()),
                path: Some("<in-process>".to_string()),
                version_warning: None,
            });
        }

        let bin = self.resolve_binary();
        let res = probe_cli_executable(
            "mock",
            bin.as_deref(),
            MOCK_CLI_TESTED_VERSION,
            Duration::from_millis(1500),
        )
        .await;
        Ok(res)
    }

    async fn capabilities(&self) -> anyhow::Result<Capabilities> {
        Ok(Capabilities {
            acp: false,
            json_stream: true,
            resume: true,
            approvals: true,
            read_only_mode: true,
            reports_usage: true,
            tested_version: Some(MOCK_CLI_TESTED_VERSION.to_string()),
        })
    }

    async fn start(&self, opts: StartOptions) -> anyhow::Result<Box<dyn AgentSession>> {
        let session_id = format!("mock-session-{}", uuid::Uuid::new_v4());
        match &self.mode {
            MockExecutionMode::InProcess => {
                let session = InProcessMockSession::new(session_id, opts);
                Ok(Box::new(session))
            }
            MockExecutionMode::Subprocess { .. } => {
                let bin = self
                    .resolve_binary()
                    .ok_or_else(|| AdapterError::BinaryNotFound {
                        cli_id: "mock".to_string(),
                        path: "osmium-mock-cli".to_string(),
                        reason: "Binary not found in PATH".to_string(),
                    })?;
                let session = SubprocessSession::new(
                    session_id,
                    bin,
                    vec!["--json".to_string(), "--delay".to_string(), "0".to_string()],
                    opts,
                );
                Ok(Box::new(session))
            }
        }
    }
}

/// Fallback in-process runner for testing without subprocess dependencies.
pub struct InProcessMockSession {
    id: String,
    _opts: StartOptions,
    event_rx: Option<tokio::sync::mpsc::UnboundedReceiver<AgentEvent>>,
    event_tx: tokio::sync::mpsc::UnboundedSender<AgentEvent>,
}

impl InProcessMockSession {
    pub fn new(id: String, opts: StartOptions) -> Self {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        Self {
            id,
            _opts: opts,
            event_rx: Some(rx),
            event_tx: tx,
        }
    }
}

#[async_trait]
impl AgentSession for InProcessMockSession {
    fn id(&self) -> &str {
        &self.id
    }

    fn take_event_receiver(&mut self) -> Option<tokio::sync::mpsc::UnboundedReceiver<AgentEvent>> {
        self.event_rx.take()
    }

    async fn send(&self, prompt: &str, _attachments: Option<&[PathBuf]>) -> anyhow::Result<()> {
        let tx = self.event_tx.clone();
        let prompt_str = prompt.to_string();

        tokio::spawn(async move {
            let _ = tx.send(AgentEvent::Status {
                state: SessionState::Working,
                message: Some("Starting mock turn".to_string()),
            });

            if prompt_str.starts_with("/plan") {
                let _ = tx.send(AgentEvent::Message {
                    role: MessageRole::Assistant,
                    text: "Proposed Plan:\n- [x] Step 1: Initialize\n- [x] Step 2: Implement\n- [x] Step 3: Test".to_string(),
                    final_: true,
                });
            } else if prompt_str.contains("approval") {
                let _ = tx.send(AgentEvent::Approval {
                    id: "approval-1".to_string(),
                    kind: osmium_core::types::ApprovalKind::Command,
                    detail: "cargo test".to_string(),
                });
                let _ = tx.send(AgentEvent::Status {
                    state: SessionState::Waiting,
                    message: Some("Waiting for approval".to_string()),
                });
                return;
            } else {
                let _ = tx.send(AgentEvent::Message {
                    role: MessageRole::Assistant,
                    text: "Turn response chunk 1, ".to_string(),
                    final_: false,
                });
                let _ = tx.send(AgentEvent::Tool {
                    id: "tool-1".to_string(),
                    name: "read_file".to_string(),
                    status: ToolStatus::Done,
                    summary: Some("Read file successfully".to_string()),
                    duration_sec: Some(0.1),
                });
                let _ = tx.send(AgentEvent::Message {
                    role: MessageRole::Assistant,
                    text: "Turn response chunk 1, completed.".to_string(),
                    final_: true,
                });
            }

            let _ = tx.send(AgentEvent::Status {
                state: SessionState::Idle,
                message: None,
            });
        });

        Ok(())
    }

    async fn respond_to_approval(
        &self,
        _id: &str,
        allow: bool,
        _scope: Option<ApprovalScope>,
    ) -> anyhow::Result<()> {
        let tx = self.event_tx.clone();
        if allow {
            let _ = tx.send(AgentEvent::Message {
                role: MessageRole::Assistant,
                text: "Approved command executed successfully.".to_string(),
                final_: true,
            });
            let _ = tx.send(AgentEvent::Status {
                state: SessionState::Idle,
                message: None,
            });
        } else {
            let _ = tx.send(AgentEvent::Tool {
                id: "tool-denied".to_string(),
                name: "command".to_string(),
                status: ToolStatus::Error,
                summary: Some("Approval denied".to_string()),
                duration_sec: None,
            });
            let _ = tx.send(AgentEvent::Status {
                state: SessionState::Idle,
                message: Some("Approval denied".to_string()),
            });
        }
        Ok(())
    }

    async fn cancel(&self) -> anyhow::Result<()> {
        let _ = self.event_tx.send(AgentEvent::Status {
            state: SessionState::Cancelled,
            message: Some("Cancelled".to_string()),
        });
        Ok(())
    }

    async fn close(&self) -> anyhow::Result<()> {
        let _ = self.event_tx.send(AgentEvent::Status {
            state: SessionState::Closed,
            message: None,
        });
        Ok(())
    }
}
