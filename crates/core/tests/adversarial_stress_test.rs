use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tempfile::tempdir;

use osmium_core::approval::{
    ApprovalError, ApprovalKind, ApprovalOutcome, ApprovalRequest, ApprovalScope,
    InteractiveApprovalGate,
};
use osmium_core::checkpoint::{
    create_checkpoint, get_checkpoint_diff, list_checkpoints, undo_checkpoint,
    validate_checkpoint_id, CheckpointError,
};
use osmium_core::schemas::PlannedTask;
use osmium_core::teamwork::{
    validate_task_dag_no_cycles, TeamworkError, TeamworkScheduler, TeamworkTaskState,
    TeamworkTaskStatus,
};
use osmium_core::types::{ApprovalMode, CliId};

// ============================================================================
// Helper for running Git commands in a test repo
// ============================================================================
fn run_git(repo: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(repo)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("Failed to run git {:?}: {}", args, e));
    assert!(
        output.status.success(),
        "git {:?} failed with stderr: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

// ============================================================================
// 1. GIT CHECKPOINT ADVERSARIAL STRESS TESTS
// ============================================================================

/// Stress test checkpoint creation and exact undo with:
/// - Mixed staged and unstaged changes
/// - Binary payloads (large, zero bytes, high bytes, invalid UTF-8)
/// - Deleted files (committed then deleted)
/// - Untracked nested directories with deep file paths
/// - STRICT VERIFICATION that user branch HEAD is NEVER altered.
#[test]
fn test_checkpoint_adversarial_mixed_staged_unstaged_binary_and_undo() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let repo = tmp.path();

    // 1. Initialize git repo
    run_git(repo, &["init", "-b", "main"]);
    run_git(repo, &["config", "user.name", "Osmium Stress Challenger"]);
    run_git(repo, &["config", "user.email", "challenger@osmium.dev"]);

    // 2. Commit initial files
    let file_staged_base = repo.join("staged_mod.txt");
    let file_unstaged_base = repo.join("unstaged_mod.txt");
    let file_to_delete = repo.join("delete_me.txt");
    let file_committed_binary = repo.join("base_binary.bin");

    fs::write(&file_staged_base, "base staged content").unwrap();
    fs::write(&file_unstaged_base, "base unstaged content").unwrap();
    fs::write(&file_to_delete, "file to be deleted").unwrap();

    // 16KB initial binary file with non-UTF-8 bytes
    let initial_bin_data: Vec<u8> = (0..16384).map(|i| (i % 256) as u8).collect();
    fs::write(&file_committed_binary, &initial_bin_data).unwrap();

    run_git(repo, &["add", "."]);
    run_git(repo, &["commit", "-m", "Initial commit for stress test"]);

    let head_commit_original = run_git(repo, &["rev-parse", "HEAD"]);
    let branch_original = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(branch_original, "main");

    // 3. Setup mixed staged & unstaged state BEFORE checkpoint:
    // a. staged modification
    fs::write(&file_staged_base, "staged modification before checkpoint").unwrap();
    run_git(repo, &["add", "staged_mod.txt"]);

    // b. unstaged modification
    fs::write(&file_unstaged_base, "unstaged modification before checkpoint").unwrap();

    // c. staged new file
    let file_new_staged = repo.join("newly_staged.txt");
    fs::write(&file_new_staged, "new staged file content").unwrap();
    run_git(repo, &["add", "newly_staged.txt"]);

    // d. untracked nested directory with binary payload
    let nested_dir = repo.join("nested").join("deep").join("dir");
    fs::create_dir_all(&nested_dir).unwrap();
    let untracked_nested_file = nested_dir.join("deep_nested.bin");
    let nested_bin_data: Vec<u8> = (0..32768).map(|i| ((i * 7) % 256) as u8).collect();
    fs::write(&untracked_nested_file, &nested_bin_data).unwrap();

    // e. deleted file (deleted in working tree, unstaged)
    fs::remove_file(&file_to_delete).unwrap();

    // Capture exact working tree snapshot before checkpoint
    let pre_cp_staged_content = fs::read_to_string(&file_staged_base).unwrap();
    let pre_cp_unstaged_content = fs::read_to_string(&file_unstaged_base).unwrap();
    let pre_cp_new_staged_content = fs::read_to_string(&file_new_staged).unwrap();

    // 4. CREATE CHECKPOINT
    let cp = create_checkpoint(repo, "sess-adversarial-1", Some("chk-adv-1"), 1)
        .expect("create_checkpoint should succeed");
    assert_eq!(cp.id, "chk-adv-1");
    assert_eq!(cp.git_ref, "refs/osmium/checkpoints/chk-adv-1");

    // VERIFY: HEAD was NEVER modified
    let head_after_cp = run_git(repo, &["rev-parse", "HEAD"]);
    assert_eq!(
        head_commit_original, head_after_cp,
        "HEAD commit was modified during create_checkpoint!"
    );
    let branch_after_cp = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(branch_after_cp, "main");

    // VERIFY: list_checkpoints contains our checkpoint
    let list = list_checkpoints(repo).expect("list_checkpoints failed");
    assert!(list.contains(&"chk-adv-1".to_string()));

    // 5. DESTRUCTIVE TURNS / AGENT EXECUTION
    // Modify existing files destructively
    fs::write(&file_staged_base, "DESTRUCTIVELY CORRUPTED BY AGENT").unwrap();
    fs::write(&file_unstaged_base, "AGENT MODIFIED UNSTAGED").unwrap();
    fs::write(&file_new_staged, "AGENT OVERWROTE NEW STAGED").unwrap();
    fs::write(&untracked_nested_file, [0xDE, 0xAD, 0xBE, 0xEF]).unwrap();

    // Modify base binary file with completely different payload
    let corrupted_bin: Vec<u8> = vec![0xFF; 8192];
    fs::write(&file_committed_binary, &corrupted_bin).unwrap();

    // Re-create the deleted file with bogus content
    fs::write(&file_to_delete, "resurrected with wrong content").unwrap();

    // Create NEW agent-created nested directories and files
    let agent_rogue_dir = repo.join("rogue_agent_output").join("subfolder");
    fs::create_dir_all(&agent_rogue_dir).unwrap();
    let rogue_file1 = agent_rogue_dir.join("rogue1.rs");
    let rogue_file2 = agent_rogue_dir.join("rogue2.bin");
    fs::write(&rogue_file1, "fn evil() {}").unwrap();
    fs::write(&rogue_file2, &[0x00, 0x01, 0x02, 0x03]).unwrap();

    // Stage some rogue changes in git
    run_git(repo, &["add", "rogue_agent_output"]);

    // VERIFY: Diff computation works and captures changes without failing on binary payloads
    let diff = get_checkpoint_diff(repo, "chk-adv-1").expect("get_checkpoint_diff failed");
    assert_eq!(diff.checkpoint_id, "chk-adv-1");
    assert!(diff.files.len() >= 4, "Diff should contain modified files");

    // 6. EXACT UNDO CHECKPOINT
    let undo_res = undo_checkpoint(repo, "chk-adv-1").expect("undo_checkpoint should succeed");
    assert_eq!(undo_res.checkpoint_id, "chk-adv-1");

    // 7. VERIFY EXACT BYTE-FOR-BYTE RESTORATION
    // Staged base file restored
    let restored_staged = fs::read_to_string(&file_staged_base).unwrap();
    assert_eq!(restored_staged, pre_cp_staged_content);

    // Unstaged base file restored
    let restored_unstaged = fs::read_to_string(&file_unstaged_base).unwrap();
    assert_eq!(restored_unstaged, pre_cp_unstaged_content);

    // New staged file restored
    let restored_new_staged = fs::read_to_string(&file_new_staged).unwrap();
    assert_eq!(restored_new_staged, pre_cp_new_staged_content);

    // Nested binary payload restored byte-for-byte
    let restored_nested_bin = fs::read(&untracked_nested_file).unwrap();
    assert_eq!(
        restored_nested_bin, nested_bin_data,
        "Nested binary payload was not restored byte-for-byte!"
    );

    // Base binary file restored byte-for-byte
    let restored_base_bin = fs::read(&file_committed_binary).unwrap();
    assert_eq!(
        restored_base_bin, initial_bin_data,
        "Base binary file was not restored byte-for-byte!"
    );

    // File that was deleted prior to checkpoint MUST NOT exist
    assert!(
        !file_to_delete.exists(),
        "Deleted file was unexpectedly recreated after undo!"
    );

    // Rogue untracked/staged files created by agent MUST be completely purged
    assert!(
        !rogue_file1.exists(),
        "Rogue agent file 1 should have been cleaned by undo"
    );
    assert!(
        !rogue_file2.exists(),
        "Rogue agent file 2 should have been cleaned by undo"
    );
    assert!(
        !agent_rogue_dir.exists(),
        "Rogue agent directory should have been cleaned by undo"
    );

    // 8. CRITICAL: VERIFY USER BRANCH HEAD IS STRICTLY UNTOUCHED
    let head_after_undo = run_git(repo, &["rev-parse", "HEAD"]);
    assert_eq!(
        head_commit_original, head_after_undo,
        "CRITICAL FAILURE: User branch HEAD was altered by undo_checkpoint!"
    );
    let branch_after_undo = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(
        branch_after_undo, "main",
        "CRITICAL FAILURE: User branch was switched or detached by undo_checkpoint!"
    );
}

