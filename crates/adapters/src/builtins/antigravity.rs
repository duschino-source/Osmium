//! Antigravity CLI adapter.

use crate::error::AdapterError;
use crate::probe::{find_in_path, probe_cli_executable};
use crate::session::SubprocessSession;
use async_trait::async_trait;
use osmium_core::types::{
    AgentSession, Capabilities, CliAdapter, CliDetectionResult, CliId, StartOptions,
};
use std::path::PathBuf;
use std::time::Duration;

pub const ANTIGRAVITY_TESTED_VERSION: &str = "1.4.0";

pub struct AntigravityAdapter {
    id: CliId,
    binary_override: Option<PathBuf>,
}

impl Default for AntigravityAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AntigravityAdapter {
    pub fn new() -> Self {
        Self {
            id: CliId::Antigravity,
            binary_override: None,
        }
    }

    pub fn with_binary_path(path: PathBuf) -> Self {
        Self {
            id: CliId::Antigravity,
            binary_override: Some(path),
        }
    }

    fn resolve_binary(&self) -> Option<PathBuf> {
        self.binary_override
            .clone()
            .or_else(|| find_in_path("antigravity"))
    }
}

#[async_trait]
impl CliAdapter for AntigravityAdapter {
    fn id(&self) -> &CliId {
        &self.id
    }

    fn display_name(&self) -> &str {
        "Antigravity"
    }

    async fn detect(&self) -> anyhow::Result<CliDetectionResult> {
        let bin = self.resolve_binary();
        let res = probe_cli_executable(
            "antigravity",
            bin.as_deref(),
            ANTIGRAVITY_TESTED_VERSION,
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
            tested_version: Some(ANTIGRAVITY_TESTED_VERSION.to_string()),
        })
    }

    async fn start(&self, opts: StartOptions) -> anyhow::Result<Box<dyn AgentSession>> {
        let bin = self
            .resolve_binary()
            .ok_or_else(|| AdapterError::BinaryNotFound {
                cli_id: "antigravity".to_string(),
                path: "antigravity".to_string(),
                reason: "Binary not found in PATH".to_string(),
            })?;

        let session_id = format!("antigravity-session-{}", uuid::Uuid::new_v4());
        let session = SubprocessSession::new(session_id, bin, vec!["--json".to_string()], opts);
        Ok(Box::new(session))
    }
}
