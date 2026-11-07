//! Mock CLI scenario runner library.

pub mod args;
pub mod cli;
pub mod error;
pub mod plan_data;
pub mod scenarios;
pub mod stdin;

pub use args::{parse_approval_kind, CliArgs, MockCliOptions, MockScenarioName, MOCK_CLI_VERSION};
pub use cli::cli_main;
pub use error::MockCliError;
pub use scenarios::run_scenario;
pub use stdin::{parse_approval_input, wait_for_approval_line};

use osmium_core::types::AgentEvent;
use tokio::io::{AsyncBufRead, AsyncWrite};

/// In-memory execution without external IO.
pub async fn run_mock_cli_scenario(opts: &MockCliOptions) -> Result<Vec<AgentEvent>, MockCliError> {
    let dummy_stdin: Option<tokio::io::Empty> = None;
    let dummy_stdout: Option<tokio::io::Sink> = None;
    run_scenario(opts, dummy_stdin, dummy_stdout, None).await
}

/// Execution with generic AsyncBufRead (stdin) and AsyncWrite (stdout).
pub async fn run_mock_cli_scenario_with_io<R, W>(
    opts: &MockCliOptions,
    stdin: Option<R>,
    stdout: Option<W>,
    on_event: Option<&mut (dyn FnMut(&AgentEvent) + Send)>,
) -> Result<Vec<AgentEvent>, MockCliError>
where
    R: AsyncBufRead + Unpin + Send,
    W: AsyncWrite + Unpin + Send,
{
    run_scenario(opts, stdin, stdout, on_event).await
}
