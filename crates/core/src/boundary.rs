use std::path::{Component, Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BoundaryError {
    #[error("Workspace boundary violation: refusing to write to \"{target_path}\" outside project root \"{project_root}\"")]
    WorkspaceBoundaryViolation {
        target_path: String,
        project_root: String,
    },
}

/// Normalizes path components lexically (resolving `.` and `..`) without
/// requiring filesystem existence, preventing Windows UNC prefix corruption.
pub fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if let Some(Component::Normal(_)) = out.components().last() {
                    out.pop();
                } else if out.as_os_str().is_empty()
                    || matches!(out.components().last(), Some(Component::ParentDir))
                {
                    out.push(comp);
                }
            }
            _ => out.push(comp),
        }
    }
    out
}

/// Resolves a target path against a root path.
/// If `target` is absolute (or has root), normalizes it directly.
/// If `target` is relative, joins it with `root` and normalizes.
pub fn resolve_relative_or_absolute(root: &Path, target: &Path) -> PathBuf {
    let is_absolute_or_rooted = target.is_absolute()
        || target.has_root()
        || target
            .components()
            .next()
            .map(|c| matches!(c, Component::RootDir | Component::Prefix(_)))
            .unwrap_or(false);

    let combined = if is_absolute_or_rooted {
        target.to_path_buf()
    } else {
        root.join(target)
    };
    normalize_lexical(&combined)
}

/// Checks whether `target_path` resolves inside `project_root`
/// (which includes `.osmium/worktrees/`) or optionally `~/.osmium/`.
/// Enforces Section 2.5: "The app never writes outside the project root or its own worktrees."
pub fn is_path_inside_workspace<P: AsRef<Path>, Q: AsRef<Path>>(
    project_root: P,
    target_path: Q,
    allow_global_osmium_dir: bool,
) -> bool {
    let root = project_root.as_ref();
    let target = target_path.as_ref();

    let resolved_root = normalize_lexical(root);
    let resolved_target = resolve_relative_or_absolute(root, target);

    // Check if target is inside project root
    if resolved_target.strip_prefix(&resolved_root).is_ok() {
        return true;
    }

    // Check if allowed in global ~/.osmium directory
    if allow_global_osmium_dir {
        if let Some(home) = dirs::home_dir() {
            let global_osmium = normalize_lexical(&home.join(".osmium"));
            if resolved_target.strip_prefix(&global_osmium).is_ok() {
                return true;
            }
        }
    }

    false
}

/// Asserts that writing to `target_path` is allowed inside `project_root`.
/// Returns the normalized resolved `PathBuf` or errors with `BoundaryError::WorkspaceBoundaryViolation`.
pub fn assert_workspace_write_allowed<P: AsRef<Path>, Q: AsRef<Path>>(
    project_root: P,
    target_path: Q,
    allow_global_osmium_dir: bool,
) -> Result<PathBuf, BoundaryError> {
    let root = project_root.as_ref();
    let target = target_path.as_ref();

    if !is_path_inside_workspace(root, target, allow_global_osmium_dir) {
        return Err(BoundaryError::WorkspaceBoundaryViolation {
            target_path: target.to_string_lossy().to_string(),
            project_root: root.to_string_lossy().to_string(),
        });
    }

    Ok(resolve_relative_or_absolute(root, target))
}
