//! SemVer comparison and version warning banner generation.

pub use crate::display::get_cli_display_name;

/// Compares two SemVer strings by dotted numeric segments.
///
/// Strips leading non-digits and separates on `[-+]`. Compares up to
/// `max(lenA, lenB, 3)` segments, padding missing segments with `0`.
/// Returns `1` if `A > B`, `-1` if `A < B`, `0` if equal.
pub fn compare_semver(version_a: &str, version_b: &str) -> i32 {
    let parse_parts = |s: &str| -> Vec<i64> {
        let clean = s.trim_start_matches(|c: char| !c.is_ascii_digit());
        let base = clean.split(['-', '+']).next().unwrap_or("");
        base.split('.')
            .map(|part| part.parse::<i64>().unwrap_or(0))
            .collect()
    };

    let parts_a = parse_parts(version_a);
    let parts_b = parse_parts(version_b);
    let len = parts_a.len().max(parts_b.len()).max(3);

    for i in 0..len {
        let a = parts_a.get(i).copied().unwrap_or(0);
        let b = parts_b.get(i).copied().unwrap_or(0);
        if a > b {
            return 1;
        } else if a < b {
            return -1;
        }
    }

    0
}

/// Produces a non-blocking warning banner when an installed CLI version is newer
/// than the tested version supported by Osmium.
pub fn create_version_warning(
    cli_id: &str,
    installed_version: Option<&str>,
    tested_version: Option<&str>,
) -> Option<String> {
    let (installed, tested) = (installed_version?, tested_version?);
    // An empty tested version means "never verified against a real binary".
    // Comparing against it would invent a warning, so stay silent.
    if installed.is_empty() || tested.is_empty() {
        return None;
    }
    if compare_semver(installed, tested) > 0 {
        Some(format!(
            "{} version {} is newer than tested version {}. Proceeding with compatibility fallback.",
            get_cli_display_name(cli_id),
            installed,
            tested
        ))
    } else {
        None
    }
}
