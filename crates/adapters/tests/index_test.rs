//! Tests ported from packages/adapters/src/__tests__/index.test.ts

use osmium_adapters::*;

#[test]
fn test_resolves_known_cli_colors_and_css_variables() {
    assert_eq!(get_cli_color("codex", None), "#1B2B22");
    assert_eq!(get_cli_color("antigravity", None), "#2F5FD0");
    assert_eq!(get_cli_color("deepseek", None), "#6B4FD0");
    assert_eq!(get_cli_color("mock", None), "#2F6B4F");

    assert!(get_cli_css_variable("codex").contains("--cli-codex"));
    assert!(get_cli_css_variable("antigravity").contains("--cli-antigravity"));
    assert!(get_cli_css_variable("deepseek").contains("--cli-deepseek"));
}

#[test]
fn test_resolves_deterministic_fallback_colors_for_unknown_clis() {
    let color1 = get_cli_color("custom-cli-alpha", None);
    let color2 = get_cli_color("custom-cli-alpha", None);
    assert_eq!(color1, color2);
    assert!(
        color1.starts_with('#') && color1.len() == 7,
        "Color should be valid hex format: {}",
        color1
    );

    // Explicit palette index overrides polynomial hash
    assert_eq!(get_cli_color("custom-cli-alpha", Some(0)), "#1B2B22");
    assert_eq!(get_cli_color("custom-cli-alpha", Some(1)), "#2F5FD0");
}

#[test]
fn test_formats_display_names() {
    assert_eq!(get_cli_display_name("codex"), "Codex CLI");
    assert_eq!(get_cli_display_name("antigravity"), "Antigravity");
    assert_eq!(get_cli_display_name("deepseek"), "DeepSeek CLI");
    assert_eq!(get_cli_display_name("mock"), "Mock CLI");
    assert_eq!(get_cli_display_name("custom-tool"), "custom-tool");
}

#[test]
fn test_compares_semver_strings_and_warns_on_newer_clis() {
    assert_eq!(compare_semver("1.2.0", "1.1.9"), 1);
    assert_eq!(compare_semver("1.1.0", "1.1.0"), 0);
    assert_eq!(compare_semver("0.9.5", "1.0.0"), -1);
    assert_eq!(compare_semver("v2.0.0", "1.9.9"), 1);

    let warning = create_version_warning("codex", Some("0.2.0"), Some("0.1.0"));
    assert!(warning.is_some());
    let msg = warning.unwrap();
    assert!(msg.contains("Codex CLI"));
    assert!(msg.contains("newer than tested version 0.1.0"));

    assert_eq!(
        create_version_warning("codex", Some("0.1.0"), Some("0.1.0")),
        None
    );
    assert_eq!(
        create_version_warning("codex", Some("0.0.9"), Some("0.1.0")),
        None
    );
    assert_eq!(create_version_warning("codex", None, Some("0.1.0")), None);
}
