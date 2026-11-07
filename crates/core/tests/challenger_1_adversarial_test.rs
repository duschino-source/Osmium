use std::path::PathBuf;
use tempfile::tempdir;
use tokio::task::JoinSet;

use osmium_core::boundary::{assert_workspace_write_allowed, is_path_inside_workspace};
use osmium_core::schemas::{parse_project_config_yaml, stringify_project_config_yaml};
use osmium_core::storage::SqliteStorage;
use osmium_core::types::{
    AgentEvent, ApprovalMode, CliId, MessageRole, ProjectSummary, SessionState, SessionSummary, ToolStatus,
};

// =========================================================================
// 1. YAML UNKNOWN-KEY PRESERVATION & STRUCTURE STRESS TESTS
// =========================================================================

#[test]
fn test_yaml_deep_nested_unknown_structures_and_lists() {
    let complex_yaml = r#"
version: 1
name: deep-structure-app
primary: codex
secondary:
  - antigravity
  - deepseek
  - custom-cli
approvalMode: ask
routing:
  - when: planning
    cli: codex
    customRoutingData:
      priority: 100
      tags: ["urgent", "backend"]
      deepSettings:
        retryOnFailure: true
        subAttempts: 5
        nestedMatrix:
          - level: 1
            weight: 0.5
          - level: 2
            weight: 0.9
fallback:
  onQuotaHit: ask
  customTelemetry:
    endpoint: "https://telemetry.corp.internal/v1"
    headers:
      X-Custom-Auth: "secret-token"
      X-Environment: "staging"
    sampleRate: 0.05
teamwork:
  maxParallel: 4
  integrationBranch: osmium/integration
  clusterConfig:
    region: "us-west-2"
    nodes:
      - id: "node-1"
        capacity: 16
        labels:
          arch: "arm64"
          zone: "a"
      - id: "node-2"
        capacity: 32
        labels:
          arch: "x86_64"
          zone: "b"
extraDeepRoot:
  l1:
    l2:
      l3:
        l4:
          l5:
            finalValue: "deeply_nested_payload"
            booleanFlag: true
            floatValue: 3.14159
            nullValue: null
            emptyList: []
            emptyMap: {}
            listOfObjects:
              - key: "item1"
                tags: ["a", "b"]
              - key: "item2"
                tags: ["c", "d"]
"#;

    // 1. Parse complex YAML
    let parsed = parse_project_config_yaml(complex_yaml).expect("Failed to parse complex YAML");
    assert_eq!(parsed.name, "deep-structure-app");
    assert_eq!(parsed.teamwork.max_parallel, 4);

    // 2. Verify extra fields are present in in-memory parsed representation
    assert!(parsed.extra.contains_key("extraDeepRoot"));
    let extra_root = &parsed.extra["extraDeepRoot"];
    let l5 = &extra_root["l1"]["l2"]["l3"]["l4"]["l5"];
    assert_eq!(l5["finalValue"].as_str().unwrap(), "deeply_nested_payload");
    assert_eq!(l5["booleanFlag"].as_bool().unwrap(), true);
    assert_eq!(l5["listOfObjects"][0]["key"].as_str().unwrap(), "item1");

    // Check routing extra
    assert_eq!(parsed.routing.len(), 1);
    assert_eq!(
        parsed.routing[0].extra["customRoutingData"]["priority"].as_i64().unwrap(),
        100
    );
    assert_eq!(
        parsed.routing[0].extra["customRoutingData"]["deepSettings"]["nestedMatrix"][1]["level"]
            .as_i64()
            .unwrap(),
        2
    );

    // Check teamwork extra
    assert_eq!(
        parsed.teamwork.extra["clusterConfig"]["region"].as_str().unwrap(),
        "us-west-2"
    );
    assert_eq!(
        parsed.teamwork.extra["clusterConfig"]["nodes"][0]["labels"]["arch"].as_str().unwrap(),
        "arm64"
    );

    // 3. Mutate standard fields (e.g. via UI action)
    let mut modified = parsed.clone();
    modified.approval_mode = ApprovalMode::FullAuto;
    modified.teamwork.max_parallel = 8;
    modified.name = "renamed-deep-app".to_string();

    // 4. Stringify back using original_yaml_text merge
    let serialized = stringify_project_config_yaml(&modified, Some(complex_yaml))
        .expect("Failed to stringify modified config with original YAML");

    // 5. Re-parse and verify ALL deep structures, lists, and values survived intact
    let reparsed = parse_project_config_yaml(&serialized).expect("Failed to re-parse serialized YAML");
    assert_eq!(reparsed.name, "renamed-deep-app");
    assert_eq!(reparsed.approval_mode, ApprovalMode::FullAuto);
    assert_eq!(reparsed.teamwork.max_parallel, 8);

    // Verify deep root survived
    let rel5 = &reparsed.extra["extraDeepRoot"]["l1"]["l2"]["l3"]["l4"]["l5"];
    assert_eq!(rel5["finalValue"].as_str().unwrap(), "deeply_nested_payload");
    assert_eq!(rel5["booleanFlag"].as_bool().unwrap(), true);
    assert_eq!(rel5["listOfObjects"][1]["tags"][0].as_str().unwrap(), "c");

    // Verify routing extra survived
    assert_eq!(
        reparsed.routing[0].extra["customRoutingData"]["deepSettings"]["subAttempts"].as_i64().unwrap(),
        5
    );

    // Verify fallback extra survived
    assert_eq!(
        reparsed.fallback.extra["customTelemetry"]["headers"]["X-Environment"].as_str().unwrap(),
        "staging"
    );

    // Verify teamwork extra survived
    assert_eq!(
        reparsed.teamwork.extra["clusterConfig"]["nodes"][1]["labels"]["zone"].as_str().unwrap(),
        "b"
    );
}

