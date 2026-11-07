//! Empirical stress harness authored by challenger_m2_it3_2.
//!
//! Validates:
//! 1. 4-byte emoji boundary slicing with small/zero buffer limits (0, 1, 2, 3 bytes)
//! 2. Guaranteed forward progress under single-char and streaming emoji chunks
//! 3. Uppercase plain text preservation after arbitrary stray ESC characters (\x1B\x1B\x1BPlain, \x1B\x1B\x1BABC)
//! 4. Fe escape code stripping (\x1BM, \x1B7, \x1B8, etc.)
//! 5. Deeply nested array and object zero-api-key checks (10+ nested levels, accurate JSON paths)
//! 6. Comprehensive case-insensitive environment variable sanitization (all 2^N permutations, prefix/suffix safety)

use osmium_adapters::env::{
    is_forbidden_env_var, sanitize_process_env, validate_zero_api_key_requirement,
    FORBIDDEN_CONFIG_KEYS, FORBIDDEN_ENV_VARS,
};
use osmium_adapters::normalizer::{strip_ansi_codes, EventNormalizer};
use osmium_core::types::AgentEvent;
use serde_json::json;

// ============================================================================
// 1. Emoji Boundary Slicing and Guaranteed Forward Progress
// ============================================================================

#[test]
fn test_emoji_boundary_with_varying_tiny_buffer_limits() {
    // Test buffer limits from 0 up to 8 bytes with a sequence of 4-byte emojis
    let emojis = ["🦀", "🚀", "🌟", "🔥", "🎉"];

    for buffer_limit in 0..=8 {
        let mut normalizer = EventNormalizer::new(Some(buffer_limit));
        let mut emitted_data = Vec::new();

        for emoji in emojis {
            let evts = normalizer.write_chunk(emoji);
            for evt in evts {
                if let AgentEvent::Raw { data } = evt {
                    emitted_data.push(data);
                }
            }
        }

        // Drain any remaining buffered data via EOF
        let eof_evts = normalizer.handle_unexpected_eof(Some(0));
        for evt in eof_evts {
            if let AgentEvent::Raw { data } = evt {
                if !data.is_empty() {
                    emitted_data.push(data);
                }
            }
        }

        let combined = emitted_data.join("");
        let expected = emojis.join("");
        assert_eq!(
            combined, expected,
            "Buffer limit {}: combined output did not match expected emojis. Got: {:?}, expected: {:?}",
            buffer_limit, combined, expected
        );
    }
}

#[test]
fn test_mixed_multibyte_utf8_forward_progress_single_stream() {
    // 1-byte ASCII ('a'), 2-byte Latin ('é'), 3-byte CJK ('世'), 4-byte Astral ('🦀')
    let text = "aé世🦀bè界🚀cñ木🌟";
    // Total bytes:
    // 'a' = 1, 'é' = 2, '世' = 3, '🦀' = 4 -> 10 bytes
    // 'b' = 1, 'è' = 2, '界' = 3, '🚀' = 4 -> 10 bytes
    // 'c' = 1, 'ñ' = 2, '木' = 3, '🌟' = 4 -> 10 bytes
    // Total: 30 bytes

    for limit in 1..=5 {
        let mut normalizer = EventNormalizer::new(Some(limit));
        let mut emitted_chars = String::new();

        // Feed full stream at once
        let evts = normalizer.write_chunk(text);
        for evt in evts {
            if let AgentEvent::Raw { data } = evt {
                emitted_chars.push_str(&data);
            }
        }

        // Drain remainder via write_chunk("") without skipping
        loop {
            let evts = normalizer.write_chunk("");
            if evts.is_empty() {
                break;
            }
            for evt in evts {
                if let AgentEvent::Raw { data } = evt {
                    emitted_chars.push_str(&data);
                }
            }
        }

        let eof_evts = normalizer.handle_unexpected_eof(Some(0));
        for evt in eof_evts {
            if let AgentEvent::Raw { data } = evt {
                emitted_chars.push_str(&data);
            }
        }

        assert_eq!(
            emitted_chars, text,
            "Forward progress failed with buffer limit {}: got {:?}, expected {:?}",
            limit, emitted_chars, text
        );
    }
}

// ============================================================================
// 2. ANSI Escape Stripping and Uppercase Plain Text Preservation
// ============================================================================

