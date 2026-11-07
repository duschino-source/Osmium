//! Subprocess execution and exit code verification tests.

use std::process::Command;

#[test]
fn test_mock_cli_subprocess_execution() {
    let bin_path = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let output = Command::new(bin_path)
        .args(["--scenario", "chat", "--delay", "0"])
        .output()
        .expect("Failed to execute mock-cli binary");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("\"state\":\"working\""));
    assert!(stdout.contains("\"state\":\"idle\""));
}

#[test]
fn test_mock_cli_version_flag_exit_code_0() {
    let bin_path = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let output = Command::new(bin_path)
        .arg("--version")
        .output()
        .expect("Failed to execute mock-cli binary");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("mock-cli 0.1.0"));
}

#[test]
fn test_mock_cli_exit_code_2_on_unrecognized_flag() {
    let bin_path = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let output = Command::new(bin_path)
        .arg("--bogus-unrecognized-flag")
        .output()
        .expect("Failed to execute mock-cli binary");

    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn test_mock_cli_exit_code_3_on_unknown_scenario() {
    let bin_path = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let output = Command::new(bin_path)
        .args(["--scenario", "does-not-exist"])
        .output()
        .expect("Failed to execute mock-cli binary");

    assert_eq!(output.status.code(), Some(3));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("\"state\":\"error\""));
    assert!(stdout.contains("Unknown scenario: does-not-exist"));
}

#[test]
fn test_mock_cli_exit_code_1_on_workspace_boundary_violation() {
    let tmp = tempfile::tempdir().unwrap();
    let bin_path = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let output = Command::new(bin_path)
        .args([
            "--scenario",
            "edit",
            "--delay",
            "0",
            "--cwd",
            tmp.path().to_str().unwrap(),
            "--write-file",
            "--target-file",
            "../../forbidden.txt",
        ])
        .output()
        .expect("Failed to execute mock-cli binary");

    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("mock-cli error:"));
}
