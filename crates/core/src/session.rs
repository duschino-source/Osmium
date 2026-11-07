use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::{broadcast, oneshot, RwLock};

use crate::approval::{
    ApprovalDecision, ApprovalError, ApprovalScope, InteractiveApprovalGate,
};
use crate::quota::QuotaTracker;
use crate::storage::{SqliteStorage, StorageError, StoredSessionEvent};
use crate::types::{
    AgentEvent, ApprovalMode, CliId, MessageRole, SessionState, SessionSummary, ToolStatus,
};

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("Storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("Session is already running a turn: {0}")]
    AlreadyRunning(String),
    #[error("Cannot switch CLI while approval(s) are pending")]
    PendingApprovalOnSwitch,
    #[error("Session not found: {0}")]
    NotFound(String),
    #[error("Adapter execution error: {0}")]
    Adapter(String),
    #[error("Session was cancelled: {0}")]
    Cancelled(String),
    #[error("Approval error: {0}")]
    Approval(#[from] ApprovalError),
}

impl SessionError {
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::PendingApprovalOnSwitch => "ERR_PENDING_APPROVAL_ON_SWITCH",
            Self::AlreadyRunning(_) => "ERR_SESSION_ALREADY_RUNNING",
            Self::NotFound(_) => "ERR_SESSION_NOT_FOUND",
            Self::Cancelled(_) => "ERR_SESSION_CANCELLED",
            Self::Storage(e) => e.error_code(),
            Self::Adapter(_) => "ERR_ADAPTER_EXEC",
            Self::Approval(e) => e.error_code(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionBroadcastEvent {
    pub session_id: String,
    pub seq: i64,
    pub event: AgentEvent,
}

/// Synthesizes cumulative turn events into the standard Osmium mid-session handoff format.
pub fn build_handoff_system_context(
    events: &[StoredSessionEvent],
    from_cli: &str,
    to_cli: &str,
) -> String {
    let mut user_prompts = Vec::new();
    let mut assistant_replies = Vec::new();
    let mut edited_files = Vec::new();
    let mut tools_run = Vec::new();

    for ev in events {
        match &ev.payload {
            AgentEvent::Message { role, text, final_ } => {
                if *role == MessageRole::User {
                    user_prompts.push(text.as_str());
                } else if *role == MessageRole::Assistant && *final_ {
                    assistant_replies.push(text.as_str());
                }
            }
            AgentEvent::FileEdit { path, added, removed } => {
                edited_files.push(format!("{path} (+{added} -{removed})"));
            }
            AgentEvent::Tool { name, summary, status, .. } => {
                if *status == ToolStatus::Done {
                    tools_run.push(format!("{name}: {}", summary.as_deref().unwrap_or("ok")));
                }
            }
            _ => {}
        }
    }

    let prompts_str = if user_prompts.is_empty() {
        "none".to_string()
    } else {
        user_prompts.join(" | ")
    };

    let replies_str = if assistant_replies.is_empty() {
        "none".to_string()
    } else {
        assistant_replies.join(" | ")
    };

    let files_str = if edited_files.is_empty() {
        "none".to_string()
    } else {
        edited_files.join(", ")
    };

    let tools_str = if tools_run.is_empty() {
        "none".to_string()
    } else {
        tools_run.join("; ")
    };

    format!(
        "[Osmium Mid-Session Handoff: {from_cli} -> {to_cli}]\n\
         User prompts: {prompts_str}\n\
         Previous assistant summary: {replies_str}\n\
         Edited files: {files_str}\n\
         Tools executed: {tools_str}"
    )
}

pub struct ActiveSession {
    pub summary: SessionSummary,
    pub state: SessionState,
    pub approval_gate: Arc<InteractiveApprovalGate>,
    pub cancel_sender: Option<oneshot::Sender<()>>,
}

pub struct SessionManager {
    storage: SqliteStorage,
    event_bus: broadcast::Sender<SessionBroadcastEvent>,
    active_sessions: Arc<RwLock<HashMap<String, ActiveSession>>>,
    quota_tracker: Arc<QuotaTracker>,
}

impl SessionManager {
    pub fn new(storage: SqliteStorage, quota_tracker: Arc<QuotaTracker>) -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self {
            storage,
            event_bus: tx,
            active_sessions: Arc::new(RwLock::new(HashMap::new())),
            quota_tracker,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionBroadcastEvent> {
        self.event_bus.subscribe()
    }

    pub fn storage(&self) -> &SqliteStorage {
        &self.storage
    }

    pub fn quota_tracker(&self) -> &Arc<QuotaTracker> {
        &self.quota_tracker
    }

    pub async fn start_session(
        &self,
        id: &str,
        project_id: &str,
        title: &str,
        active_cli: &str,
        approval_mode: ApprovalMode,
    ) -> Result<SessionSummary, SessionError> {
        let now = chrono::Utc::now().timestamp_millis();
        let summary = SessionSummary {
            id: id.to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            active_cli: CliId::from(active_cli),
            provider_session_id: None,
            status: SessionState::Idle,
            created_at: now,
            updated_at: now,
        };

        let created = self.storage.create_session(&summary).await?;
        let gate = Arc::new(InteractiveApprovalGate::new(approval_mode));

        let active = ActiveSession {
            summary: created.clone(),
            state: SessionState::Idle,
            approval_gate: gate,
            cancel_sender: None,
        };

        self.active_sessions.write().await.insert(id.to_string(), active);
        Ok(created)
    }

    pub async fn get_session(&self, id: &str) -> Result<Option<SessionSummary>, SessionError> {
        let sess = self.storage.get_session(id).await?;
        Ok(sess)
    }

    pub async fn list_sessions(&self, project_id: Option<&str>) -> Result<Vec<SessionSummary>, SessionError> {
        let list = self.storage.list_sessions(project_id).await?;
        Ok(list)
    }

    pub async fn get_session_events(&self, session_id: &str) -> Result<Vec<StoredSessionEvent>, SessionError> {
        let evs = self.storage.get_session_events(session_id).await?;
        Ok(evs)
    }

    /// Appends event to SQLite, broadcasts on bus, and tracks quota/usage.
    pub async fn emit_event(&self, session_id: &str, event: AgentEvent) -> Result<i64, SessionError> {
        let seq = self.storage.append_session_event(session_id, &event).await?;
        let _ = self.event_bus.send(SessionBroadcastEvent {
            session_id: session_id.to_string(),
            seq,
            event: event.clone(),
        });

        // Trigger quota listener on Usage events
        if let AgentEvent::Usage { limit_hit, note } = &event {
            let active_cli = {
                let map = self.active_sessions.read().await;
                map.get(session_id).map(|s| s.summary.active_cli.to_string())
            };
            if let Some(cli) = active_cli {
                let _ = self.quota_tracker
                    .record_turn_usage(&cli, limit_hit.unwrap_or(false), note.as_deref())
                    .await;
            }
        }

        Ok(seq)
    }

    /// Responds to a blocked approval request in the session's gate.
    pub async fn respond_to_approval(
        &self,
        session_id: &str,
        approval_id: &str,
        allow: bool,
        scope: ApprovalScope,
    ) -> Result<ApprovalDecision, SessionError> {
        let gate = {
            let map = self.active_sessions.read().await;
            let sess = map.get(session_id).ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;
            sess.approval_gate.clone()
        };

        let decision = gate.respond(approval_id, allow, scope)?;
        let next_status = if allow { "working" } else { "idle" };
        self.storage.update_session_status(session_id, next_status, None).await?;

        Ok(decision)
    }

    /// Cancels an active session cleanly, setting state to idle and notifying listeners.
    pub async fn cancel_session(&self, session_id: &str) -> Result<SessionSummary, SessionError> {
        let mut map = self.active_sessions.write().await;
        let sess = map.get_mut(session_id).ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        // Cancel any pending approval requests
        sess.approval_gate.cancel_all_pending();

        // Signal abort channel if active
        if let Some(cancel_tx) = sess.cancel_sender.take() {
            let _ = cancel_tx.send(());
        }

        sess.state = SessionState::Idle;
        drop(map);

        // Record status event
        self.emit_event(
            session_id,
            AgentEvent::Status {
                state: SessionState::Idle,
                message: Some("Cancelled by user".to_string()),
            },
        ).await?;

        let updated = self.storage.update_session_status(session_id, "idle", None).await?;
        Ok(updated)
    }

    /// Switches CLI mid-session, enforcing pending approval guard and building handoff summary.
    pub async fn switch_cli(
        &self,
        session_id: &str,
        target_cli: &str,
    ) -> Result<(SessionSummary, String), SessionError> {
        let mut map = self.active_sessions.write().await;
        let sess = map.get_mut(session_id).ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        // Feature 10 / Tier 2 check: Cannot switch while approvals are pending
        if sess.approval_gate.pending_count() > 0 {
            return Err(SessionError::PendingApprovalOnSwitch);
        }

        let from_cli = sess.summary.active_cli.to_string();
        sess.summary.active_cli = CliId::from(target_cli);
        drop(map);

        let events = self.storage.get_session_events(session_id).await?;
        let handoff_summary = build_handoff_system_context(&events, &from_cli, target_cli);

        // Emit handoff tool event
        self.emit_event(
            session_id,
            AgentEvent::Tool {
                id: format!("handoff-{target_cli}-{}", chrono::Utc::now().timestamp_millis()),
                name: "cli-handoff".to_string(),
                status: ToolStatus::Done,
                summary: Some(format!("Switched from {from_cli} to {target_cli}")),
                duration_sec: None,
            },
        ).await?;

        let updated = self.storage.update_session_status(session_id, "working", Some(target_cli)).await?;
        Ok((updated, handoff_summary))
    }
}
