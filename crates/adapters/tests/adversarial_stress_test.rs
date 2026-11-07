//! Empirical adversarial stress-test suite for `osmium-adapters`.
//!
//! Vectors:
//! a. Stream normalizer torture test (split JSON chunks across arbitrary boundaries)
//! b. Non-standard ANSI escape sequences (nested CSI, malformed OSC)
//! c. Buffer overflow limits (feeding continuous non-newline streams exceeding 16MB and char boundaries)
//! d. Unknown JSON payload structures and corrupted lines (lossless fallback to AgentEvent::Raw)
//! e. Zero API key enforcement (process env sanitization and config validation nested inside maps and vectors)
//! f. Deterministic polynomial hash stability across 10,000 randomized CLI strings

use osmium_adapters::env::{
    sanitize_process_env, validate_zero_api_key_requirement, FORBIDDEN_ENV_VARS,
};
use osmium_adapters::normalizer::{strip_ansi_codes, EventNormalizer};
use osmium_adapters::palette::{get_cli_color, get_cli_css_variable, DEFAULT_CLI_PALETTE};
use osmium_core::types::{AgentEvent, MessageRole, SessionState, ToolStatus};
use serde_json::json;

// ============================================================================
// Vector a: Stream Normalizer Torture Test
// ============================================================================

#[test]
fn test_vector_a_single_char_chunk_torture() {
    let payload = r#"{"type":"message","role":"assistant","text":"Hello \"world\" \n 🦀 \u0041 \t \\ \r\n end","final":true}"#;
    let full_line = format!("{}\n", payload);

    let mut normalizer = EventNormalizer::new(None);
    let mut emitted = Vec::new();

    // Feed one character at a time
    for ch in full_line.chars() {
        let mut s = String::new();
        s.push(ch);
        let evts = normalizer.write_chunk(&s);
        emitted.extend(evts);
    }

    assert_eq!(emitted.len(), 1, "Expected exactly 1 event emitted");
    match &emitted[0] {
        AgentEvent::Message {
            role,
            text,
            final_,
        } => {
            assert_eq!(*role, MessageRole::Assistant);
            assert!(
                text.contains("Hello \"world\""),
                "Text did not preserve escaped quotes: {}",
                text
            );
            assert!(
                text.contains("🦀"),
                "Text did not preserve unicode emoji: {}",
                text
            );
            assert!(
                text.contains('A'),
                "Text did not preserve unicode escape \\u0041: {}",
                text
            );
            assert!(*final_, "Expected final = true");
        }
        other => panic!("Unexpected event emitted: {:?}", other),
    }
}

#[test]
fn test_vector_a_arbitrary_chunk_boundaries_and_escapes() {
    let events_json = [
        r#"{"type":"tool","id":"t-42","name":"shell_exec","status":"running"}"#,
        r#"{"type":"message","role":"assistant","text":"Chunk with \"escapes\" \\ and \/ and \b\f\r\t","final":false}"#,
        r#"{"type":"file-edit","path":"crates/adapters/src/lib.rs","added":150,"removed":25}"#,
        r#"{"type":"status","state":"working","message":"Optimizing AST..."}"#,
    ];

    let full_stream = events_json
        .iter()
        .map(|s| format!("{}\n", s))
        .collect::<Vec<_>>()
        .join("");

    // Test different chunk sizes from 1 to 37 bytes
    for chunk_size in [1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 37] {
        let mut normalizer = EventNormalizer::new(None);
        let mut emitted = Vec::new();

        let chars: Vec<char> = full_stream.chars().collect();
        for chunk in chars.chunks(chunk_size) {
            let s: String = chunk.iter().collect();
            let evts = normalizer.write_chunk(&s);
            emitted.extend(evts);
        }

        assert_eq!(
            emitted.len(),
            4,
            "Failed with chunk_size {}: expected 4 events, got {}",
            chunk_size,
            emitted.len()
        );

        assert!(matches!(&emitted[0], AgentEvent::Tool { id, status: ToolStatus::Running, .. } if id == "t-42"));
        assert!(matches!(&emitted[1], AgentEvent::Message { role: MessageRole::Assistant, text, .. } if text.contains("Chunk with \"escapes\"")));
        assert!(matches!(&emitted[2], AgentEvent::FileEdit { path, added: 150, removed: 25 } if path == "crates/adapters/src/lib.rs"));
        assert!(matches!(&emitted[3], AgentEvent::Status { state: SessionState::Working, .. }));
    }
}

