//! Scenario dispatcher and event generator for mock-cli.

use crate::args::{MockCliOptions, MockScenarioName};
use crate::error::MockCliError;
use osmium_core::boundary::assert_workspace_write_allowed;
use osmium_core::types::*;
use std::path::Path;
use tokio::io::{AsyncBufRead, AsyncWrite, AsyncWriteExt};

async fn emit_event<W: AsyncWrite + Unpin + Send>(
    evt: AgentEvent,
    emitted: &mut Vec<AgentEvent>,
    opts: &MockCliOptions,
    stdout: &mut Option<W>,
    on_event: &mut Option<&mut (dyn FnMut(&AgentEvent) + Send)>,
) -> Result<(), MockCliError> {
    emitted.push(evt.clone());
    if let Some(cb) = on_event.as_mut() {
        cb(&evt);
    }
    if let Some(out) = stdout.as_mut() {
        let formatted = if opts.json {
            format!("{}\n", serde_json::to_string(&evt)?)
        } else {
            format!("[{}] {}\n", evt.event_type(), serde_json::to_string(&evt)?)
        };
        out.write_all(formatted.as_bytes()).await?;
        out.flush().await?;
    }
    if opts.delay_ms > 0 {
        tokio::time::sleep(tokio::time::Duration::from_millis(opts.delay_ms)).await;
    }
    Ok(())
}

