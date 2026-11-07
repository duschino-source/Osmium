use std::path::{Path, PathBuf};
use std::sync::Arc;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::types::{
    AgentEvent, CheckpointSummary, CliId, CliUsageStats, FileChangeRecord, ProjectSummary,
    SessionState, SessionSummary, TeamworkRunState, TeamworkRunStatus, TeamworkTaskState,
    TeamworkTaskStatus,
};

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("SQLite internal error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Session not found: {0}")]
    SessionNotFound(String),
    #[error("Project not found: {0}")]
    ProjectNotFound(String),
    #[error("Teamwork run not found: {0}")]
    RunNotFound(String),
    #[error("Teamwork task not found: {0}")]
    TaskNotFound(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Storage migration failed: {0}")]
    Migration(String),
}

impl StorageError {
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::SessionNotFound(_) => "ERR_SESSION_NOT_FOUND",
            Self::ProjectNotFound(_) => "ERR_PROJECT_NOT_FOUND",
            Self::RunNotFound(_) => "ERR_RUN_NOT_FOUND",
            Self::TaskNotFound(_) => "ERR_TASK_NOT_FOUND",
            Self::Sqlite(_) => "ERR_SQLITE_EXEC",
            Self::Json(_) => "ERR_JSON_SERIALIZE",
            Self::Io(_) => "ERR_IO",
            Self::Migration(_) => "ERR_MIGRATION",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSessionEvent {
    pub id: i64,
    pub session_id: String,
    pub seq: i64,
    pub event_type: String,
    pub payload: AgentEvent,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceLayoutData {
    pub project_id: String,
    pub layout: serde_json::Value,
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    pub updated_at: i64,
}

#[derive(Clone)]
pub struct SqliteStorage {
    conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
}

impl SqliteStorage {
    pub async fn new<P: AsRef<Path>>(path: P) -> Result<Self, StorageError> {
        let db_path = path.as_ref().to_path_buf();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        };

        storage.init_schema().await?;
        Ok(storage)
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// Initializes WAL mode, busy timeout, foreign keys, and all 8 tables.
    pub async fn init_schema(&self) -> Result<(), StorageError> {
        let conn = self.conn.lock().await;

        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                root_path TEXT UNIQUE NOT NULL,
                primary_cli TEXT NOT NULL,
                secondary_clis_json TEXT NOT NULL DEFAULT '[]',
                approval_mode TEXT NOT NULL DEFAULT 'ask',
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                active_cli TEXT NOT NULL,
                provider_session_id TEXT,
                status TEXT NOT NULL,
                system_context TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_session_events_session_seq ON session_events(session_id, seq);

            CREATE TABLE IF NOT EXISTS checkpoints (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                turn_index INTEGER NOT NULL,
                git_ref TEXT NOT NULL,
                commit_sha TEXT NOT NULL,
                files_changed_json TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);

            CREATE TABLE IF NOT EXISTS teamwork_runs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                session_id TEXT,
                goal TEXT NOT NULL,
                orchestrator_cli TEXT NOT NULL,
                integration_branch TEXT NOT NULL,
                max_parallel INTEGER NOT NULL DEFAULT 2,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS teamwork_tasks (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                task_type TEXT NOT NULL,
                assigned_cli TEXT NOT NULL,
                status TEXT NOT NULL,
                scope_json TEXT NOT NULL DEFAULT '[]',
                dependencies_json TEXT NOT NULL DEFAULT '[]',
                worktree_path TEXT,
                branch_name TEXT,
                session_id TEXT,
                diff_added INTEGER NOT NULL DEFAULT 0,
                diff_removed INTEGER NOT NULL DEFAULT 0,
                out_of_scope_files_json TEXT NOT NULL DEFAULT '[]',
                error_message TEXT,
                started_at INTEGER,
                completed_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_teamwork_tasks_run ON teamwork_tasks(run_id);

            CREATE TABLE IF NOT EXISTS cli_usage (
                cli_id TEXT PRIMARY KEY,
                turns_run INTEGER NOT NULL DEFAULT 0,
                last_limit_hit_at INTEGER,
                last_note TEXT
            );

            CREATE TABLE IF NOT EXISTS workspace_layout (
                project_id TEXT PRIMARY KEY,
                layout_json TEXT NOT NULL DEFAULT '{}',
                open_tabs_json TEXT NOT NULL DEFAULT '[]',
                active_tab TEXT,
                updated_at INTEGER NOT NULL
            );
            "#,
        )?;

        Ok(())
    }

    // --- Projects ---

    pub async fn upsert_project(&self, proj: &ProjectSummary) -> Result<(), StorageError> {
        let conn = self.conn.lock().await;
        let secondaries = serde_json::to_string(&proj.secondary_clis)?;
        let mode_str = serde_json::to_value(&proj.approval_mode)?
            .as_str()
            .unwrap_or("ask")
            .to_string();

        conn.execute(
            r#"
            INSERT INTO projects (id, name, root_path, primary_cli, secondary_clis_json, approval_mode, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                root_path = excluded.root_path,
                primary_cli = excluded.primary_cli,
                secondary_clis_json = excluded.secondary_clis_json,
                approval_mode = excluded.approval_mode,
                updated_at = excluded.updated_at;
            "#,
            params![
                proj.id,
                proj.name,
                proj.root_path,
                proj.primary_cli.as_str(),
                secondaries,
                mode_str,
                proj.updated_at
            ],
        )?;
        Ok(())
    }

    pub async fn get_project(&self, id: &str) -> Result<Option<ProjectSummary>, StorageError> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, name, root_path, primary_cli, secondary_clis_json, approval_mode, updated_at
            FROM projects WHERE id = ?1;
            "#,
        )?;
        let mut rows = stmt.query(params![id])?;

        if let Some(row) = rows.next()? {
            let primary_str: String = row.get(3)?;
            let sec_json: String = row.get(4)?;
            let mode_str: String = row.get(5)?;
            let secondaries: Vec<CliId> = serde_json::from_str(&sec_json).unwrap_or_default();
            let approval_mode = serde_json::from_str(&format!("\"{}\"", mode_str)).unwrap_or_default();

            Ok(Some(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                primary_cli: CliId::from(primary_str),
                secondary_clis: secondaries,
                approval_mode,
                updated_at: row.get(6)?,
            }))
        } else {
            Ok(None)
        }
    }

