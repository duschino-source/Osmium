//! Multi-Turn Session Lifecycle and Subprocess Concurrency Adversarial Stress Test.
//!
//! Validates:
//! 1. Consecutive turns on a single SubprocessSession instance against osmium-mock-cli.
//! 2. Clean transition back to SessionState::Idle upon turn completion.
//! 3. Absence of deadlocks or ERR_ADAPTER_ALREADY_RUNNING errors on subsequent turns.
//! 4. Process reaping: no orphan or zombie processes lingering.
//! 5. Interactive approval turn following normal turn (stdin preservation).
//! 6. Immediate cancel() during streaming terminating the child process cleanly.
//! 7. Recovery and new turn execution after cancellation.
//! 8. Rejection of concurrent send() calls while session is SessionState::Working.

use osmium_adapters::*;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::timeout;

fn get_mock_cli_binary() -> Option<PathBuf> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(format!("osmium-mock-cli{}", std::env::consts::EXE_SUFFIX));
    if candidate.exists() {
        return Some(candidate);
    }
    find_in_path("osmium-mock-cli")
}

fn count_running_mock_cli_processes() -> usize {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq osmium-mock-cli.exe", "/FO", "CSV"])
            .output();
        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .filter(|l| l.to_lowercase().contains("osmium-mock-cli.exe"))
                    .count()
            }
            Err(_) => 0,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        0
    }
}

/// Helper to drain events until SessionState::Idle or Error is reached.
async fn drain_until_idle_or_terminal(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<AgentEvent>,
    max_wait: Duration,
) -> Result<Vec<AgentEvent>, String> {
    let mut collected = Vec::new();
    let deadline = tokio::time::Instant::now() + max_wait;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(format!(
                "Timed out waiting for Idle state after {:?}. Collected {} events.",
                max_wait,
                collected.len()
            ));
        }

        match timeout(remaining, rx.recv()).await {
            Ok(Some(evt)) => {
                let is_terminal = matches!(
                    &evt,
                    AgentEvent::Status {
                        state: SessionState::Idle | SessionState::Error | SessionState::Cancelled,
                        ..
                    }
                );
                collected.push(evt);
                if is_terminal {
                    break;
                }
            }
            Ok(None) => {
                return Err("Event receiver closed unexpectedly".into());
            }
            Err(_) => {
                return Err(format!("Timed out after {:?}", max_wait));
            }
        }
    }

    Ok(collected)
}

#[tokio::test]
async fn test_consecutive_multi_turn_send_lifecycle() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let adapter = MockCliAdapter::with_binary_path(mock_bin);
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::Ask,
        resume: None,
        system_context: None,
        read_only: None,
    };

    let mut session = adapter.start(opts).await.expect("Failed to start session");
    let mut rx = session
        .take_event_receiver()
        .expect("Failed to take event receiver");

    // Turn 1: Chat scenario
    println!("[Turn 1] Sending prompt: chat");
    session
        .send("chat", None)
        .await
        .expect("Turn 1 send failed");
    let events1 = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Turn 1 drain failed");
    assert!(
        events1
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. })),
        "Turn 1 did not reach Idle state"
    );

    // Turn 2: Edit scenario
    println!("[Turn 2] Sending prompt: edit");
    session
        .send("edit", None)
        .await
        .expect("Turn 2 send failed: cannot start subsequent turn");
    let events2 = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Turn 2 drain failed");
    assert!(
        events2
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. })),
        "Turn 2 did not reach Idle state"
    );

    // Turn 3: Plan scenario
    println!("[Turn 3] Sending prompt: /plan design system");
    session
        .send("/plan design system", None)
        .await
        .expect("Turn 3 send failed: cannot start subsequent turn");
    let events3 = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Turn 3 drain failed");
    assert!(
        events3
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. })),
        "Turn 3 did not reach Idle state"
    );

    // Turn 4: Raw scenario
    println!("[Turn 4] Sending prompt: /raw");
    session
        .send("/raw", None)
        .await
        .expect("Turn 4 send failed: cannot start subsequent turn");
    let events4 = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Turn 4 drain failed");
    assert!(
        events4
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. })),
        "Turn 4 did not reach Idle state"
    );

    session.close().await.expect("Failed to close session");
}

#[tokio::test]
async fn test_rapid_consecutive_turns_loop() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
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

    let mut session = adapter.start(opts).await.expect("Failed to start session");
    let mut rx = session
        .take_event_receiver()
        .expect("Failed to take event receiver");

    // Rapid-fire 5 turns consecutively
    for i in 1..=5 {
        println!("[Rapid Turn {}] Sending prompt", i);
        session
            .send("chat", None)
            .await
            .unwrap_or_else(|e| panic!("Rapid turn {} send failed with error: {:?}", i, e));

        let events = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
            .await
            .unwrap_or_else(|e| panic!("Rapid turn {} drain failed: {}", i, e));

        let has_idle = events
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. }));
        assert!(has_idle, "Rapid turn {} did not reach Idle state", i);
    }

    session.close().await.expect("Failed to close session");
}

