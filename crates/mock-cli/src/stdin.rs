//! Stdin reader for interactive approval handling.

use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub fn parse_approval_input(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.starts_with('{') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let allow = val.get("allow").and_then(|v| v.as_bool());
            let approved = val.get("approved").and_then(|v| v.as_bool());
            return allow.or(approved).unwrap_or(false);
        } else {
            return false;
        }
    }
    let lower = trimmed.to_lowercase();
    matches!(
        lower.as_str(),
        "allow" | "allow-session" | "yes" | "y" | "true" | "1"
    )
}

pub async fn wait_for_approval_line<R: AsyncBufRead + Unpin>(mut reader: R) -> bool {
    let mut line = String::new();
    match reader.read_line(&mut line).await {
        Ok(n) if n > 0 => parse_approval_input(&line),
        _ => false,
    }
}
