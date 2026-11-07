//! Host state and request dispatch.
//!
//! All adapter work happens outside any long-lived lock: the session map is
//! only locked long enough to clone or insert an `Arc`, so a slow `start`
//! probe never blocks `ping`, `detectAll`, or another `start`.

use crate::protocol::{
    parse_params, session_ended_notification, session_event_notification, ApprovalParams,
    CliParams, RpcError, SendParams, SessionParams, StartParams, HOST_VERSION,
};
use futures::future::join_all;
use osmium_adapters::{
    AdapterError, AgentEvent, Capabilities, CliAdapter, CliDetectionResult, CliId,
};
use osmium_core::types::{AgentSession, StartOptions};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::Mutex;

/// Metadata kept alongside a session for `listSessions`.
struct SessionMetadata {
    cli_id: String,
    cwd: String,
    started_at: i64,
}

pub struct HostState {
    adapters: Vec<Arc<dyn CliAdapter>>,
    /// The canonical session store mandated by the bridge contract.
    sessions: Mutex<HashMap<String, Arc<dyn AgentSession>>>,
    /// Metadata for `listSessions`, kept separate so the session store has the
    /// exact shape the contract specifies.
    metadata: Mutex<HashMap<String, SessionMetadata>>,
    /// Closed session ids are terminal: `send`, `cancel` and approval calls on
    /// them report `ERR_ADAPTER_SESSION_CLOSED`, not "not found".
    closed_sessions: Mutex<HashSet<String>>,
    out_tx: UnboundedSender<String>,
}

impl HostState {
    pub fn new(adapters: Vec<Arc<dyn CliAdapter>>, out_tx: UnboundedSender<String>) -> Self {
        Self {
            adapters,
            sessions: Mutex::new(HashMap::new()),
            metadata: Mutex::new(HashMap::new()),
            closed_sessions: Mutex::new(HashSet::new()),
            out_tx,
        }
    }

    /// Serializes and queues one protocol line for the stdout writer task.
    pub fn enqueue(&self, value: &Value) {
        enqueue_json(&self.out_tx, value);
    }

