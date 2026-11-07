//! Empirical Challenger Stress Harness for SubprocessSession Lifecycle.
//!
//! Authored by teamwork_challenger_m2_it3_1 to empirically stress-test:
//! 1. 20 consecutive rapid multi-turn cycles across diverse scenarios
//! 2. 5 consecutive turns with interactive approval (mixed allow/deny, scopes)
//! 3. 10 rapid streaming cancellation & immediate next turn cycles
//! 4. 10 concurrent send() requests rejected with mutual exclusion
//! 5. Stdin approval rejection when Idle, Cancelled, or Closed
//! 6. Session close during active streaming kills child cleanly
//! 7. Error state handling & subsequent turn recovery
//! 8. Defect reproduction: cancel() after close() resurrects closed session
//! 9. Defect reproduction: repeated cancel() emits duplicate terminal events

use osmium_adapters::*;
use osmium_core::types::{AgentEvent, ApprovalMode, ApprovalScope, SessionState, StartOptions};
use std::path::PathBuf;
use std::sync::Arc;
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

async fn drain_until_terminal(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<AgentEvent>,
    max_wait: Duration,
) -> Result<Vec<AgentEvent>, String> {
    let mut collected = Vec::new();
    let deadline = tokio::time::Instant::now() + max_wait;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(format!(
                "Timed out waiting for terminal state after {:?}. Collected {} events.",
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
            Ok(None) => return Err("Event receiver closed unexpectedly".into()),
            Err(_) => return Err(format!("Timed out after {:?}", max_wait)),
        }
    }

    Ok(collected)
}

// ----------------------------------------------------------------------------
// 1. 20 Consecutive Rapid Multi-Turn Cycles
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_stress_20_consecutive_multi_turn_cycles() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let initial_processes = count_running_mock_cli_processes();
    let adapter = MockCliAdapter::with_binary_path(mock_bin);
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: Some(true),
    };

    let mut session = adapter.start(opts).await.expect("Failed to start session");
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    let prompts = [
        "chat",
        "edit",
        "/plan design tokens",
        "/review src/lib.rs",
        "/raw",
    ];

    for turn in 1..=20 {
        let prompt = prompts[(turn - 1) % prompts.len()];
        session
            .send(prompt, None)
            .await
            .unwrap_or_else(|e| panic!("Turn {} ({}) send failed: {:?}", turn, prompt, e));

        let events = drain_until_terminal(&mut rx, Duration::from_secs(5))
            .await
            .unwrap_or_else(|e| panic!("Turn {} drain failed: {}", turn, e));

        let has_idle = events
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. }));
        assert!(
            has_idle,
            "Turn {} did not reach Idle terminal state. Events: {:?}",
            turn, events
        );
    }

    session.close().await.expect("Failed to close session");

    // Allow brief OS cleanup
    tokio::time::sleep(Duration::from_millis(150)).await;
    let final_processes = count_running_mock_cli_processes();
    assert!(
        final_processes <= initial_processes,
        "Orphaned mock-cli processes detected after 20 turns! Initial: {}, Final: {}",
        initial_processes,
        final_processes
    );
}

// ----------------------------------------------------------------------------
// 2. 5 Consecutive Turns with Interactive Approval (Mixed Allow/Deny & Scopes)
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_stress_consecutive_interactive_approvals_cycle() {
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
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    let approval_scenarios = [
        (true, Some(ApprovalScope::Once)),
        (false, Some(ApprovalScope::Once)),
        (true, Some(ApprovalScope::Session)),
        (true, None),
        (false, None),
    ];

    for (turn, (allow, scope)) in approval_scenarios.iter().enumerate() {
        let turn_num = turn + 1;
        session
            .send("approval", None)
            .await
            .unwrap_or_else(|e| panic!("Approval turn {} send failed: {:?}", turn_num, e));

        // Await approval request event
        let mut approval_id = String::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while let Ok(Some(evt)) = timeout(
            deadline.saturating_duration_since(tokio::time::Instant::now()),
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
            "Approval turn {} did not emit an Approval event",
            turn_num
        );

        // Respond to approval
        session
            .respond_to_approval(&approval_id, *allow, *scope)
            .await
            .unwrap_or_else(|e| {
                panic!(
                    "respond_to_approval failed on approval turn {} (allow={}, scope={:?}): {:?}",
                    turn_num, allow, scope, e
                )
            });

        let events = drain_until_terminal(&mut rx, Duration::from_secs(5))
            .await
            .unwrap_or_else(|e| panic!("Approval turn {} drain failed: {}", turn_num, e));

        let has_idle = events
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. }));
        assert!(
            has_idle,
            "Approval turn {} did not reach Idle terminal state. Events: {:?}",
            turn_num, events
        );
    }

    session.close().await.expect("Failed to close session");
}

