//! Wire protocol for the adapter host.
//!
//! The transport is newline-delimited JSON over stdin/stdout: one JSON object
//! per line, requests and responses matched by `id`, and asynchronous
//! `sessionEvent` / `sessionEnded` notifications interleaved with them.

use osmium_adapters::{AdapterError, AgentEvent, ApprovalScope};
use osmium_core::types::ApprovalMode;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

/// Version reported by the `ping` method.
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

/// A failure that becomes `{ "code": …, "message": … }` on the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcError {
    pub code: &'static str,
    pub message: String,
}

impl RpcError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new("ERR_HOST_BAD_REQUEST", message)
    }

    pub fn unknown_method(method: &str) -> Self {
        Self::new(
            "ERR_HOST_UNKNOWN_METHOD",
            format!("Unknown method: {method}"),
        )
    }

    pub fn session_not_found(session_id: &str) -> Self {
        Self::new(
            "ERR_HOST_SESSION_NOT_FOUND",
            format!("Unknown session: {session_id}"),
        )
    }

    /// Unexpected host-side failure (serialization, channel closure, …).
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("ERR_HOST_INTERNAL", message)
    }

    /// Maps an adapter error to its documented `ERR_ADAPTER_*` code.
    pub fn from_adapter(error: AdapterError) -> Self {
        Self {
            code: error.error_code(),
            message: error.to_string(),
        }
    }

    /// Downcasts to [`AdapterError`] so adapter failures keep their own code;
    /// anything else is reported as an unexpected host failure.
    pub fn from_anyhow(error: &anyhow::Error) -> Self {
        match error.downcast_ref::<AdapterError>() {
            Some(adapter) => Self::from_adapter_ref(adapter),
            None => Self::internal(error.to_string()),
        }
    }

    fn from_adapter_ref(error: &AdapterError) -> Self {
        Self {
            code: error.error_code(),
            message: error.to_string(),
        }
    }
}

/// One line read from stdin, already classified.
pub enum ParsedLine {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Invalid {
        id: Value,
        message: String,
    },
}

/// Parses one NDJSON request line. Malformed input is reported with the `id`
/// when one can be recovered, and `null` otherwise.
pub fn parse_line(line: &str) -> ParsedLine {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => {
            return ParsedLine::Invalid {
                id: Value::Null,
                message: format!("Malformed JSON: {error}"),
            }
        }
    };

    let Value::Object(mut object) = value else {
        return ParsedLine::Invalid {
            id: Value::Null,
            message: "A request must be a JSON object".to_string(),
        };
    };

    let id = object.remove("id").unwrap_or(Value::Null);
    if id.is_null() {
        return ParsedLine::Invalid {
            id,
            message: "A request must carry a non-null id".to_string(),
        };
    }

    let method = match object.remove("method") {
        Some(Value::String(method)) if !method.is_empty() => method,
        Some(_) => {
            return ParsedLine::Invalid {
                id,
                message: "The method must be a non-empty string".to_string(),
            }
        }
        None => {
            return ParsedLine::Invalid {
                id,
                message: "The request is missing a method".to_string(),
            }
        }
    };

    ParsedLine::Request {
        id,
        method,
        params: object.remove("params").unwrap_or(Value::Null),
    }
}

/// Deserializes method params, reporting a bad request on shape errors.
pub fn parse_params<T: DeserializeOwned>(params: &Value, method: &str) -> Result<T, RpcError> {
    serde_json::from_value(params.clone())
        .map_err(|error| RpcError::bad_request(format!("Invalid params for {method}: {error}")))
}

pub fn success_response(id: Value, result: Value) -> Value {
    json!({ "id": id, "result": result })
}

pub fn failure_response(id: Value, error: RpcError) -> Value {
    json!({
        "id": id,
        "error": {
            "code": error.code,
            "message": error.message,
        },
    })
}

/// Notification for one streamed [`AgentEvent`].
///
/// The contract document sketches the payload under a second `event` key, but
/// a JSON object cannot carry the notification name and the payload under the
/// same key. The name stays in `event`; the payload is carried in `data`.
pub fn session_event_notification(session_id: &str, event: &AgentEvent) -> Value {
    json!({
        "event": "sessionEvent",
        "sessionId": session_id,
        "data": event,
    })
}

/// Notification emitted once a session's event receiver closes.
pub fn session_ended_notification(session_id: &str) -> Value {
    json!({
        "event": "sessionEnded",
        "sessionId": session_id,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliParams {
    pub cli_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionParams {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartParams {
    pub cli_id: String,
    pub cwd: String,
    #[serde(default)]
    pub approval_mode: Option<ApprovalMode>,
    #[serde(default)]
    pub resume: Option<String>,
    #[serde(default)]
    pub system_context: Option<String>,
    #[serde(default)]
    pub read_only: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendParams {
    pub session_id: String,
    pub prompt: String,
    #[serde(default)]
    pub attachments: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalParams {
    pub session_id: String,
    pub approval_id: String,
    pub allow: bool,
    #[serde(default)]
    pub scope: Option<ApprovalScope>,
}