    pub async fn dispatch(&self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "ping" => Ok(json!({ "ok": true, "version": HOST_VERSION })),
            "detectAll" => self.detect_all().await,
            "detect" => self.detect(params).await,
            "capabilities" => self.capabilities(params).await,
            "getUsage" => Ok(json!([])),
            "start" => self.start(params).await,
            "send" => self.send(params).await,
            "respondToApproval" => self.respond_to_approval(params).await,
            "cancel" => self.cancel(params).await,
            "close" => self.close(params).await,
            "listSessions" => self.list_sessions().await,
            _ => Err(RpcError::unknown_method(method)),
        }
    }

    /// Closes every live session concurrently. Used by shutdown and stdin EOF.
    pub async fn close_all(&self) {
        let sessions: Vec<(String, Arc<dyn AgentSession>)> = {
            let mut sessions = self.sessions.lock().await;
            sessions.drain().collect()
        };
        self.metadata.lock().await.clear();
        {
            let mut closed = self.closed_sessions.lock().await;
            for (session_id, _) in &sessions {
                closed.insert(session_id.clone());
            }
        }

        let closes = sessions
            .into_iter()
            .map(|(session_id, session)| async move {
                if let Err(error) = session.close().await {
                    eprintln!("[adapter-host] failed to close session {session_id}: {error}");
                }
            });
        join_all(closes).await;
    }

    fn adapter_for(&self, cli_id: &str) -> Result<Arc<dyn CliAdapter>, RpcError> {
        let id = CliId::from(cli_id);
        self.adapters
            .iter()
            .find(|adapter| adapter.id() == &id)
            .cloned()
            .ok_or_else(|| RpcError::bad_request(format!("Unknown cliId: {cli_id}")))
    }

    async fn detect_all(&self) -> Result<Value, RpcError> {
        let probes = self.adapters.iter().cloned().map(|adapter| async move {
            let (detection, capabilities) = tokio::join!(adapter.detect(), adapter.capabilities());
            (adapter.id().as_str().to_string(), detection, capabilities)
        });
        let results = join_all(probes).await;

        let mut map = serde_json::Map::new();
        for (cli_id, detection, capabilities) in results {
            let detection = detection.unwrap_or_else(|error| {
                eprintln!("[adapter-host] detect({cli_id}) failed: {error}");
                CliDetectionResult {
                    installed: false,
                    version: None,
                    path: None,
                    version_warning: Some(format!("Detection failed: {error}")),
                }
            });
            // A failed capability probe for one CLI must not fail the response.
            let mut capabilities = capabilities.unwrap_or_else(|error| {
                eprintln!("[adapter-host] capabilities({cli_id}) failed: {error}");
                Capabilities::default()
            });
            // Never advertise capabilities for a CLI that is not installed:
            // some adapters keep static capability tables. The UI must render
            // "not installed", not a phantom feature list.
            if !detection.installed {
                capabilities = Capabilities::default();
            }
            map.insert(cli_id, merge_detection(&detection, &capabilities));
        }
        Ok(Value::Object(map))
    }

    async fn detect(&self, params: &Value) -> Result<Value, RpcError> {
        let params: CliParams = parse_params(params, "detect")?;
        let adapter = self.adapter_for(&params.cli_id)?;
        let detection = adapter
            .detect()
            .await
            .map_err(|error| RpcError::from_anyhow(&error))?;
        to_value(detection)
    }

    async fn capabilities(&self, params: &Value) -> Result<Value, RpcError> {
        let params: CliParams = parse_params(params, "capabilities")?;
        let adapter = self.adapter_for(&params.cli_id)?;
        let capabilities = adapter
            .capabilities()
            .await
            .map_err(|error| RpcError::from_anyhow(&error))?;
        to_value(capabilities)
    }

    async fn start(&self, params: &Value) -> Result<Value, RpcError> {
        let params: StartParams = parse_params(params, "start")?;
        let adapter = self.adapter_for(&params.cli_id)?;
        let opts = StartOptions {
            cwd: params.cwd.clone(),
            approval_mode: params.approval_mode.unwrap_or_default(),
            resume: params.resume,
            system_context: params.system_context,
            read_only: params.read_only,
        };

        let mut session = adapter
            .start(opts)
            .await
            .map_err(|error| RpcError::from_anyhow(&error))?;
        let session_id = session.id().to_string();
        let events = session.take_event_receiver().ok_or_else(|| {
            RpcError::from_adapter(AdapterError::Protocol(
                "adapter session did not expose an event receiver".to_string(),
            ))
        })?;

        let session: Arc<dyn AgentSession> = Arc::from(session);
        let metadata = SessionMetadata {
            cli_id: params.cli_id.clone(),
            cwd: params.cwd.clone(),
            started_at: now_millis(),
        };
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), session);
        self.metadata
            .lock()
            .await
            .insert(session_id.clone(), metadata);

        // The forwarded events are the only way the client sees this session.
        self.forward_events(&session_id, events);

        Ok(json!({
            "sessionId": session_id,
            "cliId": params.cli_id,
            "cwd": params.cwd,
        }))
    }

    async fn send(&self, params: &Value) -> Result<Value, RpcError> {
        let params: SendParams = parse_params(params, "send")?;
        let session = self.lookup(&params.session_id).await?;
        let attachments: Vec<PathBuf> = params.attachments.into_iter().map(PathBuf::from).collect();
        let attachments = if attachments.is_empty() {
            None
        } else {
            Some(attachments.as_slice())
        };
        session
            .send(&params.prompt, attachments)
            .await
            .map_err(|error| RpcError::from_anyhow(&error))?;
        Ok(json!({}))
    }

    async fn respond_to_approval(&self, params: &Value) -> Result<Value, RpcError> {
        let params: ApprovalParams = parse_params(params, "respondToApproval")?;
        let session = self.lookup(&params.session_id).await?;
        session
            .respond_to_approval(&params.approval_id, params.allow, params.scope)
            .await
            .map_err(|error| RpcError::from_anyhow(&error))?;
        Ok(json!({}))
    }

    async fn cancel(&self, params: &Value) -> Result<Value, RpcError> {
        let params: SessionParams = parse_params(params, "cancel")?;
        let session = self.lookup(&params.session_id).await?;
        session
            .cancel()
            .await
            .map_err(|error| RpcError::from_anyhow(&error))?;
        Ok(json!({}))
    }

    async fn close(&self, params: &Value) -> Result<Value, RpcError> {
        let params: SessionParams = parse_params(params, "close")?;
        let session = {
            let mut sessions = self.sessions.lock().await;
            match sessions.remove(&params.session_id) {
                Some(session) => {
                    // Mark terminal while the session map is still locked so a
                    // concurrent `send` cannot observe a removed-but-not-closed
                    // session.
                    self.closed_sessions
                        .lock()
                        .await
                        .insert(params.session_id.clone());
                    Some(session)
                }
                None => None,
            }
        };
        let Some(session) = session else {
            // `close` is terminal but idempotent for an already-closed id.
            if self
                .closed_sessions
                .lock()
                .await
                .contains(&params.session_id)
            {
                return Ok(json!({}));
            }
            return Err(RpcError::session_not_found(&params.session_id));
        };

        self.metadata.lock().await.remove(&params.session_id);
        session
            .close()
            .await
            .map_err(|error| RpcError::from_anyhow(&error))?;
        Ok(json!({}))
    }

    async fn list_sessions(&self) -> Result<Value, RpcError> {
        let metadata = self.metadata.lock().await;
        let mut entries: Vec<(&String, &SessionMetadata)> = metadata.iter().collect();
        entries.sort_by(|(id_a, a), (id_b, b)| {
            a.started_at.cmp(&b.started_at).then_with(|| id_a.cmp(id_b))
        });
        let sessions: Vec<Value> = entries
            .into_iter()
            .map(|(session_id, meta)| {
                json!({
                    "sessionId": session_id,
                    "cliId": meta.cli_id,
                    "cwd": meta.cwd,
                    "startedAt": meta.started_at,
                })
            })
            .collect();
        Ok(Value::Array(sessions))
    }

    async fn lookup(&self, session_id: &str) -> Result<Arc<dyn AgentSession>, RpcError> {
        let session = {
            let sessions = self.sessions.lock().await;
            sessions.get(session_id).cloned()
        };
        if let Some(session) = session {
            return Ok(session);
        }
        if self.closed_sessions.lock().await.contains(session_id) {
            return Err(RpcError::from_adapter(AdapterError::SessionAlreadyClosed {
                session_id: session_id.to_string(),
            }));
        }
        Err(RpcError::session_not_found(session_id))
    }

    fn forward_events(&self, session_id: &str, mut events: UnboundedReceiver<AgentEvent>) {
        let out_tx = self.out_tx.clone();
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                enqueue_json(&out_tx, &session_event_notification(&session_id, &event));
            }
            // The receiver only closes when the session (and every sender it
            // owns) has been dropped.
            enqueue_json(&out_tx, &session_ended_notification(&session_id));
        });
    }
}