#[test]
fn test_yaml_comment_behavior_characterization() {
    let yaml_with_comments = r#"
# Root level configuration comment
version: 1
# Application name
name: commented-app
primary: codex
secondary:
  - antigravity # secondary 1
  - deepseek    # secondary 2
# Teamwork settings
teamwork:
  maxParallel: 2 # default concurrency
  integrationBranch: osmium/integration
"#;

    let parsed = parse_project_config_yaml(yaml_with_comments).expect("Should parse YAML with comments");
    assert_eq!(parsed.name, "commented-app");

    let stringified = stringify_project_config_yaml(&parsed, Some(yaml_with_comments))
        .expect("Should stringify");

    // Serde YAML AST data model operates on typed Values rather than Concrete Syntax Trees (CST)
    // Document comment preservation status empirically:
    let contains_comments = stringified.contains("# Root level configuration comment");
    println!("Empirical YAML comment preservation status: {}", contains_comments);
    // Comments are stripped by serde_yaml (same behavior as TypeScript YAML.parse/stringify)
    assert!(!contains_comments, "Standard serde_yaml AST discards comment tokens");
}

#[test]
fn test_yaml_adversarial_malformed_and_boundary_rejections() {
    // 1. Non-mapping root (array at root)
    let array_root = "- item1\n- item2\n";
    assert!(parse_project_config_yaml(array_root).is_err());

    // 2. Scalar at root
    assert!(parse_project_config_yaml("just a string").is_err());

    // 3. Invalid version
    let bad_version = "version: 2\nname: test\n";
    assert!(parse_project_config_yaml(bad_version).is_err());

    // 4. Missing / empty name
    let empty_name = "version: 1\nname: '   '\n";
    assert!(parse_project_config_yaml(empty_name).is_err());

    // 5. Zero maxParallel
    let zero_parallel = "version: 1\nname: test\nteamwork:\n  maxParallel: 0\n";
    assert!(parse_project_config_yaml(zero_parallel).is_err());

    // 6. Empty routing 'when' or 'cli'
    let bad_routing = "version: 1\nname: test\nrouting:\n  - when: ''\n    cli: codex\n";
    assert!(parse_project_config_yaml(bad_routing).is_err());
}

// =========================================================================
// 2. WORKSPACE BOUNDARY ADVERSARIAL PATH TRAVERSAL TESTS
// =========================================================================

