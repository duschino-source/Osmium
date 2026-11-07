use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::types::CheckpointSummary;

#[derive(Debug, Error)]
pub enum CheckpointError {
    #[error("Checkpoint not found: {0}")]
    NotFound(String),

    #[error("Invalid checkpoint ID '{0}': must be alphanumeric, dashes, or underscores")]
    InvalidId(String),

    #[error("Git execution failed: {command}: {stderr}")]
    Git { command: String, stderr: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Storage error: {0}")]
    Storage(String),
}

impl CheckpointError {
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "ERR_CHECKPOINT_NOT_FOUND",
            Self::InvalidId(_) => "ERR_CHECKPOINT_INVALID_ID",
            Self::Git { .. } => "ERR_GIT_EXEC",
            Self::Io(_) => "ERR_IO",
            Self::Storage(_) => "ERR_STORAGE",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileSummary {
    pub path: String,
    pub base_name: String,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointDiff {
    pub checkpoint_id: String,
    pub base_sha: String,
    pub current_tree_sha: String,
    pub files: Vec<DiffFileSummary>,
    pub total_added: usize,
    pub total_removed: usize,
    pub raw_diff: String,
    pub right_pane_width_px: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointUndoResult {
    pub checkpoint_id: String,
    pub restored_commit_sha: String,
    pub tree_sha: String,
}

/// RAII Guard that removes the temporary Git index file on drop.
struct TmpIndexGuard(PathBuf);

impl Drop for TmpIndexGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Helper to execute git and return stdout, or error on non-zero exit code.
fn run_git(
    cwd: &Path,
    args: &[&str],
    extra_env: Option<(&str, &Path)>,
) -> Result<String, CheckpointError> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd).args(args);
    if let Some((k, v)) = extra_env {
        cmd.env(k, v);
    }
    let output = cmd.output().map_err(|e| CheckpointError::Git {
        command: format!("git {}", args.join(" ")),
        stderr: e.to_string(),
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(CheckpointError::Git {
            command: format!("git {}", args.join(" ")),
            stderr,
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Validate checkpoint ID to prevent directory traversal or malformed ref injections.
pub fn validate_checkpoint_id(id: &str) -> Result<(), CheckpointError> {
    if id.is_empty()
        || id.contains("..")
        || id.contains('/')
        || id.contains('\\')
        || !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(CheckpointError::InvalidId(id.to_string()));
    }
    Ok(())
}

/// Resolve the absolute `.git` directory for the repository.
pub fn get_git_dir(repo_root: &Path) -> Result<PathBuf, CheckpointError> {
    let rel_git_dir = run_git(repo_root, &["rev-parse", "--git-dir"], None)?;
    let candidate = repo_root.join(rel_git_dir);
    if let Ok(canon) = dunce::canonicalize(&candidate) {
        Ok(canon)
    } else {
        Ok(candidate)
    }
}

/// Create a pre-turn checkpoint without altering user branch HEAD or staged index.
pub fn create_checkpoint(
    repo_root: &Path,
    session_id: &str,
    checkpoint_id: Option<&str>,
    turn_index: usize,
) -> Result<CheckpointSummary, CheckpointError> {
    let cid = match checkpoint_id {
        Some(id) => {
            validate_checkpoint_id(id)?;
            id.to_string()
        }
        None => format!(
            "chk-{}-{}",
            chrono::Utc::now().timestamp_millis(),
            &Uuid::new_v4().to_string()[..6]
        ),
    };

    let ref_name = format!("refs/osmium/checkpoints/{}", cid);
    let git_dir = get_git_dir(repo_root)?;
    let tmp_index_path = git_dir.join(format!("osmium-tmp-index-{}-{}", cid, std::process::id()));
    let real_index_path = git_dir.join("index");

    // Copy user's existing index if present to retain stat cache
    if real_index_path.exists() {
        let _ = fs::copy(&real_index_path, &tmp_index_path);
    }
    let _guard = TmpIndexGuard(tmp_index_path.clone());

    let env = Some(("GIT_INDEX_FILE", tmp_index_path.as_path()));

    // Stage all changes into temporary index
    run_git(repo_root, &["add", "-A"], env)?;

    // Write tree from temporary index
    let tree_sha = run_git(repo_root, &["write-tree"], env)?;

    // Get current HEAD sha before commit (if repository has commits)
    let head_sha_before = run_git(repo_root, &["rev-parse", "HEAD"], None).unwrap_or_default();

    // Commit tree
    let commit_msg = format!("Osmium pre-turn checkpoint {}", cid);
    let commit_sha = if !head_sha_before.is_empty() {
        run_git(
            repo_root,
            &["commit-tree", &tree_sha, "-p", &head_sha_before, "-m", &commit_msg],
            env,
        )?
    } else {
        run_git(repo_root, &["commit-tree", &tree_sha, "-m", &commit_msg], env)?
    };

    // Update ref
    run_git(repo_root, &["update-ref", &ref_name, &commit_sha], None)?;

    // Verify HEAD was untouched
    if !head_sha_before.is_empty() {
        let head_after = run_git(repo_root, &["rev-parse", "HEAD"], None)?;
        if head_after != head_sha_before {
            return Err(CheckpointError::Git {
                command: "update-ref verification".to_string(),
                stderr: "Checkpoint creation modified user branch HEAD!".to_string(),
            });
        }
    }

    Ok(CheckpointSummary {
        id: cid,
        session_id: session_id.to_string(),
        turn_index: turn_index as u64,
        git_ref: ref_name,
        commit_sha,
        files_changed: Vec::new(),
        created_at: chrono::Utc::now().timestamp_millis(),
    })
}

/// Compute structured diff between checkpoint state and current working tree.
pub fn get_checkpoint_diff(
    repo_root: &Path,
    checkpoint_id: &str,
) -> Result<CheckpointDiff, CheckpointError> {
    validate_checkpoint_id(checkpoint_id)?;
    let ref_name = format!("refs/osmium/checkpoints/{}", checkpoint_id);

    // Verify checkpoint ref exists
    let base_commit_sha = run_git(repo_root, &["rev-parse", "--verify", &ref_name], None)
        .map_err(|_| CheckpointError::NotFound(checkpoint_id.to_string()))?;

    let git_dir = get_git_dir(repo_root)?;
    let tmp_index_path = git_dir.join(format!(
        "osmium-diff-index-{}-{}",
        checkpoint_id,
        std::process::id()
    ));
    let real_index_path = git_dir.join("index");
    if real_index_path.exists() {
        let _ = fs::copy(&real_index_path, &tmp_index_path);
    }
    let _guard = TmpIndexGuard(tmp_index_path.clone());
    let env = Some(("GIT_INDEX_FILE", tmp_index_path.as_path()));

    run_git(repo_root, &["add", "-A"], env)?;
    let current_tree_sha = run_git(repo_root, &["write-tree"], env)?;

    let numstat_raw = run_git(
        repo_root,
        &["diff-tree", "-r", "--numstat", &base_commit_sha, &current_tree_sha],
        None,
    )?;

    let raw_diff = run_git(
        repo_root,
        &["diff-tree", "-r", "-p", "-U3", &base_commit_sha, &current_tree_sha],
        None,
    )?;

    let mut files = Vec::new();
    let mut total_added = 0;
    let mut total_removed = 0;

    for line in numstat_raw.lines().filter(|l| !l.trim().is_empty()) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let added: usize = parts[0].parse().unwrap_or(0);
            let removed: usize = parts[1].parse().unwrap_or(0);
            let file_path = parts[2].to_string();
            let base_name = Path::new(&file_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&file_path)
                .to_string();
            total_added += added;
            total_removed += removed;
            files.push(DiffFileSummary {
                path: file_path,
                base_name,
                added,
                removed,
            });
        }
    }

    Ok(CheckpointDiff {
        checkpoint_id: checkpoint_id.to_string(),
        base_sha: base_commit_sha,
        current_tree_sha,
        files,
        total_added,
        total_removed,
        raw_diff,
        right_pane_width_px: 360,
    })
}

/// Restore working tree byte-for-byte to checkpoint state without touching other refs.
pub fn undo_checkpoint(
    repo_root: &Path,
    checkpoint_id: &str,
) -> Result<CheckpointUndoResult, CheckpointError> {
    validate_checkpoint_id(checkpoint_id)?;
    let ref_name = format!("refs/osmium/checkpoints/{}", checkpoint_id);

    // Verify existence of tree before modifying ANY working tree files
    let tree_rev = format!("{}^{{tree}}", ref_name);
    let tree_sha = run_git(repo_root, &["rev-parse", &tree_rev], None)
        .map_err(|_| CheckpointError::NotFound(checkpoint_id.to_string()))?;

    let commit_sha = run_git(repo_root, &["rev-parse", &ref_name], None)
        .map_err(|_| CheckpointError::NotFound(checkpoint_id.to_string()))?;

    // Reset index and working tree to the checkpoint tree
    run_git(repo_root, &["read-tree", "--reset", "-u", &tree_sha], None)?;

    // Clean untracked files and directories created after checkpoint
    run_git(repo_root, &["clean", "-fd"], None)?;

    Ok(CheckpointUndoResult {
        checkpoint_id: checkpoint_id.to_string(),
        restored_commit_sha: commit_sha,
        tree_sha,
    })
}

/// List all available checkpoints in the repository.
pub fn list_checkpoints(repo_root: &Path) -> Result<Vec<String>, CheckpointError> {
    let out = run_git(
        repo_root,
        &["for-each-ref", "--format=%(refname:strip=3)", "refs/osmium/checkpoints/"],
        None,
    )?;
    Ok(out.lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
}
