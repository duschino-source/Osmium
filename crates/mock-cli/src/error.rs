//! Error types for mock-cli.

use osmium_core::boundary::BoundaryError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MockCliError {
    #[error("Workspace boundary violation: {0}")]
    Boundary(#[from] BoundaryError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Unknown scenario: {0}")]
    UnknownScenario(String),

    #[error("Runtime error: {0}")]
    Runtime(String),
}
