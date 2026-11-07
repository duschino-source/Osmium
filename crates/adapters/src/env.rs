//! Zero API keys environment sanitizer and config validator.

use std::collections::HashMap;

/// Environment variables strictly prohibited from subprocess execution.
pub const FORBIDDEN_ENV_VARS: &[&str] = &[
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_AUTH_TOKEN",
    "DEEPSEEK_SESSION_TOKEN",
    "DEEPSEEK_ACCESS_TOKEN",
    "DEEPSEEK_REFRESH_TOKEN",
    "GEMINI_API_KEY",
    "CODEX_TOKEN",
];

/// Keys prohibited in Osmium project/session configuration objects.
pub const FORBIDDEN_CONFIG_KEYS: &[&str] = &[
    "apiKey",
    "api_key",
    "openaiApiKey",
    "deepseekApiKey",
    "authToken",
    "bearerToken",
    "secretKey",
];

#[derive(Debug, thiserror::Error)]
#[error("API keys or tokens are strictly prohibited in Osmium config: {keys:?}")]
pub struct ApiKeyViolationError {
    pub code: &'static str,
    pub keys: Vec<String>,
}

/// Returns true if the environment variable name matches any forbidden API key (case-insensitive).
pub fn is_forbidden_env_var(key: &str) -> bool {
    FORBIDDEN_ENV_VARS
        .iter()
        .any(|forbidden| key.eq_ignore_ascii_case(forbidden))
}

/// Sanitizes process environment by removing all provider API keys.
pub fn sanitize_process_env<I, K, V>(env: I) -> HashMap<String, String>
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    let mut sanitized = HashMap::new();
    for (k, v) in env {
        let key = k.into();
        let val = v.into();
        if !is_forbidden_env_var(&key) {
            sanitized.insert(key, val);
        }
    }
    sanitized
}

/// Validates that a configuration value does not contain forbidden API keys or tokens.
pub fn validate_zero_api_key_requirement(
    value: &serde_json::Value,
) -> Result<(), ApiKeyViolationError> {
    let mut found = Vec::new();

    fn walk(val: &serde_json::Value, prefix: &str, found: &mut Vec<String>) {
        match val {
            serde_json::Value::Object(map) => {
                for (k, v) in map {
                    let full_key = if prefix.is_empty() {
                        k.clone()
                    } else {
                        format!("{}.{}", prefix, k)
                    };
                    if FORBIDDEN_CONFIG_KEYS.contains(&k.as_str()) {
                        found.push(full_key.clone());
                    }
                    walk(v, &full_key, found);
                }
            }
            serde_json::Value::Array(items) => {
                for (i, item) in items.iter().enumerate() {
                    let full_key = if prefix.is_empty() {
                        format!("[{i}]")
                    } else {
                        format!("{prefix}[{i}]")
                    };
                    walk(item, &full_key, found);
                }
            }
            _ => {}
        }
    }

    walk(value, "", &mut found);

    if !found.is_empty() {
        return Err(ApiKeyViolationError {
            code: "ERR_API_KEY_PROHIBITED",
            keys: found,
        });
    }

    Ok(())
}
