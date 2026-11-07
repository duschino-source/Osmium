use std::fs;
use std::sync::Arc;
use tempfile::tempdir;

use osmium_core::approval::{
    ApprovalKind, ApprovalOutcome, ApprovalRequest, ApprovalScope, InteractiveApprovalGate,
};
use osmium_core::checkpoint::{
    create_checkpoint, get_checkpoint_diff, list_checkpoints, undo_checkpoint,
    validate_checkpoint_id,
};
use osmium_core::quota::{FallbackOutcome, QuotaFallbackPolicy, QuotaTracker};
use osmium_core::schemas::PlannedTask;
use osmium_core::session::{build_handoff_system_context, SessionManager};
use osmium_core::storage::{SqliteStorage, StoredSessionEvent};
use osmium_core::teamwork::{
    get_teamwork_board_state, validate_task_dag_no_cycles, TeamworkRunState, TeamworkRunStatus,
    TeamworkScheduler, TeamworkTaskState, TeamworkTaskStatus,
};
use osmium_core::types::{
    AgentEvent, ApprovalMode, CliId, MessageRole, ProjectSummary, SessionState, SessionSummary,
    ToolStatus,
};

#[tokio::test]
async fn test_sqlite_storage_and_session_events() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let db_path = tmp.path().join(".osmium").join("osmium.db");
    let storage = SqliteStorage::new(&db_path).await.expect("Failed to init SqliteStorage");

    // Upsert project
    let proj = ProjectSummary {
        id: "proj-1".to_string(),
        name: "test-project".to_string(),
        root_path: tmp.path().to_string_lossy().to_string(),
        primary_cli: CliId::Codex,
        secondary_clis: vec![CliId::Antigravity, CliId::Deepseek],
        approval_mode: ApprovalMode::Ask,
        updated_at: 1000,
    };
    storage.upsert_project(&proj).await.expect("upsert_project failed");
    let loaded_proj = storage.get_project("proj-1").await.expect("get_project failed").unwrap();
    assert_eq!(loaded_proj.name, "test-project");
    assert_eq!(loaded_proj.primary_cli, CliId::Codex);

    // Create session
    let sess = SessionSummary {
        id: "sess-1".to_string(),
        project_id: "proj-1".to_string(),
        title: "Initial Session".to_string(),
        active_cli: CliId::Codex,
        provider_session_id: None,
        status: SessionState::Idle,
        created_at: 1000,
        updated_at: 1000,
    };
    storage.create_session(&sess).await.expect("create_session failed");

    // Append session events and verify strict seq 1..N order
    for i in 1..=5 {
        let ev = AgentEvent::Message {
            role: MessageRole::User,
            text: format!("Prompt {}", i),
            final_: true,
        };
        let seq = storage.append_session_event("sess-1", &ev).await.expect("append failed");
        assert_eq!(seq, i);
    }

    let events = storage.get_session_events("sess-1").await.expect("get events failed");
    assert_eq!(events.len(), 5);
    for (i, ev) in events.iter().enumerate() {
        assert_eq!(ev.seq, (i + 1) as i64);
        assert_eq!(ev.event_type, "message");
    }

    // Verify recovery of interrupted sessions
    storage.update_session_status("sess-1", "working", None).await.expect("update status failed");
    let recovered = storage.recover_interrupted_sessions().await.expect("recovery failed");
    assert_eq!(recovered, vec!["sess-1"]);
    let updated_sess = storage.get_session("sess-1").await.expect("get session").unwrap();
    assert_eq!(updated_sess.status, SessionState::Interrupted);
}

