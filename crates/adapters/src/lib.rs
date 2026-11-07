//! Osmium CLI Adapters, utilities, and streaming normalizer.

pub mod builtins;
pub mod display;
pub mod env;
pub mod error;
pub mod normalizer;
pub mod palette;
pub mod probe;
pub mod semver;
pub mod session;

// Re-export core domain types for full TypeScript API parity
pub use osmium_core::types::{
    AgentEvent, AgentSession, ApprovalKind, ApprovalMode, ApprovalScope, Capabilities, CliAdapter,
    CliDetectionResult, CliId, MessageRole, SessionState, StartOptions, ToolStatus,
};

pub use builtins::{
    builtin_adapters, get_builtin_adapter, AntigravityAdapter, CodexAdapter, DeepSeekAdapter,
    DeepSeekProbe, MockCliAdapter, MockExecutionMode, DEEPSEEK_TESTED_VERSION,
};
pub use display::get_cli_display_name;
pub use env::{
    sanitize_process_env, validate_zero_api_key_requirement, ApiKeyViolationError,
    FORBIDDEN_CONFIG_KEYS, FORBIDDEN_ENV_VARS,
};
pub use error::AdapterError;
pub use normalizer::{
    assemble_streamed_message, strip_ansi_codes, EventNormalizer, NormalizedEventStreamParser,
};
pub use palette::{get_cli_color, get_cli_css_variable, DEFAULT_CLI_PALETTE, KNOWN_CLI_COLORS};
pub use probe::{extract_semver, find_in_path, probe_cli_executable, probe_help_text, CliProber};
pub use semver::{compare_semver, create_version_warning};
pub use session::{ApprovalGate, PromptTransport, SubprocessSession, SubprocessSessionConfig};