#[test]
fn test_vector_a_crlf_and_mixed_newlines() {
    let mut normalizer = EventNormalizer::new(None);
    let chunk = "{\"type\":\"status\",\"state\":\"idle\"}\r\n{\"type\":\"raw\",\"data\":\"line2\"}\n";
    let emitted = normalizer.write_chunk(chunk);
    assert_eq!(emitted.len(), 2);
    assert!(matches!(&emitted[0], AgentEvent::Status { state: SessionState::Idle, .. }));
    assert!(matches!(&emitted[1], AgentEvent::Raw { data } if data == "line2"));
}

// ============================================================================
// Vector b: Non-Standard ANSI Escape Sequences
// ============================================================================

#[test]
fn test_vector_b_standard_and_edge_ansi() {
    // 1. Basic color codes
    assert_eq!(
        strip_ansi_codes("\x1B[31mRed\x1B[0m Normal"),
        "Red Normal"
    );

    // 2. 256 color & truecolor sequences: ESC[38;5;123m and ESC[38;2;255;0;0m
    assert_eq!(
        strip_ansi_codes("\x1B[38;5;123m256-color\x1B[0m"),
        "256-color"
    );
    assert_eq!(
        strip_ansi_codes("\x1B[38;2;255;128;64mTrueColor\x1B[0m"),
        "TrueColor"
    );

    // 3. CSI private modes (e.g. cursor hide ?25l, alternate screen ?1049h)
    assert_eq!(strip_ansi_codes("\x1B[?25hVisibleCursor"), "VisibleCursor");
    assert_eq!(strip_ansi_codes("\x1B[?1049hScreenSwitch"), "ScreenSwitch");

    // 4. Single-character escapes (0x40..=0x5F) e.g. ESC M (reverse line feed)
    assert_eq!(strip_ansi_codes("\x1BMSome text"), "Some text");

    // 5. OSC with BEL terminator (\x07)
    assert_eq!(
        strip_ansi_codes("\x1B]0;Window Title\x07Body text"),
        "Body text"
    );

    // 6. OSC with String Terminator ST (\x1b\)
    assert_eq!(
        strip_ansi_codes("\x1B]0;Window Title\x1B\\Body text"),
        "Body text"
    );
}

#[test]
fn test_vector_b_nested_and_malformed_ansi() {
    // A: Truncated escape at end of stream
    assert_eq!(strip_ansi_codes("Hello \x1B"), "Hello ");
    assert_eq!(strip_ansi_codes("Hello \x1B["), "Hello ");
    assert_eq!(strip_ansi_codes("Hello \x1B[31"), "Hello ");

    // B: Unterminated OSC sequence
    let unterminated_osc = "\x1B]0;Title that never terminates";
    let res = strip_ansi_codes(unterminated_osc);
    assert_eq!(res, "");

    // C: Nested / double ESC sequences: \x1B\x1B[31m
    let double_esc = "\x1B\x1B[31mText\x1B[0m";
    let stripped = strip_ansi_codes(double_esc);
    assert_eq!(stripped, "Text");

    // D: Nested CSI: \x1B[\x1B[31mNested\x1B[0m
    // When a CSI sequence is interrupted by an inner CSI sequence, standard terminal
    // emulators restart escape parsing. If the outer sequence treats '[' (0x5B)
    // as a final byte, the parameter '31m' leaks into user output.
    let nested_csi = "\x1B[\x1B[31mNested\x1B[0m";
    let stripped_nested = strip_ansi_codes(nested_csi);
    assert_eq!(
        stripped_nested, "Nested",
        "LEAKAGE CONFIRMED: Nested CSI leaked raw parameter bytes into output: got {:?}",
        stripped_nested
    );
}

// ============================================================================
// Vector c: Buffer Overflow Limits
// ============================================================================

#[test]
fn test_vector_c_continuous_stream_exceeding_buffer() {
    let mut normalizer = EventNormalizer::new(Some(1024));

    let chunk1 = "A".repeat(500);
    let chunk2 = "B".repeat(600); // 500 + 600 = 1100 > 1024 limit

    let evts1 = normalizer.write_chunk(&chunk1);
    assert!(evts1.is_empty(), "First 500 bytes should be buffered");

    let evts2 = normalizer.write_chunk(&chunk2);
    assert_eq!(evts2.len(), 1, "Should emit Raw event on overflow");
    match &evts2[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data.len(), 1024, "Raw event should be truncated at max_buffer_bytes");
            assert!(data.starts_with("AAAA"));
        }
        other => panic!("Expected Raw event, got {:?}", other),
    }
}