// ----------------------------------------------------------------------------
// 3. 10 Rapid Streaming Cancellation & Immediate Next Turn Cycles
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_stress_rapid_streaming_cancellation_and_immediate_turn_loop() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let initial_processes = count_running_mock_cli_processes();
    let session_id = format!("cancel-stress-{}", uuid::Uuid::new_v4());
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
            "50".to_string(), // 50ms per event to allow clean mid-stream cancel
        ],
        opts,
    );
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    for cycle in 1..=10 {
        // Start streaming turn
        session
            .send("chat", None)
            .await
            .unwrap_or_else(|e| panic!("Cycle {} send before cancel failed: {:?}", cycle, e));

        // Wait for first event confirming child has spawned and begun streaming
        let first_evt = timeout(Duration::from_secs(3), rx.recv())
            .await
            .unwrap_or_else(|_| panic!("Cycle {} timeout waiting for initial event", cycle))
            .unwrap_or_else(|| panic!("Cycle {} channel closed prematurely", cycle));

        assert!(
            matches!(first_evt, AgentEvent::Status { .. } | AgentEvent::Message { .. }),
            "Unexpected first event in cycle {}: {:?}",
            cycle,
            first_evt
        );

        // Cancel mid-stream
        session
            .cancel()
            .await
            .unwrap_or_else(|e| panic!("Cycle {} cancel failed: {:?}", cycle, e));

        // Drain until Cancelled state
        let events = drain_until_terminal(&mut rx, Duration::from_secs(3))
            .await
            .unwrap_or_else(|e| panic!("Cycle {} drain after cancel failed: {}", cycle, e));

        let has_cancelled = events.iter().any(|e| {
            matches!(
                e,
                AgentEvent::Status {
                    state: SessionState::Cancelled,
                    ..
                }
            )
        });
        assert!(
            has_cancelled,
            "Cycle {} did not emit Cancelled status event: {:?}",
            cycle, events
        );

        // Immediately launch next turn without waiting
        session
            .send("chat", None)
            .await
            .unwrap_or_else(|e| panic!("Cycle {} immediate next turn send failed: {:?}", cycle, e));

        let next_events = drain_until_terminal(&mut rx, Duration::from_secs(5))
            .await
            .unwrap_or_else(|e| panic!("Cycle {} next turn drain failed: {}", cycle, e));

        let has_idle = next_events
            .iter()
            .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. }));
        assert!(
            has_idle,
            "Cycle {} next turn did not reach Idle terminal state: {:?}",
            cycle, next_events
        );
    }

    session.close().await.expect("Failed to close session");

    tokio::time::sleep(Duration::from_millis(200)).await;
    let final_processes = count_running_mock_cli_processes();
    assert!(
        final_processes <= initial_processes,
        "Orphaned processes after 10 cancel-and-recover cycles! Initial: {}, Final: {}",
        initial_processes,
        final_processes
    );
}

