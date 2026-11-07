//! CLI display name resolution.

/// Returns the canonical display name for a CLI identifier.
pub fn get_cli_display_name(cli_id: &str) -> String {
    match cli_id.to_ascii_lowercase().as_str() {
        "codex" => "Codex CLI".to_string(),
        "antigravity" => "Antigravity".to_string(),
        "deepseek" => "DeepSeek CLI".to_string(),
        "mock" => "Mock CLI".to_string(),
        _ => cli_id.to_string(),
    }
}
