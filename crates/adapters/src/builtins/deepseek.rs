//! DeepSeek CLI adapter.
//!
//! ## Truthfulness note
//!
//! No real DeepSeek CLI has been observed on any development host. The
//! adapter therefore derives every capability from the binary's own
//! `--help` output at runtime and leaves unauthorised capabilities `false`.
//! `DEEPSEEK_TESTED_VERSION` is `None` until a real version has actually
//! been probed (see `docs/adapters/deepseek.md`).
//!
//! Session arguments contain only flags that appeared verbatim in `--help`.
//! The prompt, system context and attachment paths are delivered on stdin,
//! so prompt text never has to survive Windows `.cmd` command-line quoting.

use crate::error::AdapterError;
use crate::probe::{find_in_path, probe_cli_executable, probe_help_text, CliProber};
use crate::session::{ApprovalGate, PromptTransport, SubprocessSession, SubprocessSessionConfig};
use async_trait::async_trait;
use osmium_core::types::{
    AgentSession, Capabilities, CliAdapter, CliDetectionResult, CliId, StartOptions,
};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Version of the real DeepSeek CLI this adapter has been verified against.
///
/// `None` is deliberate: no real `deepseek` binary has been available on any
/// host where this adapter was built, so claiming a version would be a lie.
pub const DEEPSEEK_TESTED_VERSION: Option<&str> = None;

/// Default timeout for the `--help` capability probe.
pub const DEEPSEEK_HELP_PROBE_TIMEOUT: Duration = Duration::from_millis(2000);

/// Result of one DeepSeek capability probe.
#[derive(Debug, Clone)]
pub struct DeepSeekProbe {
    pub capabilities: Capabilities,
    /// Exact streaming flag advertised in `--help`, if any.
    pub json_flag: Option<String>,
    /// Exact resume flag advertised in `--help`, if any.
    pub resume_flag: Option<String>,
    /// Exact read-only flag advertised in `--help`, if any.
    pub read_only_flag: Option<String>,
}

pub struct DeepSeekAdapter {
    id: CliId,
    binary_override: Option<PathBuf>,
    prober: CliProber,
    probe_timeout: Duration,
}

impl Default for DeepSeekAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl DeepSeekAdapter {
    pub fn new() -> Self {
        Self {
            id: CliId::Deepseek,
            binary_override: None,
            prober: CliProber::new(),
            probe_timeout: DEEPSEEK_HELP_PROBE_TIMEOUT,
        }
    }

    pub fn with_binary_path(path: PathBuf) -> Self {
        Self {
            id: CliId::Deepseek,
            binary_override: Some(path),
            prober: CliProber::new(),
            probe_timeout: DEEPSEEK_HELP_PROBE_TIMEOUT,
        }
    }

    /// Overrides the `--help` probe timeout (useful in tests).
    pub fn with_probe_timeout(mut self, timeout: Duration) -> Self {
        self.probe_timeout = timeout;
        self
    }

    fn resolve_binary(&self) -> Option<PathBuf> {
        self.binary_override
            .clone()
            .or_else(|| find_in_path("deepseek"))
    }

    async fn probe(&self, binary_path: &Path) -> anyhow::Result<DeepSeekProbe> {
        let help = probe_help_text(binary_path, self.probe_timeout)
            .await
            .unwrap_or_default();
        let mut capabilities = self
            .prober
            .probe_capabilities(
                "deepseek",
                None,
                &help,
                DEEPSEEK_TESTED_VERSION.unwrap_or(""),
            )
            .await;

        // The shared prober is a claim about the CLI. These two are not
        // implemented by this adapter, so it must not advertise them even if
        // a future help screen mentions the flags.
        capabilities.acp = false;
        capabilities.approvals = false;
        capabilities.tested_version = DEEPSEEK_TESTED_VERSION.map(str::to_string);

        Ok(DeepSeekProbe {
            capabilities,
            json_flag: find_flag(&help, &["--json-stream", "--json"]),
            resume_flag: find_flag(&help, &["--resume"]),
            read_only_flag: find_flag(&help, &["--read-only", "--readonly"]),
        })
    }

    /// Builds the per-turn argv from probed capabilities only.
    pub fn build_turn_args(
        probe: &DeepSeekProbe,
        opts: &StartOptions,
    ) -> Result<Vec<String>, AdapterError> {
        if opts.resume.is_some() && !probe.capabilities.resume {
            return Err(AdapterError::UnsupportedCapability {
                cli_id: "deepseek".to_string(),
                capability: "resume".to_string(),
                detail: "the installed DeepSeek CLI did not advertise a resume flag".to_string(),
            });
        }
        if opts.read_only == Some(true) && !probe.capabilities.read_only_mode {
            return Err(AdapterError::UnsupportedCapability {
                cli_id: "deepseek".to_string(),
                capability: "readOnlyMode".to_string(),
                detail: "the installed DeepSeek CLI did not advertise a read-only flag".to_string(),
            });
        }

        let mut args = Vec::new();

        if probe.capabilities.json_stream {
            if let Some(flag) = &probe.json_flag {
                args.push(flag.clone());
            }
        }

        if let Some(resume_id) = &opts.resume {
            // The id ends up on a Windows `.cmd` command line; refuse values
            // that could be interpreted by cmd.exe.
            if !is_safe_argv_token(resume_id) {
                return Err(AdapterError::Protocol(format!(
                    "refusing to pass unsafe resume id on the command line: {resume_id:?}"
                )));
            }
            if let Some(flag) = &probe.resume_flag {
                args.push(flag.clone());
                args.push(resume_id.clone());
            }
        }

        if opts.read_only == Some(true) {
            if let Some(flag) = &probe.read_only_flag {
                args.push(flag.clone());
            }
        }

        Ok(args)
    }
}

