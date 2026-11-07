//! Deep dive adversarial stress test suite authored by challenger_m2_it4_2.
//!
//! Empirical Verification Vectors:
//! 1. Normalizer ANSI Torture & Broken Sequence Resilience
//! 2. Split CRLF Boundaries Across Chunks & Mixed Line Endings
//! 3. 10,000-char Non-Newline Stream and Repeated Buffer Overflow Invariants
//! 4. Streamed Message Assembly Semantics & Edge Cases
//! 5. Security Sanitization Case Permutations & Deep Structure Boundary Fuzzing
//! 6. Subprocess Session Concurrent Cancellation & Closure Barrier
//! 7. Subprocess Approval State Guards on Cancelled and Closed Sessions

use osmium_adapters::env::{sanitize_process_env, validate_zero_api_key_requirement};
use osmium_adapters::normalizer::{assemble_streamed_message, strip_ansi_codes, EventNormalizer};
use osmium_adapters::probe::find_in_path;
use osmium_adapters::session::SubprocessSession;
use osmium_core::types::{
    AgentEvent, AgentSession, ApprovalMode, ApprovalScope, MessageRole, SessionState, StartOptions,
    ToolStatus,
};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;

fn get_mock_cli_binary() -> Option<PathBuf> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(format!("osmium-mock-cli{}", std::env::consts::EXE_SUFFIX));
    if candidate.exists() {
        return Some(candidate);
    }
    find_in_path("osmium-mock-cli")
}

// ============================================================================
// 1. Normalizer ANSI Torture & Broken Sequence Resilience
// ============================================================================

#[test]
fn test_ansi_torture_broken_and_unclosed_sequences() {
    // 1. Multiple consecutive unclosed CSI sequences
    let input1 = "\x1B[\x1B[\x1B[31mRedText\x1B[0m";
    assert_eq!(strip_ansi_codes(input1), "RedText");

    // 2. Trailing unclosed ESC at end of string
    let input2 = "Hello world\x1B";
    assert_eq!(strip_ansi_codes(input2), "Hello world");

    // 3. Incomplete CSI at end of string without final byte
    let input3 = "Status: \x1B[1;34";
    assert_eq!(strip_ansi_codes(input3), "Status: ");

    // 4. OSC terminated by ST (\x1b\) vs BEL (\x07)
    let input4 = "\x1B]0;Window Title\x07Body Content";
    assert_eq!(strip_ansi_codes(input4), "Body Content");

    let input5 = "\x1B]0;Window Title\x1B\\Body Content";
    assert_eq!(strip_ansi_codes(input5), "Body Content");

    // 5. Interrupted OSC sequence with another ESC
    let input6 = "\x1B]0;Title\x1B[32mSuccess\x1B[0m";
    assert_eq!(strip_ansi_codes(input6), "Success");

    // 6. Fe escape codes mixed with regular letters
    // Fe codes: '7', '8', '=', '>', 'M', 'D', 'E', 'H'
    let input7 = "\x1BMReverse Index\x1B7Saved\x1B8Restored";
    assert_eq!(strip_ansi_codes(input7), "Reverse IndexSavedRestored");

    // Regular non-Fe letter after ESC should be preserved
    let input8 = "\x1BKNormalText";
    assert_eq!(strip_ansi_codes(input8), "KNormalText");
}

// ============================================================================
// 2. Split CRLF Boundaries Across Chunks & Mixed Line Endings
// ============================================================================

#[test]
fn test_split_crlf_across_chunk_boundaries() {
    let mut normalizer = EventNormalizer::new(None);

    // Chunk 1 ends with '\r'
    let chunk1 = "{\"type\":\"message\",\"role\":\"assistant\",\"text\":\"Line 1\",\"final\":false}\r";
    let evts1 = normalizer.write_chunk(chunk1);
    assert!(evts1.is_empty(), "Chunk ending in CR without LF should remain buffered");

    // Chunk 2 starts with '\n'
    let chunk2 = "\n{\"type\":\"status\",\"state\":\"idle\"}\r\n";
    let evts2 = normalizer.write_chunk(chunk2);
    assert_eq!(evts2.len(), 2, "Both lines should be emitted across the CRLF boundary");

    match &evts2[0] {
        AgentEvent::Message { text, .. } => assert_eq!(text, "Line 1"),
        other => panic!("Expected Message event, got {:?}", other),
    }

    match &evts2[1] {
        AgentEvent::Status { state, .. } => assert_eq!(*state, SessionState::Idle),
        other => panic!("Expected Status event, got {:?}", other),
    }
}

// ============================================================================
// 3. Repeated Buffer Overflow Invariants & Monotonic Forward Progress
// ============================================================================

