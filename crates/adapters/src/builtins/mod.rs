//! Builtin CLI adapters.

pub mod antigravity;
pub mod codex;
pub mod deepseek;
pub mod mock;

pub use antigravity::AntigravityAdapter;
pub use codex::CodexAdapter;
pub use deepseek::{DeepSeekAdapter, DeepSeekProbe, DEEPSEEK_TESTED_VERSION};
pub use mock::{MockCliAdapter, MockExecutionMode};

use osmium_core::types::{CliAdapter, CliId};
use std::sync::Arc;

/// Factory producing all canonical builtin CLI adapters.
pub fn builtin_adapters() -> Vec<Arc<dyn CliAdapter>> {
    vec![
        Arc::new(MockCliAdapter::new()),
        Arc::new(CodexAdapter::new()),
        Arc::new(AntigravityAdapter::new()),
        Arc::new(DeepSeekAdapter::new()),
    ]
}

/// Looks up a builtin adapter by CliId.
pub fn get_builtin_adapter(id: &CliId) -> Option<Arc<dyn CliAdapter>> {
    builtin_adapters().into_iter().find(|a| a.id() == id)
}
