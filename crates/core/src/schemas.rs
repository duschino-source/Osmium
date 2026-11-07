use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::types::ApprovalMode;

#[derive(Debug, Error)]
pub enum SchemaError {
    #[error("Invalid project.yaml: root value must be a YAML mapping object")]
    NotAMapping,
    #[error("YAML parse error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("Validation error: {0}")]
    Validation(String),
}

/// Routing rule mapping task type to CLI adapter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingRule {
    pub when: String,
    pub cli: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, serde_yaml::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum OnQuotaHit {
    #[default]
    NextSecondary,
    Ask,
    Stop,
}

/// Fallback behavior when primary CLI hits quota limit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FallbackConfig {
    #[serde(default)]
    pub on_quota_hit: OnQuotaHit,
    #[serde(flatten)]
    pub extra: IndexMap<String, serde_yaml::Value>,
}

fn default_max_parallel() -> u32 {
    2
}

fn default_integration_branch() -> String {
    "osmium/integration".to_string()
}

/// Teamwork configuration in project.yaml.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamworkConfig {
    #[serde(default = "default_max_parallel")]
    pub max_parallel: u32,
    #[serde(default = "default_integration_branch")]
    pub integration_branch: String,
    #[serde(flatten)]
    pub extra: IndexMap<String, serde_yaml::Value>,
}

impl Default for TeamworkConfig {
    fn default() -> Self {
        Self {
            max_parallel: default_max_parallel(),
            integration_branch: default_integration_branch(),
            extra: IndexMap::new(),
        }
    }
}

fn default_version() -> u32 {
    1
}

fn default_primary() -> String {
    "codex".to_string()
}

fn default_secondary() -> Vec<String> {
    vec!["antigravity".to_string(), "deepseek".to_string()]
}

/// Complete `.osmium/project.yaml` configuration with unknown-key preservation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    pub name: String,
    #[serde(default = "default_primary")]
    pub primary: String,
    #[serde(default = "default_secondary")]
    pub secondary: Vec<String>,
    #[serde(default)]
    pub approval_mode: ApprovalMode,
    #[serde(default)]
    pub routing: Vec<RoutingRule>,
    #[serde(default)]
    pub fallback: FallbackConfig,
    #[serde(default)]
    pub teamwork: TeamworkConfig,
    #[serde(flatten)]
    pub extra: IndexMap<String, serde_yaml::Value>,
}

impl ProjectConfig {
    pub fn validate(&self) -> Result<(), SchemaError> {
        if self.version != 1 {
            return Err(SchemaError::Validation(format!(
                "Unsupported config version: expected 1, found {}",
                self.version
            )));
        }
        if self.name.trim().is_empty() {
            return Err(SchemaError::Validation(
                "Project name cannot be empty".to_string(),
            ));
        }
        if self.teamwork.max_parallel == 0 {
            return Err(SchemaError::Validation(
                "teamwork.maxParallel must be greater than 0".to_string(),
            ));
        }
        if self.teamwork.integration_branch.trim().is_empty() {
            return Err(SchemaError::Validation(
                "teamwork.integrationBranch cannot be empty".to_string(),
            ));
        }
        for (i, rule) in self.routing.iter().enumerate() {
            if rule.when.trim().is_empty() {
                return Err(SchemaError::Validation(format!(
                    "routing[{}].when cannot be empty",
                    i
                )));
            }
            if rule.cli.trim().is_empty() {
                return Err(SchemaError::Validation(format!(
                    "routing[{}].cli cannot be empty",
                    i
                )));
            }
        }
        Ok(())
    }
}

/// Recursively merges `updates` over `base` preserving all unknown keys.
fn deep_merge_yaml(base: &mut serde_yaml::Value, updates: &serde_yaml::Value) {
    match (base, updates) {
        (serde_yaml::Value::Mapping(base_map), serde_yaml::Value::Mapping(update_map)) => {
            for (k, v) in update_map {
                if let Some(base_v) = base_map.get_mut(k) {
                    deep_merge_yaml(base_v, v);
                } else {
                    base_map.insert(k.clone(), v.clone());
                }
            }
        }
        (base_slot, update_val) => {
            *base_slot = update_val.clone();
        }
    }
}

