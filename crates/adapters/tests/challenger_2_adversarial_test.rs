//! Adversarial challenger test suite authored by teamwork_challenger_m2_it2_1.
//!
//! Vectors tested:
//! 1. Multi-byte UTF-8 boundary overflow & trailing byte retention (3-byte CJK, 2-byte accented, 4-byte astral)
//! 2. Zero API Key Config Validation & Vector/Map Penetration (arrays of arrays, all 7 forbidden keys, substring safety)
//! 3. Mixed-case Environment Sanitization (case insensitivity, prefix/suffix safety)
//! 4. Malformed and Complex ANSI escape sequences (multi-nested CSI, mixed OSC/CSI, ANSI-wrapped JSON)
//! 5. Subprocess multi-turn sequential execution and process reaping
//! 6. Capability detection accuracy (dead code removal verification)

use osmium_adapters::env::{
    is_forbidden_env_var, sanitize_process_env, validate_zero_api_key_requirement,
    FORBIDDEN_CONFIG_KEYS, FORBIDDEN_ENV_VARS,
};
use osmium_adapters::normalizer::{strip_ansi_codes, EventNormalizer};
use osmium_adapters::probe::CliProber;
use osmium_adapters::*;
use osmium_core::types::{AgentEvent, ApprovalMode, ApprovalScope, SessionState, StartOptions};
use serde_json::json;
use std::path::PathBuf;

// ============================================================================
// 1. Multi-byte UTF-8 Boundary Overflow & Trailing Byte Retention
// ============================================================================

#[test]
fn test_cjk_3byte_boundary_overflow_and_retention() {
    // "世界" is 6 bytes total:
    // '世' = [0xE4, 0xB8, 0x96] (3 bytes, 0..3)
    // '界' = [0xE7, 0x95, 0x8C] (3 bytes, 3..6)
    // Total prefix "Prefix" = 6 bytes (0..6).
    // "Prefix世界" = 6 + 3 + 3 = 12 bytes.

    // Test buffer limit cuts exactly inside '世':
    // Limit = 7: cuts at byte 6 ("Prefix"), retains "世界"
    // Limit = 8: cuts at byte 6 ("Prefix"), retains "世界"
    // Limit = 9: cuts at byte 9 ("Prefix世"), retains "界"
    // Limit = 10: cuts at byte 9 ("Prefix世"), retains "界"
    // Limit = 11: cuts at byte 9 ("Prefix世"), retains "界"

    for limit in [7, 8, 9, 10, 11] {
        let mut normalizer = EventNormalizer::new(Some(limit));
        let evts = normalizer.write_chunk("Prefix世界");
        assert_eq!(evts.len(), 1, "Should emit exactly one overflow event at limit {}", limit);

        match &evts[0] {
            AgentEvent::Raw { data } => {
                if limit < 9 {
                    assert_eq!(data, "Prefix", "Limit {}: Expected 'Prefix', got {:?}", limit, data);
                } else {
                    assert_eq!(data, "Prefix世", "Limit {}: Expected 'Prefix世', got {:?}", limit, data);
                }
            }
            other => panic!("Expected AgentEvent::Raw, got {:?}", other),
        }

        // Now feed trailing newline: the remaining retained characters must be emitted intact
        let evts2 = normalizer.write_chunk("\n");
        assert_eq!(evts2.len(), 1, "Should emit retained remainder on newline for limit {}", limit);
        match &evts2[0] {
            AgentEvent::Raw { data } => {
                if limit < 9 {
                    assert_eq!(data, "世界", "Limit {}: Expected retained '世界', got {:?}", limit, data);
                } else {
                    assert_eq!(data, "界", "Limit {}: Expected retained '界', got {:?}", limit, data);
                }
            }
            other => panic!("Expected AgentEvent::Raw for remainder, got {:?}", other),
        }
    }
}

