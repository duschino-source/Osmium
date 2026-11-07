use thiserror::Error;

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("CLI '{cli_id}' binary not found at '{path}': {reason}")]
    BinaryNotFound {
        cli_id: String,
        path: String,
        reason: String,
    },

    #[error("Failed to spawn process for '{cli_id}': {source}")]
    SpawnFailed {
        cli_id: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Probe timed out after {timeout_ms}ms for CLI '{cli_id}'")]
    ProbeTimeout { cli_id: String, timeout_ms: u64 },

    #[error("Session '{session_id}' is already closed")]
    SessionAlreadyClosed { session_id: String },

    #[error("Session is already running a turn")]
    AlreadyRunning,

    #[error("Approval request '{approval_id}' not found in active session")]
    ApprovalNotFound { approval_id: String },

    #[error("CLI '{cli_id}' does not support '{capability}': {detail}")]
    UnsupportedCapability {
        cli_id: String,
        capability: String,
        detail: String,
    },

    #[error("Subprocess terminated unexpectedly with exit code: {code:?}")]
    ProcessTerminated { code: Option<i32> },

    #[error("I/O error communicating with subprocess: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization/deserialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Session was cancelled")]
    Cancelled,
}

impl AdapterError {
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::BinaryNotFound { .. } => "ERR_ADAPTER_BINARY_NOT_FOUND",
            Self::SpawnFailed { .. } => "ERR_ADAPTER_SPAWN_FAILED",
            Self::ProbeTimeout { .. } => "ERR_ADAPTER_PROBE_TIMEOUT",
            Self::SessionAlreadyClosed { .. } => "ERR_ADAPTER_SESSION_CLOSED",
            Self::AlreadyRunning => "ERR_ADAPTER_ALREADY_RUNNING",
            Self::ApprovalNotFound { .. } => "ERR_ADAPTER_APPROVAL_NOT_FOUND",
            Self::UnsupportedCapability { .. } => "ERR_ADAPTER_UNSUPPORTED_CAPABILITY",
            Self::ProcessTerminated { .. } => "ERR_ADAPTER_PROCESS_TERMINATED",
            Self::Io(_) => "ERR_ADAPTER_IO",
            Self::Json(_) => "ERR_ADAPTER_JSON",
            Self::Protocol(_) => "ERR_ADAPTER_PROTOCOL",
            Self::Cancelled => "ERR_ADAPTER_CANCELLED",
        }
    }
}
