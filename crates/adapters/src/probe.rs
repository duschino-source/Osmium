//! CLI executable discovery, version probing, and capability negotiation.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::semver::create_version_warning;
use osmium_core::types::{Capabilities, CliDetectionResult};

/// Windows executable suffixes, in the order `cmd.exe`/`CreateProcess`
/// conventionally resolves them. `npm install -g` writes a `.cmd` shim next to
/// an extensionless POSIX shell script of the same name; the script is not a
/// Win32 executable and must never win the lookup.
#[cfg(windows)]
const WINDOWS_EXECUTABLE_EXTENSIONS: &[&str] = &["exe", "cmd", "bat", "com"];

#[cfg(windows)]
fn has_executable_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            WINDOWS_EXECUTABLE_EXTENSIONS
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

/// An extensionless file is runnable on Windows only when it is a real PE
/// executable (`MZ` magic). npm's extensionless shims are shell scripts.
#[cfg(windows)]
fn is_pe_executable(path: &Path) -> bool {
    use std::io::Read;
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 2];
    file.read_exact(&mut magic).is_ok() && magic == *b"MZ"
}

#[cfg(windows)]
fn is_windows_runnable(path: &Path) -> bool {
    path.is_file() && (has_executable_extension(path) || is_pe_executable(path))
}