#[test]
fn test_2byte_accented_boundary_overflow_and_retention() {
    // "café" -> 'c' (1), 'a' (1), 'f' (1), 'é' (2 bytes: 0xC3, 0xA9) = 5 bytes total.
    let mut normalizer = EventNormalizer::new(Some(4));
    // Limit = 4 falls in the middle of 'é' (byte 3..5). Cutoff must be 3 ("caf").
    let evts = normalizer.write_chunk("café");
    assert_eq!(evts.len(), 1);
    match &evts[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data, "caf");
        }
        other => panic!("Expected Raw, got {:?}", other),
    }

    let evts2 = normalizer.write_chunk("\n");
    assert_eq!(evts2.len(), 1);
    match &evts2[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data, "é");
        }
        other => panic!("Expected Raw, got {:?}", other),
    }
}

#[test]
fn test_4byte_emoji_boundary_overflow_and_retention() {
    // "Prefix🦀": "Prefix" = 6 bytes, '🦀' = 4 bytes (bytes 6..10). Total = 10 bytes.
    for limit in [7, 8, 9] {
        let mut normalizer = EventNormalizer::new(Some(limit));
        // Cutoff inside 🦀 (at byte 7, 8, or 9) must fall back to byte 6 ("Prefix")
        let evts = normalizer.write_chunk("Prefix🦀");
        assert_eq!(evts.len(), 1, "Limit {}: expected exactly 1 overflow event", limit);
        match &evts[0] {
            AgentEvent::Raw { data } => {
                assert_eq!(data, "Prefix", "Limit {}: Expected 'Prefix', got {:?}", limit, data);
            }
            other => panic!("Expected Raw, got {:?}", other),
        }

        // Remainder "🦀" must be retained and emitted on newline
        let evts2 = normalizer.write_chunk("\n");
        assert_eq!(evts2.len(), 1, "Limit {}: expected remainder on newline", limit);
        match &evts2[0] {
            AgentEvent::Raw { data } => {
                assert_eq!(data, "🦀", "Limit {}: Expected retained '🦀', got {:?}", limit, data);
            }
            other => panic!("Expected Raw, got {:?}", other),
        }
    }

    // Extreme edge: buffer limit (2 bytes) smaller than the 4-byte emoji itself
    // Must never panic!
    let mut small_norm = EventNormalizer::new(Some(2));
    let panic_check = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        small_norm.write_chunk("🦀")
    }));
    assert!(panic_check.is_ok(), "Writing multi-byte character exceeding buffer limit must not panic");
    let evts = panic_check.unwrap();
    assert_eq!(evts.len(), 1);
    match &evts[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data, "🦀", "Cutoff when smaller than first char emits at least first char to guarantee forward progress without panic");
        }
        other => panic!("Expected Raw, got {:?}", other),
    }
    // Remainder was consumed, verify next chunk makes forward progress
    let evts2 = small_norm.write_chunk("🚀");
    assert_eq!(evts2.len(), 1);
    match &evts2[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data, "🚀");
        }
        other => panic!("Expected Raw, got {:?}", other),
    }
}

// ============================================================================
// 2. Zero API Key Config Validation & Vector/Map Penetration
// ============================================================================

#[test]
fn test_config_validation_deeply_nested_arrays_of_arrays() {
    // 4 levels of nested arrays
    let config = json!({
        "matrix": [
            [
                [
                    {
                        "deep_layers": [
                            { "authToken": "deep-tok-123" }
                        ]
                    }
                ]
            ]
        ]
    });

    let res = validate_zero_api_key_requirement(&config);
    assert!(res.is_err(), "Must reject authToken in 4-level nested array matrix");
    let err = res.unwrap_err();
    assert_eq!(err.code, "ERR_API_KEY_PROHIBITED");
    assert!(
        err.keys.contains(&"matrix[0][0][0].deep_layers[0].authToken".to_string()),
        "Expected exact path 'matrix[0][0][0].deep_layers[0].authToken', got {:?}",
        err.keys
    );
}