#[tokio::test]
async fn test_interactive_approval_gate_modes_and_scopes() {
    // Mode: Ask
    let gate = InteractiveApprovalGate::new(ApprovalMode::Ask);
    let req = ApprovalRequest {
        id: "appr-1".to_string(),
        kind: ApprovalKind::Edit,
        detail: "edit src/main.rs".to_string(),
    };
    match gate.request_approval(req) {
        ApprovalOutcome::Blocked(rx) => {
            assert_eq!(gate.pending_count(), 1);
            let res = gate.respond("appr-1", true, ApprovalScope::Session).expect("respond failed");
            assert!(res.allowed);
            assert_eq!(res.scope, ApprovalScope::Session);
            let decision = rx.await.expect("oneshot failed");
            assert!(decision.allowed);
            assert_eq!(gate.pending_count(), 0);
        }
        ApprovalOutcome::AllowedImmediately(_) => panic!("Should block in Ask mode"),
    }

    // Session-scope allow cache: second edit of SAME kind should be allowed immediately
    let req2 = ApprovalRequest {
        id: "appr-2".to_string(),
        kind: ApprovalKind::Edit,
        detail: "edit src/lib.rs".to_string(),
    };
    match gate.request_approval(req2) {
        ApprovalOutcome::AllowedImmediately(d) => {
            assert!(d.allowed);
            assert_eq!(d.scope, ApprovalScope::Session);
        }
        ApprovalOutcome::Blocked(_) => panic!("Should be auto-approved by session scope"),
    }

    // Different kind (Command) must still block!
    let req_cmd = ApprovalRequest {
        id: "appr-cmd".to_string(),
        kind: ApprovalKind::Command,
        detail: "cargo build".to_string(),
    };
    match gate.request_approval(req_cmd) {
        ApprovalOutcome::Blocked(_) => {
            assert_eq!(gate.pending_count(), 1);
        }
        ApprovalOutcome::AllowedImmediately(_) => panic!("Command must block even if edit was allowed"),
    }

    // AutoEdit mode auto-approves edit, blocks command
    let auto_gate = InteractiveApprovalGate::new(ApprovalMode::AutoEdit);
    let edit_req = ApprovalRequest {
        id: "appr-edit".to_string(),
        kind: ApprovalKind::Edit,
        detail: "edit file".to_string(),
    };
    assert!(matches!(
        auto_gate.request_approval(edit_req),
        ApprovalOutcome::AllowedImmediately(_)
    ));

    let cmd_req = ApprovalRequest {
        id: "appr-cmd-2".to_string(),
        kind: ApprovalKind::Command,
        detail: "run command".to_string(),
    };
    assert!(matches!(
        auto_gate.request_approval(cmd_req),
        ApprovalOutcome::Blocked(_)
    ));
}

#[test]
fn test_mid_session_handoff_synthesis() {
    let events = vec![
        StoredSessionEvent {
            id: 1,
            session_id: "sess-1".to_string(),
            seq: 1,
            event_type: "message".to_string(),
            payload: AgentEvent::Message {
                role: MessageRole::User,
                text: "Add login auth".to_string(),
                final_: true,
            },
            created_at: 1000,
        },
        StoredSessionEvent {
            id: 2,
            session_id: "sess-1".to_string(),
            seq: 2,
            event_type: "message".to_string(),
            payload: AgentEvent::Message {
                role: MessageRole::Assistant,
                text: "Implemented JWT verification".to_string(),
                final_: true,
            },
            created_at: 1010,
        },
        StoredSessionEvent {
            id: 3,
            session_id: "sess-1".to_string(),
            seq: 3,
            event_type: "file-edit".to_string(),
            payload: AgentEvent::FileEdit {
                path: "src/auth.ts".to_string(),
                added: 24,
                removed: 2,
            },
            created_at: 1020,
        },
        StoredSessionEvent {
            id: 4,
            session_id: "sess-1".to_string(),
            seq: 4,
            event_type: "tool".to_string(),
            payload: AgentEvent::Tool {
                id: "tool-1".to_string(),
                name: "run_tests".to_string(),
                status: ToolStatus::Done,
                summary: Some("All 10 tests passed".to_string()),
                duration_sec: Some(1.2),
            },
            created_at: 1030,
        },
    ];

    let handoff = build_handoff_system_context(&events, "codex", "deepseek");
    assert!(handoff.contains("[Osmium Mid-Session Handoff: codex -> deepseek]"));
    assert!(handoff.contains("User prompts: Add login auth"));
    assert!(handoff.contains("Previous assistant summary: Implemented JWT verification"));
    assert!(handoff.contains("Edited files: src/auth.ts (+24 -2)"));
    assert!(handoff.contains("Tools executed: run_tests: All 10 tests passed"));
}

