use osmium_core::boundary::{assert_workspace_write_allowed, is_path_inside_workspace};
use osmium_core::schemas::{
    parse_project_config_yaml, stringify_project_config_yaml, ExtensionManifest,
    ExtensionPermission, OnQuotaHit, PlannedTask, TeamworkPlan, UiThemeKind,
};
use osmium_core::types::ApprovalMode;

#[test]
fn test_validates_canonical_project_config() {
    let sample_yaml = r#"
version: 1
name: api-gateway
primary: codex
secondary: [antigravity, deepseek]
approvalMode: ask
routing:
  - when: planning
    cli: codex
  - when: browser-check
    cli: antigravity
  - when: tests
    cli: deepseek
fallback:
  onQuotaHit: next-secondary
teamwork:
  maxParallel: 2
  integrationBranch: osmium/integration
"#;
    let parsed = parse_project_config_yaml(sample_yaml).expect("Failed to parse canonical yaml");
    assert_eq!(parsed.version, 1);
    assert_eq!(parsed.name, "api-gateway");
    assert_eq!(parsed.primary, "codex");
    assert_eq!(parsed.secondary, vec!["antigravity", "deepseek"]);
    assert_eq!(parsed.approval_mode, ApprovalMode::Ask);
    assert_eq!(parsed.routing.len(), 3);
    assert_eq!(parsed.routing[0].when, "planning");
    assert_eq!(parsed.routing[0].cli, "codex");
    assert_eq!(parsed.routing[1].when, "browser-check");
    assert_eq!(parsed.routing[1].cli, "antigravity");
    assert_eq!(parsed.routing[2].when, "tests");
    assert_eq!(parsed.routing[2].cli, "deepseek");
    assert_eq!(parsed.fallback.on_quota_hit, OnQuotaHit::NextSecondary);
    assert_eq!(parsed.teamwork.max_parallel, 2);
    assert_eq!(parsed.teamwork.integration_branch, "osmium/integration");
}

#[test]
fn test_preserves_unknown_yaml_keys_at_root_and_nested_levels() {
    let yaml_with_unknowns = r#"
version: 1
name: api-gateway
primary: codex
customRootField: keep-me
experimentalFlags:
  featureA: true
routing:
  - when: planning
    cli: codex
    priority: 10
fallback:
  onQuotaHit: next-secondary
  notifySlack: false
teamwork:
  maxParallel: 3
  integrationBranch: osmium/integration
  customWorktreePrefix: task-wt
"#;
    let parsed = parse_project_config_yaml(yaml_with_unknowns).expect("Failed to parse yaml");
    assert_eq!(
        parsed
            .extra
            .get("customRootField")
            .and_then(|v| v.as_str()),
        Some("keep-me")
    );
    assert!(parsed.extra.contains_key("experimentalFlags"));
    assert_eq!(
        parsed.routing[0]
            .extra
            .get("priority")
            .and_then(|v| v.as_i64()),
        Some(10)
    );
    assert_eq!(
        parsed.fallback
            .extra
            .get("notifySlack")
            .and_then(|v| v.as_bool()),
        Some(false)
    );
    assert_eq!(
        parsed.teamwork
            .extra
            .get("customWorktreePrefix")
            .and_then(|v| v.as_str()),
        Some("task-wt")
    );

    // Update a known field via UI and stringify back while preserving unknown keys
    let mut updated_config = parsed.clone();
    updated_config.approval_mode = ApprovalMode::AutoEdit;
    updated_config.teamwork.max_parallel = 4;

    let updated_yaml = stringify_project_config_yaml(&updated_config, Some(yaml_with_unknowns))
        .expect("Failed to stringify yaml");

    let reparsed = parse_project_config_yaml(&updated_yaml).expect("Failed to reparse updated yaml");
    assert_eq!(reparsed.approval_mode, ApprovalMode::AutoEdit);
    assert_eq!(reparsed.teamwork.max_parallel, 4);
    assert_eq!(
        reparsed
            .extra
            .get("customRootField")
            .and_then(|v| v.as_str()),
        Some("keep-me")
    );
    assert!(reparsed.extra.contains_key("experimentalFlags"));
    assert_eq!(
        reparsed.routing[0]
            .extra
            .get("priority")
            .and_then(|v| v.as_i64()),
        Some(10)
    );
    assert_eq!(
        reparsed.fallback
            .extra
            .get("notifySlack")
            .and_then(|v| v.as_bool()),
        Some(false)
    );
    assert_eq!(
        reparsed.teamwork
            .extra
            .get("customWorktreePrefix")
            .and_then(|v| v.as_str()),
        Some("task-wt")
    );
}

#[test]
fn test_rejects_invalid_project_yaml_configurations() {
    let invalid_version = r#"
version: 2
name: api-gateway
"#;
    assert!(parse_project_config_yaml(invalid_version).is_err());

    let empty_name = r#"
version: 1
name: ""
"#;
    assert!(parse_project_config_yaml(empty_name).is_err());

    let not_a_mapping = r#"
- item1
- item2
"#;
    assert!(parse_project_config_yaml(not_a_mapping).is_err());
}

#[test]
fn test_validates_teamwork_plan_schema_and_extension_manifest_schema() {
    let plan = TeamworkPlan {
        goal: "Add copy review brief".to_string(),
        tasks: vec![PlannedTask {
            id: Some("task-1".to_string()),
            title: "Markdown brief builder".to_string(),
            description: None,
            scope: vec!["src/lib/brief.ts".to_string()],
            dependencies: vec![],
            task_type: "implementation".to_string(),
            assigned_cli: Some("codex".to_string()),
        }],
    };
    assert!(plan.validate().is_ok());
    assert_eq!(plan.tasks.len(), 1);
    assert_eq!(plan.tasks[0].title, "Markdown brief builder");

    let manifest_json = r#"
    {
      "name": "forest-theme",
      "version": "1.0.0",
      "displayName": "Forest Theme",
      "permissions": ["webview"],
      "contributes": {
        "themes": [
          {
            "id": "forest-dark",
            "label": "Forest Dark",
            "uiTheme": "dark",
            "path": "./themes/forest-dark.json"
          }
        ]
      }
    }
    "#;
    let manifest: ExtensionManifest =
        serde_json::from_str(manifest_json).expect("Failed to deserialize extension manifest");
    assert!(manifest.validate().is_ok());
    assert_eq!(manifest.name, "forest-theme");
    assert_eq!(manifest.permissions, vec![ExtensionPermission::Webview]);
    let themes = manifest.contributes.themes.as_ref().unwrap();
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].ui_theme, UiThemeKind::Dark);
}

#[test]
fn test_enforces_workspace_write_boundary_rules() {
    let root = "/tmp/osmium-project";
    assert!(is_path_inside_workspace(root, "src/index.ts", false));
    assert!(is_path_inside_workspace(
        root,
        ".osmium/worktrees/task-1/file.ts",
        false
    ));
    assert!(!is_path_inside_workspace(root, "../outside.txt", false));
    assert!(!is_path_inside_workspace(root, "/etc/passwd", false));

    let err = assert_workspace_write_allowed(root, "../escape.ts", false).unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("Workspace boundary violation"),
        "Expected error message to contain 'Workspace boundary violation', got: {}",
        err_str
    );
}