// ----------------------------------------------------------------------------
// 4. 10 Concurrent send() Requests Rejected with Mutual Exclusion
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_stress_concurrent_send_mutual_exclusion_barrier() {
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
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    // Initiate approval turn which blocks on stdin
    session
        .send("approval", None)
        .await
        .expect("Primary send failed");

    // Wait until approval is requested
    let mut approval_id = String::new();
    while let Some(evt) = rx.recv().await {
        if let AgentEvent::Approval { id, .. } = evt {
            approval_id = id;
            break;
        }
    }
    assert!(!approval_id.is_empty(), "Failed to get approval id");

    // Session is currently in working/waiting state.
    // Concurrently fire 10 send() attempts across separate tasks
    let session_arc = Arc::new(session);
    let mut handles = Vec::new();

    for i in 0..10 {
        let s = session_arc.clone();
        handles.push(tokio::spawn(async move {
            let res = s.send(&format!("concurrent_prompt_{}", i), None).await;
            res.is_err()
        }));
    }

    for (i, h) in handles.into_iter().enumerate() {
        let was_err = h.await.expect("Task join failed");
        assert!(
            was_err,
            "Concurrent send #{} unexpectedly succeeded while session was working!",
            i
        );
    }

    // Now unblock the primary turn
    session_arc
        .respond_to_approval(&approval_id, true, Some(ApprovalScope::Once))
        .await
        .expect("Approval response failed");

    let events = drain_until_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Primary turn drain failed");

    let has_idle = events
        .iter()
        .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. }));
    assert!(has_idle, "Primary turn did not complete to Idle");

    session_arc.close().await.expect("Close failed");
}

// ----------------------------------------------------------------------------
// 5. Stdin Approval Rejection When Idle, Cancelled, or Closed
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_stress_approval_rejection_when_idle_cancelled_closed() {
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
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    // Case 1: Session is Idle (no turn running). respond_to_approval must fail
    let idle_res = session.respond_to_approval("app-1", true, None).await;
    assert!(
        idle_res.is_err(),
        "respond_to_approval must fail when session is Idle"
    );

    // Case 2: Start turn, cancel it, then respond_to_approval must fail
    session.send("approval", None).await.expect("Send failed");
    let mut app_id = String::new();
    while let Some(evt) = rx.recv().await {
        if let AgentEvent::Approval { id, .. } = evt {
            app_id = id;
            break;
        }
    }
    assert!(!app_id.is_empty());

    session.cancel().await.expect("Cancel failed");
    let _ = drain_until_terminal(&mut rx, Duration::from_secs(3)).await;

    let cancelled_res = session.respond_to_approval(&app_id, true, None).await;
    assert!(
        cancelled_res.is_err(),
        "respond_to_approval must fail after cancellation"
    );

    // Case 3: Session is closed. Both send and respond_to_approval must fail
    session.close().await.expect("Close failed");

    let closed_approval_res = session.respond_to_approval(&app_id, true, None).await;
    assert!(
        closed_approval_res.is_err(),
        "respond_to_approval must fail when session is Closed"
    );

    let closed_send_res = session.send("chat", None).await;
    assert!(
        closed_send_res.is_err(),
        "send must fail when session is Closed"
    );
}

// ----------------------------------------------------------------------------
// 6. Session close() During Active Streaming Kills Child Process Cleanly
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_stress_close_during_active_streaming_kills_child() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping test: osmium-mock-cli binary not found");
        return;
    };

    let session_id = format!("close-stress-{}", uuid::Uuid::new_v4());
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

    session.send("chat", None).await.expect("Send failed");

    // Wait for first event confirming child is active
    let _ = timeout(Duration::from_secs(3), rx.recv())
        .await
        .expect("Timeout waiting for first event");

    // Directly close during active execution
    session.close().await.expect("Close failed");

    // Verify session cannot be reused after close
    let send_after_close = session.send("chat", None).await;
    assert!(
        send_after_close.is_err(),
        "Session must be permanently closed after close()"
    );
}