#[test]
fn test_vector_c_16mb_continuous_non_newline_stream() {
    // Stress-test with 17MB continuous stream (16MB default limit)
    let limit = 16 * 1024 * 1024; // 16MB
    let mut normalizer = EventNormalizer::new(None); // uses DEFAULT_MAX_BUFFER_BYTES = 16MB

    // Chunk of 8MB
    let chunk_8mb = "X".repeat(8 * 1024 * 1024);
    let evts1 = normalizer.write_chunk(&chunk_8mb);
    assert!(evts1.is_empty(), "8MB non-newline stream should be buffered");

    // Second chunk of 9MB (total 17MB > 16MB)
    let chunk_9mb = "Y".repeat(9 * 1024 * 1024);
    let evts2 = normalizer.write_chunk(&chunk_9mb);
    assert_eq!(evts2.len(), 1, "Expected overflow Raw event on exceeding 16MB");
    match &evts2[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data.len(), limit, "Emitted Raw event must be truncated to exactly 16MB");
            assert!(data.starts_with("XXXX"));
        }
        other => panic!("Expected Raw event, got {:?}", other),
    }
}

#[test]
fn test_vector_c_multibyte_utf8_boundary_on_overflow() {
    // CRITICAL ADVERSARIAL CHECK:
    // When `&overflow[..self.max_buffer_bytes]` falls in the middle of a
    // multi-byte UTF-8 character, Rust slices panic.
    let adversarial_chunk = "123456789🦀"; // 9 ASCII + 4-byte emoji (bytes 9..13)

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut norm = EventNormalizer::new(Some(10));
        norm.write_chunk(adversarial_chunk)
    }));

    if let Err(panic_err) = result {
        let msg = if let Some(s) = panic_err.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_err.downcast_ref::<String>() {
            s.clone()
        } else {
            "Non-string panic".to_string()
        };
        panic!("VULNERABILITY CONFIRMED: Normalizer panics on multi-byte UTF-8 boundary during buffer overflow truncation: {}", msg);
    }
}

// ============================================================================
// Vector d: Unknown JSON Payload Structures and Corrupted Lines
// ============================================================================

#[test]
fn test_vector_d_corrupted_lines_and_unknown_json() {
    let mut normalizer = EventNormalizer::new(None);

    let test_cases = vec![
        // Corrupted JSON
        r#"{"type":"message", "unclosed": "#,
        r#"{"type":"tool", "invalid_json": true, missing_quote}"#,
        r#"{not valid json at all}"#,
        r#"{"type":"approval"}"#, // missing required fields for Serde tagged enum
        
        // Non-object JSON
        r#"[1, 2, 3, "array"]"#,
        r#""just a string""#,
        r#"1234567"#,
        r#"true"#,
        r#"null"#,

        // Unknown JSON object structures
        r#"{"future_schema_version": 2, "action": "spawn", "id": 999}"#,
        r#"{"type":"custom_vendor_event","data":{"nested":true}}"#,
        r#"{"status":"ok"}"#, // not AgentEvent::Status (missing required state)

        // Raw terminal logs
        r#"Compiling osmium-core v0.1.0 (E:\workspace)"#,
        r#"warning: unused variable `x`"#,
        r#"    Finished `dev` profile in 0.42s"#,
    ];

    for line in test_cases {
        let emitted = normalizer.process_line(line);
        assert_eq!(emitted.len(), 1, "Failed for line: {}", line);
        match &emitted[0] {
            AgentEvent::Raw { data } => {
                assert_eq!(data, line, "Lossless fallback failed: expected {:?}, got {:?}", line, data);
            }
            other => panic!("Expected AgentEvent::Raw for line {:?}, got {:?}", line, other),
        }
    }
}

// ============================================================================
// Vector e: Zero API Key Enforcement
// ============================================================================

#[test]
fn test_vector_e_environment_sanitization_case_and_all_forbidden() {
    let env_entries = vec![
        ("PATH", "C:\\Windows;C:\\Rust"),
        ("OPENAI_API_KEY", "sk-123"),
        ("openai_api_key", "sk-lower"),
        ("Openai_Api_Key", "sk-mixed"),
        ("ANTHROPIC_API_KEY", "ant-123"),
        ("anthropic_api_key", "ant-lower"),
        ("DEEPSEEK_API_KEY", "ds-123"),
        ("deepseek_api_key", "ds-lower"),
        ("GEMINI_API_KEY", "gem-123"),
        ("gemini_api_key", "gem-lower"),
        ("CODEX_TOKEN", "codex-123"),
        ("codex_token", "codex-lower"),
        ("SAFE_VAR", "safe_value"),
    ];

    let sanitized = sanitize_process_env(env_entries);

    assert_eq!(sanitized.get("PATH").unwrap(), "C:\\Windows;C:\\Rust");
    assert_eq!(sanitized.get("SAFE_VAR").unwrap(), "safe_value");

    for key in sanitized.keys() {
        let upper = key.to_ascii_uppercase();
        for forbidden in FORBIDDEN_ENV_VARS {
            assert_ne!(&upper, forbidden, "Sanitization failed to strip forbidden key: {}", key);
        }
    }
}