/// Cross-platform lookup of binary in system PATH or direct path.
pub fn find_in_path(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    if p.is_absolute() || name.contains('/') || name.contains('\\') {
        #[cfg(windows)]
        {
            if is_windows_runnable(p) {
                return Some(p.to_path_buf());
            }
            // `with_extension` would replace dots in the file name; append the
            // suffix to the OS string instead.
            if p.extension().is_none() {
                for extension in WINDOWS_EXECUTABLE_EXTENSIONS {
                    let mut candidate = p.as_os_str().to_os_string();
                    candidate.push(".");
                    candidate.push(extension);
                    let candidate = PathBuf::from(candidate);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
            return None;
        }
        #[cfg(not(windows))]
        {
            if p.is_file() {
                return Some(p.to_path_buf());
            }
            return None;
        }
    }

    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        #[cfg(windows)]
        {
            let direct = dir.join(name);
            if has_executable_extension(Path::new(name)) {
                if direct.is_file() {
                    return Some(direct);
                }
            } else if Path::new(name).extension().is_none() {
                for extension in WINDOWS_EXECUTABLE_EXTENSIONS {
                    let candidate = dir.join(format!("{name}.{extension}"));
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
            // Fall back to an extensionless real PE executable (rare, but
            // legitimate on Windows).
            if is_windows_runnable(&direct) {
                return Some(direct);
            }
        }
        #[cfg(not(windows))]
        {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Extracts a SemVer string (`X.Y.Z`) from command output.
pub fn extract_semver(output: &str) -> Option<String> {
    for word in output.split_whitespace() {
        let clean = word
            .trim_start_matches(|c: char| !c.is_ascii_digit())
            .trim_end_matches(|c: char| !c.is_ascii_digit() && c != '+' && c != '-');
        let base = clean.split(['-', '+']).next().unwrap_or("");
        let parts: Vec<&str> = base.split('.').collect();
        if parts.len() >= 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        {
            return Some(clean.to_string());
        }
    }
    None
}

/// Probes a CLI binary with `--version` without panicking.
pub async fn probe_cli_executable(
    cli_id: &str,
    binary_path: Option<&Path>,
    tested_version: &str,
    timeout_duration: Duration,
) -> CliDetectionResult {
    let Some(bin) = binary_path else {
        return CliDetectionResult {
            installed: false,
            version: None,
            path: None,
            version_warning: Some("Binary not found in PATH".to_string()),
        };
    };

    if !bin.is_file() {
        return CliDetectionResult {
            installed: false,
            version: None,
            path: Some(bin.to_string_lossy().to_string()),
            version_warning: Some("Binary not found in PATH".to_string()),
        };
    }

    let mut cmd = Command::new(bin);
    cmd.arg("--version");
    cmd.kill_on_drop(true);

    let output_res = tokio::time::timeout(timeout_duration, cmd.output()).await;
    let output = match output_res {
        Ok(Ok(out)) if out.status.success() => out,
        Ok(Ok(out)) => {
            return CliDetectionResult {
                installed: false,
                version: None,
                path: Some(bin.to_string_lossy().to_string()),
                version_warning: Some(format!(
                    "Version probe failed with exit status {}",
                    out.status
                )),
            };
        }
        Ok(Err(err)) => {
            return CliDetectionResult {
                installed: false,
                version: None,
                path: Some(bin.to_string_lossy().to_string()),
                version_warning: Some(format!("Failed to execute version probe: {err}")),
            };
        }
        Err(_) => {
            return CliDetectionResult {
                installed: false,
                version: None,
                path: Some(bin.to_string_lossy().to_string()),
                version_warning: Some(format!(
                    "CLI probe timed out after {}ms",
                    timeout_duration.as_millis()
                )),
            };
        }
    };

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let semver = extract_semver(&stdout_str);

    let version_warning = match &semver {
        Some(v) => create_version_warning(cli_id, Some(v), Some(tested_version)),
        None => Some(format!(
            "Unparseable version output from {}: {:?}",
            bin.file_name().unwrap_or_default().to_string_lossy(),
            stdout_str.trim().chars().take(40).collect::<String>()
        )),
    };

    CliDetectionResult {
        installed: true,
        version: semver,
        path: Some(bin.to_string_lossy().to_string()),
        version_warning,
    }
}

/// Runs `<binary> --help` with a timeout and returns the combined
/// stdout/stderr text. Help output is frequently printed to stderr (and
/// sometimes with a non-zero exit status), so both streams and any
/// non-empty text are accepted.
pub async fn probe_help_text(binary_path: &Path, timeout_duration: Duration) -> Option<String> {
    if !binary_path.is_file() {
        return None;
    }

    let mut cmd = Command::new(binary_path);
    cmd.arg("--help");
    cmd.stdin(std::process::Stdio::null());
    cmd.kill_on_drop(true);

    let output = tokio::time::timeout(timeout_duration, cmd.output())
        .await
        .ok()?
        .ok()?;

    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Prober service for inspecting local CLI binaries and negotiating capabilities.
#[derive(Clone, Default)]
pub struct CliProber {
    capability_cache: Arc<RwLock<HashMap<String, Capabilities>>>,
}

impl CliProber {
    pub fn new() -> Self {
        Self {
            capability_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Evaluates capabilities from `--help` text with in-memory caching.
    pub async fn probe_capabilities(
        &self,
        cli_id: &str,
        version: Option<&str>,
        help_text: &str,
        tested_version: &str,
    ) -> Capabilities {
        let cache_key = format!("{}@{}", cli_id, version.unwrap_or("unknown"));
        {
            let cache = self.capability_cache.read().await;
            if let Some(caps) = cache.get(&cache_key) {
                return caps.clone();
            }
        }

        let lower = help_text.to_ascii_lowercase();
        // Only flag-shaped evidence counts. Bare words such as "ask" or the
        // "Usage:" heading of every help screen must never advertise a
        // capability the CLI has not actually shown.
        let capabilities = Capabilities {
            acp: lower.contains("--acp"),
            json_stream: lower.contains("--json"),
            resume: lower.contains("--resume"),
            approvals: lower.contains("--approval") || lower.contains("--ask-for-approval"),
            read_only_mode: lower.contains("--read-only") || lower.contains("--readonly"),
            reports_usage: lower.contains("--usage")
                || lower.contains("--quota")
                || lower.contains("quota"),
            tested_version: Some(tested_version.to_string()),
        };

        {
            let mut cache = self.capability_cache.write().await;
            cache.insert(cache_key, capabilities.clone());
        }

        capabilities
    }
}
