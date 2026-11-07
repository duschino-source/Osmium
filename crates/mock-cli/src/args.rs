//! Command-line argument parsing and scenario inference.

use clap::Parser;
use osmium_core::types::ApprovalKind;
use std::path::PathBuf;

pub const MOCK_CLI_VERSION: &str = "0.1.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MockScenarioName {
    Chat,
    Edit,
    Approval,
    Quota,
    Plan,
    Review,
    Teamwork,
    Raw,
}

impl MockScenarioName {
    pub fn parse(s: &str) -> Option<Self> {
        let cleaned = s.trim().trim_start_matches('/').to_lowercase();
        match cleaned.as_str() {
            "chat" => Some(Self::Chat),
            "edit" | "file-edit" => Some(Self::Edit),
            "approval" | "edit-approval" => Some(Self::Approval),
            "quota" | "limit" | "usage" => Some(Self::Quota),
            "plan" => Some(Self::Plan),
            "review" => Some(Self::Review),
            "teamwork" => Some(Self::Teamwork),
            "raw" => Some(Self::Raw),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Edit => "edit",
            Self::Approval => "approval",
            Self::Quota => "quota",
            Self::Plan => "plan",
            Self::Review => "review",
            Self::Teamwork => "teamwork",
            Self::Raw => "raw",
        }
    }
}

pub fn parse_approval_kind(s: &str) -> ApprovalKind {
    match s.trim().to_lowercase().as_str() {
        "edit" => ApprovalKind::Edit,
        "network" => ApprovalKind::Network,
        _ => ApprovalKind::Command,
    }
}

pub fn infer_scenario_from_prompt(prompt: &str) -> MockScenarioName {
    let trimmed = prompt.trim();
    let lower = trimmed.to_lowercase();
    if lower.starts_with("/plan") {
        return MockScenarioName::Plan;
    }
    if lower.starts_with("/review") {
        return MockScenarioName::Review;
    }
    if lower.starts_with("/teamwork") {
        return MockScenarioName::Teamwork;
    }

    static RE_QUOTA: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static RE_APPROVAL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static RE_EDIT: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();

    let re_quota = RE_QUOTA.get_or_init(|| regex::Regex::new(r"(?i)\b(quota|limit)\b").unwrap());
    let re_approval =
        RE_APPROVAL.get_or_init(|| regex::Regex::new(r"(?i)\b(approval|approve)\b").unwrap());
    let re_edit = RE_EDIT.get_or_init(|| regex::Regex::new(r"(?i)\b(edit|write)\b").unwrap());

    if re_quota.is_match(trimmed) {
        return MockScenarioName::Quota;
    }
    if re_approval.is_match(trimmed) {
        return MockScenarioName::Approval;
    }
    if re_edit.is_match(trimmed) {
        return MockScenarioName::Edit;
    }

    MockScenarioName::Chat
}

#[derive(Parser, Debug, Clone)]
#[command(
    name = "mock-cli",
    version = MOCK_CLI_VERSION,
    about = "Osmium deterministic fake CLI for testing",
    disable_version_flag = true,
    help_template = "mock-cli v{version} — {about}\n\nUsage: {usage}\n\nOptions:\n{options}"
)]
pub struct CliArgs {
    /// Print version and exit
    #[arg(short = 'v', long)]
    pub version: bool,

    /// Scenario: chat | edit | approval | quota | plan | review | teamwork | raw
    #[arg(short = 's', long)]
    pub scenario: Option<String>,

    /// Delay in milliseconds between emitted events (default: 10)
    #[arg(short = 'd', long, default_value_t = 10)]
    pub delay: u64,

    /// Working directory for file operations
    #[arg(long, default_value = ".")]
    pub cwd: PathBuf,

    /// Emit newline-delimited JSON AgentEvents (default)
    #[arg(long, default_value_t = true)]
    pub json: bool,

    /// Emit human-readable plain text output
    #[arg(long, default_value_t = false)]
    pub text: bool,

    /// Write simulated file edit to disk inside --cwd
    #[arg(long, default_value_t = false)]
    pub write_file: bool,

    /// Target file path relative to --cwd (default: src/routes/compare.ts)
    #[arg(long, default_value = "src/routes/compare.ts")]
    pub target_file: String,

    /// Approval kind: command | edit | network (default: command)
    #[arg(long, default_value = "command")]
    pub approval_kind: String,

    /// User prompt text
    #[arg(short = 'p', long)]
    pub prompt: Option<String>,

    /// Resume an existing session ID
    #[arg(long)]
    pub resume: Option<String>,

    /// System handoff or context string
    #[arg(long)]
    pub system_context: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MockCliOptions {
    pub scenario: MockScenarioName,
    pub delay_ms: u64,
    pub cwd: PathBuf,
    pub json: bool,
    pub write_file: bool,
    pub target_file: String,
    pub approval_kind: ApprovalKind,
    pub prompt: Option<String>,
    pub resume: Option<String>,
    pub system_context: Option<String>,
}

impl MockCliOptions {
    pub fn from_args(args: CliArgs) -> Result<Self, String> {
        let scenario = match &args.scenario {
            Some(s) => match MockScenarioName::parse(s) {
                Some(scen) => scen,
                None => return Err(s.clone()),
            },
            None => {
                if let Some(ref prompt) = args.prompt {
                    infer_scenario_from_prompt(prompt)
                } else {
                    MockScenarioName::Chat
                }
            }
        };

        let json = if args.text { false } else { args.json };

        Ok(Self {
            scenario,
            delay_ms: args.delay,
            cwd: args.cwd,
            json,
            write_file: args.write_file,
            target_file: args.target_file,
            approval_kind: parse_approval_kind(&args.approval_kind),
            prompt: args.prompt,
            resume: args.resume,
            system_context: args.system_context,
        })
    }
}