#[test]
fn test_config_validation_all_7_forbidden_keys_in_array() {
    // Test that every single one of the 7 forbidden keys is detected inside an array of objects
    let config = json!([
        { "apiKey": "val-1" },
        { "api_key": "val-2" },
        { "openaiApiKey": "val-3" },
        { "deepseekApiKey": "val-4" },
        { "authToken": "val-5" },
        { "bearerToken": "val-6" },
        { "secretKey": "val-7" }
    ]);

    let res = validate_zero_api_key_requirement(&config);
    assert!(res.is_err(), "Must detect all forbidden keys in root array");
    let err = res.unwrap_err();
    assert_eq!(err.code, "ERR_API_KEY_PROHIBITED");
    assert_eq!(err.keys.len(), 7, "Must report all 7 violations, got {:?}", err.keys);

    for (i, key_name) in FORBIDDEN_CONFIG_KEYS.iter().enumerate() {
        let expected_path = format!("[{}].{}", i, key_name);
        assert!(
            err.keys.contains(&expected_path),
            "Missing violation for path {}: {:?}",
            expected_path,
            err.keys
        );
    }
}

#[test]
fn test_config_validation_mixed_primitives_and_safe_substrings() {
    // Substrings like "api_version", "token_count", "secretKeyName" should NOT be rejected
    let safe_config = json!({
        "api_version": "v1",
        "api_endpoint": "https://api.osmium.local",
        "token_limit": 4096,
        "max_tokens": 1000,
        "public_key": "pub_123",
        "items": [
            1,
            2.5,
            true,
            false,
            null,
            "apiKeyName",
            "bearerTokenString",
            { "safe_setting": "enabled" }
        ]
    });

    let res = validate_zero_api_key_requirement(&safe_config);
    assert!(res.is_ok(), "Safe config with substring keys must be accepted: {:?}", res);
}

// ============================================================================
// 3. Mixed-case Environment Sanitization
// ============================================================================