#[tokio::test]
async fn test_quota_tracker_and_cascading_fallback() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let db_path = tmp.path().join("osmium.db");
    let storage = SqliteStorage::new(&db_path).await.expect("init storage");
    let tracker = QuotaTracker::new(storage);

    // Record turn usage
    let stats = tracker
        .record_turn_usage("codex", false, None)
        .await
        .expect("record turn");
    assert_eq!(stats.turns_run, 1);
    assert!(stats.last_limit_hit_at.is_none());

    let stats2 = tracker
        .record_turn_usage("codex", true, Some("Rate limited"))
        .await
        .expect("record limit");
    assert_eq!(stats2.turns_run, 2);
    assert!(stats2.last_limit_hit_at.is_some());
    assert_eq!(stats2.last_note, Some("Rate limited".to_string()));

    // Test determine next CLI
    let secondaries = vec!["antigravity".to_string(), "deepseek".to_string()];
    let next = QuotaTracker::determine_next_cli("codex", &secondaries, "codex", &[]);
    assert_eq!(next, Some("antigravity".to_string()));

    let next2 = QuotaTracker::determine_next_cli(
        "codex",
        &secondaries,
        "antigravity",
        &["codex".to_string()],
    );
    assert_eq!(next2, Some("deepseek".to_string()));

    // Fallback outcome NextSecondary
    let outcome = QuotaTracker::handle_limit_hit(
        QuotaFallbackPolicy::NextSecondary,
        "codex",
        &secondaries,
        "codex",
        &[],
    );
    assert_eq!(
        outcome,
        FallbackOutcome::SwitchedToSecondary {
            next_cli: "antigravity".to_string()
        }
    );

    // When all exhausted
    let outcome_exhausted = QuotaTracker::handle_limit_hit(
        QuotaFallbackPolicy::NextSecondary,
        "codex",
        &secondaries,
        "deepseek",
        &["codex".to_string(), "antigravity".to_string()],
    );
    assert!(matches!(outcome_exhausted, FallbackOutcome::Exhausted { .. }));
}