#[test]
fn test_vector_e_config_validation_nested_in_maps() {
    let map_nested = json!({
        "level1": {
            "level2": {
                "apiKey": "nested-secret"
            }
        }
    });

    let res = validate_zero_api_key_requirement(&map_nested);
    assert!(res.is_err(), "Must reject apiKey nested in maps");
    let err = res.unwrap_err();
    assert_eq!(err.code, "ERR_API_KEY_PROHIBITED");
    assert!(err.keys.contains(&"level1.level2.apiKey".to_string()));
}

#[test]
fn test_vector_e_config_validation_nested_in_vectors() {
    // Architectural Rule 2.2: "configuration validation rejects API keys nested inside maps/vectors"
    
    // Case 1: Vector of objects
    let vector_nested = json!({
        "plugins": [
            {
                "name": "plugin-a",
                "settings": {
                    "apiKey": "vector-secret-1"
                }
            },
            {
                "name": "plugin-b",
                "api_key": "vector-secret-2"
            }
        ]
    });

    let res1 = validate_zero_api_key_requirement(&vector_nested);
    assert!(
        res1.is_err(),
        "VULNERABILITY CONFIRMED: validate_zero_api_key_requirement failed to reject apiKey inside vector of objects!"
    );

    // Case 2: Vector directly at root
    let root_vector = json!([
        { "secretKey": "root-vec-secret" }
    ]);
    let res2 = validate_zero_api_key_requirement(&root_vector);
    assert!(
        res2.is_err(),
        "VULNERABILITY CONFIRMED: validate_zero_api_key_requirement failed to reject API key in root vector!"
    );
}

// ============================================================================
// Vector f: Deterministic Polynomial Hash Stability across 10,000 CLI Strings
// ============================================================================

#[test]
fn test_vector_f_deterministic_hash_stability_10000() {
    // Generate 10,000 diverse CLI strings
    let mut rng_seed: u64 = 0xDEADBEEF;
    let mut next_random = || {
        rng_seed = rng_seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        rng_seed
    };

    let sample_chars: Vec<char> = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./@#$%^&*()!~` \t\r\n🦀✨🚀"
        .chars()
        .collect();

    for i in 0..10_000 {
        // Vary lengths from 0 to 64
        let len = (next_random() % 65) as usize;
        let mut cli_str = String::with_capacity(len);
        for _ in 0..len {
            let idx = (next_random() as usize) % sample_chars.len();
            cli_str.push(sample_chars[idx]);
        }

        // 1. Invariance: Calling get_cli_color multiple times must return exact same color
        let color1 = get_cli_color(&cli_str, None);
        let color2 = get_cli_color(&cli_str, None);
        assert_eq!(color1, color2, "Color stability violation on iteration {}: {:?}", i, cli_str);

        // 2. CSS variable invariance
        let css1 = get_cli_css_variable(&cli_str);
        let css2 = get_cli_css_variable(&cli_str);
        assert_eq!(css1, css2, "CSS var stability violation on iteration {}: {:?}", i, cli_str);

        // 3. Valid color format (#XXXXXX)
        assert!(
            color1.starts_with('#') && color1.len() == 7,
            "Invalid hex color format '{}' for CLI {:?}",
            color1,
            cli_str
        );

        // 4. Must belong to DEFAULT_CLI_PALETTE
        assert!(
            DEFAULT_CLI_PALETTE.contains(&color1),
            "Returned color '{}' not in DEFAULT_CLI_PALETTE for CLI {:?}",
            color1,
            cli_str
        );

        // 5. Case-insensitivity: lowercase and uppercase must yield identical color
        let lower_color = get_cli_color(&cli_str.to_lowercase(), None);
        assert_eq!(
            color1, lower_color,
            "Case-insensitivity failure on iteration {}: {:?} vs {:?}",
            i, cli_str, cli_str.to_lowercase()
        );
    }
}