#[test]
fn test_workspace_boundary_path_traversal_attacks() {
    let root = PathBuf::from(r"E:\SeriousProject\Osmium");

    // Attack 1: Classic single and multi-level parent directory traversal
    assert!(!is_path_inside_workspace(&root, "../outside.txt", false));
    assert!(!is_path_inside_workspace(&root, "../../outside.txt", false));
    assert!(!is_path_inside_workspace(&root, "../../../outside.txt", false));
    assert!(!is_path_inside_workspace(&root, "src/../../../outside.txt", false));
    assert!(!is_path_inside_workspace(&root, "crates/core/src/../../../../../outside.txt", false));

    // Attack 2: Windows backslash parent traversal
    assert!(!is_path_inside_workspace(&root, r"..\outside.txt", false));
    assert!(!is_path_inside_workspace(&root, r"..\..\outside.txt", false));
    assert!(!is_path_inside_workspace(&root, r"crates\..\..\..\outside.txt", false));

    // Attack 3: Mixed forward and backslash traversal escaping root
    assert!(!is_path_inside_workspace(&root, r"crates/../..\../outside.txt", false));
    assert!(!is_path_inside_workspace(&root, r"crates\core/../../../outside.txt", false));
    // Normalization staying within root MUST be accepted
    assert!(is_path_inside_workspace(&root, r"crates\core/../../inside.txt", false));

    // Attack 4: Prefix collision (directory prefix confusion)
    assert!(!is_path_inside_workspace(&root, r"E:\SeriousProject\Osmium-evil\payload.rs", false));
    assert!(!is_path_inside_workspace(&root, r"E:\SeriousProject\Osmium_backup\file.txt", false));
    assert!(!is_path_inside_workspace(&root, r"E:\SeriousProject\Osmium2\file.txt", false));

    // Attack 5: Absolute rooted paths to sensitive OS locations
    assert!(!is_path_inside_workspace(&root, r"C:\Windows\System32\cmd.exe", false));
    assert!(!is_path_inside_workspace(&root, r"C:\Windows\explorer.exe", false));
    assert!(!is_path_inside_workspace(&root, r"/etc/passwd", false));
    assert!(!is_path_inside_workspace(&root, r"/var/log/syslog", false));

    // Attack 6: Cross-drive paths
    assert!(!is_path_inside_workspace(&root, r"D:\workspace\file.txt", false));
    assert!(!is_path_inside_workspace(&root, r"C:\workspace\file.txt", false));

    // Attack 7: Windows drive-relative paths (e.g. C:foo.txt without root slash)
    assert!(!is_path_inside_workspace(&root, r"C:foo.txt", false));
    assert!(!is_path_inside_workspace(&root, r"E:foo.txt", false));

    // Attack 8: UNC server paths
    assert!(!is_path_inside_workspace(&root, r"\\localhost\c$\Windows\System32", false));
    assert!(!is_path_inside_workspace(&root, r"\\127.0.0.1\share\exploit.dll", false));
    assert!(!is_path_inside_workspace(&root, r"\\?\UNC\server\share\file.txt", false));

    // Attack 9: Windows device paths
    assert!(!is_path_inside_workspace(&root, r"\\.\PhysicalDrive0", false));
    assert!(!is_path_inside_workspace(&root, r"\\.\NUL", false));

    // Attack 10: Deep traversal with excessive dot-dots attempting to underflow root
    let deep_dots = "../".repeat(50) + "Windows/System32";
    assert!(!is_path_inside_workspace(&root, &deep_dots, false));

    // Valid paths MUST be accepted
    assert!(is_path_inside_workspace(&root, "src/lib.rs", false));
    assert!(is_path_inside_workspace(&root, "crates/core/src/types.rs", false));
    assert!(is_path_inside_workspace(&root, ".osmium/worktrees/task-1/file.rs", false));
    assert!(is_path_inside_workspace(&root, r".osmium\worktrees\task-2\nested\file.rs", false));
    assert!(is_path_inside_workspace(&root, ".", false));
    assert!(is_path_inside_workspace(&root, "", false));

    // assert_workspace_write_allowed error format check
    let err = assert_workspace_write_allowed(&root, "../hacked.rs", false).unwrap_err();
    assert!(err.to_string().contains("Workspace boundary violation"));
}