#[test]
fn test_teamwork_dag_validation_and_kanban_board() {
    // Valid DAG
    let valid_tasks = vec![
        PlannedTask {
            id: Some("task-1".to_string()),
            title: "Task 1".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec![],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("task-2".to_string()),
            title: "Task 2".to_string(),
            description: None,
            scope: vec!["tests/**".to_string()],
            dependencies: vec!["task-1".to_string()],
            task_type: "test".to_string(),
            assigned_cli: None,
        },
    ];
    assert!(validate_task_dag_no_cycles(&valid_tasks).is_ok());

    // Cyclic DAG
    let cyclic_tasks = vec![
        PlannedTask {
            id: Some("task-A".to_string()),
            title: "Task A".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["task-B".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("task-B".to_string()),
            title: "Task B".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["task-A".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
    ];
    assert!(validate_task_dag_no_cycles(&cyclic_tasks).is_err());

    // Teamwork Scheduler concurrency throttling
    let scheduler = TeamworkScheduler::new(2);
    let run_state_tasks = vec![
        TeamworkTaskState {
            id: "t1".to_string(),
            run_id: "r1".to_string(),
            title: "T1".to_string(),
            description: None,
            task_type: "code".to_string(),
            assigned_cli: CliId::Codex,
            status: TeamworkTaskStatus::Done,
            scope: vec!["src/**".to_string()],
            dependencies: vec![],
            worktree_path: None,
            branch_name: None,
            session_id: None,
            diff_added: 10,
            diff_removed: 0,
            out_of_scope_files: vec![],
            error_message: None,
            started_at: None,
            completed_at: None,
        },
        TeamworkTaskState {
            id: "t2".to_string(),
            run_id: "r1".to_string(),
            title: "T2".to_string(),
            description: None,
            task_type: "code".to_string(),
            assigned_cli: CliId::Codex,
            status: TeamworkTaskStatus::Queued,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["t1".to_string()],
            worktree_path: None,
            branch_name: None,
            session_id: None,
            diff_added: 0,
            diff_removed: 0,
            out_of_scope_files: vec![],
            error_message: None,
            started_at: None,
            completed_at: None,
        },
    ];

    let ready = scheduler.select_ready_tasks(&run_state_tasks, 0);
    assert_eq!(ready.len(), 1);
    assert_eq!(ready[0].id, "t2");

    let run_state = TeamworkRunState {
        id: "r1".to_string(),
        project_id: "p1".to_string(),
        session_id: None,
        goal: "Finish Milestone 1".to_string(),
        orchestrator_cli: CliId::Codex,
        integration_branch: "osmium/integration".to_string(),
        max_parallel: 2,
        status: TeamworkRunStatus::Running,
        tasks: run_state_tasks,
        created_at: 1000,
        updated_at: 1000,
    };
    let board = get_teamwork_board_state(&run_state);
    assert_eq!(board.columns.done.len(), 1);
    assert_eq!(board.columns.queued.len(), 1);
    assert_eq!(board.orchestrator_badge, "● codex · Orchestrator");
}

#[test]
fn test_checkpoint_id_validation() {
    assert!(validate_checkpoint_id("chk-123-abc").is_ok());
    assert!(validate_checkpoint_id("checkpoint_turn_1").is_ok());
    assert!(validate_checkpoint_id("../escape").is_err());
    assert!(validate_checkpoint_id("chk/with/slashes").is_err());
    assert!(validate_checkpoint_id("").is_err());
}

#[tokio::test]
async fn test_session_manager_lifecycle_and_switch_guard() {
    let tmp = tempdir().expect("tempdir");
    let db_path = tmp.path().join("osmium.db");
    let storage = SqliteStorage::new(&db_path).await.expect("storage init");
    let tracker = Arc::new(QuotaTracker::new(storage.clone()));
    let manager = SessionManager::new(storage.clone(), tracker);

    let proj = ProjectSummary {
        id: "proj-mgr".to_string(),
        name: "Mgr Test".to_string(),
        root_path: tmp.path().to_string_lossy().to_string(),
        primary_cli: CliId::Codex,
        secondary_clis: vec![CliId::Deepseek],
        approval_mode: ApprovalMode::Ask,
        updated_at: 1000,
    };
    storage.upsert_project(&proj).await.expect("upsert project");

    let sess = manager
        .start_session("sess-mgr", "proj-mgr", "Manager Session", "codex", ApprovalMode::Ask)
        .await
        .expect("start session");
    assert_eq!(sess.active_cli, CliId::Codex);

    // Emit event
    manager
        .emit_event(
            "sess-mgr",
            AgentEvent::Message {
                role: MessageRole::User,
                text: "Hello agent".to_string(),
                final_: true,
            },
        )
        .await
        .expect("emit event");

    // Switch CLI cleanly
    let (switched, handoff) = manager
        .switch_cli("sess-mgr", "deepseek")
        .await
        .expect("switch cli");
    assert_eq!(switched.active_cli, CliId::Deepseek);
    assert!(handoff.contains("[Osmium Mid-Session Handoff: codex -> deepseek]"));

    // Cancel session
    let cancelled = manager.cancel_session("sess-mgr").await.expect("cancel session");
    assert_eq!(cancelled.status, SessionState::Idle);
}

#[test]
fn test_git_checkpoint_creation_and_exact_undo() {
    let tmp = tempdir().expect("tempdir");
    let repo = tmp.path();

    // Initialize real git repo
    let run = |args: &[&str]| {
        let status = std::process::Command::new("git")
            .current_dir(repo)
            .args(args)
            .status()
            .expect("git execution failed");
        assert!(status.success(), "Command git {:?} failed", args);
    };

    run(&["init", "-b", "main"]);
    run(&["config", "user.name", "Osmium Test"]);
    run(&["config", "user.email", "test@osmium.dev"]);

    let tracked_file = repo.join("hello.txt");
    fs::write(&tracked_file, "initial content").expect("write file");
    run(&["add", "hello.txt"]);
    run(&["commit", "-m", "Initial commit"]);

    // Create pre-turn checkpoint
    let cp = create_checkpoint(repo, "sess-test", Some("chk-1"), 1)
        .expect("create checkpoint");
    assert_eq!(cp.id, "chk-1");
    assert_eq!(cp.git_ref, "refs/osmium/checkpoints/chk-1");

    // List checkpoints
    let list = list_checkpoints(repo).expect("list checkpoints");
    assert!(list.contains(&"chk-1".to_string()));

    // Destructive agent changes: edit tracked file, add new untracked file
    fs::write(&tracked_file, "modified by agent").expect("modify file");
    let untracked_file = repo.join("agent_created.txt");
    fs::write(&untracked_file, "untracked work").expect("write untracked");

    // Get checkpoint diff
    let diff = get_checkpoint_diff(repo, "chk-1").expect("get diff");
    assert_eq!(diff.checkpoint_id, "chk-1");
    assert!(diff.files.iter().any(|f| f.path == "hello.txt" || f.path.contains("agent_created")));

    // Undo checkpoint
    let undo = undo_checkpoint(repo, "chk-1").expect("undo checkpoint");
    assert_eq!(undo.checkpoint_id, "chk-1");

    // Verify exact restoration
    let restored_content = fs::read_to_string(&tracked_file).expect("read file");
    assert_eq!(restored_content, "initial content");
    assert!(!untracked_file.exists(), "Untracked file should be cleaned up by undo");
}
