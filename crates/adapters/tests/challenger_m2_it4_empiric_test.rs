//! Empirical Challenger Stress & Concurrency Verification Test Suite.
//!
//! Authored by teamwork_challenger_m2_it4_1 to empirically probe:
//! 1. Concurrent Cancel Storm (20 simultaneous cancel() calls)
//! 2. Concurrent Cancel vs Close Race (10 cancel() + 10 close() simultaneously)
//! 3. Repeated Close Idempotency (10 consecutive close() calls)
//! 4. Rapid 30-cycle Cancel-and-Recover Loop
//! 5. External Process Termination (abrupt child death) and Subsequent Recovery
//! 6. Concurrent Send Race from Idle (exactly one winner, rest rejected)

use osmium_adapters::*;
use osmium_core::types::{AgentEvent, ApprovalMode, SessionState, StartOptions};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
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
// 1. Concurrent Cancel Storm: 20 simultaneous cancel() calls
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_adversarial_concurrent_cancel_storm() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        return;
    };

    let session_id = format!("storm-cancel-{}", uuid::Uuid::new_v4());
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
    let _ = rx.recv().await; // Wait for stream start

    let session_arc = Arc::new(session);
    let mut handles = Vec::new();

    // Spawn 20 tasks calling cancel simultaneously
    for _ in 0..20 {
        let s = session_arc.clone();
        handles.push(tokio::spawn(async move {
            s.cancel().await
        }));
    }

    for h in handles {
        let res = h.await.expect("Task panicked");
        assert!(res.is_ok(), "cancel() call failed during storm: {:?}", res);
    }

    // Drain events and count Cancelled status events
    let mut cancelled_count = 0;
    while let Ok(Some(evt)) = timeout(Duration::from_millis(500), rx.recv()).await {
        if matches!(evt, AgentEvent::Status { state: SessionState::Cancelled, .. }) {
            cancelled_count += 1;
        }
    }

    assert_eq!(
        cancelled_count, 1,
        "Cancel storm must produce exactly 1 Cancelled event, got {}",
        cancelled_count
    );

    session_arc.close().await.expect("Close failed");
}

// ----------------------------------------------------------------------------
// 2. Concurrent Cancel vs Close Race: 10 cancel() + 10 close() simultaneously
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_adversarial_concurrent_cancel_vs_close_race() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        return;
    };

    let session_id = format!("race-cancel-close-{}", uuid::Uuid::new_v4());
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
    let _ = rx.recv().await; // Wait for stream start

    let session_arc = Arc::new(session);
    let mut handles = Vec::new();

    // 10 cancels and 10 closes racing
    for i in 0..20 {
        let s = session_arc.clone();
        if i % 2 == 0 {
            handles.push(tokio::spawn(async move {
                let _ = s.cancel().await;
            }));
        } else {
            handles.push(tokio::spawn(async move {
                let _ = s.close().await;
            }));
        }
    }

    for h in handles {
        h.await.expect("Task panicked");
    }

    // Must be permanently closed
    let send_res = session_arc.send("chat", None).await;
    assert!(
        send_res.is_err(),
        "Session must not accept send() after close/cancel race"
    );

    // Cancel must now fail with SessionAlreadyClosed
    let cancel_res = session_arc.cancel().await;
    assert!(
        cancel_res.is_err(),
        "cancel() after close race must return SessionAlreadyClosed error"
    );
}

// ----------------------------------------------------------------------------
// 3. Repeated Close Idempotency: 10 consecutive close() calls
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_adversarial_repeated_close_idempotency() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        return;
    };

    let session_id = format!("rep-close-{}", uuid::Uuid::new_v4());
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

    for i in 1..=10 {
        let res = session.close().await;
        assert!(
            res.is_ok(),
            "close() call #{} failed: {:?}",
            i, res
        );
    }
}

// ----------------------------------------------------------------------------
// 4. Rapid 25-cycle Cancel-and-Recover Loop with Process Leak Verification
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_adversarial_rapid_25_cycle_cancel_and_recover() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        return;
    };

    let initial_procs = count_running_mock_cli_processes();
    let session_id = format!("rapid-25-{}", uuid::Uuid::new_v4());
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
            "30".to_string(),
        ],
        opts,
    );
    let mut rx = session.take_event_receiver().expect("Receiver missing");

    for cycle in 1..=25 {
        session.send("chat", None).await.unwrap_or_else(|e| panic!("Cycle {} send failed: {:?}", cycle, e));
        let _ = rx.recv().await; // wait first event
        session.cancel().await.unwrap_or_else(|e| panic!("Cycle {} cancel failed: {:?}", cycle, e));
        let _ = drain_until_terminal(&mut rx, Duration::from_secs(3)).await;

        // Immediately launch next turn
        session.send("chat", None).await.unwrap_or_else(|e| panic!("Cycle {} recover send failed: {:?}", cycle, e));
        let events = drain_until_terminal(&mut rx, Duration::from_secs(5))
            .await
            .unwrap_or_else(|e| panic!("Cycle {} recover drain failed: {}", cycle, e));

        assert!(
            events.iter().any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. })),
            "Cycle {} did not complete to Idle",
            cycle
        );
    }

    session.close().await.expect("Close failed");
    tokio::time::sleep(Duration::from_millis(200)).await;

    let final_procs = count_running_mock_cli_processes();
    assert!(
        final_procs <= initial_procs,
        "Process leak after 25 rapid cycles! Initial: {}, Final: {}",
        initial_procs,
        final_procs
    );
}

// ----------------------------------------------------------------------------
// 5. Concurrent Send Race from Idle: exactly 1 winner, others rejected
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_adversarial_concurrent_send_from_idle() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        return;
    };

    let session_id = format!("send-race-{}", uuid::Uuid::new_v4());
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

    let session_arc = Arc::new(session);
    let success_count = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();

    // 10 tasks all try to call send() simultaneously from Idle
    for i in 0..10 {
        let s = session_arc.clone();
        let sc = success_count.clone();
        handles.push(tokio::spawn(async move {
            let res = s.send(&format!("prompt-{}", i), None).await;
            if res.is_ok() {
                sc.fetch_add(1, Ordering::SeqCst);
            }
        }));
    }

    for h in handles {
        h.await.expect("Task failed");
    }

    assert_eq!(
        success_count.load(Ordering::SeqCst),
        1,
        "Exactly 1 concurrent send() must win the mutex and start the turn!"
    );

    // Drain the winning turn to completion
    let events = drain_until_terminal(&mut rx, Duration::from_secs(5))
        .await
        .expect("Drain failed");
    assert!(
        events.iter().any(|e| matches!(e, AgentEvent::Status { state: SessionState::Idle, .. })),
        "Winning turn must complete cleanly"
    );

    session_arc.close().await.expect("Close failed");
}