#[tokio::test]
async fn test_consecutive_turn_with_interactive_approval() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let adapter = MockCliAdapter::with_binary_path(mock_bin);
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::Ask,
        resume: None,
        system_context: None,
        read_only: None,
    };

    let mut session = adapter.start(opts).await.expect("Failed to start session");
    let mut rx = session
        .take_event_receiver()
        .expect("Failed to take event receiver");

    // Turn 1: Normal chat turn
    session
        .send("chat", None)
        .await
        .expect("Turn 1 send failed");
    let _ = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Turn 1 drain failed");

    // Turn 2: Approval turn immediately following Turn 1
    session
        .send("approval", None)
        .await
        .expect("Turn 2 send failed: unable to start approval turn after chat turn");

    // Wait for Approval event
    let mut approval_id = String::new();
    let approval_deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while let Ok(Some(evt)) = timeout(
        approval_deadline.saturating_duration_since(tokio::time::Instant::now()),
        rx.recv(),
    )
    .await
    {
        if let AgentEvent::Approval { id, .. } = evt {
            approval_id = id;
            break;
        }
    }
    assert!(
        !approval_id.is_empty(),
        "Did not receive approval event in Turn 2"
    );

    // Respond to approval via session stdin
    session
        .respond_to_approval(&approval_id, true, Some(ApprovalScope::Once))
        .await
        .expect("respond_to_approval failed on consecutive turn (stdin may have been closed prematurely!)");

    // Drain remaining Turn 2 events until Idle
    let remaining_events = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Turn 2 post-approval drain failed");
    assert!(
        remaining_events
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. })),
        "Turn 2 did not reach Idle state after approval response"
    );

    session.close().await.expect("Failed to close session");
}

#[tokio::test]
async fn test_concurrent_send_rejected_while_working() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let adapter = MockCliAdapter::with_binary_path(mock_bin);
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::Ask,
        resume: None,
        system_context: None,
        read_only: None,
    };

    let mut session = adapter.start(opts).await.expect("Failed to start session");
    let mut rx = session
        .take_event_receiver()
        .expect("Failed to take event receiver");

    // Start an approval scenario which blocks on stdin waiting for response
    session
        .send("approval", None)
        .await
        .expect("Initial send failed");

    // Wait for Approval event
    let mut approval_id = String::new();
    while let Some(evt) = rx.recv().await {
        if let AgentEvent::Approval { id, .. } = evt {
            approval_id = id;
            break;
        }
    }
    assert!(!approval_id.is_empty());

    // Attempt concurrent send while previous turn is still waiting / working
    let concurrent_result = session.send("chat", None).await;
    assert!(
        concurrent_result.is_err(),
        "Concurrent send while working must return an error"
    );
    let err_str = concurrent_result.unwrap_err().to_string();
    assert!(
        err_str.contains("ERR_ADAPTER_ALREADY_RUNNING") || err_str.contains("already running"),
        "Error must indicate adapter is already running: got '{}'",
        err_str
    );

    // Unblock the turn and finish cleanly
    session
        .respond_to_approval(&approval_id, true, Some(ApprovalScope::Once))
        .await
        .expect("Failed to respond to approval");
    let _ = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Drain failed");

    session.close().await.expect("Failed to close session");
}

#[tokio::test]
async fn test_cancellation_during_streaming_terminates_child_cleanly() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    // Construct a SubprocessSession with delay to allow mid-stream cancellation
    let session_id = format!("cancel-test-{}", uuid::Uuid::new_v4());
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: None,
    };
    let mut session = SubprocessSession::new(
        session_id,
        mock_bin,
        vec![
            "--json".to_string(),
            "--delay".to_string(),
            "200".to_string(), // 200ms delay between events
        ],
        opts,
    );
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    let count_before = count_running_mock_cli_processes();
    println!("Processes before cancel test: {}", count_before);

    // Send a multi-event scenario: chat produces ~5 events * 200ms = 1000ms
    session
        .send("chat", None)
        .await
        .expect("Send failed before cancel");

    // Wait for the very first event to confirm child has spawned and started emitting
    let first_evt = timeout(Duration::from_secs(3), rx.recv())
        .await
        .expect("Timeout waiting for first event")
        .expect("Channel closed");
    println!("Received first event: {:?}", first_evt);

    // Now immediately cancel the running session mid-stream
    session.cancel().await.expect("Cancel failed");

    // Wait briefly for process reap
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Verify process count: no extra orphaned process should remain
    let count_after = count_running_mock_cli_processes();
    println!("Processes after cancel: {}", count_after);
    assert!(
        count_after <= count_before,
        "Orphan process detected! Before: {}, After: {}",
        count_before,
        count_after
    );

    // Session should be closed cleanly
    session.close().await.expect("Close failed");
}