    // --- Sessions ---

    pub async fn create_session(&self, sess: &SessionSummary) -> Result<SessionSummary, StorageError> {
        let conn = self.conn.lock().await;
        let status_str = serde_json::to_value(&sess.status)?
            .as_str()
            .unwrap_or("idle")
            .to_string();

        conn.execute(
            r#"
            INSERT INTO sessions (id, project_id, title, active_cli, provider_session_id, status, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);
            "#,
            params![
                sess.id,
                sess.project_id,
                sess.title,
                sess.active_cli.as_str(),
                sess.provider_session_id,
                status_str,
                sess.created_at,
                sess.updated_at
            ],
        )?;
        drop(conn);
        self.get_session(&sess.id).await?.ok_or_else(|| StorageError::SessionNotFound(sess.id.clone()))
    }

    pub async fn get_session(&self, id: &str) -> Result<Option<SessionSummary>, StorageError> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, project_id, title, active_cli, provider_session_id, status, created_at, updated_at
            FROM sessions WHERE id = ?1;
            "#,
        )?;
        let mut rows = stmt.query(params![id])?;

        if let Some(row) = rows.next()? {
            let active_cli_str: String = row.get(3)?;
            let status_str: String = row.get(5)?;
            let status: SessionState = serde_json::from_str(&format!("\"{}\"", status_str)).unwrap_or(SessionState::Idle);

            Ok(Some(SessionSummary {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                active_cli: CliId::from(active_cli_str),
                provider_session_id: row.get(4)?,
                status,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn list_sessions(&self, project_id: Option<&str>) -> Result<Vec<SessionSummary>, StorageError> {
        let conn = self.conn.lock().await;
        let mut list = Vec::new();
        if let Some(pid) = project_id {
            let mut stmt = conn.prepare(
                r#"
                SELECT id, project_id, title, active_cli, provider_session_id, status, created_at, updated_at
                FROM sessions WHERE project_id = ?1 ORDER BY updated_at DESC;
                "#,
            )?;
            let mut rows = stmt.query(params![pid])?;
            while let Some(row) = rows.next()? {
                let active_cli_str: String = row.get(3)?;
                let status_str: String = row.get(5)?;
                let status: SessionState = serde_json::from_str(&format!("\"{}\"", status_str)).unwrap_or(SessionState::Idle);
                list.push(SessionSummary {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    active_cli: CliId::from(active_cli_str),
                    provider_session_id: row.get(4)?,
                    status,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                });
            }
        } else {
            let mut stmt = conn.prepare(
                r#"
                SELECT id, project_id, title, active_cli, provider_session_id, status, created_at, updated_at
                FROM sessions ORDER BY updated_at DESC;
                "#,
            )?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let active_cli_str: String = row.get(3)?;
                let status_str: String = row.get(5)?;
                let status: SessionState = serde_json::from_str(&format!("\"{}\"", status_str)).unwrap_or(SessionState::Idle);
                list.push(SessionSummary {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    title: row.get(2)?,
                    active_cli: CliId::from(active_cli_str),
                    provider_session_id: row.get(4)?,
                    status,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                });
            }
        }
        Ok(list)
    }

    pub async fn update_session_status(
        &self,
        id: &str,
        status: &str,
        active_cli: Option<&str>,
    ) -> Result<SessionSummary, StorageError> {
        let conn = self.conn.lock().await;
        let now = Utc::now().timestamp_millis();

        let rows_affected = if let Some(cli) = active_cli {
            conn.execute(
                r#"
                UPDATE sessions SET status = ?1, active_cli = ?2, updated_at = ?3
                WHERE id = ?4;
                "#,
                params![status, cli, now, id],
            )?
        } else {
            conn.execute(
                r#"
                UPDATE sessions SET status = ?1, updated_at = ?2
                WHERE id = ?3;
                "#,
                params![status, now, id],
            )?
        };

        if rows_affected == 0 {
            return Err(StorageError::SessionNotFound(id.to_string()));
        }
        drop(conn);
        self.get_session(id).await?.ok_or_else(|| StorageError::SessionNotFound(id.to_string()))
    }

    // --- Events (seq 1..N with BEGIN IMMEDIATE) ---

    pub async fn append_session_event(
        &self,
        session_id: &str,
        event: &AgentEvent,
    ) -> Result<i64, StorageError> {
        let mut conn = self.conn.lock().await;

        // Ensure session exists
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1);",
            params![session_id],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(StorageError::SessionNotFound(session_id.to_string()));
        }

        // Use IMMEDIATE transaction for guaranteed atomic seq calculation
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let next_seq: i64 = tx.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_events WHERE session_id = ?1;",
            params![session_id],
            |r| r.get(0),
        )?;

        let now = Utc::now().timestamp_millis();
        let payload_json = serde_json::to_string(event)?;
        let event_type = event.event_type();

        tx.execute(
            r#"
            INSERT INTO session_events (session_id, seq, event_type, payload_json, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5);
            "#,
            params![session_id, next_seq, event_type, payload_json, now],
        )?;

        tx.commit()?;
        Ok(next_seq)
    }

    pub async fn get_session_events(
        &self,
        session_id: &str,
    ) -> Result<Vec<StoredSessionEvent>, StorageError> {
        let conn = self.conn.lock().await;

        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1);",
            params![session_id],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(StorageError::SessionNotFound(session_id.to_string()));
        }

        let mut stmt = conn.prepare(
            r#"
            SELECT id, session_id, seq, event_type, payload_json, created_at
            FROM session_events
            WHERE session_id = ?1
            ORDER BY seq ASC;
            "#,
        )?;

        let mut rows = stmt.query(params![session_id])?;
        let mut events = Vec::new();

        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let sess_id: String = row.get(1)?;
            let seq: i64 = row.get(2)?;
            let event_type: String = row.get(3)?;
            let payload_str: String = row.get(4)?;
            let created_at: i64 = row.get(5)?;

            let payload: AgentEvent = serde_json::from_str(&payload_str)?;
            events.push(StoredSessionEvent {
                id,
                session_id: sess_id,
                seq,
                event_type,
                payload,
                created_at,
            });
        }

        Ok(events)
    }

    // --- Crash Recovery ---

    /// Scans sessions on startup and marks interrupted working/waiting sessions as 'interrupted'.
    pub async fn recover_interrupted_sessions(&self) -> Result<Vec<String>, StorageError> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id FROM sessions WHERE status IN ('working', 'waiting') ORDER BY id ASC;"
        )?;
        let ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        if !ids.is_empty() {
            let now = Utc::now().timestamp_millis();
            conn.execute(
                "UPDATE sessions SET status = 'interrupted', updated_at = ?1 WHERE status IN ('working', 'waiting');",
                params![now],
            )?;
        }

        Ok(ids)
    }

    // --- Checkpoints ---

    pub async fn insert_checkpoint(&self, cp: &CheckpointSummary) -> Result<(), StorageError> {
        let conn = self.conn.lock().await;
        let files_json = serde_json::to_string(&cp.files_changed)?;

        conn.execute(
            r#"
            INSERT INTO checkpoints (id, session_id, turn_index, git_ref, commit_sha, files_changed_json, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                session_id = excluded.session_id,
                turn_index = excluded.turn_index,
                git_ref = excluded.git_ref,
                commit_sha = excluded.commit_sha,
                files_changed_json = excluded.files_changed_json,
                created_at = excluded.created_at;
            "#,
            params![
                cp.id,
                cp.session_id,
                cp.turn_index,
                cp.git_ref,
                cp.commit_sha,
                files_json,
                cp.created_at
            ],
        )?;
        Ok(())
    }

    pub async fn get_checkpoint(&self, id: &str) -> Result<Option<CheckpointSummary>, StorageError> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, session_id, turn_index, git_ref, commit_sha, files_changed_json, created_at
            FROM checkpoints WHERE id = ?1;
            "#,
        )?;
        let mut rows = stmt.query(params![id])?;

        if let Some(row) = rows.next()? {
            let files_json: String = row.get(5)?;
            let files_changed: Vec<FileChangeRecord> = serde_json::from_str(&files_json).unwrap_or_default();

            Ok(Some(CheckpointSummary {
                id: row.get(0)?,
                session_id: row.get(1)?,
                turn_index: row.get(2)?,
                git_ref: row.get(3)?,
                commit_sha: row.get(4)?,
                files_changed,
                created_at: row.get(6)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn list_checkpoints(&self, session_id: &str) -> Result<Vec<CheckpointSummary>, StorageError> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, session_id, turn_index, git_ref, commit_sha, files_changed_json, created_at
            FROM checkpoints WHERE session_id = ?1 ORDER BY turn_index ASC;
            "#,
        )?;
        let mut rows = stmt.query(params![session_id])?;
        let mut list = Vec::new();

        while let Some(row) = rows.next()? {
            let files_json: String = row.get(5)?;
            let files_changed: Vec<FileChangeRecord> = serde_json::from_str(&files_json).unwrap_or_default();
            list.push(CheckpointSummary {
                id: row.get(0)?,
                session_id: row.get(1)?,
                turn_index: row.get(2)?,
                git_ref: row.get(3)?,
                commit_sha: row.get(4)?,
                files_changed,
                created_at: row.get(6)?,
            });
        }

        Ok(list)
    }

    // --- Teamwork Runs & Tasks ---

    pub async fn upsert_teamwork_run(&self, run: &TeamworkRunState) -> Result<(), StorageError> {
        let conn = self.conn.lock().await;
        let status_str = serde_json::to_value(&run.status)?
            .as_str()
            .unwrap_or("running")
            .to_string();

        conn.execute(
            r#"
            INSERT INTO teamwork_runs (id, project_id, session_id, goal, orchestrator_cli, integration_branch, max_parallel, status, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                session_id = excluded.session_id,
                goal = excluded.goal,
                orchestrator_cli = excluded.orchestrator_cli,
                integration_branch = excluded.integration_branch,
                max_parallel = excluded.max_parallel,
                status = excluded.status,
                updated_at = excluded.updated_at;
            "#,
            params![
                run.id,
                run.project_id,
                run.session_id,
                run.goal,
                run.orchestrator_cli.as_str(),
                run.integration_branch,
                run.max_parallel,
                status_str,
                run.created_at,
                run.updated_at
            ],
        )?;

        // Also upsert all tasks
        for task in &run.tasks {
            let scope_json = serde_json::to_string(&task.scope)?;
            let deps_json = serde_json::to_string(&task.dependencies)?;
            let out_of_scope_json = serde_json::to_string(&task.out_of_scope_files)?;
            let task_status_str = serde_json::to_value(&task.status)?
                .as_str()
                .unwrap_or("queued")
                .to_string();

            conn.execute(
                r#"
                INSERT INTO teamwork_tasks (
                    id, run_id, title, description, task_type, assigned_cli, status,
                    scope_json, dependencies_json, worktree_path, branch_name, session_id,
                    diff_added, diff_removed, out_of_scope_files_json, error_message, started_at, completed_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
                ON CONFLICT(id) DO UPDATE SET
                    run_id = excluded.run_id,
                    title = excluded.title,
                    description = excluded.description,
                    task_type = excluded.task_type,
                    assigned_cli = excluded.assigned_cli,
                    status = excluded.status,
                    scope_json = excluded.scope_json,
                    dependencies_json = excluded.dependencies_json,
                    worktree_path = excluded.worktree_path,
                    branch_name = excluded.branch_name,
                    session_id = excluded.session_id,
                    diff_added = excluded.diff_added,
                    diff_removed = excluded.diff_removed,
                    out_of_scope_files_json = excluded.out_of_scope_files_json,
                    error_message = excluded.error_message,
                    started_at = excluded.started_at,
                    completed_at = excluded.completed_at;
                "#,
                params![
                    task.id,
                    task.run_id,
                    task.title,
                    task.description,
                    task.task_type,
                    task.assigned_cli.as_str(),
                    task_status_str,
                    scope_json,
                    deps_json,
                    task.worktree_path,
                    task.branch_name,
                    task.session_id,
                    task.diff_added,
                    task.diff_removed,
                    out_of_scope_json,
                    task.error_message,
                    task.started_at,
                    task.completed_at
                ],
            )?;
        }

        Ok(())
    }

    pub async fn get_teamwork_tasks(&self, run_id: &str) -> Result<Vec<TeamworkTaskState>, StorageError> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, run_id, title, description, task_type, assigned_cli, status,
                   scope_json, dependencies_json, worktree_path, branch_name, session_id,
                   diff_added, diff_removed, out_of_scope_files_json, error_message, started_at, completed_at
            FROM teamwork_tasks WHERE run_id = ?1 ORDER BY rowid ASC;
            "#,
        )?;
        let mut rows = stmt.query(params![run_id])?;
        let mut tasks = Vec::new();

        while let Some(row) = rows.next()? {
            let cli_str: String = row.get(5)?;
            let status_str: String = row.get(6)?;
            let scope_json: String = row.get(7)?;
            let deps_json: String = row.get(8)?;
            let out_of_scope_json: String = row.get(14)?;

            let status: TeamworkTaskStatus = serde_json::from_str(&format!("\"{}\"", status_str)).unwrap_or(TeamworkTaskStatus::Queued);
            let scope: Vec<String> = serde_json::from_str(&scope_json).unwrap_or_default();
            let dependencies: Vec<String> = serde_json::from_str(&deps_json).unwrap_or_default();
            let out_of_scope_files: Vec<String> = serde_json::from_str(&out_of_scope_json).unwrap_or_default();

            tasks.push(TeamworkTaskState {
                id: row.get(0)?,
                run_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                task_type: row.get(4)?,
                assigned_cli: CliId::from(cli_str),
                status,
                scope,
                dependencies,
                worktree_path: row.get(9)?,
                branch_name: row.get(10)?,
                session_id: row.get(11)?,
                diff_added: row.get(12)?,
                diff_removed: row.get(13)?,
                out_of_scope_files,
                error_message: row.get(15)?,
                started_at: row.get(16)?,
                completed_at: row.get(17)?,
            });
        }

        Ok(tasks)
    }

    pub async fn get_teamwork_run(&self, id: &str) -> Result<Option<TeamworkRunState>, StorageError> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, project_id, session_id, goal, orchestrator_cli, integration_branch, max_parallel, status, created_at, updated_at
            FROM teamwork_runs WHERE id = ?1;
            "#,
        )?;
        let mut rows = stmt.query(params![id])?;

        let maybe_run = if let Some(row) = rows.next()? {
            let run_id: String = row.get(0)?;
            let project_id: String = row.get(1)?;
            let session_id: Option<String> = row.get(2)?;
            let goal: String = row.get(3)?;
            let cli_str: String = row.get(4)?;
            let integration_branch: String = row.get(5)?;
            let max_parallel: u32 = row.get(6)?;
            let status_str: String = row.get(7)?;
            let status: TeamworkRunStatus = serde_json::from_str(&format!("\"{}\"", status_str)).unwrap_or(TeamworkRunStatus::Running);
            let created_at: i64 = row.get(8)?;
            let updated_at: i64 = row.get(9)?;

            Some((run_id, project_id, session_id, goal, cli_str, integration_branch, max_parallel, status, created_at, updated_at))
        } else {
            None
        };

        drop(rows);
        drop(stmt);
        drop(conn);

        if let Some((run_id, project_id, session_id, goal, cli_str, integration_branch, max_parallel, status, created_at, updated_at)) = maybe_run {
            let tasks = self.get_teamwork_tasks(&run_id).await?;
            Ok(Some(TeamworkRunState {
                id: run_id,
                project_id,
                session_id,
                goal,
                orchestrator_cli: CliId::from(cli_str),
                integration_branch,
                max_parallel,
                status,
                tasks,
                created_at,
                updated_at,
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn list_active_teamwork_runs(&self) -> Result<Vec<TeamworkRunState>, StorageError> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id FROM teamwork_runs WHERE status IN ('planning', 'running', 'review') ORDER BY updated_at DESC;"
        )?;
        let run_ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        drop(conn);

        let mut runs = Vec::new();
        for id in run_ids {
            if let Some(r) = self.get_teamwork_run(&id).await? {
                runs.push(r);
            }
        }
        Ok(runs)
    }

    pub async fn update_task_status(
        &self,
        task_id: &str,
        run_id: &str,
        status: TeamworkTaskStatus,
    ) -> Result<(), StorageError> {
        let conn = self.conn.lock().await;
        let status_str = serde_json::to_value(&status)?
            .as_str()
            .unwrap_or("queued")
            .to_string();

        let rows = conn.execute(
            "UPDATE teamwork_tasks SET status = ?1 WHERE id = ?2 AND run_id = ?3;",
            params![status_str, task_id, run_id],
        )?;

        if rows == 0 {
            return Err(StorageError::TaskNotFound(task_id.to_string()));
        }

        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE teamwork_runs SET updated_at = ?1 WHERE id = ?2;",
            params![now, run_id],
        )?;

        Ok(())
    }

    // --- Quota & Usage ---

    pub async fn record_cli_turn_usage(
        &self,
        cli_id: &str,
        limit_hit: bool,
        note: Option<&str>,
    ) -> Result<CliUsageStats, StorageError> {
        let conn = self.conn.lock().await;
        let now = Utc::now().timestamp_millis();

        conn.execute(
            r#"
            INSERT INTO cli_usage (cli_id, turns_run, last_limit_hit_at, last_note)
            VALUES (?1, 1, CASE WHEN ?2 THEN ?3 ELSE NULL END, ?4)
            ON CONFLICT(cli_id) DO UPDATE SET
                turns_run = cli_usage.turns_run + 1,
                last_limit_hit_at = CASE WHEN ?2 THEN ?3 ELSE cli_usage.last_limit_hit_at END,
                last_note = CASE WHEN ?4 IS NOT NULL THEN ?4 ELSE cli_usage.last_note END;
            "#,
            params![cli_id, limit_hit, now, note],
        )?;

        drop(conn);
        self.get_cli_usage(cli_id).await
    }

    pub async fn get_cli_usage(&self, cli_id: &str) -> Result<CliUsageStats, StorageError> {
        let conn = self.conn.lock().await;
        let row = conn.query_row(
            "SELECT cli_id, turns_run, last_limit_hit_at, last_note FROM cli_usage WHERE cli_id = ?1;",
            params![cli_id],
            |r| {
                let id_str: String = r.get(0)?;
                let turns: u64 = r.get(1)?;
                let last_hit: Option<i64> = r.get(2)?;
                let note: Option<String> = r.get(3)?;
                Ok(CliUsageStats {
                    cli_id: CliId::from(id_str),
                    turns_run: turns,
                    last_limit_hit_at: last_hit,
                    last_note: note,
                })
            },
        ).optional()?;

        Ok(row.unwrap_or(CliUsageStats {
            cli_id: CliId::from(cli_id),
            turns_run: 0,
            last_limit_hit_at: None,
            last_note: None,
        }))
    }

    // --- Workspace Layout ---

    pub async fn save_workspace_layout(
        &self,
        project_id: &str,
        layout: &serde_json::Value,
        open_tabs: &[String],
        active_tab: Option<&str>,
    ) -> Result<(), StorageError> {
        let conn = self.conn.lock().await;
        let now = Utc::now().timestamp_millis();
        let layout_str = serde_json::to_string(layout)?;
        let tabs_str = serde_json::to_string(open_tabs)?;

        conn.execute(
            r#"
            INSERT INTO workspace_layout (project_id, layout_json, open_tabs_json, active_tab, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(project_id) DO UPDATE SET
                layout_json = excluded.layout_json,
                open_tabs_json = excluded.open_tabs_json,
                active_tab = excluded.active_tab,
                updated_at = excluded.updated_at;
            "#,
            params![project_id, layout_str, tabs_str, active_tab, now],
        )?;
        Ok(())
    }

    pub async fn get_workspace_layout(&self, project_id: &str) -> Result<Option<WorkspaceLayoutData>, StorageError> {
        let conn = self.conn.lock().await;
        let row = conn.query_row(
            "SELECT project_id, layout_json, open_tabs_json, active_tab, updated_at FROM workspace_layout WHERE project_id = ?1;",
            params![project_id],
            |r| {
                let pid: String = r.get(0)?;
                let layout_json: String = r.get(1)?;
                let tabs_json: String = r.get(2)?;
                let active: Option<String> = r.get(3)?;
                let updated: i64 = r.get(4)?;
                Ok((pid, layout_json, tabs_json, active, updated))
            },
        ).optional()?;

        match row {
            Some((pid, l_str, t_str, active, updated)) => {
                let layout: serde_json::Value = serde_json::from_str(&l_str)?;
                let open_tabs: Vec<String> = serde_json::from_str(&t_str)?;
                Ok(Some(WorkspaceLayoutData {
                    project_id: pid,
                    layout,
                    open_tabs,
                    active_tab: active,
                    updated_at: updated,
                }))
            }
            None => Ok(None),
        }
    }
}