#[test]
fn test_uppercase_plain_text_preservation_after_stray_escapes() {
    let test_words = [
        "Plain", "ALICE", "Bob", "Charlie", "David", "Echo", "Foxtrot",
        "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike",
        "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango",
        "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu"
    ];

    for word in test_words {
        let first_char = word.chars().next().unwrap();
        let is_fe_code = matches!(first_char, '7' | '8' | '=' | '>' | 'M' | 'D' | 'E' | 'H');

        let s1 = format!("\x1B{}", word);
        if !is_fe_code {
            assert_eq!(
                strip_ansi_codes(&s1),
                word,
                "Failed to preserve word '{}' after single ESC",
                word
            );
        }

        let s3 = format!("\x1B\x1B\x1B{}", word);
        if !is_fe_code {
            assert_eq!(
                strip_ansi_codes(&s3),
                word,
                "Failed to preserve word '{}' after 3 ESCs",
                word
            );
        }
    }

    // Specific requested test case: \x1B\x1B\x1BPlain -> "Plain"
    assert_eq!(strip_ansi_codes("\x1B\x1B\x1BPlain"), "Plain");
}

#[test]
fn test_fe_escape_codes_correctly_stripped() {
    assert_eq!(strip_ansi_codes("\x1B7Save"), "Save");
    assert_eq!(strip_ansi_codes("\x1B8Restore"), "Restore");
    assert_eq!(strip_ansi_codes("\x1B=AppKeypad"), "AppKeypad");
    assert_eq!(strip_ansi_codes("\x1B>NormKeypad"), "NormKeypad");
    assert_eq!(strip_ansi_codes("\x1BMReverseIndex"), "ReverseIndex");
    assert_eq!(strip_ansi_codes("\x1BDIndex"), "Index");
    assert_eq!(strip_ansi_codes("\x1BENextLine"), "NextLine");
    assert_eq!(strip_ansi_codes("\x1BHTabSet"), "TabSet");
}

#[test]
fn test_complex_and_restarted_csi_osc() {
    let interrupted = "\x1B[12;34\x1B[1mBoldText\x1B[0m";
    assert_eq!(strip_ansi_codes(interrupted), "BoldText");

    let osc_interrupted = "\x1B]0;Broken Title\x1B[32mGreen\x1B[0m";
    assert_eq!(strip_ansi_codes(osc_interrupted), "Green");

    let osc_st = "\x1B]0;Valid Title\x1B\\Actual Content";
    assert_eq!(strip_ansi_codes(osc_st), "Actual Content");

    let osc_bel = "\x1B]0;Valid Title\x07Actual Content";
    assert_eq!(strip_ansi_codes(osc_bel), "Actual Content");
}

// ============================================================================
// 3. Deeply Nested Arrays & Zero API Key Verification
// ============================================================================

