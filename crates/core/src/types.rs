use std::fmt;
use std::path::PathBuf;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// CLI adapter identifier. Supports canonical builtins and custom CLI strings.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliId {
    Codex,
    Antigravity,
    Deepseek,
    Mock,
    #[serde(untagged)]
    Custom(String),
}

impl CliId {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Codex => "codex",
            Self::Antigravity => "antigravity",
            Self::Deepseek => "deepseek",
            Self::Mock => "mock",
            Self::Custom(s) => s.as_str(),
        }
    }
}

impl fmt::Display for CliId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl From<&str> for CliId {
    fn from(s: &str) -> Self {
        match s {
            "codex" => Self::Codex,
            "antigravity" => Self::Antigravity,
            "deepseek" => Self::Deepseek,
            "mock" => Self::Mock,
            other => Self::Custom(other.to_string()),
        }
    }
}

impl From<String> for CliId {
    fn from(s: String) -> Self {
        match s.as_str() {
            "codex" => Self::Codex,
            "antigravity" => Self::Antigravity,
            "deepseek" => Self::Deepseek,
            "mock" => Self::Mock,
            _ => Self::Custom(s),
        }
    }
}

/// User approval mode for assistant actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalMode {
    #[default]
    Ask,
    AutoEdit,
    FullAuto,
}

/// Capabilities supported by a CLI adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub acp: bool,
    pub json_stream: bool,
    pub resume: bool,
    pub approvals: bool,
    pub read_only_mode: bool,
    pub reports_usage: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tested_version: Option<String>,
}

/// Result of probing a CLI executable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliDetectionResult {
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_warning: Option<String>,
}

/// Options supplied when launching an agent session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    pub cwd: String,
    pub approval_mode: ApprovalMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
}

/// Scope of approval granted by user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalScope {
    Once,
    Session,
}

/// Role of a message in a conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    Assistant,
    User,
}

/// Status of a tool invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolStatus {
    Running,
    Done,
    Error,
}

/// Category of action requiring approval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalKind {
    Command,
    Edit,
    Network,
}

/// State of an active agent session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Idle,
    Working,
    Waiting,
    Interrupted,
    Cancelled,
    Closed,
    Error,
}

/// Normalized event emitted by an agent session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentEvent {
    #[serde(rename = "message")]
    Message {
        role: MessageRole,
        text: String,
        #[serde(default, rename = "final")]
        final_: bool,
    },
    #[serde(rename = "tool")]
    Tool {
        id: String,
        name: String,
        status: ToolStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(rename = "durationSec", skip_serializing_if = "Option::is_none")]
        duration_sec: Option<f64>,
    },
    #[serde(rename = "file-edit")]
    FileEdit {
        path: String,
        added: u64,
        removed: u64,
    },
    #[serde(rename = "approval")]
    Approval {
        id: String,
        kind: ApprovalKind,
        detail: String,
    },
    #[serde(rename = "usage")]
    Usage {
        #[serde(rename = "limitHit", skip_serializing_if = "Option::is_none")]
        limit_hit: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
    #[serde(rename = "status")]
    Status {
        state: SessionState,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    #[serde(rename = "raw")]
    Raw {
        data: String,
    },
}

impl AgentEvent {
    pub fn event_type(&self) -> &'static str {
        match self {
            Self::Message { .. } => "message",
            Self::Tool { .. } => "tool",
            Self::FileEdit { .. } => "file-edit",
            Self::Approval { .. } => "approval",
            Self::Usage { .. } => "usage",
            Self::Status { .. } => "status",
            Self::Raw { .. } => "raw",
        }
    }
}

/// Trait implemented by CLI adapters.
#[async_trait]
pub trait CliAdapter: Send + Sync {
    fn id(&self) -> &CliId;
    fn display_name(&self) -> &str;
    async fn detect(&self) -> anyhow::Result<CliDetectionResult>;
    async fn capabilities(&self) -> anyhow::Result<Capabilities>;
    async fn start(&self, opts: StartOptions) -> anyhow::Result<Box<dyn AgentSession>>;
}

/// Active agent session trait.
#[async_trait]
pub trait AgentSession: Send + Sync {
    fn id(&self) -> &str;
    fn take_event_receiver(&mut self) -> Option<tokio::sync::mpsc::UnboundedReceiver<AgentEvent>>;
    async fn send(&self, prompt: &str, attachments: Option<&[PathBuf]>) -> anyhow::Result<()>;
    async fn respond_to_approval(
        &self,
        id: &str,
        allow: bool,
        scope: Option<ApprovalScope>,
    ) -> anyhow::Result<()>;
    async fn cancel(&self) -> anyhow::Result<()>;
    async fn close(&self) -> anyhow::Result<()>;
}

/// Summary of a project managed by Osmium.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub primary_cli: CliId,
    pub secondary_clis: Vec<CliId>,
    pub approval_mode: ApprovalMode,
    pub updated_at: i64,
}

/// Summary of an agent conversation session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub active_cli: CliId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    pub status: SessionState,
    pub created_at: i64,
    pub updated_at: i64,
}

/// File edit count record inside a checkpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeRecord {
    pub path: String,
    pub added: u64,
    pub removed: u64,
}

/// Pre-turn Git checkpoint summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointSummary {
    pub id: String,
    pub session_id: String,
    pub turn_index: u64,
    pub git_ref: String,
    pub commit_sha: String,
    pub files_changed: Vec<FileChangeRecord>,
    pub created_at: i64,
}

/// Status of a teamwork task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TeamworkTaskStatus {
    Queued,
    Running,
    Review,
    Done,
    Error,
}

/// Task state in a teamwork run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamworkTaskState {
    pub id: String,
    pub run_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub task_type: String,
    pub assigned_cli: CliId,
    pub status: TeamworkTaskStatus,
    pub scope: Vec<String>,
    pub dependencies: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub diff_added: u64,
    pub diff_removed: u64,
    pub out_of_scope_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
}

/// Run state for teamwork orchestration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TeamworkRunStatus {
    Planning,
    Running,
    Review,
    Done,
    Conflict,
    Error,
}

/// Entire teamwork run state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamworkRunState {
    pub id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub goal: String,
    pub orchestrator_cli: CliId,
    pub integration_branch: String,
    pub max_parallel: u32,
    pub status: TeamworkRunStatus,
    pub tasks: Vec<TeamworkTaskState>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// CLI token and turn usage stats.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUsageStats {
    pub cli_id: CliId,
    pub turns_run: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_limit_hit_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_note: Option<String>,
}