/// Parses `.osmium/project.yaml` text into `ProjectConfig`, preserving unknown keys.
pub fn parse_project_config_yaml(yaml_text: &str) -> Result<ProjectConfig, SchemaError> {
    let raw_val: serde_yaml::Value = serde_yaml::from_str(yaml_text)?;
    if !raw_val.is_mapping() {
        return Err(SchemaError::NotAMapping);
    }
    let config: ProjectConfig = serde_yaml::from_value(raw_val)?;
    config.validate()?;
    Ok(config)
}

/// Serializes `ProjectConfig` back to YAML. If `original_yaml_text` is provided,
/// deep-merges over it so that existing unknown keys and formatting are preserved.
pub fn stringify_project_config_yaml(
    config: &ProjectConfig,
    original_yaml_text: Option<&str>,
) -> Result<String, SchemaError> {
    config.validate()?;
    let config_val = serde_yaml::to_value(config)?;

    let merged = if let Some(orig) = original_yaml_text {
        if !orig.trim().is_empty() {
            let parsed_orig: serde_yaml::Value = serde_yaml::from_str(orig)?;
            if parsed_orig.is_mapping() {
                let mut base = parsed_orig;
                deep_merge_yaml(&mut base, &config_val);
                base
            } else {
                config_val
            }
        } else {
            config_val
        }
    } else {
        config_val
    };

    let reparsed: ProjectConfig = serde_yaml::from_value(merged.clone())?;
    reparsed.validate()?;
    Ok(serde_yaml::to_string(&merged)?)
}

/// Task planned as part of a teamwork orchestration run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedTask {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub scope: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    pub task_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_cli: Option<String>,
}

/// Structured plan generated by teamwork orchestrator CLI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamworkPlan {
    pub goal: String,
    pub tasks: Vec<PlannedTask>,
}

impl TeamworkPlan {
    pub fn validate(&self) -> Result<(), SchemaError> {
        if self.goal.trim().is_empty() {
            return Err(SchemaError::Validation("Goal cannot be empty".to_string()));
        }
        if self.tasks.is_empty() {
            return Err(SchemaError::Validation(
                "Tasks list must contain at least one task".to_string(),
            ));
        }
        for (i, t) in self.tasks.iter().enumerate() {
            if t.title.trim().is_empty() {
                return Err(SchemaError::Validation(format!(
                    "Task[{}] title cannot be empty",
                    i
                )));
            }
            if t.scope.is_empty() {
                return Err(SchemaError::Validation(format!(
                    "Task[{}] scope must contain at least one pattern",
                    i
                )));
            }
            if t.task_type.trim().is_empty() {
                return Err(SchemaError::Validation(format!(
                    "Task[{}] taskType cannot be empty",
                    i
                )));
            }
        }
        Ok(())
    }
}

/// Permissions requested by an extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionPermission {
    NodeProcess,
    Filesystem,
    Network,
    Webview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiThemeKind {
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContribution {
    pub id: String,
    pub label: String,
    pub ui_theme: UiThemeKind,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetContribution {
    pub language: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerContribution {
    pub id: String,
    pub languages: Vec<String>,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAdapterContribution {
    pub id: String,
    pub display_name: String,
    pub entry: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandContribution {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keybinding: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelContribution {
    pub id: String,
    pub title: String,
    pub html_path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionContributes {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<ThemeContribution>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippets: Option<Vec<SnippetContribution>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language_servers: Option<Vec<LanguageServerContribution>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_adapters: Option<Vec<CliAdapterContribution>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<Vec<CommandContribution>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panels: Option<Vec<PanelContribution>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub name: String,
    pub version: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub permissions: Vec<ExtensionPermission>,
    #[serde(default)]
    pub contributes: ExtensionContributes,
}

impl ExtensionManifest {
    pub fn validate(&self) -> Result<(), SchemaError> {
        if self.name.trim().is_empty() {
            return Err(SchemaError::Validation("Manifest name cannot be empty".to_string()));
        }
        if self.version.trim().is_empty() {
            return Err(SchemaError::Validation("Manifest version cannot be empty".to_string()));
        }
        if self.display_name.trim().is_empty() {
            return Err(SchemaError::Validation("Manifest displayName cannot be empty".to_string()));
        }
        Ok(())
    }
}