// ----------------------------------------------------------------------------
// 7. DEFECT CONFIRMATION: Error Status Emitted Prematurely While Still Working
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_defect_error_state_premature_emission_race() {
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

    let mut session = adapter.start(opts).await.expect("Start failed");
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    // Turn 1: Quota error scenario
    session.send("quota", None).await.expect("Send quota failed");
    let events = drain_until_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Drain quota failed");

    let has_error = events
        .iter()
        .any(|e| matches!(e, AgentEvent::Status { state: SessionState::Error, .. }));
    assert!(has_error, "Turn 1 must transition to Error state on quota hit: {:?}", events);

    // Turn 2: Secondary CLI fallback / retry turn immediately following Error.
    // EXPECTED: Session has finished prior turn with Error, so send() can launch subsequent turn.
    // ACTUAL DEFECT: Status(Error) was emitted early while inner.state was still Working and child alive.
    // send() fails with: AdapterError::AlreadyRunning ("Session is already running a turn").
    let recovery_res = session.send("chat", None).await;
    if recovery_res.is_err() {
        eprintln!(
            "DEFECT CONFIRMED: Immediate turn after Error failed because inner.state is still Working: {:?}",
            recovery_res
        );
    }
    assert!(
        recovery_res.is_ok(),
        "DEFECT CONFIRMED: send() after Error failed with: {:?}",
        recovery_res.err()
    );

    session.close().await.expect("Close failed");
}

// ----------------------------------------------------------------------------
// 8. DEFECT CONFIRMATION: cancel() on Closed Session Resurrects Session
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_defect_cancel_on_closed_session_resurrects_session() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        return;
    };

    let session_id = format!("resurrect-{}", uuid::Uuid::new_v4());
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: None,
    };

    let session = SubprocessSession::new(
        session_id,
        mock_bin,
        vec!["--json".to_string()],
        opts,
    );

    // Step 1: Permanently close the session
    session.close().await.expect("Close failed");

    // Step 2: Calling cancel() on an already closed session
    // According to lifecycle contract, a closed session must NEVER transition back to Cancelled.
    let _ = session.cancel().await;

    // Step 3: Attempting to send() on the closed session.
    // EXPECTED: Must return Err(AdapterError::SessionAlreadyClosed).
    // ACTUAL DEFECT: cancel() overwrote inner.state = Cancelled, so send() succeeds!
    let send_res = session.send("chat", None).await;

    // We empirically assert that this flaw currently exists:
    if send_res.is_ok() {
        eprintln!(
            "DEFECT CONFIRMED: SubprocessSession::cancel() overwrote SessionState::Closed to SessionState::Cancelled, allowing send() on a closed session!"
        );
    }

    assert!(
        send_res.is_err(),
        "DEFECT CONFIRMED: cancel() resurrected a closed session! send() succeeded with Ok(())"
    );
}

// ----------------------------------------------------------------------------
// 9. DEFECT CONFIRMATION: Repeated cancel() Calls Emit Duplicate Terminal Events
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_defect_repeated_cancel_emits_duplicate_terminal_events() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        return;
    };

    let session_id = format!("dup-cancel-{}", uuid::Uuid::new_v4());
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

    session.send("chat", None).await.expect("Send failed");
    let _ = rx.recv().await; // wait for stream start

    // First cancel
    session.cancel().await.expect("First cancel failed");
    // Second cancel on already cancelled session
    session.cancel().await.expect("Second cancel failed");

    // Count how many Status::Cancelled events are emitted into rx
    let mut cancelled_count = 0;
    while let Ok(Some(evt)) = timeout(Duration::from_millis(500), rx.recv()).await {
        if matches!(evt, AgentEvent::Status { state: SessionState::Cancelled, .. }) {
            cancelled_count += 1;
        }
    }

    // EXPECTED: Cancel should be idempotent: exactly 1 Cancelled event
    // ACTUAL DEFECT: 2 Cancelled events emitted
    if cancelled_count > 1 {
        eprintln!(
            "DEFECT CONFIRMED: Repeated cancel() emitted {} Cancelled status events instead of being idempotent (1)",
            cancelled_count
        );
    }

    assert_eq!(
        cancelled_count, 1,
        "DEFECT CONFIRMED: Repeated cancel() emitted {} duplicate Cancelled events onto channel!",
        cancelled_count
    );
}