#[test]
fn test_environment_sanitization_all_mixed_cases_and_prefix_safety() {
    let env_entries = vec![
        ("oPeNaI_aPi_KeY", "forbidden_1"),
        ("aNtHrOpIc_ApI_kEy", "forbidden_2"),
        ("dEePsEeK_aPi_KeY", "forbidden_3"),
        ("gEmInI_aPi_KeY", "forbidden_4"),
        ("cOdEx_ToKeN", "forbidden_5"),
        // Safe variables that contain substrings:
        ("OPENAI_MODEL", "gpt-4o"),
        ("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        ("MY_ANTHROPIC_API_KEY_BACKUP", "safe_backup"),
        ("PREFIX_CODEX_TOKEN", "safe_prefix"),
        ("GEMINI_API_KEY_ID", "safe_id"),
        ("SAFE_KEY", "safe_val"),
    ];

    let sanitized = sanitize_process_env(env_entries);

    // Verify all 5 mixed-case forbidden keys are stripped
    assert!(!sanitized.contains_key("oPeNaI_aPi_KeY"));
    assert!(!sanitized.contains_key("aNtHrOpIc_ApI_kEy"));
    assert!(!sanitized.contains_key("dEePsEeK_aPi_KeY"));
    assert!(!sanitized.contains_key("gEmInI_aPi_KeY"));
    assert!(!sanitized.contains_key("cOdEx_ToKeN"));

    // Verify helper is_forbidden_env_var
    for forbidden in FORBIDDEN_ENV_VARS {
        assert!(is_forbidden_env_var(&forbidden.to_lowercase()));
        assert!(is_forbidden_env_var(&forbidden.to_uppercase()));
    }
    assert!(!is_forbidden_env_var("OPENAI_MODEL"));
    assert!(!is_forbidden_env_var("MY_OPENAI_API_KEY"));

    // Verify safe substring keys are intact
    assert_eq!(sanitized.get("OPENAI_MODEL").unwrap(), "gpt-4o");
    assert_eq!(sanitized.get("DEEPSEEK_BASE_URL").unwrap(), "https://api.deepseek.com");
    assert_eq!(sanitized.get("MY_ANTHROPIC_API_KEY_BACKUP").unwrap(), "safe_backup");
    assert_eq!(sanitized.get("PREFIX_CODEX_TOKEN").unwrap(), "safe_prefix");
    assert_eq!(sanitized.get("GEMINI_API_KEY_ID").unwrap(), "safe_id");
    assert_eq!(sanitized.get("SAFE_KEY").unwrap(), "safe_val");
}

// ============================================================================
// 4. Malformed and Complex ANSI Escape Sequences
// ============================================================================

#[test]
fn test_complex_and_nested_ansi_stripping() {
    // 1. Triple nested CSI sequences
    let triple_csi = "\x1B[\x1B[\x1B[32mSuccess\x1B[0m";
    assert_eq!(strip_ansi_codes(triple_csi), "Success");

    // 2. Interrupted CSI with long parameter sequence followed by valid sequence
    let interrupted = "\x1B[123;456;789\x1B[31mRed\x1B[0m";
    assert_eq!(strip_ansi_codes(interrupted), "Red");

    // 3. Mixed OSC and CSI
    let osc_and_csi = "\x1B]0;Terminal Title\x07\x1B[1;34mBlue Bold\x1B[0m";
    assert_eq!(strip_ansi_codes(osc_and_csi), "Blue Bold");

    // 4. Multiple consecutive escapes without CSI/OSC
    // Plain text preceded by stray ESC sequences is preserved, including uppercase letters:
    assert_eq!(strip_ansi_codes("\x1B\x1B\x1Bplain"), "plain");
    assert_eq!(strip_ansi_codes("\x1B\x1B\x1BPlain"), "Plain");
    // Standard 2-character / Fe escape sequences:
    assert_eq!(strip_ansi_codes("\x1BMReverseIndex"), "ReverseIndex");
    assert_eq!(strip_ansi_codes("\x1BDIndex"), "Index");
    assert_eq!(strip_ansi_codes("\x1BENextLine"), "NextLine");
    assert_eq!(strip_ansi_codes("\x1BHHorizontalTab"), "HorizontalTab");
    assert_eq!(strip_ansi_codes("\x1B7SaveCursor"), "SaveCursor");
    assert_eq!(strip_ansi_codes("\x1B8RestoreCursor"), "RestoreCursor");
    assert_eq!(strip_ansi_codes("\x1B=AppKeypad"), "AppKeypad");
    assert_eq!(strip_ansi_codes("\x1B>NormKeypad"), "NormKeypad");

    // 5. ANSI-wrapped JSON line inside normalizer
    let mut normalizer = EventNormalizer::new(None);
    let wrapped_json = "\x1B[32;1m{\"type\":\"status\",\"state\":\"idle\"}\x1B[0m\n";
    let emitted = normalizer.write_chunk(wrapped_json);
    assert_eq!(emitted.len(), 1);
    match &emitted[0] {
        AgentEvent::Status { state, .. } => {
            assert_eq!(*state, SessionState::Idle, "Must normalize ANSI-wrapped status JSON");
        }
        other => panic!("Expected Status event, got {:?}", other),
    }

    // 6. Trailing dangling escape at EOF
    let mut normalizer_eof = EventNormalizer::new(None);
    let _ = normalizer_eof.write_chunk("Dangling \x1B[31");
    let eof_evts = normalizer_eof.handle_unexpected_eof(Some(0));
    assert!(!eof_evts.is_empty());
    match &eof_evts[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data, "Dangling ");
        }
        other => panic!("Expected Raw event, got {:?}", other),
    }
}

// ============================================================================
// 5. Subprocess Multi-Turn Sequential Execution
// ============================================================================

fn find_mock_cli() -> Option<PathBuf> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(format!("osmium-mock-cli{}", std::env::consts::EXE_SUFFIX));
    if candidate.exists() {
        return Some(candidate);
    }
    find_in_path("osmium-mock-cli")
}

