//! Tests for stream normalizer, environment sanitization, and probe caching.

use osmium_adapters::*;
use std::path::PathBuf;

#[test]
fn test_strip_ansi_codes() {
    let input = "\x1B[32mSuccess\x1B[0m: compilation \x1B[1mfinished\x1B[0m\r";
    let stripped = strip_ansi_codes(input);
    assert_eq!(stripped, "Success: compilation finished\r");
}

#[test]
fn test_normalizer_parses_7_canonical_event_variants() {
    let mut normalizer = EventNormalizer::new(None);

    let lines = [
        r#"{"type":"message","role":"assistant","text":"Hello world","final":false}"#,
        r#"{"type":"tool","id":"t1","name":"read_file","status":"running"}"#,
        r#"{"type":"tool","id":"t1","name":"read_file","status":"done","summary":"ok","durationSec":1.5}"#,
        r#"{"type":"file-edit","path":"src/main.rs","added":10,"removed":2}"#,
        r#"{"type":"approval","id":"app-1","kind":"command","detail":"cargo build"}"#,
        r#"{"type":"usage","limitHit":true,"note":"Quota reached"}"#,
        r#"{"type":"status","state":"working","message":"In progress"}"#,
        r#"{"type":"raw","data":"raw terminal output"}"#,
    ];

    for line in lines {
        let events = normalizer.process_line(line);
        assert_eq!(events.len(), 1, "Failed parsing line: {}", line);
    }

    let collected = normalizer.collected_events();
    assert_eq!(collected.len(), 8);

    assert!(
        matches!(&collected[0], AgentEvent::Message { role: MessageRole::Assistant, text, final_: false } if text == "Hello world")
    );
    assert!(
        matches!(&collected[1], AgentEvent::Tool { id, status: ToolStatus::Running, .. } if id == "t1")
    );
    assert!(
        matches!(&collected[2], AgentEvent::Tool { id, status: ToolStatus::Done, duration_sec: Some(d), .. } if id == "t1" && (*d - 1.5).abs() < f64::EPSILON)
    );
    assert!(
        matches!(&collected[3], AgentEvent::FileEdit { path, added: 10, removed: 2 } if path == "src/main.rs")
    );
    assert!(
        matches!(&collected[4], AgentEvent::Approval { id, kind: ApprovalKind::Command, .. } if id == "app-1")
    );
    assert!(matches!(
        &collected[5],
        AgentEvent::Usage {
            limit_hit: Some(true),
            ..
        }
    ));
    assert!(matches!(
        &collected[6],
        AgentEvent::Status {
            state: SessionState::Working,
            ..
        }
    ));
    assert!(matches!(&collected[7], AgentEvent::Raw { data } if data == "raw terminal output"));
}

#[test]
fn test_normalizer_raw_fallback_on_unrecognized_or_non_json() {
    let mut normalizer = EventNormalizer::new(None);

    let raw_line = "Compiling osmium-adapters v0.1.0 (E:\\workspace)";
    let events = normalizer.process_line(raw_line);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        AgentEvent::Raw {
            data: raw_line.to_string()
        }
    );

    let unknown_json = r#"{"type":"some-future-unknown-event","payload":123}"#;
    let events = normalizer.process_line(unknown_json);
    assert_eq!(events.len(), 1);
    assert!(matches!(&events[0], AgentEvent::Raw { .. }));
}

#[test]
fn test_normalizer_chunk_buffering_across_newlines() {
    let mut normalizer = EventNormalizer::new(None);

    let chunk1 = "{\"type\":\"message\",\"role\":\"assistant\",\"text\":\"chunk ";
    let chunk2 = "one\",\"final\":true}\n{\"type\":\"status\",\"state\":\"idle\"}\n";

    let evts1 = normalizer.write_chunk(chunk1);
    assert!(
        evts1.is_empty(),
        "Partial chunk should buffer without emitting"
    );

    let evts2 = normalizer.write_chunk(chunk2);
    assert_eq!(evts2.len(), 2);
    assert!(
        matches!(&evts2[0], AgentEvent::Message { text, final_: true, .. } if text == "chunk one")
    );
    assert!(matches!(
        &evts2[1],
        AgentEvent::Status {
            state: SessionState::Idle,
            ..
        }
    ));
}

#[test]
fn test_normalizer_buffer_overflow_protection() {
    let mut normalizer = EventNormalizer::new(Some(64));

    let huge_chunk = "A".repeat(100);
    let emitted = normalizer.write_chunk(&huge_chunk);
    assert_eq!(emitted.len(), 1);
    match &emitted[0] {
        AgentEvent::Raw { data } => {
            assert_eq!(data.len(), 64);
        }
        _ => panic!("Expected Raw event on buffer overflow"),
    }
}