/// Returns the first flag-shaped token present in help output.
fn find_flag(help: &str, candidates: &[&str]) -> Option<String> {
    let lower = help.to_ascii_lowercase();
    candidates
        .iter()
        .find(|candidate| lower.contains(**candidate))
        .map(|candidate| (*candidate).to_string())
}

/// Session ids are provider-issued tokens. Keep them to a conservative
/// character set so a `.cmd` shim cannot interpret them as shell syntax.
fn is_safe_argv_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':' | '/' | '\\'))
}

#[async_trait]
impl CliAdapter for DeepSeekAdapter {
    fn id(&self) -> &CliId {
        &self.id
    }

    fn display_name(&self) -> &str {
        "DeepSeek CLI"
    }

    async fn detect(&self) -> anyhow::Result<CliDetectionResult> {
        let bin = self.resolve_binary();
        let res = probe_cli_executable(
            "deepseek",
            bin.as_deref(),
            DEEPSEEK_TESTED_VERSION.unwrap_or(""),
            Duration::from_millis(1500),
        )
        .await;
        Ok(res)
    }

    async fn capabilities(&self) -> anyhow::Result<Capabilities> {
        let Some(bin) = self.resolve_binary() else {
            return Ok(Capabilities {
                tested_version: DEEPSEEK_TESTED_VERSION.map(str::to_string),
                ..Capabilities::default()
            });
        };
        if !bin.is_file() {
            return Ok(Capabilities {
                tested_version: DEEPSEEK_TESTED_VERSION.map(str::to_string),
                ..Capabilities::default()
            });
        }
        Ok(self.probe(&bin).await?.capabilities)
    }

    async fn start(&self, opts: StartOptions) -> anyhow::Result<Box<dyn AgentSession>> {
        let bin = self
            .resolve_binary()
            .ok_or_else(|| AdapterError::BinaryNotFound {
                cli_id: "deepseek".to_string(),
                path: "deepseek".to_string(),
                reason: "Binary not found in PATH".to_string(),
            })?;
        if !bin.is_file() {
            return Err(AdapterError::BinaryNotFound {
                cli_id: "deepseek".to_string(),
                path: bin.to_string_lossy().to_string(),
                reason: "Path exists but is not a file".to_string(),
            }
            .into());
        }

        let probe = self.probe(&bin).await?;
        let args = Self::build_turn_args(&probe, &opts)?;

        let session_id = format!("deepseek-session-{}", uuid::Uuid::new_v4());
        let config = SubprocessSessionConfig {
            prompt_transport: PromptTransport::StdinPrompt,
            approval_gate: ApprovalGate::OsmiumGate,
            emit_start_status: true,
        };
        let session = SubprocessSession::new_with_config(session_id, bin, args, opts, config);
        Ok(Box::new(session))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use osmium_core::types::ApprovalMode;

    fn opts() -> StartOptions {
        StartOptions {
            cwd: ".".to_string(),
            approval_mode: ApprovalMode::Ask,
            resume: None,
            system_context: None,
            read_only: None,
        }
    }

    fn probe(capabilities: Capabilities) -> DeepSeekProbe {
        DeepSeekProbe {
            capabilities,
            json_flag: Some("--json".to_string()),
            resume_flag: Some("--resume".to_string()),
            read_only_flag: Some("--read-only".to_string()),
        }
    }

    #[test]
    fn no_binary_means_no_verified_version() {
        assert!(DEEPSEEK_TESTED_VERSION.is_none());
    }

    #[test]
    fn args_contain_only_advertised_flags() {
        let caps = Capabilities {
            json_stream: true,
            resume: true,
            read_only_mode: true,
            ..Capabilities::default()
        };
        let mut start = opts();
        start.resume = Some("sess-1".to_string());
        start.read_only = Some(true);
        let args = DeepSeekAdapter::build_turn_args(&probe(caps), &start).unwrap();
        assert_eq!(args, vec!["--json", "--resume", "sess-1", "--read-only"]);
    }

    #[test]
    fn resume_is_rejected_when_not_advertised() {
        let caps = Capabilities::default();
        let mut start = opts();
        start.resume = Some("sess-1".to_string());
        let err = DeepSeekAdapter::build_turn_args(&probe(caps), &start).unwrap_err();
        assert_eq!(err.error_code(), "ERR_ADAPTER_UNSUPPORTED_CAPABILITY");
    }

    #[test]
    fn read_only_is_rejected_when_not_advertised() {
        let caps = Capabilities::default();
        let mut start = opts();
        start.read_only = Some(true);
        let err = DeepSeekAdapter::build_turn_args(&probe(caps), &start).unwrap_err();
        assert_eq!(err.error_code(), "ERR_ADAPTER_UNSUPPORTED_CAPABILITY");
    }

    #[test]
    fn unsafe_resume_ids_never_reach_argv() {
        let caps = Capabilities {
            resume: true,
            ..Capabilities::default()
        };
        let mut start = opts();
        start.resume = Some("x&calc".to_string());
        let err = DeepSeekAdapter::build_turn_args(&probe(caps), &start).unwrap_err();
        assert_eq!(err.error_code(), "ERR_ADAPTER_PROTOCOL");
    }

    #[test]
    fn find_flag_prefers_the_streaming_variant() {
        let help = "Options:\n  --json-stream  Emit NDJSON\n  --json  Emit JSON\n";
        assert_eq!(
            find_flag(help, &["--json-stream", "--json"]).as_deref(),
            Some("--json-stream")
        );
        assert_eq!(
            find_flag(
                "Options:\n  --json  Emit JSON\n",
                &["--json-stream", "--json"]
            )
            .as_deref(),
            Some("--json")
        );
        assert_eq!(find_flag("no flags here", &["--json"]), None);
    }
}
