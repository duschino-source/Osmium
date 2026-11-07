//! CLI color palette and CSS variables.

pub const KNOWN_CLI_COLORS: &[(&str, &str)] = &[
    ("codex", "#1B2B22"),
    ("antigravity", "#2F5FD0"),
    ("deepseek", "#6B4FD0"),
    ("mock", "#2F6B4F"),
];

pub const DEFAULT_CLI_PALETTE: &[&str] = &[
    "#1B2B22", // Codex
    "#2F5FD0", // Antigravity
    "#6B4FD0", // DeepSeek
    "#2F6B4F", // Forest Accent
    "#B85D19", // Warm Amber
    "#0E7490", // Deep Teal
    "#9D174D", // Berry
    "#4338CA", // Indigo
];

/// Returns the assigned hex color for a CLI identifier.
///
/// If `cli_id` matches a known CLI, returns its canonical color.
/// If `palette_index` is provided, selects deterministically by index.
/// Otherwise, computes a 32-bit polynomial hash (`hash * 31 + charCode`)
/// mapped over the extra fallback palette (`DEFAULT_CLI_PALETTE[3..]`).
pub fn get_cli_color(cli_id: &str, palette_index: Option<usize>) -> &'static str {
    let normalized = cli_id.to_ascii_lowercase();

    for (known_id, color) in KNOWN_CLI_COLORS {
        if normalized == *known_id {
            return color;
        }
    }

    if let Some(idx) = palette_index {
        return DEFAULT_CLI_PALETTE[idx % DEFAULT_CLI_PALETTE.len()];
    }

    let mut hash: u32 = 0;
    for b in normalized.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(b as u32);
    }

    let extra_palette = &DEFAULT_CLI_PALETTE[3..];
    extra_palette[(hash as usize) % extra_palette.len()]
}

/// Returns a CSS variable expression or resolved hex color for a CLI identifier.
pub fn get_cli_css_variable(cli_id: &str) -> String {
    let normalized = cli_id.to_ascii_lowercase();
    match normalized.as_str() {
        "codex" => "var(--cli-codex, #1B2B22)".to_string(),
        "antigravity" => "var(--cli-antigravity, #2F5FD0)".to_string(),
        "deepseek" => "var(--cli-deepseek, #6B4FD0)".to_string(),
        _ => get_cli_color(cli_id, None).to_string(),
    }
}