#[test]
fn test_assemble_streamed_message() {
    let events = vec![
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "Hello ".into(),
            final_: false,
        },
        AgentEvent::Tool {
            id: "1".into(),
            name: "ping".into(),
            status: ToolStatus::Done,
            summary: None,
            duration_sec: None,
        },
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "world!".into(),
            final_: false,
        },
    ];

    assert_eq!(
        assemble_streamed_message(&events),
        Some("Hello world!".to_string())
    );

    let events_with_final = vec![
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "Hello partial".into(),
            final_: false,
        },
        AgentEvent::Message {
            role: MessageRole::Assistant,
            text: "Hello complete final message".into(),
            final_: true,
        },
    ];

    assert_eq!(
        assemble_streamed_message(&events_with_final),
        Some("Hello complete final message".to_string())
    );
}

#[test]
fn test_environment_sanitizer_removes_forbidden_keys() {
    let raw_env = vec![
        ("PATH", "/usr/bin"),
        ("OPENAI_API_KEY", "sk-secret123"),
        ("ANTHROPIC_API_KEY", "sk-ant-456"),
        ("DEEPSEEK_API_KEY", "sk-deep-789"),
        ("GEMINI_API_KEY", "ai-gem-012"),
        ("CODEX_TOKEN", "token-xyz"),
        ("RUST_LOG", "info"),
    ];

    let sanitized = sanitize_process_env(raw_env);
    assert_eq!(sanitized.get("PATH").unwrap(), "/usr/bin");
    assert_eq!(sanitized.get("RUST_LOG").unwrap(), "info");
    assert!(!sanitized.contains_key("OPENAI_API_KEY"));
    assert!(!sanitized.contains_key("ANTHROPIC_API_KEY"));
    assert!(!sanitized.contains_key("DEEPSEEK_API_KEY"));
    assert!(!sanitized.contains_key("GEMINI_API_KEY"));
    assert!(!sanitized.contains_key("CODEX_TOKEN"));
}

#[test]
fn test_zero_api_key_config_validation() {
    let valid_config = serde_json::json!({
        "project": "osmium",
        "cli": "mock",
        "settings": {
            "maxTurns": 10
        }
    });
    assert!(validate_zero_api_key_requirement(&valid_config).is_ok());

    let invalid_config = serde_json::json!({
        "project": "osmium",
        "auth": {
            "apiKey": "forbidden-secret"
        }
    });
    let err = validate_zero_api_key_requirement(&invalid_config).unwrap_err();
    assert_eq!(err.code, "ERR_API_KEY_PROHIBITED");
    assert_eq!(err.keys, vec!["auth.apiKey"]);
}

#[tokio::test]
async fn test_detection_of_missing_cli_does_not_panic() {
    // Probe explicit nonexistent paths: the host may legitimately have any of
    // these CLIs installed, and this test is about graceful absence, not the
    // machine's PATH.
    let codex = CodexAdapter::with_binary_path(PathBuf::from("osmium-test-absent-codex"));
    let res = codex.detect().await.unwrap();
    assert!(!res.installed);
    assert!(res.version.is_none());
    assert!(res.version_warning.is_some());

    let antigravity =
        AntigravityAdapter::with_binary_path(PathBuf::from("osmium-test-absent-antigravity"));
    let res = antigravity.detect().await.unwrap();
    assert!(!res.installed);

    let deepseek = DeepSeekAdapter::with_binary_path(PathBuf::from("osmium-test-absent-deepseek"));
    let res = deepseek.detect().await.unwrap();
    assert!(!res.installed);
}

#[tokio::test]
async fn test_in_process_mock_adapter_lifecycle() {
    let adapter = MockCliAdapter::in_process();
    assert_eq!(adapter.id(), &CliId::Mock);
    assert_eq!(adapter.display_name(), "Mock CLI");

    let detection = adapter.detect().await.unwrap();
    assert!(detection.installed);
    assert_eq!(detection.version.as_deref(), Some("0.1.0"));

    let caps = adapter.capabilities().await.unwrap();
    assert!(caps.json_stream);
    assert!(caps.approvals);

    let opts = StartOptions {
        cwd: ".".into(),
        approval_mode: ApprovalMode::Ask,
        resume: None,
        system_context: None,
        read_only: None,
    };

    let mut session = adapter.start(opts).await.unwrap();
    let mut rx = session.take_event_receiver().unwrap();

    session.send("Hello agent", None).await.unwrap();

    let mut events = Vec::new();
    while let Some(evt) = rx.recv().await {
        let is_idle = matches!(
            &evt,
            AgentEvent::Status {
                state: SessionState::Idle,
                ..
            }
        );
        events.push(evt);
        if is_idle {
            break;
        }
    }

    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEvent::Message { final_: true, .. })));
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::Tool {
            status: ToolStatus::Done,
            ..
        }
    )));
}