/// Test checkpoint undo idempotency and multi-turn sequence
#[test]
fn test_checkpoint_multi_turn_and_idempotent_undo() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let repo = tmp.path();

    run_git(repo, &["init", "-b", "main"]);
    run_git(repo, &["config", "user.name", "Osmium MultiTurn"]);
    run_git(repo, &["config", "user.email", "multiturn@osmium.dev"]);

    let f = repo.join("file.txt");
    fs::write(&f, "turn 0 content").unwrap();
    run_git(repo, &["add", "."]);
    run_git(repo, &["commit", "-m", "Turn 0"]);
    let original_head = run_git(repo, &["rev-parse", "HEAD"]);

    // Turn 1 checkpoint
    create_checkpoint(repo, "sess-1", Some("chk-turn-1"), 1).unwrap();

    // Turn 1 edits
    fs::write(&f, "turn 1 modified").unwrap();

    // Turn 2 checkpoint
    create_checkpoint(repo, "sess-1", Some("chk-turn-2"), 2).unwrap();

    // Turn 2 edits
    fs::write(&f, "turn 2 modified").unwrap();

    // Undo Turn 2 -> should restore turn 1 state
    undo_checkpoint(repo, "chk-turn-2").unwrap();
    assert_eq!(fs::read_to_string(&f).unwrap(), "turn 1 modified");

    // Idempotent undo: calling undo again on chk-turn-2 should be a no-op
    undo_checkpoint(repo, "chk-turn-2").unwrap();
    assert_eq!(fs::read_to_string(&f).unwrap(), "turn 1 modified");

    // Undo Turn 1 -> should restore turn 0 state
    undo_checkpoint(repo, "chk-turn-1").unwrap();
    assert_eq!(fs::read_to_string(&f).unwrap(), "turn 0 content");

    // HEAD must still be exactly original
    assert_eq!(original_head, run_git(repo, &["rev-parse", "HEAD"]));
}