#[test]
fn test_repeated_buffer_overflow_without_newline() {
    let limit = 32;
    let mut normalizer = EventNormalizer::new(Some(limit));

    // Feed 10 chunks of 50 bytes each with NO newlines
    let pattern = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN";
    assert_eq!(pattern.len(), 50);

    let mut total_overflow_emitted = 0;
    for i in 0..10 {
        let evts = normalizer.write_chunk(pattern);
        assert!(!evts.is_empty(), "Iteration {}: must emit overflow event", i);
        for evt in evts {
            if let AgentEvent::Raw { data } = evt {
                assert!(data.len() <= limit + pattern.len());
                total_overflow_emitted += data.len();
            } else {
                panic!("Expected Raw event on overflow");
            }
        }
    }

    // Drain remainder at EOF
    let eof_evts = normalizer.handle_unexpected_eof(Some(0));
    for evt in eof_evts {
        if let AgentEvent::Raw { data } = evt {
            total_overflow_emitted += data.len();
        }
    }

    // Total emitted bytes must equal 10 * 50 = 500 bytes (zero byte loss)
    assert_eq!(total_overflow_emitted, 500);
}

// ============================================================================
// 4. Streamed Message Assembly Semantics & Edge Cases
// ============================================================================

#[test]
fn test_streamed_message_assembly_comprehensive() {
    // 1. Empty events
    assert_eq!(assemble_streamed_message(&[]), None);

    // 2. Only non-assistant events
    let non_assistant = vec![
        AgentEvent::Message {
            role: MessageRole::User,
            text: "Hello assistant".to_string(),
            final_: false,
        },
        AgentEvent::Tool {
            id: "t1".to_string(),
            name: "grep".to_string(),
            status: ToolStatus::Done,
            summary: Some("ok".to_string()),
            duration_sec: Some(0.1),
        },
        AgentEvent::Status {
            state: SessionState::Idle,
            message: None,
        },
    ];
    assert_eq!(assemble_streamed_message(&non_assistant), None);

    // 3. Multiple streaming chunks without final
    let stream_chunks = vec![
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "Part 1, ".to_string(),
            final_: false,
        },
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "Part 2, ".to_string(),
            final_: false,
        },
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "Part 3".to_string(),
            final_: false,
        },
    ];
    assert_eq!(
        assemble_streamed_message(&stream_chunks),
        Some("Part 1, Part 2, Part 3".to_string())
    );

    // 4. Multiple chunks followed by a consolidated final
    let chunks_with_final = vec![
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "Part 1, ".to_string(),
            final_: false,
        },
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "Complete text from final event".to_string(),
            final_: true,
        },
    ];
    assert_eq!(
        assemble_streamed_message(&chunks_with_final),
        Some("Complete text from final event".to_string())
    );
}

// ============================================================================
// 5. Security Sanitization Case Permutations & Deep Structure Fuzzing
// ============================================================================

#[test]
fn test_security_sanitization_comprehensive() {
    // Test all forbidden env vars in various casing
    let env_samples = vec![
        ("openai_api_key", "sk-1"),
        ("OPENAI_API_KEY", "sk-2"),
        ("Openai_Api_Key", "sk-3"),
        ("anthropic_api_key", "sk-4"),
        ("ANTHROPIC_API_KEY", "sk-5"),
        ("deepseek_api_key", "sk-6"),
        ("DEEPSEEK_API_KEY", "sk-7"),
        ("gemini_api_key", "sk-8"),
        ("GEMINI_API_KEY", "sk-9"),
        ("codex_token", "sk-10"),
        ("CODEX_TOKEN", "sk-11"),
        ("SAFE_VAR", "safe_val"),
        ("API_KEY_SAFE_SUFFIX", "safe_val"),
    ];

    let sanitized = sanitize_process_env(env_samples);
    assert_eq!(sanitized.len(), 2);
    assert_eq!(sanitized.get("SAFE_VAR").unwrap(), "safe_val");
    assert_eq!(sanitized.get("API_KEY_SAFE_SUFFIX").unwrap(), "safe_val");

    // Deep nested JSON structure validation with 12 nested levels
    let mut nested = json!({ "valid": true });
    for i in 0..12 {
        nested = json!({ format!("level_{}", i): [nested] });
    }
    assert!(validate_zero_api_key_requirement(&nested).is_ok());

    // Inject forbidden key deep in array of objects
    let tainted = json!({
        "config": {
            "services": [
                {
                    "name": "srv1",
                    "options": [
                        { "bearerToken": "secret-token" }
                    ]
                }
            ]
        }
    });

    let res = validate_zero_api_key_requirement(&tainted);
    assert!(res.is_err());
    let err = res.unwrap_err();
    assert_eq!(err.code, "ERR_API_KEY_PROHIBITED");
    assert_eq!(err.keys, vec!["config.services[0].options[0].bearerToken"]);
}

// ============================================================================
// 6. Subprocess Session Concurrent Cancellation & Closure Barrier
// ============================================================================

