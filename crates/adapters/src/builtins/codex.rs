//! Codex CLI adapter.

use crate::error::AdapterError;
use crate::probe::{find_in_path, probe_cli_executable};
use crate::session::SubprocessSession;
use async_trait::async_trait;
use osmium_core::types::{
    AgentSession, Capabilities, CliAdapter, CliDetectionResult, CliId, StartOptions,
};
use std::path::PathBuf;
use std::time::Duration;

pub const CODEX_TESTED_VERSION: &str = "1.4.0";

pub struct CodexAdapter {
    id: CliId,
    binary_override: Option<PathBuf>,
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self {
            id: CliId::Codex,
            binary_override: None,
        }
    }

    pub fn with_binary_path(path: PathBuf) -> Self {
        Self {
            id: CliId::Codex,
            binary_override: Some(path),
        }
    }

    fn resolve_binary(&self) -> Option<PathBuf> {
        self.binary_override
            .clone()
            .or_else(|| find_in_path("codex"))
    }
}

#[async_trait]
impl CliAdapter for CodexAdapter {
    fn id(&self) -> &CliId {
        &self.id
    }

    fn display_name(&self) -> &str {
        "Codex CLI"
    }

    async fn detect(&self) -> anyhow::Result<CliDetectionResult> {
        let bin = self.resolve_binary();
        let res = probe_cli_executable(
            "codex",
            bin.as_deref(),
            CODEX_TESTED_VERSION,
            Duration::from_millis(1500),
        )
        .await;
        Ok(res)
    }

    async fn capabilities(&self) -> anyhow::Result<Capabilities> {
        Ok(Capabilities {
            acp: true,
            json_stream: true,
            resume: true,
            approvals: true,
            read_only_mode: true,
            reports_usage: true,
            tested_version: Some(CODEX_TESTED_VERSION.to_string()),
        })
    }

    async fn start(&self, opts: StartOptions) -> anyhow::Result<Box<dyn AgentSession>> {
        let bin = self
            .resolve_binary()
            .ok_or_else(|| AdapterError::BinaryNotFound {
                cli_id: "codex".to_string(),
                path: "codex".to_string(),
                reason: "Binary not found in PATH".to_string(),
            })?;

        let session_id = format!("codex-session-{}", uuid::Uuid::new_v4());
        let session = SubprocessSession::new(
            session_id,
            bin,
            vec!["exec".to_string(), "--json".to_string()],
            opts,
        );
        Ok(Box::new(session))
    }
}
