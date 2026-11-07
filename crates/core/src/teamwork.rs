use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Semaphore;

use crate::schemas::PlannedTask;
use crate::storage::{SqliteStorage, StorageError};
pub use crate::types::{TeamworkRunState, TeamworkRunStatus, TeamworkTaskState, TeamworkTaskStatus};

#[derive(Debug, Error)]
pub enum TeamworkError {
    #[error("Cyclic task dependency detected: {0:?}")]
    CyclicDependency(Vec<String>),

    #[error("Task '{task}' references non-existent dependency '{dep}'")]
    InvalidDependency { task: String, dep: String },

    #[error("Teamwork run '{0}' not found")]
    RunNotFound(String),

    #[error("Teamwork task '{0}' not found")]
    TaskNotFound(String),

    #[error("Git execution failed: {command}: {stderr}")]
    Git { command: String, stderr: String },

    #[error("Merge conflict in task '{task_id}': {files:?}")]
    MergeConflict { task_id: String, files: Vec<String> },

    #[error("Workspace boundary violation: {0}")]
    BoundaryViolation(String),

    #[error("Storage error: {0}")]
    Storage(#[from] StorageError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamworkColumns {
    pub queued: Vec<TeamworkTaskState>,
    pub running: Vec<TeamworkTaskState>,
    pub review: Vec<TeamworkTaskState>,
    pub done: Vec<TeamworkTaskState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamworkBoardState {
    pub run_id: String,
    pub goal: String,
    pub orchestrator_badge: String,
    pub max_parallel: usize,
    pub integration_branch: String,
    pub columns: TeamworkColumns,
    pub tasks: Vec<TeamworkTaskState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeCheckResult {
    pub within_scope: bool,
    pub out_of_scope_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeTaskResult {
    pub merged: bool,
    pub conflict: bool,
    pub task_id: String,
    pub integration_branch: String,
    pub conflicting_files: Vec<String>,
    pub error_message: Option<String>,
}

fn run_git_cmd(cwd: &Path, args: &[&str]) -> Result<String, TeamworkError> {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|e| TeamworkError::Git {
            command: format!("git {}", args.join(" ")),
            stderr: e.to_string(),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(TeamworkError::Git {
            command: format!("git {}", args.join(" ")),
            stderr,
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Validate that the task dependency graph is a valid Directed Acyclic Graph (DAG) with no cycles.
pub fn validate_task_dag_no_cycles(tasks: &[PlannedTask]) -> Result<(), TeamworkError> {
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    let mut all_ids = HashSet::new();

    for (i, t) in tasks.iter().enumerate() {
        let id = t.id.clone().unwrap_or_else(|| format!("task-{}", i + 1));
        all_ids.insert(id.clone());
        adj.insert(id, t.dependencies.clone());
    }

    // Verify all referenced dependencies exist
    for (task_id, deps) in &adj {
        for dep in deps {
            if !all_ids.contains(dep) {
                return Err(TeamworkError::InvalidDependency {
                    task: task_id.clone(),
                    dep: dep.clone(),
                });
            }
        }
    }

    // Cycle detection via DFS
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();

    fn dfs(
        node: &str,
        chain: &mut Vec<String>,
        adj: &HashMap<String, Vec<String>>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> Result<(), TeamworkError> {
        if visiting.contains(node) {
            let mut cycle = chain.clone();
            cycle.push(node.to_string());
            return Err(TeamworkError::CyclicDependency(cycle));
        }
        if visited.contains(node) {
            return Ok(());
        }

        visiting.insert(node.to_string());
        chain.push(node.to_string());

        if let Some(deps) = adj.get(node) {
            for dep in deps {
                dfs(dep, chain, adj, visiting, visited)?;
            }
        }

        chain.pop();
        visiting.remove(node);
        visited.insert(node.to_string());
        Ok(())
    }

    let mut chain = Vec::new();
    for id in adj.keys() {
        if !visited.contains(id) {
            dfs(id, &mut chain, &adj, &mut visiting, &mut visited)?;
        }
    }

    Ok(())
}

/// Build a compiled GlobSet from scope patterns (e.g., `src/**`, `tests/**`).
pub fn build_scope_globset(patterns: &[String]) -> Result<GlobSet, TeamworkError> {
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        let normalized = p.replace('\\', "/");
        let glob = Glob::new(&normalized).map_err(|e| TeamworkError::Git {
            command: "glob_compile".to_string(),
            stderr: e.to_string(),
        })?;
        builder.add(glob);
    }
    builder.build().map_err(|e| TeamworkError::Git {
        command: "globset_build".to_string(),
        stderr: e.to_string(),
    })
}

/// Check modified files in a task worktree against assigned scope globs.
pub fn detect_out_of_scope_edits(
    worktree_path: &Path,
    scope_globs: &[String],
) -> Result<ScopeCheckResult, TeamworkError> {
    let globset = build_scope_globset(scope_globs)?;
    let diff_files_raw = run_git_cmd(worktree_path, &["diff", "--name-only", "HEAD~1", "HEAD"])
        .unwrap_or_default();

    let mut out_of_scope_files = Vec::new();
    for line in diff_files_raw.lines().filter(|l| !l.trim().is_empty()) {
        let norm_file = line.replace('\\', "/");
        if !globset.is_match(&norm_file) {
            out_of_scope_files.push(norm_file);
        }
    }

    Ok(ScopeCheckResult {
        within_scope: out_of_scope_files.is_empty(),
        out_of_scope_files,
    })
}

/// Create an isolated git worktree for a task, branching from the integration branch.
pub fn create_task_worktree(
    repo_root: &Path,
    task_id: &str,
    integration_branch: &str,
) -> Result<(PathBuf, String), TeamworkError> {
    let worktree_rel = Path::new(".osmium").join("worktrees").join(task_id);
    let worktree_abs = repo_root.join(&worktree_rel);
    let branch_name = format!("osmium/task/{}", task_id);

    // Ensure integration branch exists in repo
    let branch_list = run_git_cmd(repo_root, &["branch", "--list", integration_branch])?;
    if branch_list.trim().is_empty() {
        run_git_cmd(repo_root, &["branch", integration_branch])?;
    }

    if let Some(parent) = worktree_abs.parent() {
        fs::create_dir_all(parent)?;
    }

    // Add worktree, using -B to reset branch cleanly if it already existed
    let wt_path_str = worktree_abs.to_string_lossy();
    run_git_cmd(
        repo_root,
        &["worktree", "add", "-B", &branch_name, &wt_path_str, integration_branch],
    )?;

    Ok((worktree_abs, branch_name))
}

/// Merge a completed task branch non-fast-forward into the integration branch.
pub fn merge_task_into_integration(
    repo_root: &Path,
    branch_name: &str,
    task_id: &str,
    integration_branch: &str,
) -> Result<MergeTaskResult, TeamworkError> {
    // Preserve current branch to restore afterward
    let prev_branch = run_git_cmd(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();

    // Checkout integration branch
    run_git_cmd(repo_root, &["checkout", integration_branch])?;

    let merge_msg = format!("Merge teamwork task {} into {}", task_id, integration_branch);
    let merge_res = run_git_cmd(repo_root, &["merge", "--no-ff", branch_name, "-m", &merge_msg]);

    match merge_res {
        Ok(_) => {
            if !prev_branch.is_empty() && prev_branch != integration_branch {
                let _ = run_git_cmd(repo_root, &["checkout", &prev_branch]);
            }
            Ok(MergeTaskResult {
                merged: true,
                conflict: false,
                task_id: task_id.to_string(),
                integration_branch: integration_branch.to_string(),
                conflicting_files: Vec::new(),
                error_message: None,
            })
        }
        Err(err) => {
            // Find unmerged conflicting files
            let unmerged = run_git_cmd(repo_root, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default();
            let conflicting_files: Vec<String> = unmerged.lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();

            Ok(MergeTaskResult {
                merged: false,
                conflict: true,
                task_id: task_id.to_string(),
                integration_branch: integration_branch.to_string(),
                conflicting_files,
                error_message: Some(err.to_string()),
            })
        }
    }
}

/// Remove worktree on disk and clean up Git worktree metadata.
pub fn cleanup_task_worktree(repo_root: &Path, task_id: &str) -> Result<(), TeamworkError> {
    let worktree_abs = repo_root.join(".osmium").join("worktrees").join(task_id);
    let wt_path_str = worktree_abs.to_string_lossy();
    let _ = run_git_cmd(repo_root, &["worktree", "remove", "--force", &wt_path_str]);
    let _ = run_git_cmd(repo_root, &["worktree", "prune"]);
    Ok(())
}

/// Async DAG runner throttled by `tokio::sync::Semaphore`.
pub struct TeamworkScheduler {
    max_parallel: usize,
    semaphore: Arc<Semaphore>,
}

impl TeamworkScheduler {
    pub fn new(max_parallel: usize) -> Self {
        let max = if max_parallel == 0 { 2 } else { max_parallel };
        Self {
            max_parallel: max,
            semaphore: Arc::new(Semaphore::new(max)),
        }
    }

    pub fn semaphore(&self) -> Arc<Semaphore> {
        self.semaphore.clone()
    }

    /// Selects the batch of tasks ready to execute based on dependency completion and semaphore limit.
    pub fn select_ready_tasks<'a>(
        &self,
        tasks: &'a [TeamworkTaskState],
        active_running_count: usize,
    ) -> Vec<&'a TeamworkTaskState> {
        let done_or_review_ids: HashSet<&str> = tasks
            .iter()
            .filter(|t| t.status == TeamworkTaskStatus::Review || t.status == TeamworkTaskStatus::Done)
            .map(|t| t.id.as_str())
            .collect();

        let available_slots = self.max_parallel.saturating_sub(active_running_count);
        if available_slots == 0 {
            return Vec::new();
        }

        let mut ready = Vec::new();
        for t in tasks.iter().filter(|t| t.status == TeamworkTaskStatus::Queued) {
            let deps_met = t.dependencies.iter().all(|dep| done_or_review_ids.contains(dep.as_str()));
            if deps_met {
                ready.push(t);
                if ready.len() >= available_slots {
                    break;
                }
            }
        }

        ready
    }
}

/// Builds the 4-column Kanban board state for a teamwork run.
pub fn get_teamwork_board_state(run: &TeamworkRunState) -> TeamworkBoardState {
    let mut queued = Vec::new();
    let mut running = Vec::new();
    let mut review = Vec::new();
    let mut done = Vec::new();

    for t in &run.tasks {
        match t.status {
            TeamworkTaskStatus::Queued => queued.push(t.clone()),
            TeamworkTaskStatus::Running => running.push(t.clone()),
            TeamworkTaskStatus::Review => review.push(t.clone()),
            TeamworkTaskStatus::Done => done.push(t.clone()),
            TeamworkTaskStatus::Error => queued.push(t.clone()),
        }
    }

    let orchestrator_badge = format!("● {} · Orchestrator", run.orchestrator_cli);

    TeamworkBoardState {
        run_id: run.id.clone(),
        goal: run.goal.clone(),
        orchestrator_badge,
        max_parallel: run.max_parallel as usize,
        integration_branch: run.integration_branch.clone(),
        columns: TeamworkColumns {
            queued,
            running,
            review,
            done,
        },
        tasks: run.tasks.clone(),
    }
}

/// Recovers active teamwork runs after an application restart or crash.
pub async fn recover_teamwork_state_on_startup(
    storage: &SqliteStorage,
    _repo_root: &Path,
) -> Result<Vec<TeamworkRunState>, TeamworkError> {
    let active_runs = storage.list_active_teamwork_runs().await?;
    let mut recovered_runs = Vec::new();

    for mut run in active_runs {
        for task in &mut run.tasks {
            match task.status {
                TeamworkTaskStatus::Done => {
                    // Completed tasks remain DONE and are NEVER re-executed
                }
                TeamworkTaskStatus::Review => {
                    // Tasks awaiting review remain in REVIEW
                }
                TeamworkTaskStatus::Running => {
                    // Task was interrupted during execution.
                    // If worktree exists, check commit status
                    if let Some(wt_str) = &task.worktree_path {
                        let wt_path = PathBuf::from(wt_str);
                        if wt_path.exists() {
                            let commit_check = Command::new("git")
                                .current_dir(&wt_path)
                                .args(["status", "--porcelain"])
                                .output();

                            let has_uncommitted = commit_check.map(|o| !o.stdout.is_empty()).unwrap_or(true);
                            if !has_uncommitted {
                                let scope_res = detect_out_of_scope_edits(&wt_path, &task.scope)?;
                                task.status = TeamworkTaskStatus::Review;
                                task.out_of_scope_files = scope_res.out_of_scope_files;
                                storage.update_task_status(&task.id, &task.run_id, TeamworkTaskStatus::Review).await?;
                            } else {
                                task.status = TeamworkTaskStatus::Queued;
                                storage.update_task_status(&task.id, &task.run_id, TeamworkTaskStatus::Queued).await?;
                            }
                        } else {
                            task.status = TeamworkTaskStatus::Queued;
                            storage.update_task_status(&task.id, &task.run_id, TeamworkTaskStatus::Queued).await?;
                        }
                    } else {
                        task.status = TeamworkTaskStatus::Queued;
                        storage.update_task_status(&task.id, &task.run_id, TeamworkTaskStatus::Queued).await?;
                    }
                }
                TeamworkTaskStatus::Queued | TeamworkTaskStatus::Error => {
                    // Queued tasks remain queued
                }
            }
        }
        recovered_runs.push(run);
    }

    Ok(recovered_runs)
}
