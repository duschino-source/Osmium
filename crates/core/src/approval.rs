use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::oneshot;

use crate::types::ApprovalMode;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ApprovalError {
    #[error("Unknown approval request ID: {0}")]
    NotFound(String),
    #[error("Approval request {0} was already resolved")]
    AlreadyResolved(String),
    #[error("Approval request {0} was cancelled")]
    Cancelled(String),
}

impl ApprovalError {
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "ERR_APPROVAL_NOT_FOUND",
            Self::AlreadyResolved(_) => "ERR_APPROVAL_ALREADY_RESOLVED",
            Self::Cancelled(_) => "ERR_APPROVAL_CANCELLED",
        }
    }
}

pub use crate::types::ApprovalKind;
pub use crate::types::ApprovalScope;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub kind: ApprovalKind,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecision {
    pub id: String,
    pub kind: ApprovalKind,
    pub allowed: bool,
    pub scope: ApprovalScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto: Option<String>,
}

pub enum ApprovalOutcome {
    AllowedImmediately(ApprovalDecision),
    Blocked(oneshot::Receiver<ApprovalDecision>),
}

pub struct InteractiveApprovalGate {
    mode: RwLock<ApprovalMode>,
    pending: RwLock<HashMap<String, (ApprovalRequest, oneshot::Sender<ApprovalDecision>)>>,
    session_allowed_kinds: RwLock<HashSet<ApprovalKind>>,
    history: RwLock<Vec<ApprovalDecision>>,
}

impl InteractiveApprovalGate {
    pub fn new(mode: ApprovalMode) -> Self {
        Self {
            mode: RwLock::new(mode),
            pending: RwLock::new(HashMap::new()),
            session_allowed_kinds: RwLock::new(HashSet::new()),
            history: RwLock::new(Vec::new()),
        }
    }

    pub fn mode(&self) -> ApprovalMode {
        *self.mode.read().unwrap()
    }

    pub fn set_mode(&self, mode: ApprovalMode) {
        *self.mode.write().unwrap() = mode;
    }

    pub fn pending_count(&self) -> usize {
        self.pending.read().unwrap().len()
    }

    /// Evaluates incoming approval request. If auto-approved, returns immediately;
    /// otherwise creates an async oneshot channel and registers in pending.
    pub fn request_approval(&self, req: ApprovalRequest) -> ApprovalOutcome {
        let current_mode = *self.mode.read().unwrap();

        // Check full-auto
        if current_mode == ApprovalMode::FullAuto {
            let decision = ApprovalDecision {
                id: req.id.clone(),
                kind: req.kind,
                allowed: true,
                scope: ApprovalScope::Once,
                auto: Some("full-auto".to_string()),
            };
            self.history.write().unwrap().push(decision.clone());
            return ApprovalOutcome::AllowedImmediately(decision);
        }

        // Check auto-edit for edits
        if current_mode == ApprovalMode::AutoEdit && req.kind == ApprovalKind::Edit {
            let decision = ApprovalDecision {
                id: req.id.clone(),
                kind: req.kind,
                allowed: true,
                scope: ApprovalScope::Once,
                auto: Some("auto-edit".to_string()),
            };
            self.history.write().unwrap().push(decision.clone());
            return ApprovalOutcome::AllowedImmediately(decision);
        }

        // Check session-scope allow cache (only for same kind!)
        if self.session_allowed_kinds.read().unwrap().contains(&req.kind) {
            let decision = ApprovalDecision {
                id: req.id.clone(),
                kind: req.kind,
                allowed: true,
                scope: ApprovalScope::Session,
                auto: Some("session-scope".to_string()),
            };
            self.history.write().unwrap().push(decision.clone());
            return ApprovalOutcome::AllowedImmediately(decision);
        }

        // Must block on user approval
        let (tx, rx) = oneshot::channel();
        self.pending.write().unwrap().insert(req.id.clone(), (req, tx));
        ApprovalOutcome::Blocked(rx)
    }

    /// Responds to a pending approval request. Unblocks waiting receiver.
    pub fn respond(
        &self,
        id: &str,
        allow: bool,
        scope: ApprovalScope,
    ) -> Result<ApprovalDecision, ApprovalError> {
        let entry = self.pending.write().unwrap().remove(id);
        let (req, tx) = entry.ok_or_else(|| {
            // Check if it was already resolved
            let hist = self.history.read().unwrap();
            if hist.iter().any(|d| d.id == id) {
                ApprovalError::AlreadyResolved(id.to_string())
            } else {
                ApprovalError::NotFound(id.to_string())
            }
        })?;

        if allow && scope == ApprovalScope::Session {
            self.session_allowed_kinds.write().unwrap().insert(req.kind);
        }

        let decision = ApprovalDecision {
            id: id.to_string(),
            kind: req.kind,
            allowed: allow,
            scope,
            auto: None,
        };

        self.history.write().unwrap().push(decision.clone());
        let _ = tx.send(decision.clone());
        Ok(decision)
    }

    /// Cancels all pending requests, dropping channels with ERR_APPROVAL_CANCELLED.
    pub fn cancel_all_pending(&self) -> Vec<String> {
        let mut map = self.pending.write().unwrap();
        let ids: Vec<String> = map.keys().cloned().collect();
        map.clear();
        ids
    }
}