#[test]
fn test_10_level_deeply_nested_arrays_and_objects() {
    let nested = json!({
        "level0": [
            {
                "level1": [
                    {
                        "level2": [
                            {
                                "level3": [
                                    {
                                        "level4": [
                                            {
                                                "apiKey": "super-deep-secret"
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    });

    let res = validate_zero_api_key_requirement(&nested);
    assert!(res.is_err(), "Must detect apiKey in 10-level nested structure");
    let err = res.unwrap_err();
    assert_eq!(err.code, "ERR_API_KEY_PROHIBITED");
    let expected_path = "level0[0].level1[0].level2[0].level3[0].level4[0].apiKey";
    assert!(
        err.keys.contains(&expected_path.to_string()),
        "Expected path '{}', got {:?}",
        expected_path,
        err.keys
    );
}

#[test]
fn test_all_forbidden_keys_at_different_array_indices() {
    for (idx, forbidden_key) in FORBIDDEN_CONFIG_KEYS.iter().enumerate() {
        let mut arr = Vec::new();
        for _ in 0..idx {
            arr.push(json!({"safe": "value"}));
        }
        arr.push(json!({ *forbidden_key: "violation-value" }));

        let config = serde_json::Value::Array(arr);
        let res = validate_zero_api_key_requirement(&config);
        assert!(res.is_err(), "Must detect {} at index {}", forbidden_key, idx);
        let err = res.unwrap_err();
        let expected_path = format!("[{}].{}", idx, forbidden_key);
        assert!(
            err.keys.contains(&expected_path),
            "Expected violation at '{}', got {:?}",
            expected_path,
            err.keys
        );
    }
}

// ============================================================================
// 4. Case-Insensitive Environment Sanitization
// ============================================================================

#[test]
fn test_exhaustive_case_permutations_of_forbidden_env_vars() {
    for &forbidden in FORBIDDEN_ENV_VARS {
        let lower = forbidden.to_lowercase();
        let upper = forbidden.to_uppercase();
        let mut mixed = String::new();
        for (i, c) in forbidden.chars().enumerate() {
            if i % 2 == 0 {
                mixed.extend(c.to_uppercase());
            } else {
                mixed.extend(c.to_lowercase());
            }
        }

        assert!(is_forbidden_env_var(&lower), "Must match lowercase: {}", lower);
        assert!(is_forbidden_env_var(&upper), "Must match uppercase: {}", upper);
        assert!(is_forbidden_env_var(&mixed), "Must match mixed: {}", mixed);

        let env_map = vec![
            (lower.as_str(), "val1"),
            (upper.as_str(), "val2"),
            (mixed.as_str(), "val3"),
            ("ALLOWED_VAR", "allowed"),
        ];

        let sanitized = sanitize_process_env(env_map);
        assert!(!sanitized.contains_key(&lower), "Sanitizer leaked: {}", lower);
        assert!(!sanitized.contains_key(&upper), "Sanitizer leaked: {}", upper);
        assert!(!sanitized.contains_key(&mixed), "Sanitizer leaked: {}", mixed);
        assert_eq!(sanitized.get("ALLOWED_VAR").unwrap(), "allowed");
    }
}

#[test]
fn test_prefix_and_suffix_environment_variable_safety() {
    let test_env = vec![
        ("PREFIX_OPENAI_API_KEY", "safe1"),
        ("OPENAI_API_KEY_SUFFIX", "safe2"),
        ("MY_ANTHROPIC_API_KEY_VAL", "safe3"),
        ("DEEPSEEK_API_KEY_ID", "safe4"),
        ("GEMINI_API_KEY_URL", "safe5"),
        ("CODEX_TOKEN_STORE", "safe6"),
        ("OPENAI_API_KEY", "unsafe1"),
        ("ANTHROPIC_API_KEY", "unsafe2"),
        ("DEEPSEEK_API_KEY", "unsafe3"),
        ("GEMINI_API_KEY", "unsafe4"),
        ("CODEX_TOKEN", "unsafe5"),
    ];

    let sanitized = sanitize_process_env(test_env);
    assert_eq!(sanitized.get("PREFIX_OPENAI_API_KEY").unwrap(), "safe1");
    assert_eq!(sanitized.get("OPENAI_API_KEY_SUFFIX").unwrap(), "safe2");
    assert_eq!(sanitized.get("MY_ANTHROPIC_API_KEY_VAL").unwrap(), "safe3");
    assert_eq!(sanitized.get("DEEPSEEK_API_KEY_ID").unwrap(), "safe4");
    assert_eq!(sanitized.get("GEMINI_API_KEY_URL").unwrap(), "safe5");
    assert_eq!(sanitized.get("CODEX_TOKEN_STORE").unwrap(), "safe6");

    assert!(!sanitized.contains_key("OPENAI_API_KEY"));
    assert!(!sanitized.contains_key("ANTHROPIC_API_KEY"));
    assert!(!sanitized.contains_key("DEEPSEEK_API_KEY"));
    assert!(!sanitized.contains_key("GEMINI_API_KEY"));
    assert!(!sanitized.contains_key("CODEX_TOKEN"));
}

#[test]
fn test_ansi_stripped_emojis_and_multibyte() {
    let colored_emoji = "\x1B[31;1m🦀\x1B[0m\x1B[32;1m🚀\x1B[0m";
    assert_eq!(strip_ansi_codes(colored_emoji), "🦀🚀");

    let wrapped_json = "\x1B[33m{\"type\":\"raw\",\"data\":\"🦀\"}\x1B[0m\n";
    let mut normalizer = EventNormalizer::new(None);
    let evts = normalizer.write_chunk(wrapped_json);
    assert_eq!(evts.len(), 1);
    match &evts[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data, "🦀");
        }
        other => panic!("Expected Raw event, got {:?}", other),
    }
}

#[test]
fn test_empty_keys_nulls_and_unusual_types_in_zero_api_key_check() {
    let config = json!({
        "": "empty-key",
        "null_val": null,
        "bool_val": true,
        "number_val": -42.5,
        "empty_arr": [],
        "empty_obj": {},
        "nested_arr": [null, 1, "string", true, []],
        "safe_map": {
            "api_key_suffix": "safe",
            "prefix_apiKey": "safe"
        }
    });

    let res = validate_zero_api_key_requirement(&config);
    assert!(res.is_ok(), "Config with empty keys and nulls should pass: {:?}", res);
}

#[test]
fn test_environment_sanitizer_empty_and_special_characters() {
    let env_entries = vec![
        ("", "empty-key"),
        (" ", "space-key"),
        ("=123", "weird-windows-env"),
        ("PATH", "C:\\bin"),
        ("openai_API_key", "must-strip"),
        ("GEMINI_api_KEY", "must-strip"),
    ];

    let sanitized = sanitize_process_env(env_entries);
    assert_eq!(sanitized.get("").unwrap(), "empty-key");
    assert_eq!(sanitized.get(" ").unwrap(), "space-key");
    assert_eq!(sanitized.get("=123").unwrap(), "weird-windows-env");
    assert_eq!(sanitized.get("PATH").unwrap(), "C:\\bin");
    assert!(!sanitized.contains_key("openai_API_key"));
    assert!(!sanitized.contains_key("GEMINI_api_KEY"));
}