#[test]
fn test_workspace_boundary_global_osmium_directory() {
    let root = PathBuf::from(r"E:\SeriousProject\Osmium");
    let home = dirs::home_dir().expect("Home directory must exist");
    let global_valid = home.join(".osmium").join("extensions").join("plugin.json");
    let global_traversal = home.join(".osmium").join("..").join("outside.txt");

    // Allowed when flag is true
    assert!(is_path_inside_workspace(&root, &global_valid, true));
    // Rejected when flag is false
    assert!(!is_path_inside_workspace(&root, &global_valid, false));
    // Traversal out of ~/.osmium must be rejected even when allow_global_osmium_dir is true
    assert!(!is_path_inside_workspace(&root, &global_traversal, true));
}

// =========================================================================
// 3. SQLITE STORAGE UNDER CONCURRENT WRITES & WAL CONCURRENCY
// =========================================================================

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn test_sqlite_concurrent_writes_single_connection_gapless_sequences() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let db_path = tmp.path().join("osmium_concurrent_test.db");

    let storage = SqliteStorage::new(&db_path).await.expect("Failed to init storage");

    // Create test project and session
    let project = ProjectSummary {
        id: "proj-concurrent".to_string(),
        name: "Concurrent Test Project".to_string(),
        root_path: tmp.path().to_string_lossy().to_string(),
        primary_cli: CliId::from("codex"),
        secondary_clis: vec![CliId::from("deepseek")],
        approval_mode: ApprovalMode::Ask,
        updated_at: 1000,
    };
    storage.upsert_project(&project).await.expect("Failed to upsert project");

    let session = SessionSummary {
        id: "sess-concurrent-1".to_string(),
        project_id: "proj-concurrent".to_string(),
        title: "Concurrent Turn Session".to_string(),
        active_cli: CliId::from("codex"),
        provider_session_id: None,
        status: SessionState::Working,
        created_at: 1000,
        updated_at: 1000,
    };
    storage.create_session(&session).await.expect("Failed to create session");

    // Spawn 50 concurrent tasks writing events to the SAME session
    const NUM_EVENTS: usize = 50;
    let mut tasks = JoinSet::new();

    for i in 0..NUM_EVENTS {
        let store = storage.clone();
        tasks.spawn(async move {
            let event = AgentEvent::Message {
                role: MessageRole::Assistant,
                text: format!("Concurrent message chunk #{}", i),
                final_: false,
            };
            store.append_session_event("sess-concurrent-1", &event).await
        });
    }

    let mut returned_seqs = Vec::new();
    while let Some(res) = tasks.join_next().await {
        let seq = res.expect("Task panicked").expect("Event append failed");
        returned_seqs.push(seq);
    }

    assert_eq!(returned_seqs.len(), NUM_EVENTS);

    // Verify all sequence numbers returned are unique and cover exactly 1..50
    let mut sorted_returned = returned_seqs.clone();
    sorted_returned.sort_unstable();
    let expected: Vec<i64> = (1..=(NUM_EVENTS as i64)).collect();
    assert_eq!(sorted_returned, expected, "Returned sequence numbers must be gapless 1..N");

    // Verify stored events in SQLite
    let stored_events = storage
        .get_session_events("sess-concurrent-1")
        .await
        .expect("Failed to query session events");

    assert_eq!(stored_events.len(), NUM_EVENTS);
    let stored_seqs: Vec<i64> = stored_events.iter().map(|e| e.seq).collect();
    assert_eq!(stored_seqs, expected, "Stored sequence numbers in DB must be strictly gapless 1..N in order");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn test_sqlite_concurrent_multi_connection_wal_writes_gapless_sequences() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let db_path = tmp.path().join("osmium_multi_conn_wal.db");

    // Initialize DB schema with primary storage connection
    {
        let init_storage = SqliteStorage::new(&db_path).await.expect("Failed to init storage");
        let project = ProjectSummary {
            id: "proj-multi-conn".to_string(),
            name: "Multi-Conn Test".to_string(),
            root_path: tmp.path().to_string_lossy().to_string(),
            primary_cli: CliId::from("codex"),
            secondary_clis: vec![],
            approval_mode: ApprovalMode::Ask,
            updated_at: 1000,
        };
        init_storage.upsert_project(&project).await.expect("Project upsert");

        let session = SessionSummary {
            id: "sess-multi-conn".to_string(),
            project_id: "proj-multi-conn".to_string(),
            title: "Multi-Connection WAL Session".to_string(),
            active_cli: CliId::from("codex"),
            provider_session_id: None,
            status: SessionState::Working,
            created_at: 1000,
            updated_at: 1000,
        };
        init_storage.create_session(&session).await.expect("Session create");
    }

    // Stress test: 10 independent connections, each writing 10 events concurrently (100 total)
    const NUM_CONNS: usize = 10;
    const EVENTS_PER_CONN: usize = 10;
    const TOTAL_EVENTS: usize = NUM_CONNS * EVENTS_PER_CONN;

    let mut tasks = JoinSet::new();

    for conn_idx in 0..NUM_CONNS {
        let path = db_path.clone();
        tasks.spawn(async move {
            // Open a separate SQLite connection to the same DB file
            let conn_storage = SqliteStorage::new(&path)
                .await
                .expect("Failed to open connection in worker task");

            let mut seqs = Vec::new();
            for item in 0..EVENTS_PER_CONN {
                let event = AgentEvent::Tool {
                    id: format!("tool-{}-{}", conn_idx, item),
                    name: "readFile".to_string(),
                    status: ToolStatus::Running,
                    summary: Some(format!("Reading file chunk {}-{}", conn_idx, item)),
                    duration_sec: Some(0.05),
                };
                let seq = conn_storage
                    .append_session_event("sess-multi-conn", &event)
                    .await
                    .expect("Append across multi-connection WAL must succeed");
                seqs.push(seq);
            }
            seqs
        });
    }

    let mut all_returned_seqs = Vec::new();
    while let Some(res) = tasks.join_next().await {
        let conn_seqs = res.expect("Task panicked");
        all_returned_seqs.extend(conn_seqs);
    }

    assert_eq!(all_returned_seqs.len(), TOTAL_EVENTS);

    // Verify all sequence numbers across independent connections are strictly unique and gapless 1..100
    let mut sorted = all_returned_seqs.clone();
    sorted.sort_unstable();
    let expected: Vec<i64> = (1..=(TOTAL_EVENTS as i64)).collect();
    assert_eq!(
        sorted, expected,
        "Multi-connection WAL writes must produce strictly unique, gapless sequence numbers 1..N"
    );

    // Read back all events with a fresh reader connection
    let reader = SqliteStorage::new(&db_path).await.expect("Reader open");
    let stored = reader
        .get_session_events("sess-multi-conn")
        .await
        .expect("Reader query");
    assert_eq!(stored.len(), TOTAL_EVENTS);
    let stored_seqs: Vec<i64> = stored.iter().map(|s| s.seq).collect();
    assert_eq!(stored_seqs, expected, "Stored sequences in SQLite DB must be 1..100 without gaps");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn test_sqlite_concurrent_readers_and_writers_wal_isolation() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let db_path = tmp.path().join("osmium_wal_isolation.db");

    let storage = SqliteStorage::new(&db_path).await.expect("Failed to init storage");

    let project = ProjectSummary {
        id: "proj-wal".to_string(),
        name: "WAL Isolation Project".to_string(),
        root_path: tmp.path().to_string_lossy().to_string(),
        primary_cli: CliId::from("codex"),
        secondary_clis: vec![],
        approval_mode: ApprovalMode::Ask,
        updated_at: 1000,
    };
    storage.upsert_project(&project).await.unwrap();

    let session = SessionSummary {
        id: "sess-wal".to_string(),
        project_id: "proj-wal".to_string(),
        title: "WAL Read-Write Concurrency".to_string(),
        active_cli: CliId::from("codex"),
        provider_session_id: None,
        status: SessionState::Working,
        created_at: 1000,
        updated_at: 1000,
    };
    storage.create_session(&session).await.unwrap();

    let write_storage = storage.clone();
    let read_storage = storage.clone();

    // Writer task: bursts 40 events
    let writer_handle = tokio::spawn(async move {
        for i in 0..40 {
            let event = AgentEvent::Message {
                role: MessageRole::User,
                text: format!("Stream chunk {}", i),
                final_: false,
            };
            write_storage.append_session_event("sess-wal", &event).await.unwrap();
            tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
        }
    });

    // Reader task: queries events repeatedly while writes are occurring
    let reader_handle = tokio::spawn(async move {
        let mut read_counts = Vec::new();
        for _ in 0..15 {
            let events = read_storage.get_session_events("sess-wal").await.unwrap();
            read_counts.push(events.len());
            // Verify sequence monotonicity at any point in time
            for (idx, ev) in events.iter().enumerate() {
                assert_eq!(ev.seq, (idx + 1) as i64);
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(12)).await;
        }
        read_counts
    });

    writer_handle.await.expect("Writer task failed");
    let read_counts = reader_handle.await.expect("Reader task failed");

    // Readers must observe progress monotonically without being blocked
    println!("Observed event counts during WAL concurrency: {:?}", read_counts);
    assert!(*read_counts.last().unwrap() > 0);

    // Final verification: exactly 40 events
    let final_events = storage.get_session_events("sess-wal").await.unwrap();
    assert_eq!(final_events.len(), 40);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn test_sqlite_concurrent_multi_session_isolation() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let db_path = tmp.path().join("osmium_multi_session.db");

    let storage = SqliteStorage::new(&db_path).await.expect("Init storage");

    let project = ProjectSummary {
        id: "proj-multi-sess".to_string(),
        name: "Multi-Session Project".to_string(),
        root_path: tmp.path().to_string_lossy().to_string(),
        primary_cli: CliId::from("codex"),
        secondary_clis: vec![],
        approval_mode: ApprovalMode::Ask,
        updated_at: 1000,
    };
    storage.upsert_project(&project).await.unwrap();

    const NUM_SESSIONS: usize = 5;
    const EVENTS_PER_SESSION: usize = 20;

    for s_idx in 0..NUM_SESSIONS {
        let session = SessionSummary {
            id: format!("sess-iso-{}", s_idx),
            project_id: "proj-multi-sess".to_string(),
            title: format!("Session {}", s_idx),
            active_cli: CliId::from("codex"),
            provider_session_id: None,
            status: SessionState::Working,
            created_at: 1000,
            updated_at: 1000,
        };
        storage.create_session(&session).await.unwrap();
    }

    // Concurrently write to all 5 sessions at once
    let mut tasks = JoinSet::new();

    for s_idx in 0..NUM_SESSIONS {
        for e_idx in 0..EVENTS_PER_SESSION {
            let store = storage.clone();
            let session_id = format!("sess-iso-{}", s_idx);
            tasks.spawn(async move {
                let event = AgentEvent::Message {
                    role: MessageRole::Assistant,
                    text: format!("Message {} for session {}", e_idx, session_id),
                    final_: false,
                };
                let seq = store.append_session_event(&session_id, &event).await.unwrap();
                (session_id, seq)
            });
        }
    }

    let mut session_seqs: std::collections::HashMap<String, Vec<i64>> = std::collections::HashMap::new();
    while let Some(res) = tasks.join_next().await {
        let (sess_id, seq) = res.unwrap();
        session_seqs.entry(sess_id).or_default().push(seq);
    }

    let expected_seqs: Vec<i64> = (1..=(EVENTS_PER_SESSION as i64)).collect();

    for s_idx in 0..NUM_SESSIONS {
        let sess_id = format!("sess-iso-{}", s_idx);
        let mut seqs = session_seqs.get(&sess_id).cloned().unwrap_or_default();
        seqs.sort_unstable();
        assert_eq!(
            seqs, expected_seqs,
            "Each session must independently maintain strictly gapless sequences 1..N"
        );

        let stored = storage.get_session_events(&sess_id).await.unwrap();
        assert_eq!(stored.len(), EVENTS_PER_SESSION);
        let stored_seqs: Vec<i64> = stored.iter().map(|e| e.seq).collect();
        assert_eq!(stored_seqs, expected_seqs);
    }
}