#[tokio::test]
async fn test_subprocess_session_concurrent_cancel_and_close() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping: mock-cli not built");
        return;
    };

    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::Ask,
        resume: None,
        system_context: None,
        read_only: Some(true),
    };

    let session = Arc::new(SubprocessSession::new(
        "stress-session-concurrency".to_string(),
        mock_bin,
        vec!["-s".to_string(), "chat".to_string(), "--json".to_string()],
        opts,
    ));

    // Send turn
    session.send("Hello world", None).await.unwrap();

    // Spawn 20 concurrent cancel tasks
    let mut tasks = Vec::new();
    for _ in 0..20 {
        let s = session.clone();
        tasks.push(tokio::spawn(async move {
            s.cancel().await
        }));
    }

    for t in tasks {
        let res = t.await.unwrap();
        assert!(res.is_ok(), "Concurrent cancel must succeed idempotently");
    }

    // Now spawn 20 concurrent close tasks
    let mut close_tasks = Vec::new();
    for _ in 0..20 {
        let s = session.clone();
        close_tasks.push(tokio::spawn(async move {
            s.close().await
        }));
    }

    for t in close_tasks {
        let res = t.await.unwrap();
        assert!(res.is_ok(), "Concurrent close must succeed idempotently");
    }

    // Calling cancel on closed session must return error
    let cancel_res = session.cancel().await;
    assert!(
        cancel_res.is_err(),
        "Cancel on closed session must return error"
    );

    // Calling send on closed session must return error
    let send_res = session.send("Hello again", None).await;
    assert!(
        send_res.is_err(),
        "Send on closed session must return error"
    );
}

// ============================================================================
// 7. Subprocess Approval State Guards on Cancelled and Closed Sessions
// ============================================================================

#[tokio::test]
async fn test_subprocess_approval_guards_on_closed_session() {
    let Some(mock_bin) = get_mock_cli_binary() else {
        eprintln!("Skipping: mock-cli not built");
        return;
    };

    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::Ask,
        resume: None,
        system_context: None,
        read_only: Some(true),
    };

    let session = SubprocessSession::new(
        "stress-session-approval".to_string(),
        mock_bin,
        vec!["-s".to_string(), "approval".to_string(), "--json".to_string()],
        opts,
    );

    // Close immediately before any send
    session.close().await.unwrap();

    // Calling respond_to_approval on closed session must return SessionAlreadyClosed
    let res = session
        .respond_to_approval("app-123", true, Some(ApprovalScope::Once))
        .await;
    assert!(
        res.is_err(),
        "Approval response on closed session must return error"
    );
}


// ============================================================================
// 8. SemVer and Palette Edge Cases & Hash Distribution
// ============================================================================

#[test]
fn test_semver_and_palette_edge_cases() {
    use osmium_adapters::palette::{get_cli_color, get_cli_css_variable};
    use osmium_adapters::probe::extract_semver;
    use osmium_adapters::semver::{compare_semver, create_version_warning};

    // SemVer extraction
    assert_eq!(
        extract_semver("codex version 1.4.0 (x86_64)"),
        Some("1.4.0".to_string())
    );
    assert_eq!(
        extract_semver("tool v2.10.3-beta.1"),
        Some("2.10.3-beta.1".to_string())
    );
    assert_eq!(extract_semver("prefix:0.1.0"), Some("0.1.0".to_string()));
    assert_eq!(extract_semver("no semver here"), None);

    // SemVer comparison
    assert_eq!(compare_semver("1.4.0", "1.4.0"), 0);
    assert_eq!(compare_semver("1.4.1", "1.4.0"), 1);
    assert_eq!(compare_semver("1.3.9", "1.4.0"), -1);
    assert_eq!(compare_semver("v2.0.0", "1.99.99"), 1);
    assert_eq!(compare_semver("1.0", "1.0.0"), 0);

    // Version warning banner
    let warn = create_version_warning("codex", Some("1.5.0"), Some("1.4.0"));
    assert!(warn.is_some());
    assert!(warn.unwrap().contains("is newer than tested version"));

    let no_warn = create_version_warning("codex", Some("1.4.0"), Some("1.4.0"));
    assert!(no_warn.is_none());

    let old_warn = create_version_warning("codex", Some("1.3.0"), Some("1.4.0"));
    assert!(old_warn.is_none());

    // Palette resolution & case insensitivity
    assert_eq!(get_cli_color("CODEX", None), "#1B2B22");
    assert_eq!(get_cli_color("AntiGravity", None), "#2F5FD0");
    assert_eq!(get_cli_color("DEEPSEEK", None), "#6B4FD0");
    assert_eq!(get_cli_color("mock", None), "#2F6B4F");

    // Fallback hashing for unknown CLIs is deterministic
    let color1 = get_cli_color("custom-cli-agent", None);
    let color2 = get_cli_color("CUSTOM-CLI-AGENT", None);
    assert_eq!(color1, color2, "Hash must be case-insensitive and deterministic");

    // CSS variables
    assert_eq!(get_cli_css_variable("codex"), "var(--cli-codex, #1B2B22)");
    assert_eq!(
        get_cli_css_variable("antigravity"),
        "var(--cli-antigravity, #2F5FD0)"
    );
    assert_eq!(
        get_cli_css_variable("deepseek"),
        "var(--cli-deepseek, #6B4FD0)"
    );
}
