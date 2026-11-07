//! Subprocess integration test between osmium-adapters and osmium-mock-cli binary.

use osmium_adapters::*;
use std::path::PathBuf;

fn get_mock_cli_binary() -> Option<PathBuf> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(format!("osmium-mock-cli{}", std::env::consts::EXE_SUFFIX));
    if candidate.exists() {
        return Some(candidate);
    }
    find_in_path("osmium-mock-cli")
}

#[tokio::test]
async fn test_adapter_subprocess_session_with_mock_cli() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping subprocess test: osmium-mock-cli binary not yet built");
        return;
    };

    let adapter = MockCliAdapter::with_binary_path(mock_bin);
    let detect = adapter.detect().await.unwrap();
    assert!(detect.installed);
    assert_eq!(detect.version.as_deref(), Some("0.1.0"));

    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::Ask,
        resume: None,
        system_context: None,
        read_only: None,
    };

    let mut session = adapter.start(opts).await.unwrap();
    let mut rx = session.take_event_receiver().unwrap();

    session.send("approval", None).await.unwrap();

    let mut received_approval = false;
    let mut approval_id = String::new();

    while let Some(evt) = rx.recv().await {
        match evt {
            AgentEvent::Approval { id, .. } => {
                received_approval = true;
                approval_id = id;
                break;
            }
            _ => {}
        }
    }

    assert!(received_approval);
    assert_eq!(approval_id, "approval-1");

    // Respond to approval via session
    session
        .respond_to_approval(&approval_id, true, Some(ApprovalScope::Once))
        .await
        .unwrap();

    let mut completed = false;
    while let Some(evt) = rx.recv().await {
        if let AgentEvent::Message {
            ref text,
            final_: true,
            ..
        } = evt
        {
            if text.contains("Approved command completed") {
                completed = true;
            }
        }
        if matches!(
            evt,
            AgentEvent::Status {
                state: SessionState::Idle,
                ..
            }
        ) {
            break;
        }
    }

    assert!(completed, "Expected approval completion message");
    session.close().await.unwrap();
}

#[tokio::test]
async fn test_adapter_subprocess_session_cancellation() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping subprocess test: osmium-mock-cli binary not yet built");
        return;
    };
    let adapter = MockCliAdapter::with_binary_path(mock_bin);

    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: None,
    };

    let session = adapter.start(opts).await.unwrap();
    session.send("chat", None).await.unwrap();

    // Cancel session immediately
    session.cancel().await.unwrap();
    session.close().await.unwrap();
}