/// Test invalid checkpoint IDs and non-existent checkpoint errors
#[test]
fn test_checkpoint_invalid_ids_and_non_existent() {
    let tmp = tempdir().expect("Failed to create tempdir");
    let repo = tmp.path();

    run_git(repo, &["init", "-b", "main"]);
    run_git(repo, &["config", "user.name", "Osmium Test"]);
    run_git(repo, &["config", "user.email", "test@osmium.dev"]);
    let f = repo.join("a.txt");
    fs::write(&f, "a").unwrap();
    run_git(repo, &["add", "."]);
    run_git(repo, &["commit", "-m", "init"]);

    // Attempt directory traversal / shell injections in checkpoint IDs
    assert!(matches!(
        validate_checkpoint_id("../../../evil"),
        Err(CheckpointError::InvalidId(_))
    ));
    assert!(matches!(
        validate_checkpoint_id("chk;rm -rf /"),
        Err(CheckpointError::InvalidId(_))
    ));
    assert!(matches!(
        validate_checkpoint_id("chk|touch"),
        Err(CheckpointError::InvalidId(_))
    ));
    assert!(matches!(
        validate_checkpoint_id("chk`cmd`"),
        Err(CheckpointError::InvalidId(_))
    ));
    assert!(matches!(
        validate_checkpoint_id(""),
        Err(CheckpointError::InvalidId(_))
    ));

    // Non-existent checkpoint ID
    let err = undo_checkpoint(repo, "chk-does-not-exist");
    assert!(matches!(err, Err(CheckpointError::NotFound(_))));
    assert_eq!(err.unwrap_err().error_code(), "ERR_CHECKPOINT_NOT_FOUND");
}

// ============================================================================
// 2. TEAMWORK DAG SCHEDULER ADVERSARIAL STRESS TESTS
// ============================================================================