#[tokio::test]
async fn test_subprocess_multi_turn_consecutive_execution() {
    let Some(mock_bin) = find_mock_cli() else {
        eprintln!("Skipping multi-turn test: osmium-mock-cli not found");
        return;
    };

    let adapter = MockCliAdapter::with_binary_path(mock_bin);
    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::AutoEdit,
        resume: None,
        system_context: None,
        read_only: Some(true),
    };

    let mut session = adapter.start(opts).await.unwrap();
    let mut rx = session.take_event_receiver().unwrap();

    // Turn 1: Chat scenario
    session.send("chat", None).await.expect("Turn 1 send must succeed");

    let mut turn1_completed = false;
    while let Some(evt) = rx.recv().await {
        if matches!(evt, AgentEvent::Status { state: SessionState::Idle, .. }) {
            turn1_completed = true;
            break;
        }
    }
    assert!(turn1_completed, "Turn 1 must transition to Idle");

    // Turn 2: Plan scenario on SAME session instance
    session.send("plan", None).await.expect("Turn 2 send must succeed without AlreadyRunning");

    let mut turn2_completed = false;
    while let Some(evt) = rx.recv().await {
        if matches!(evt, AgentEvent::Status { state: SessionState::Idle, .. }) {
            turn2_completed = true;
            break;
        }
    }
    assert!(turn2_completed, "Turn 2 must transition to Idle");

    // Turn 3: Review scenario on SAME session instance
    session.send("review", None).await.expect("Turn 3 send must succeed without AlreadyRunning");

    let mut turn3_completed = false;
    while let Some(evt) = rx.recv().await {
        if matches!(evt, AgentEvent::Status { state: SessionState::Idle, .. }) {
            turn3_completed = true;
            break;
        }
    }
    assert!(turn3_completed, "Turn 3 must transition to Idle");

    session.close().await.unwrap();
}

#[tokio::test]
async fn test_subprocess_consecutive_turn_interactive_approval_race() {
    let Some(mock_bin) = find_mock_cli() else {
        eprintln!("Skipping multi-turn approval test: osmium-mock-cli not found");
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

    let mut session = adapter.start(opts).await.unwrap();
    let mut rx = session.take_event_receiver().unwrap();

    // Turn 1: Normal chat turn
    session.send("chat", None).await.expect("Turn 1 send must succeed");
    while let Some(evt) = rx.recv().await {
        if matches!(evt, AgentEvent::Status { state: SessionState::Idle, .. }) {
            break;
        }
    }

    // Turn 2: Approval turn immediately following Turn 1
    session.send("approval", None).await.expect("Turn 2 send must succeed");

    let mut approval_id = String::new();
    while let Some(evt) = rx.recv().await {
        if let AgentEvent::Approval { id, .. } = evt {
            approval_id = id;
            break;
        }
    }
    assert!(!approval_id.is_empty(), "Turn 2 must yield an approval request");

    // Race hazard: Turn 1 background cleanup clobbers inner.stdin = None
    let resp_res = session
        .respond_to_approval(&approval_id, true, Some(ApprovalScope::Once))
        .await;

    assert!(
        resp_res.is_ok(),
        "CRITICAL DEFECT CONFIRMED: respond_to_approval on consecutive turn failed because Turn 1 supervisor wiped inner.stdin: {:?}",
        resp_res.err()
    );

    session.close().await.unwrap();
}

// ============================================================================
// 6. Capability Detection Accuracy (Dead Code Removal Verification)
// ============================================================================

#[tokio::test]
async fn test_capability_detection_dead_code_removal() {
    let probe = CliProber::default();

    // Help text with NO approvals or usage flags
    let minimal_help = "Osmium Minimal CLI v1.0.0\nCommands:\n  run  Run script\n";
    let caps = probe
        .probe_capabilities("minimal-cli", Some("1.0.0"), minimal_help, "1.0.0")
        .await;

    // Both approvals and reports_usage must be FALSE (proves || true was removed)
    assert!(!caps.approvals, "Approvals must be false when help text lacks approval flags");
    assert!(!caps.reports_usage, "Reports usage must be false when help text lacks usage flags");
    assert!(!caps.acp);
    assert!(!caps.json_stream);
    assert!(!caps.resume);
    assert!(!caps.read_only_mode);

    // Help text WITH approval flag
    let approval_help = "Commands:\n  run --approval  Run with interactive approvals\n";
    let caps_approval = probe
        .probe_capabilities("approval-cli", Some("1.0.0"), approval_help, "1.0.0")
        .await;
    assert!(caps_approval.approvals, "Approvals must be true when --approval is present");
    assert!(!caps_approval.reports_usage, "Reports usage must remain false");

    // Help text WITH usage flag
    let usage_help = "Commands:\n  run --quota  Check quota usage\n";
    let caps_usage = probe
        .probe_capabilities("usage-cli", Some("1.0.0"), usage_help, "1.0.0")
        .await;
    assert!(caps_usage.reports_usage, "Reports usage must be true when quota/usage is present");
    assert!(!caps_usage.approvals, "Approvals must remain false");
}
