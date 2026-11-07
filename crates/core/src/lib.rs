pub mod approval;
pub mod boundary;
pub mod checkpoint;
pub mod quota;
pub mod schemas;
pub mod session;
pub mod storage;
pub mod teamwork;
pub mod types;

// Convenient top-level re-exports
pub use approval::{
    ApprovalDecision, ApprovalError, ApprovalKind, ApprovalOutcome, ApprovalRequest, ApprovalScope,
    InteractiveApprovalGate,
};
pub use boundary::{
    assert_workspace_write_allowed, is_path_inside_workspace, normalize_lexical,
    resolve_relative_or_absolute, BoundaryError,
};
pub use checkpoint::{
    create_checkpoint, get_checkpoint_diff, list_checkpoints, undo_checkpoint, CheckpointDiff,
    CheckpointError, CheckpointUndoResult, DiffFileSummary,
};
pub use quota::{FallbackOutcome, QuotaError, QuotaFallbackPolicy, QuotaTracker};
pub use schemas::{
    parse_project_config_yaml, stringify_project_config_yaml, ExtensionContributes,
    ExtensionManifest, ExtensionPermission, FallbackConfig, OnQuotaHit, PlannedTask,
    ProjectConfig, RoutingRule, SchemaError, TeamworkConfig, TeamworkPlan, ThemeContribution,
    UiThemeKind,
};
pub use session::{
    build_handoff_system_context, ActiveSession, SessionBroadcastEvent, SessionError, SessionManager,
};
pub use storage::{SqliteStorage, StorageError, StoredSessionEvent, WorkspaceLayoutData};
pub use teamwork::{
    cleanup_task_worktree, create_task_worktree, detect_out_of_scope_edits,
    get_teamwork_board_state, merge_task_into_integration, recover_teamwork_state_on_startup,
    validate_task_dag_no_cycles, MergeTaskResult, ScopeCheckResult, TeamworkBoardState,
    TeamworkColumns, TeamworkError, TeamworkScheduler,
};
pub use types::*;