/// Adversarial stress testing of DAG cycle detection:
/// - Self-dependency (A -> A)
/// - 2-node cycle (A -> B -> A)
/// - Deep cycle (10-node cycle)
/// - Disconnected subgraph with cycle
/// - Diamond graph (valid DAG, must NOT falsely detect cycle)
/// - Missing/dangling dependency references
#[test]
fn test_teamwork_dag_cycle_detection_adversarial() {
    // 1. Self-dependency: Task A depends on itself
    let self_loop = vec![PlannedTask {
        id: Some("A".to_string()),
        title: "Self loop".to_string(),
        description: None,
        scope: vec!["src/**".to_string()],
        dependencies: vec!["A".to_string()],
        task_type: "code".to_string(),
        assigned_cli: None,
    }];
    let err = validate_task_dag_no_cycles(&self_loop);
    assert!(matches!(err, Err(TeamworkError::CyclicDependency(_))));

    // 2. 2-node cycle: A -> B -> A
    let mutual_cycle = vec![
        PlannedTask {
            id: Some("A".to_string()),
            title: "Task A".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["B".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("B".to_string()),
            title: "Task B".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["A".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
    ];
    let err = validate_task_dag_no_cycles(&mutual_cycle);
    assert!(matches!(err, Err(TeamworkError::CyclicDependency(_))));

    // 3. Deep 10-node cycle: T0 -> T1 -> ... -> T9 -> T0
    let mut deep_cycle_tasks = Vec::new();
    for i in 0..10 {
        let dep = format!("T{}", (i + 1) % 10);
        deep_cycle_tasks.push(PlannedTask {
            id: Some(format!("T{}", i)),
            title: format!("Task {}", i),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec![dep],
            task_type: "code".to_string(),
            assigned_cli: None,
        });
    }
    let err = validate_task_dag_no_cycles(&deep_cycle_tasks);
    assert!(matches!(err, Err(TeamworkError::CyclicDependency(_))));

    // 4. Disconnected graph: {Good1 -> Good2} and disconnected cycle {Bad1 -> Bad2 -> Bad1}
    let disconnected_tasks = vec![
        PlannedTask {
            id: Some("Good1".to_string()),
            title: "Good 1".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec![],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("Good2".to_string()),
            title: "Good 2".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["Good1".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("Bad1".to_string()),
            title: "Bad 1".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["Bad2".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("Bad2".to_string()),
            title: "Bad 2".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["Bad1".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
    ];
    let err = validate_task_dag_no_cycles(&disconnected_tasks);
    assert!(matches!(err, Err(TeamworkError::CyclicDependency(_))));

    // 5. Diamond graph: A -> B, A -> C, B -> D, C -> D (VALID DAG!)
    let diamond_tasks = vec![
        PlannedTask {
            id: Some("A".to_string()),
            title: "Root A".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec![],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("B".to_string()),
            title: "Branch B".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["A".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("C".to_string()),
            title: "Branch C".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["A".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
        PlannedTask {
            id: Some("D".to_string()),
            title: "Join D".to_string(),
            description: None,
            scope: vec!["src/**".to_string()],
            dependencies: vec!["B".to_string(), "C".to_string()],
            task_type: "code".to_string(),
            assigned_cli: None,
        },
    ];
    assert!(
        validate_task_dag_no_cycles(&diamond_tasks).is_ok(),
        "Diamond graph must be recognized as valid DAG with 0 cycles"
    );

    // 6. Dangling/missing dependency reference
    let missing_dep_tasks = vec![PlannedTask {
        id: Some("T1".to_string()),
        title: "T1".to_string(),
        description: None,
        scope: vec!["src/**".to_string()],
        dependencies: vec!["NON_EXISTENT".to_string()],
        task_type: "code".to_string(),
        assigned_cli: None,
    }];
    let err = validate_task_dag_no_cycles(&missing_dep_tasks);
    assert!(matches!(err, Err(TeamworkError::InvalidDependency { .. })));
}

/// Test task priority resolution and selection limits
#[test]
fn test_teamwork_task_priority_and_readiness_resolution() {
    let scheduler = TeamworkScheduler::new(2);

    let create_task = |id: &str, status: TeamworkTaskStatus, deps: Vec<&str>| TeamworkTaskState {
        id: id.to_string(),
        run_id: "run-1".to_string(),
        title: format!("Task {}", id),
        description: None,
        task_type: "code".to_string(),
        assigned_cli: CliId::Codex,
        status,
        scope: vec!["src/**".to_string()],
        dependencies: deps.into_iter().map(String::from).collect(),
        worktree_path: None,
        branch_name: None,
        session_id: None,
        diff_added: 0,
        diff_removed: 0,
        out_of_scope_files: vec![],
        error_message: None,
        started_at: None,
        completed_at: None,
    };

    // Tasks:
    // T1: Queued (no deps)
    // T2: Queued (no deps)
    // T3: Queued (no deps)
    // T4: Queued (depends on T1)
    // T5: Queued (depends on T4)
    let tasks = vec![
        create_task("T1", TeamworkTaskStatus::Queued, vec![]),
        create_task("T2", TeamworkTaskStatus::Queued, vec![]),
        create_task("T3", TeamworkTaskStatus::Queued, vec![]),
        create_task("T4", TeamworkTaskStatus::Queued, vec!["T1"]),
        create_task("T5", TeamworkTaskStatus::Queued, vec!["T4"]),
    ];

    // With 0 active running, and max_parallel = 2:
    // Should select exactly first 2 ready tasks in priority order: T1, T2
    let ready = scheduler.select_ready_tasks(&tasks, 0);
    assert_eq!(ready.len(), 2);
    assert_eq!(ready[0].id, "T1");
    assert_eq!(ready[1].id, "T2");

    // With 1 active running:
    // Should select exactly 1 slot: T1
    let ready_1 = scheduler.select_ready_tasks(&tasks, 1);
    assert_eq!(ready_1.len(), 1);
    assert_eq!(ready_1[0].id, "T1");

    // With 2 active running:
    // Available slots = 0, should select none
    let ready_none = scheduler.select_ready_tasks(&tasks, 2);
    assert!(ready_none.is_empty());

    // When T1 transitions to Done:
    // T4 becomes ready!
    let mut updated_tasks = tasks.clone();
    updated_tasks[0].status = TeamworkTaskStatus::Done;
    let ready_after_t1_done = scheduler.select_ready_tasks(&updated_tasks, 0);
    // Ready now: T2, T3, T4. But max_parallel=2 -> picks T2, T3.
    assert_eq!(ready_after_t1_done.len(), 2);
    assert_eq!(ready_after_t1_done[0].id, "T2");
    assert_eq!(ready_after_t1_done[1].id, "T3");

    // If a task transitions to Error:
    // Downstream tasks depending on it MUST NOT become ready!
    let mut error_tasks = tasks.clone();
    error_tasks[0].status = TeamworkTaskStatus::Error;
    let ready_error = scheduler.select_ready_tasks(&error_tasks, 0);
    // Ready tasks can only be T2 and T3. T4 depends on T1 which errored!
    for t in &ready_error {
        assert_ne!(t.id, "T4", "Task T4 should NOT be ready when T1 failed!");
        assert_ne!(t.id, "T5", "Task T5 should NOT be ready when T4 is not ready!");
    }
}

/// Stress test maxParallel semaphore limits under async task bursts:
/// Spawns 100 concurrent async tasks against a semaphore with limit=3.
/// Asserts that active concurrency NEVER exceeds 3, and all 100 complete cleanly.
#[tokio::test]
async fn test_teamwork_max_parallel_semaphore_burst() {
    const MAX_PARALLEL: usize = 3;
    const TASK_COUNT: usize = 100;

    let scheduler = Arc::new(TeamworkScheduler::new(MAX_PARALLEL));
    let sem = scheduler.semaphore();

    let current_concurrency = Arc::new(AtomicUsize::new(0));
    let max_concurrency_seen = Arc::new(AtomicUsize::new(0));
    let completed_count = Arc::new(AtomicUsize::new(0));
    let violation_detected = Arc::new(AtomicBool::new(false));

    let mut handles = Vec::new();

    for i in 0..TASK_COUNT {
        let sem_clone = sem.clone();
        let curr = current_concurrency.clone();
        let max_seen = max_concurrency_seen.clone();
        let completed = completed_count.clone();
        let violation = violation_detected.clone();

        handles.push(tokio::spawn(async move {
            // Acquire semaphore permit
            let permit = sem_clone.acquire().await.unwrap();

            let active = curr.fetch_add(1, Ordering::SeqCst) + 1;
            max_seen.fetch_max(active, Ordering::SeqCst);

            if active > MAX_PARALLEL {
                violation.store(true, Ordering::SeqCst);
            }

            // Simulate small variable workload
            tokio::time::sleep(Duration::from_millis(1 + (i % 5) as u64)).await;

            curr.fetch_sub(1, Ordering::SeqCst);
            drop(permit);

            completed.fetch_add(1, Ordering::SeqCst);
        }));
    }

    // Await all tasks to finish
    for h in handles {
        h.await.unwrap();
    }

    assert_eq!(
        completed_count.load(Ordering::SeqCst),
        TASK_COUNT,
        "All burst tasks should have completed"
    );
    assert!(
        !violation_detected.load(Ordering::SeqCst),
        "Concurrency exceeded max_parallel limit during task burst!"
    );
    assert_eq!(
        max_concurrency_seen.load(Ordering::SeqCst),
        MAX_PARALLEL,
        "Semaphore should have reached full max_parallel utilization"
    );
}

// ============================================================================
// 3. INTERACTIVE APPROVAL GATE ADVERSARIAL STRESS TESTS
// ============================================================================

/// Stress test kind isolation:
/// - Approving kind `Edit` with `Session` scope MUST NOT auto-approve `Command` or `Write`.
/// - Approving kind `Command` with `Once` scope MUST NOT auto-approve subsequent `Command`.
/// - Rejection with `Session` scope MUST NOT auto-approve anything.
#[tokio::test]
async fn test_approval_gate_kind_and_scope_isolation() {
    let gate = InteractiveApprovalGate::new(ApprovalMode::Ask);

    // 1. Request Edit approval with Session scope
    let req_edit1 = ApprovalRequest {
        id: "req-edit-1".to_string(),
        kind: ApprovalKind::Edit,
        detail: "edit src/foo.rs".to_string(),
    };
    match gate.request_approval(req_edit1) {
        ApprovalOutcome::Blocked(rx) => {
            let res = gate
                .respond("req-edit-1", true, ApprovalScope::Session)
                .expect("respond failed");
            assert!(res.allowed);
            assert_eq!(res.scope, ApprovalScope::Session);
            let decision = rx.await.expect("rx failed");
            assert!(decision.allowed);
        }
        ApprovalOutcome::AllowedImmediately(_) => panic!("First Edit in Ask mode must block"),
    }

    // 2. Second Edit request: MUST be allowed immediately due to Session scope
    let req_edit2 = ApprovalRequest {
        id: "req-edit-2".to_string(),
        kind: ApprovalKind::Edit,
        detail: "edit src/bar.rs".to_string(),
    };
    match gate.request_approval(req_edit2) {
        ApprovalOutcome::AllowedImmediately(d) => {
            assert!(d.allowed);
            assert_eq!(d.scope, ApprovalScope::Session);
            assert_eq!(d.auto.as_deref(), Some("session-scope"));
        }
        ApprovalOutcome::Blocked(_) => panic!("Second Edit should be auto-approved by session scope"),
    }

    // 3. Command request: MUST STILL BLOCK! Kind isolation strictly enforced.
    let req_cmd1 = ApprovalRequest {
        id: "req-cmd-1".to_string(),
        kind: ApprovalKind::Command,
        detail: "cargo run".to_string(),
    };
    match gate.request_approval(req_cmd1) {
        ApprovalOutcome::Blocked(rx) => {
            // Approve Command with ONCE scope
            let res = gate
                .respond("req-cmd-1", true, ApprovalScope::Once)
                .expect("respond failed");
            assert!(res.allowed);
            assert_eq!(res.scope, ApprovalScope::Once);
            let decision = rx.await.expect("rx failed");
            assert!(decision.allowed);
        }
        ApprovalOutcome::AllowedImmediately(_) => {
            panic!("Command MUST block even when Edit has session approval!")
        }
    }

    // 4. Second Command request: MUST STILL BLOCK because scope was `Once`!
    let req_cmd2 = ApprovalRequest {
        id: "req-cmd-2".to_string(),
        kind: ApprovalKind::Command,
        detail: "cargo test".to_string(),
    };
    match gate.request_approval(req_cmd2) {
        ApprovalOutcome::Blocked(rx) => {
            // Reject this command
            let res = gate
                .respond("req-cmd-2", false, ApprovalScope::Session)
                .expect("respond failed");
            assert!(!res.allowed);
            let decision = rx.await.expect("rx failed");
            assert!(!decision.allowed);
        }
        ApprovalOutcome::AllowedImmediately(_) => {
            panic!("Second Command MUST block because first was Once!")
        }
    }

    // 5. Third Command request: Rejection with Session scope MUST NOT auto-approve
    let req_cmd3 = ApprovalRequest {
        id: "req-cmd-3".to_string(),
        kind: ApprovalKind::Command,
        detail: "cargo build".to_string(),
    };
    match gate.request_approval(req_cmd3) {
        ApprovalOutcome::Blocked(_) => {
            // Correctly blocked
        }
        ApprovalOutcome::AllowedImmediately(_) => {
            panic!("Command after rejection must NOT be auto-allowed!")
        }
    }

    // 6. Double respond attempt on already resolved ID
    let err = gate.respond("req-cmd-1", true, ApprovalScope::Once);
    assert_eq!(
        err,
        Err(ApprovalError::AlreadyResolved("req-cmd-1".to_string()))
    );
    assert_eq!(
        err.unwrap_err().error_code(),
        "ERR_APPROVAL_ALREADY_RESOLVED"
    );

    // 7. Non-existent ID
    let err_not_found = gate.respond("req-ghost", true, ApprovalScope::Once);
    assert_eq!(
        err_not_found,
        Err(ApprovalError::NotFound("req-ghost".to_string()))
    );
    assert_eq!(
        err_not_found.unwrap_err().error_code(),
        "ERR_APPROVAL_NOT_FOUND"
    );
}

/// Stress test cancellation cleanup:
/// - 20 concurrent pending requests are cancelled at once.
/// - All 20 waiting receivers are immediately unblocked with dropped sender.
/// - Pending count drops to 0.
#[tokio::test]
async fn test_approval_gate_cancellation_cleanup() {
    let gate = Arc::new(InteractiveApprovalGate::new(ApprovalMode::Ask));

    const NUM_PENDING: usize = 20;
    let mut rx_handles = Vec::new();

    for i in 0..NUM_PENDING {
        let req = ApprovalRequest {
            id: format!("req-cancel-{}", i),
            kind: ApprovalKind::Command,
            detail: format!("cmd {}", i),
        };

        match gate.request_approval(req) {
            ApprovalOutcome::Blocked(rx) => {
                let h = tokio::spawn(async move {
                    // Waiting on rx
                    rx.await
                });
                rx_handles.push(h);
            }
            ApprovalOutcome::AllowedImmediately(_) => panic!("Should be blocked"),
        }
    }

    assert_eq!(gate.pending_count(), NUM_PENDING);

    // Execute cancellation
    let cancelled_ids = gate.cancel_all_pending();
    assert_eq!(cancelled_ids.len(), NUM_PENDING);
    assert_eq!(
        gate.pending_count(),
        0,
        "Pending count should be 0 after cancellation"
    );

    // Verify all 20 receivers were unblocked with RecvError (sender dropped)
    for h in rx_handles {
        let res = h.await.unwrap();
        assert!(
            res.is_err(),
            "Receiver should have returned error because sender channel was cancelled/dropped"
        );
    }
}

/// Stress test timeout handling:
/// - Awaiting approval with a timeout.
/// - Verify timeout fires as expected.
/// - Graceful handling when respond is invoked after timeout.
#[tokio::test]
async fn test_approval_gate_timeout_handling() {
    let gate = InteractiveApprovalGate::new(ApprovalMode::Ask);

    let req = ApprovalRequest {
        id: "req-timeout-1".to_string(),
        kind: ApprovalKind::Command,
        detail: "slow operation".to_string(),
    };

    match gate.request_approval(req) {
        ApprovalOutcome::Blocked(rx) => {
            assert_eq!(gate.pending_count(), 1);

            // Await with short timeout
            let timeout_res = tokio::time::timeout(Duration::from_millis(20), rx).await;
            assert!(
                timeout_res.is_err(),
                "Expected timeout to expire before response arrived"
            );

            // Even though the receiver timed out and was dropped, the engine/IDE can
            // respond or cancel cleanly without panicking.
            let res = gate.respond("req-timeout-1", true, ApprovalScope::Once);
            assert!(
                res.is_ok(),
                "Responding after receiver timeout should handle cleanly without panicking"
            );
            assert_eq!(gate.pending_count(), 0);
        }
        ApprovalOutcome::AllowedImmediately(_) => panic!("Should be blocked"),
    }
}
