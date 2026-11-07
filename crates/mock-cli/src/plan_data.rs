//! Mock data fixtures for plan, review, and teamwork scenarios.

use osmium_core::schemas::{PlannedTask, TeamworkPlan};

pub fn create_mock_teamwork_plan(goal: &str) -> TeamworkPlan {
    TeamworkPlan {
        goal: goal.to_string(),
        tasks: vec![
            PlannedTask {
                id: Some("task-1".into()),
                title: "Scaffold copy action".into(),
                description: Some("Define CompareRow brief types and route wiring".into()),
                scope: vec!["src/routes/**".into()],
                dependencies: vec![],
                task_type: "planning".into(),
                assigned_cli: Some("codex".into()),
            },
            PlannedTask {
                id: Some("task-2".into()),
                title: "Markdown brief builder".into(),
                description: Some("Implement toBrief formatting and clipboard helper".into()),
                scope: vec!["src/lib/**".into()],
                dependencies: vec!["task-1".into()],
                task_type: "implementation".into(),
                assigned_cli: Some("codex".into()),
            },
            PlannedTask {
                id: Some("task-3".into()),
                title: "Browser check on fixtures".into(),
                description: Some("Verify copy button UI states across fixture views".into()),
                scope: vec!["fixtures/**".into(), "src/components/**".into()],
                dependencies: vec!["task-1".into()],
                task_type: "browser-check".into(),
                assigned_cli: Some("antigravity".into()),
            },
            PlannedTask {
                id: Some("task-4".into()),
                title: "Unit tests: compare-model".into(),
                description: Some("Cover brief formatting edge cases and empty rows".into()),
                scope: vec!["tests/**".into()],
                dependencies: vec!["task-2".into()],
                task_type: "tests".into(),
                assigned_cli: Some("deepseek".into()),
            },
        ],
    }
}

pub fn create_mock_plan_checklist() -> Vec<(&'static str, &'static str, bool)> {
    vec![
        (
            "step-1",
            "Build the markdown brief helper in src/lib/brief.ts",
            true,
        ),
        (
            "step-2",
            "Wire the Copy review brief button in CompareView.tsx",
            true,
        ),
        ("step-3", "Add unit tests for compare-model.ts", true),
    ]
}

pub fn create_mock_review_comments() -> Vec<(&'static str, u32, &'static str)> {
    vec![
        (
            "src/routes/compare.ts",
            6,
            "Guard navigator.clipboard availability when running in non-secure contexts.",
        ),
        (
            "src/components/CompareView.tsx",
            18,
            "Ensure the Copy review brief button has an accessible aria-label.",
        ),
    ]
}