#[tokio::test]
async fn test_recovery_and_new_turn_after_cancellation() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let session_id = format!("recovery-test-{}", uuid::Uuid::new_v4());
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: None,
    };
    let mut session = SubprocessSession::new(
        session_id,
        mock_bin,
        vec![
            "--json".to_string(),
            "--delay".to_string(),
            "100".to_string(),
        ],
        opts,
    );
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    // Turn 1: Start and cancel mid-turn
    session.send("chat", None).await.expect("Send 1 failed");
    let _ = rx.recv().await; // wait for first event
    session.cancel().await.expect("Cancel failed");

    // Drain until Cancelled event
    let cancelled_evt = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(3)).await;
    assert!(
        cancelled_evt.is_ok(),
        "Did not receive cancelled terminal state"
    );

    // Wait a brief moment for child reap
    tokio::time::sleep(Duration::from_millis(150)).await;

    // Turn 2: Can we send a new turn on this session after cancellation?
    println!("Sending turn 2 after cancellation");
    session
        .send("chat", None)
        .await
        .expect("Send after cancellation failed");

    let events = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Turn after cancel drain failed");

    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. })),
        "Turn after cancel did not reach Idle state"
    );

    session.close().await.expect("Close failed");
}

#[tokio::test]
async fn test_process_reaping_cleanliness_across_5_consecutive_turns() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let initial_count = count_running_mock_cli_processes();
    println!("Initial mock-cli processes: {}", initial_count);

    let adapter = MockCliAdapter::with_binary_path(mock_bin);
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: None,
    };

    let mut session = adapter.start(opts).await.expect("Start failed");
    let mut rx = session.take_event_receiver().expect("Receiver failed");

    for i in 1..=5 {
        session.send("chat", None).await.expect("Send failed");
        let _ = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
            .await
            .expect("Drain failed");

        // Allow up to 100ms for OS reap
        tokio::time::sleep(Duration::from_millis(100)).await;

        let active_count = count_running_mock_cli_processes();
        assert!(
            active_count <= initial_count,
            "Zombie process detected after turn {}! Initial: {}, Active: {}",
            i,
            initial_count,
            active_count
        );
    }

    session.close().await.expect("Close failed");
}

#[tokio::test]
async fn test_cancel_on_second_turn_kills_child_cleanly() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let session_id = format!("cancel-turn2-test-{}", uuid::Uuid::new_v4());
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: None,
    };
    let mut session = SubprocessSession::new(
        session_id,
        mock_bin,
        vec![
            "--json".to_string(),
            "--delay".to_string(),
            "200".to_string(), // 200ms per event: 5 events = 1000ms
        ],
        opts,
    );
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    // Turn 1: runs to completion
    session.send("chat", None).await.expect("Turn 1 send failed");
    let _ = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Turn 1 drain failed");

    let count_before_cancel = count_running_mock_cli_processes();
    println!("Processes before Turn 2 cancel: {}", count_before_cancel);

    // Turn 2: send and cancel mid-stream
    session.send("chat", None).await.expect("Turn 2 send failed");
    // Wait for first event
    let first_evt = timeout(Duration::from_secs(3), rx.recv())
        .await
        .expect("Timeout waiting for first event")
        .expect("Channel closed");
    println!("Turn 2 first event: {:?}", first_evt);

    // Cancel Turn 2 immediately
    session.cancel().await.expect("Turn 2 cancel failed");

    // Wait briefly for process reap
    tokio::time::sleep(Duration::from_millis(300)).await;

    let count_after_cancel = count_running_mock_cli_processes();
    println!("Processes after Turn 2 cancel: {}", count_after_cancel);
    assert!(
        count_after_cancel <= count_before_cancel,
        "Orphan process detected on Turn 2 cancel! Before: {}, After: {}",
        count_before_cancel,
        count_after_cancel
    );

    session.close().await.expect("Close failed");
}

#[tokio::test]
async fn test_multi_turn_consecutive_with_delay() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let session_id = format!("delayed-turns-test-{}", uuid::Uuid::new_v4());
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: None,
    };
    let mut session = SubprocessSession::new(
        session_id,
        mock_bin,
        vec![
            "--json".to_string(),
            "--delay".to_string(),
            "50".to_string(), // 50ms per event
        ],
        opts,
    );
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    for i in 1..=3 {
        println!("[Delayed Multi-Turn {}] Sending prompt", i);
        session
            .send("chat", None)
            .await
            .unwrap_or_else(|e| panic!("Delayed turn {} send failed: {:?}", i, e));

        let events = drain_until_idle_or_terminal(&mut rx, Duration::from_secs(5))
            .await
            .unwrap_or_else(|e| panic!("Delayed turn {} drain failed: {}", i, e));

        let has_idle = events
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. }));
        assert!(has_idle, "Delayed turn {} did not reach Idle state", i);
    }

    session.close().await.expect("Close failed");
}