pub async fn run_scenario<R, W>(
    opts: &MockCliOptions,
    mut stdin: Option<R>,
    mut stdout: Option<W>,
    mut on_event: Option<&mut (dyn FnMut(&AgentEvent) + Send)>,
) -> Result<Vec<AgentEvent>, MockCliError>
where
    R: AsyncBufRead + Unpin + Send,
    W: AsyncWrite + Unpin + Send,
{
    let mut emitted = Vec::new();

    macro_rules! emit {
        ($evt:expr) => {
            emit_event($evt, &mut emitted, opts, &mut stdout, &mut on_event).await?
        };
    }

    // 1. Initial event
    emit!(AgentEvent::Status {
        state: SessionState::Working,
        message: Some(format!("Starting {}", opts.scenario.as_str())),
    });

    // 2. Scenario specific events
    match opts.scenario {
        MockScenarioName::Chat => {
            let context_prefix = if opts.system_context.is_some() {
                "[Handoff context received] ".to_string()
            } else if let Some(ref resume) = opts.resume {
                format!("[Resumed {}] ", resume)
            } else {
                String::new()
            };

            emit!(AgentEvent::Message {
                role: MessageRole::Assistant,
                text: format!("{}Plan: build the brief, ", context_prefix),
                final_: false,
            });

            emit!(AgentEvent::Tool {
                id: "tool-read-1".into(),
                name: "read_file".into(),
                status: ToolStatus::Running,
                summary: Some("Reading compare-model.ts".into()),
                duration_sec: None,
            });

            emit!(AgentEvent::Tool {
                id: "tool-read-1".into(),
                name: "read_file".into(),
                status: ToolStatus::Done,
                summary: Some("Read compare-model.ts · 18s".into()),
                duration_sec: Some(18.0),
            });

            emit!(AgentEvent::Message {
                role: MessageRole::Assistant,
                text: format!(
                    "{}Plan: build the brief, wire the button, cover with tests.",
                    context_prefix
                ),
                final_: true,
            });

            emit!(AgentEvent::Status {
                state: SessionState::Idle,
                message: None,
            });
        }

        MockScenarioName::Edit => {
            emit!(AgentEvent::Tool {
                id: "tool-edit-1".into(),
                name: "apply_patch".into(),
                status: ToolStatus::Running,
                summary: Some(format!("Editing {}", opts.target_file)),
                duration_sec: None,
            });

            if opts.write_file {
                let safe_path =
                    assert_workspace_write_allowed(&opts.cwd, &opts.target_file, false)?;
                if let Some(parent) = safe_path.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                let content = concat!(
                    "import { toBrief } from '../lib/brief';\n\n",
                    "export function copyBrief(rows: Array<{ key: string; value: string }>) {\n",
                    "  const text = toBrief(rows);\n",
                    "  return text;\n",
                    "}\n"
                );
                tokio::fs::write(&safe_path, content).await?;
            }

            emit!(AgentEvent::FileEdit {
                path: opts.target_file.clone(),
                added: 43,
                removed: 2,
            });

            let basename = Path::new(&opts.target_file)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| opts.target_file.clone());

            emit!(AgentEvent::Tool {
                id: "tool-edit-1".into(),
                name: "apply_patch".into(),
                status: ToolStatus::Done,
                summary: Some(format!("Edited {} · 18s", basename)),
                duration_sec: Some(18.0),
            });

            emit!(AgentEvent::Message {
                role: MessageRole::Assistant,
                text: format!(
                    "Updated {} with the copy review brief implementation.",
                    opts.target_file
                ),
                final_: true,
            });

            emit!(AgentEvent::Status {
                state: SessionState::Idle,
                message: None,
            });
        }

        MockScenarioName::Approval => {
            let detail = match opts.approval_kind {
                ApprovalKind::Command => "pnpm --filter api-gateway test".to_string(),
                ApprovalKind::Edit => format!("Write changes to {}", opts.target_file),
                ApprovalKind::Network => {
                    "Fetch schema from https://example.com/schema.json".to_string()
                }
            };
            let kind_str = match opts.approval_kind {
                ApprovalKind::Command => "command",
                ApprovalKind::Edit => "edit",
                ApprovalKind::Network => "network",
            };

            emit!(AgentEvent::Approval {
                id: "approval-1".into(),
                kind: opts.approval_kind,
                detail: detail.clone(),
            });

            emit!(AgentEvent::Status {
                state: SessionState::Waiting,
                message: Some(format!("Waiting for approval ({})", kind_str)),
            });

            let allowed = if let Some(reader) = stdin.as_mut() {
                crate::stdin::wait_for_approval_line(reader).await
            } else {
                false
            };

            if allowed {
                emit!(AgentEvent::Status {
                    state: SessionState::Working,
                    message: Some("Approval granted, continuing execution".into()),
                });

                emit!(AgentEvent::Tool {
                    id: "tool-approved-1".into(),
                    name: kind_str.into(),
                    status: ToolStatus::Done,
                    summary: Some(format!("Executed approved {}: {}", kind_str, detail)),
                    duration_sec: None,
                });

                emit!(AgentEvent::Message {
                    role: MessageRole::Assistant,
                    text: format!("Approved {} completed successfully.", kind_str),
                    final_: true,
                });

                emit!(AgentEvent::Status {
                    state: SessionState::Idle,
                    message: None,
                });
            } else {
                emit!(AgentEvent::Tool {
                    id: "tool-approved-1".into(),
                    name: kind_str.into(),
                    status: ToolStatus::Error,
                    summary: Some(format!("Approval denied for {}", kind_str)),
                    duration_sec: None,
                });

                emit!(AgentEvent::Message {
                    role: MessageRole::Assistant,
                    text: "Action cancelled because approval was denied.".into(),
                    final_: true,
                });

                emit!(AgentEvent::Status {
                    state: SessionState::Idle,
                    message: Some("Approval denied".into()),
                });
            }
        }

        MockScenarioName::Quota => {
            emit!(AgentEvent::Message {
                role: MessageRole::Assistant,
                text: "Starting task execution...".into(),
                final_: false,
            });

            emit!(AgentEvent::Usage {
                limit_hit: Some(true),
                note: Some("Rate or subscription quota limit reached on current CLI.".into()),
            });

            emit!(AgentEvent::Status {
                state: SessionState::Error,
                message: Some("Subscription quota limit reached".into()),
            });
        }

        MockScenarioName::Plan => {
            let checklist = crate::plan_data::create_mock_plan_checklist();
            let markdown = checklist
                .into_iter()
                .map(|(_, title, _)| format!("- [x] {}", title))
                .collect::<Vec<_>>()
                .join("\n");

            emit!(AgentEvent::Message {
                role: MessageRole::Assistant,
                text: format!("Proposed Plan:\n{}", markdown),
                final_: true,
            });

            emit!(AgentEvent::Status {
                state: SessionState::Idle,
                message: None,
            });
        }

        MockScenarioName::Review => {
            let comments = crate::plan_data::create_mock_review_comments();
            let formatted = comments
                .into_iter()
                .map(|(path, line, comment)| format!("{}:{} \u{2014} {}", path, line, comment))
                .collect::<Vec<_>>()
                .join("\n");

            emit!(AgentEvent::Message {
                role: MessageRole::Assistant,
                text: format!("Read-only diff review complete:\n{}", formatted),
                final_: true,
            });

            emit!(AgentEvent::Status {
                state: SessionState::Idle,
                message: None,
            });
        }

        MockScenarioName::Teamwork => {
            let goal = if let Some(ref p) = opts.prompt {
                static RE_TW: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
                let re = RE_TW.get_or_init(|| regex::Regex::new(r"(?i)^/teamwork\s*").unwrap());
                let stripped = re.replace(p.trim(), "").trim().to_string();
                if stripped.is_empty() {
                    "Add copy review brief".to_string()
                } else {
                    stripped
                }
            } else {
                "Add copy review brief".to_string()
            };

            let plan = crate::plan_data::create_mock_teamwork_plan(&goal);
            let plan_json = serde_json::to_string(&plan)?;

            emit!(AgentEvent::Message {
                role: MessageRole::Assistant,
                text: plan_json,
                final_: true,
            });

            emit!(AgentEvent::Status {
                state: SessionState::Idle,
                message: None,
            });
        }

        MockScenarioName::Raw => {
            emit!(AgentEvent::Raw {
                data: "unstructured terminal line: building index [100%]".into(),
            });

            emit!(AgentEvent::Status {
                state: SessionState::Idle,
                message: None,
            });
        }
    }

    Ok(emitted)
}