/// Queues one serialized protocol line for the single stdout writer.
fn enqueue_json(tx: &UnboundedSender<String>, value: &Value) {
    match serde_json::to_string(value) {
        Ok(line) => {
            if tx.send(line).is_err() {
                eprintln!("[adapter-host] stdout writer is no longer running");
            }
        }
        Err(error) => eprintln!("[adapter-host] failed to serialize protocol message: {error}"),
    }
}

/// The one task allowed to write stdout. Writing one whole line (including its
/// newline) and flushing it here keeps concurrent responses atomic.
pub async fn write_stdout(mut lines: UnboundedReceiver<String>) {
    let mut out = BufWriter::new(tokio::io::stdout());
    while let Some(line) = lines.recv().await {
        if out.write_all(line.as_bytes()).await.is_err() {
            break;
        }
        if out.write_all(b"\n").await.is_err() {
            break;
        }
        if out.flush().await.is_err() {
            break;
        }
    }
    let _ = out.flush().await;
}

fn merge_detection(detection: &CliDetectionResult, capabilities: &Capabilities) -> Value {
    let mut value = serde_json::to_value(detection).unwrap_or(Value::Null);
    if let Value::Object(object) = &mut value {
        object.insert(
            "capabilities".to_string(),
            serde_json::to_value(capabilities).unwrap_or(Value::Null),
        );
    }
    value
}

fn to_value<T: Serialize>(value: T) -> Result<Value, RpcError> {
    serde_json::to_value(value)
        .map_err(|error| RpcError::internal(format!("Failed to serialize response: {error}")))
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
