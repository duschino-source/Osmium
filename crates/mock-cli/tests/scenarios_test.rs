//! Scenario tests ported from packages/mock-cli/src/__tests__/mock-cli.test.ts

use osmium_core::schemas::TeamworkPlan;
use osmium_core::types::*;
use osmium_mock_cli::args::{CliArgs, MockCliOptions, MockScenarioName};
use osmium_mock_cli::{run_mock_cli_scenario, run_mock_cli_scenario_with_io};
use std::io::Cursor;

#[tokio::test]
async fn test_chat_scenario_streaming() {
    let opts = MockCliOptions {
        scenario: MockScenarioName::Chat,
        delay_ms: 0,
        cwd: std::path::PathBuf::from("."),
        json: true,
        write_file: false,
        target_file: "src/routes/compare.ts".into(),
        approval_kind: ApprovalKind::Command,
        prompt: None,
        resume: None,
        system_context: None,
    };
    let events = run_mock_cli_scenario(&opts).await.unwrap();

    let messages: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::Message { role, final_, text } => Some((*role, *final_, text)),
            _ => None,
        })
        .collect();

    assert!(messages.len() >= 2);
    assert_eq!(messages[0].0, MessageRole::Assistant);
    assert_eq!(messages[0].1, false);
    assert!(messages[0].2.contains("Plan: build the brief, "));
    assert_eq!(messages.last().unwrap().1, true);

    let tools: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::Tool { status, .. } => Some(*status),
            _ => None,
        })
        .collect();
    assert_eq!(tools, vec![ToolStatus::Running, ToolStatus::Done]);
}

#[tokio::test]
async fn test_edit_scenario_writes_file_safely() {
    let tmp = tempfile::tempdir().unwrap();
    let opts = MockCliOptions {
        scenario: MockScenarioName::Edit,
        delay_ms: 0,
        cwd: tmp.path().to_path_buf(),
        json: true,
        write_file: true,
        target_file: "src/routes/compare.ts".into(),
        approval_kind: ApprovalKind::Command,
        prompt: None,
        resume: None,
        system_context: None,
    };

    let events = run_mock_cli_scenario(&opts).await.unwrap();
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::FileEdit {
            added: 43,
            removed: 2,
            ..
        }
    )));

    let written = tmp.path().join("src/routes/compare.ts");
    assert!(written.exists());
    let content = std::fs::read_to_string(written).unwrap();
    assert!(content.contains("export function copyBrief"));
}

#[tokio::test]
async fn test_approval_scenario_allow_and_deny() {
    let opts = MockCliOptions {
        scenario: MockScenarioName::Approval,
        delay_ms: 0,
        cwd: std::path::PathBuf::from("."),
        json: true,
        write_file: false,
        target_file: "src/routes/compare.ts".into(),
        approval_kind: ApprovalKind::Command,
        prompt: None,
        resume: None,
        system_context: None,
    };

    // Test Allow via JSON
    let stdin_allow =
        tokio::io::BufReader::new(Cursor::new(b"{\"id\":\"approval-1\",\"allow\":true}\n"));
    let allow_events =
        run_mock_cli_scenario_with_io(&opts, Some(stdin_allow), None::<tokio::io::Sink>, None)
            .await
            .unwrap();
    assert!(allow_events
        .iter()
        .any(|e| matches!(e, AgentEvent::Approval { .. })));
    assert!(allow_events.iter().any(|e| matches!(
        e,
        AgentEvent::Status {
            state: SessionState::Waiting,
            ..
        }
    )));
    let final_msg = allow_events
        .iter()
        .find(|e| matches!(e, AgentEvent::Message { final_: true, .. }))
        .unwrap();
    if let AgentEvent::Message { text, .. } = final_msg {
        assert!(text.contains("Approved command completed"));
    }

    // Test Deny via plain text
    let stdin_deny = tokio::io::BufReader::new(Cursor::new(b"deny\n"));
    let deny_events =
        run_mock_cli_scenario_with_io(&opts, Some(stdin_deny), None::<tokio::io::Sink>, None)
            .await
            .unwrap();
    assert!(deny_events.iter().any(|e| matches!(
        e,
        AgentEvent::Tool {
            status: ToolStatus::Error,
            ..
        }
    )));
}

#[tokio::test]
async fn test_quota_scenario() {
    let opts = MockCliOptions {
        scenario: MockScenarioName::Quota,
        delay_ms: 0,
        cwd: std::path::PathBuf::from("."),
        json: true,
        write_file: false,
        target_file: "src/routes/compare.ts".into(),
        approval_kind: ApprovalKind::Command,
        prompt: None,
        resume: None,
        system_context: None,
    };
    let events = run_mock_cli_scenario(&opts).await.unwrap();
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::Usage {
            limit_hit: Some(true),
            ..
        }
    )));
    assert!(matches!(
        events.last().unwrap(),
        AgentEvent::Status {
            state: SessionState::Error,
            ..
        }
    ));
}

#[tokio::test]
async fn test_prompt_inference_plan_review_teamwork() {
    use clap::Parser;

    // /plan
    let plan_opts = MockCliOptions::from_args(
        CliArgs::try_parse_from(["mock-cli", "-p", "/plan Add copy brief", "-d", "0"]).unwrap(),
    )
    .unwrap();
    let plan_evts = run_mock_cli_scenario(&plan_opts).await.unwrap();
    let plan_msg = plan_evts
        .iter()
        .find(|e| matches!(e, AgentEvent::Message { final_: true, .. }))
        .unwrap();
    if let AgentEvent::Message { text, .. } = plan_msg {
        assert!(text.contains("Proposed Plan:"));
        assert!(text.contains("- [x] Build the markdown brief helper"));
    }

    // /review
    let review_opts = MockCliOptions::from_args(
        CliArgs::try_parse_from(["mock-cli", "-p", "/review", "-d", "0"]).unwrap(),
    )
    .unwrap();
    let review_evts = run_mock_cli_scenario(&review_opts).await.unwrap();
    let review_msg = review_evts
        .iter()
        .find(|e| matches!(e, AgentEvent::Message { final_: true, .. }))
        .unwrap();
    if let AgentEvent::Message { text, .. } = review_msg {
        assert!(text.contains("Read-only diff review complete:"));
    }

    // /teamwork
    let tw_opts = MockCliOptions::from_args(
        CliArgs::try_parse_from([
            "mock-cli",
            "-p",
            "/teamwork Add copy review brief",
            "-d",
            "0",
        ])
        .unwrap(),
    )
    .unwrap();
    let tw_evts = run_mock_cli_scenario(&tw_opts).await.unwrap();
    let tw_msg = tw_evts
        .iter()
        .find(|e| matches!(e, AgentEvent::Message { final_: true, .. }))
        .unwrap();
    if let AgentEvent::Message { text, .. } = tw_msg {
        let plan: TeamworkPlan = serde_json::from_str(text).unwrap();
        assert_eq!(plan.tasks.len(), 4);
        let clis: std::collections::HashSet<_> = plan
            .tasks
            .iter()
            .filter_map(|t| t.assigned_cli.as_deref())
            .collect();
        assert!(clis.contains("codex"));
        assert!(clis.contains("antigravity"));
        assert!(clis.contains("deepseek"));
    }
}
