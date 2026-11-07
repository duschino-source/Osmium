//! Adversarial empirical stress test suite for osmium-mock-cli.
//! Stress-tests concurrency across all 8 scenarios, exact exit codes (0, 1, 2, 3),
//! stdin approval torture (delayed, fragmented, whitespace, denial, EOF),
//! and workspace boundary security traversal attacks.

use osmium_core::types::AgentEvent;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const TIMEOUT: Duration = Duration::from_secs(15);

// ============================================================================
// Attack Vector A: Concurrency Stress Test Across All 8 Scenarios
// ============================================================================

#[tokio::test]
async fn test_concurrent_subprocess_invocations_across_all_8_scenarios() {
    let bin_path = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let scenarios = [
        "chat", "edit", "approval", "quota", "plan", "review", "teamwork", "raw",
    ];

    let root_tmp = tempfile::tempdir().expect("Failed to create root tempdir");
    let mut handles = Vec::new();

    // Launch 4 concurrent workers for each of the 8 scenarios = 32 concurrent processes
    for &scenario in &scenarios {
        for worker_idx in 0..4 {
            let bin = bin_path.to_string();
            let scen = scenario.to_string();
            let worker_dir = root_tmp
                .path()
                .join(format!("{}_{}", scenario, worker_idx));
            std::fs::create_dir_all(&worker_dir).expect("Failed to create worker dir");

            let handle = tokio::spawn(async move {
                let mut cmd = Command::new(&bin);
                cmd.args([
                    "--scenario",
                    &scen,
                    "--delay",
                    "0",
                    "--cwd",
                    worker_dir.to_str().unwrap(),
                ]);

                if scen == "edit" {
                    cmd.arg("--write-file");
                    cmd.args(["--target-file", "src/nested/output.ts"]);
                }

                cmd.stdin(Stdio::piped());
                cmd.stdout(Stdio::piped());
                cmd.stderr(Stdio::piped());

                let mut child = cmd.spawn().unwrap_or_else(|e| {
                    panic!("Failed to spawn mock-cli for scenario {}: {}", scen, e)
                });

                // If approval scenario, pipe approval asynchronously
                if scen == "approval" {
                    if let Some(mut stdin) = child.stdin.take() {
                        tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(15)).await;
                            let _ = stdin.write_all(b"{\"allow\":true}\n").await;
                            let _ = stdin.flush().await;
                        });
                    }
                }

                let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
                    .await
                    .expect("Child process timed out under concurrency")
                    .expect("Failed to wait on child process");

                assert_eq!(
                    output.status.code(),
                    Some(0),
                    "Scenario {} worker {} failed with exit code {:?}, stderr: {}",
                    scen,
                    worker_idx,
                    output.status.code(),
                    String::from_utf8_lossy(&output.stderr)
                );

                let stdout = String::from_utf8_lossy(&output.stdout);
                assert!(
                    !stdout.is_empty(),
                    "Scenario {} worker {} produced empty stdout",
                    scen,
                    worker_idx
                );

                // Verify events can deserialize into AgentEvent
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        let _evt: AgentEvent = serde_json::from_str(trimmed)
                            .unwrap_or_else(|e| panic!("Invalid AgentEvent JSON in {}: {}", scen, e));
                    }
                }

                // If edit scenario, verify written file exists
                if scen == "edit" {
                    let written_file = worker_dir.join("src/nested/output.ts");
                    assert!(
                        written_file.exists(),
                        "Edit scenario failed to write file to disk"
                    );
                }
            });

            handles.push(handle);
        }
    }

    // Await all 32 concurrent processes
    for handle in handles {
        handle.await.expect("Worker task panicked");
    }
}

// ============================================================================
// Attack Vector B: Exit Code Verification
// ============================================================================

#[tokio::test]
async fn test_exit_code_0_for_help_and_version() {
    let bins = [
        env!("CARGO_BIN_EXE_osmium-mock-cli"),
        env!("CARGO_BIN_EXE_mock-cli"),
    ];

    for bin in bins {
        // --help
        let out_help_long = Command::new(bin).arg("--help").output().await.unwrap();
        assert_eq!(out_help_long.status.code(), Some(0));
        let stdout_help = String::from_utf8_lossy(&out_help_long.stdout);
        assert!(stdout_help.contains("Usage:"));
        assert!(stdout_help.contains("--scenario"));

        // -h
        let out_help_short = Command::new(bin).arg("-h").output().await.unwrap();
        assert_eq!(out_help_short.status.code(), Some(0));

        // --version
        let out_ver_long = Command::new(bin).arg("--version").output().await.unwrap();
        assert_eq!(out_ver_long.status.code(), Some(0));
        let stdout_ver = String::from_utf8_lossy(&out_ver_long.stdout);
        assert!(stdout_ver.contains("mock-cli 0.1.0"));

        // -v
        let out_ver_short = Command::new(bin).arg("-v").output().await.unwrap();
        assert_eq!(out_ver_short.status.code(), Some(0));
        let stdout_ver_s = String::from_utf8_lossy(&out_ver_short.stdout);
        assert!(stdout_ver_s.contains("mock-cli 0.1.0"));
    }
}

#[tokio::test]
async fn test_exit_code_2_for_invalid_flags() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let invalid_flag_cases = [
        vec!["--invalid-flag"],
        vec!["--nonexistent-arg"],
        vec!["--foo=bar"],
        vec!["-z"],
        vec!["--delay", "not_a_valid_number"],
        vec!["--write-file", "--unrecognized-xyz"],
    ];

    for args in invalid_flag_cases {
        let output = Command::new(bin).args(&args).output().await.unwrap();
        assert_eq!(
            output.status.code(),
            Some(2),
            "Expected exit code 2 for args {:?}, got {:?}",
            args,
            output.status.code()
        );
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            !stderr.is_empty(),
            "Expected non-empty stderr for invalid flag {:?}",
            args
        );
    }
}

#[tokio::test]
async fn test_exit_code_3_for_unknown_scenarios() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let unknown_scenario_cases = [
        "nonexistent",
        "unknown_scen",
        "evil/scenario",
        "chat-fake",
        "12345",
        "not_a_scenario",
    ];

    for scen in unknown_scenario_cases {
        let output = Command::new(bin)
            .args(["--scenario", scen])
            .output()
            .await
            .unwrap();

        assert_eq!(
            output.status.code(),
            Some(3),
            "Expected exit code 3 for unknown scenario {}, got {:?}",
            scen,
            output.status.code()
        );

        let stdout = String::from_utf8_lossy(&output.stdout);
        let err_json: serde_json::Value =
            serde_json::from_str(stdout.trim()).expect("Stdout must be valid JSON on exit code 3");
        assert_eq!(err_json["type"], "status");
        assert_eq!(err_json["state"], "error");
        assert_eq!(
            err_json["message"],
            format!("Unknown scenario: {}", scen)
        );
    }
}

#[tokio::test]
async fn test_exit_code_1_for_boundary_violation() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let tmp = tempfile::tempdir().unwrap();

    let output = Command::new(bin)
        .args([
            "--scenario",
            "edit",
            "--delay",
            "0",
            "--cwd",
            tmp.path().to_str().unwrap(),
            "--write-file",
            "--target-file",
            "../../outside_workspace.txt",
        ])
        .output()
        .await
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("mock-cli error:"));
    assert!(stderr.contains("Workspace boundary violation"));
}

// ============================================================================
// Attack Vector C: Stdin Approval Torture Tests
// ============================================================================

#[tokio::test]
async fn test_stdin_approval_torture_delayed_input() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let mut cmd = Command::new(bin);
    cmd.args(["--scenario", "approval", "--delay", "0"]);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().expect("Failed to spawn mock-cli");
    let mut stdin = child.stdin.take().expect("Failed to take stdin");

    tokio::spawn(async move {
        // Simulate network or user delay
        tokio::time::sleep(Duration::from_millis(80)).await;
        stdin.write_all(b"yes\n").await.unwrap();
        stdin.flush().await.unwrap();
    });

    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .expect("Process timed out waiting for delayed approval")
        .expect("Failed to get output");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Approved command completed successfully"));
}

#[tokio::test]
async fn test_stdin_approval_torture_fragmented_input() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let mut cmd = Command::new(bin);
    cmd.args(["--scenario", "approval", "--delay", "0"]);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().expect("Failed to spawn mock-cli");
    let mut stdin = child.stdin.take().expect("Failed to take stdin");

    tokio::spawn(async move {
        // Send byte by byte with small gaps
        for byte in b"allow\n" {
            tokio::time::sleep(Duration::from_millis(15)).await;
            stdin.write_all(&[*byte]).await.unwrap();
            stdin.flush().await.unwrap();
        }
    });

    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .expect("Process timed out waiting for fragmented approval")
        .expect("Failed to get output");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Approved command completed successfully"));
}

#[tokio::test]
async fn test_stdin_approval_torture_whitespace_padded_inputs() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let positive_inputs = [
        "  yes  \n",
        "   allow   \n",
        "  allow-session  \n",
        "   y   \n",
        "   true   \n",
        "   1   \n",
        "{ \"allow\": true }\r\n",
        "  { \"allow\": true }  \n",
        "{\"approved\": true}\n",
        "  { \"approved\": true }  \r\n",
        "\t\tyes\t\n",
    ];

    for input in positive_inputs {
        let mut cmd = Command::new(bin);
        cmd.args(["--scenario", "approval", "--delay", "0"]);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().expect("Failed to spawn mock-cli");
        let mut stdin = child.stdin.take().expect("Failed to take stdin");
        let input_bytes = input.as_bytes().to_vec();

        tokio::spawn(async move {
            stdin.write_all(&input_bytes).await.unwrap();
            stdin.flush().await.unwrap();
        });

        let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
            .await
            .unwrap_or_else(|_| panic!("Timed out for input {:?}", input))
            .unwrap();

        assert_eq!(output.status.code(), Some(0));
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains("Approved command completed successfully"),
            "Expected approval for input {:?}, got stdout: {}",
            input,
            stdout
        );
    }
}

#[tokio::test]
async fn test_stdin_approval_torture_denial_and_malformed_inputs() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let denial_inputs = [
        "no\n",
        "  no  \n",
        "   deny   \n",
        "0\n",
        "  0  \n",
        "{ \"allow\": false }\n",
        "{ \"approved\": false }\r\n",
        "random gibberish string\n",
        "{ malformed json syntax\n",
        "\n",
        "\r\n",
        "   \n",
    ];

    for input in denial_inputs {
        let mut cmd = Command::new(bin);
        cmd.args(["--scenario", "approval", "--delay", "0"]);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().expect("Failed to spawn mock-cli");
        let mut stdin = child.stdin.take().expect("Failed to take stdin");
        let input_bytes = input.as_bytes().to_vec();

        tokio::spawn(async move {
            stdin.write_all(&input_bytes).await.unwrap();
            stdin.flush().await.unwrap();
        });

        let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
            .await
            .unwrap_or_else(|_| panic!("Timed out for denial input {:?}", input))
            .unwrap();

        assert_eq!(output.status.code(), Some(0));
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains("Approval denied")
                && stdout.contains("Action cancelled because approval was denied"),
            "Expected denial for input {:?}, got stdout: {}",
            input,
            stdout
        );
    }
}

#[tokio::test]
async fn test_stdin_approval_torture_immediate_eof_pipe_close() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let mut cmd = Command::new(bin);
    cmd.args(["--scenario", "approval", "--delay", "0"]);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().expect("Failed to spawn mock-cli");
    // Explicitly drop stdin handle immediately before writing anything
    drop(child.stdin.take());

    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
        .await
        .expect("Process hung on EOF pipe close")
        .expect("Failed to get output");

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("Approval denied")
            && stdout.contains("Action cancelled because approval was denied"),
        "Expected denial on EOF, got stdout: {}",
        stdout
    );
}

// ============================================================================
// Attack Vector D: Boundary Security Directory Traversal Penetration
// ============================================================================

#[tokio::test]
async fn test_boundary_security_directory_traversal_penetration() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let sandbox = tempfile::tempdir().expect("Failed to create sandbox tempdir");
    let workspace = sandbox.path().join("workspace");
    std::fs::create_dir_all(&workspace).expect("Failed to create workspace directory");

    let outside_marker = sandbox.path().join("outside_canary.txt");
    assert!(!outside_marker.exists());

    let malicious_target_paths = [
        "../../outside_escape1.txt",
        "../../../outside_escape2.txt",
        "../outside_escape3.txt",
        "nested/../../../../outside_escape4.txt",
        "./../../outside_escape5.txt",
        "..\\..\\outside_escape6.txt",
        "nested\\..\\..\\..\\outside_escape7.txt",
        "/etc/shadow_fake",
        "\\absolute_win_root.txt",
    ];

    for target in malicious_target_paths {
        let output = Command::new(bin)
            .args([
                "--scenario",
                "edit",
                "--delay",
                "0",
                "--cwd",
                workspace.to_str().unwrap(),
                "--write-file",
                "--target-file",
                target,
            ])
            .output()
            .await
            .expect("Failed to execute mock-cli");

        assert_eq!(
            output.status.code(),
            Some(1),
            "Penetration attack with target {:?} did not return exit code 1! Got: {:?}",
            target,
            output.status.code()
        );

        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains("mock-cli error:"),
            "Stderr missing 'mock-cli error:' prefix for target {:?}: {}",
            target,
            stderr
        );
        assert!(
            stderr.contains("Workspace boundary violation"),
            "Stderr missing 'Workspace boundary violation' for target {:?}: {}",
            target,
            stderr
        );

        // Verify no escape files were created anywhere in the sandbox parent
        for i in 1..=7 {
            let escape_file = sandbox.path().join(format!("outside_escape{}.txt", i));
            assert!(
                !escape_file.exists(),
                "CRITICAL: Escape file {:?} was created on disk!",
                escape_file
            );
        }
    }

    // Also test absolute path directly targeting sandbox root
    let abs_target = sandbox.path().join("abs_violation.txt");
    let output = Command::new(bin)
        .args([
            "--scenario",
            "edit",
            "--delay",
            "0",
            "--cwd",
            workspace.to_str().unwrap(),
            "--write-file",
            "--target-file",
            abs_target.to_str().unwrap(),
        ])
        .output()
        .await
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("Workspace boundary violation"));
    assert!(!abs_target.exists(), "Absolute path file was written outside workspace!");
}

// ============================================================================
// Additional Stress Tests: Event Lifecycle & Output Formatting
// ============================================================================

#[tokio::test]
async fn test_all_8_scenarios_event_lifecycle_and_json_structure() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let scenarios = [
        "chat", "edit", "quota", "plan", "review", "teamwork", "raw",
    ];

    let tmp = tempfile::tempdir().unwrap();

    for scen in scenarios {
        let output = Command::new(bin)
            .args([
                "--scenario",
                scen,
                "--delay",
                "0",
                "--cwd",
                tmp.path().to_str().unwrap(),
            ])
            .output()
            .await
            .unwrap();

        assert_eq!(output.status.code(), Some(0));
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();
        assert!(!lines.is_empty(), "Scenario {} produced no output lines", scen);

        let events: Vec<AgentEvent> = lines
            .iter()
            .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("Scenario {} output line was not AgentEvent: {} (error: {})", scen, l, e)))
            .collect();

        // Check first event is status working
        assert!(
            matches!(&events[0], AgentEvent::Status { state, .. } if state == &osmium_core::types::SessionState::Working),
            "Scenario {} first event was not Status::Working",
            scen
        );

        // Check final event is status (Idle or Error)
        let last = events.last().unwrap();
        assert!(
            matches!(last, AgentEvent::Status { .. }),
            "Scenario {} last event was not Status",
            scen
        );
    }
}

#[tokio::test]
async fn test_text_output_mode_formatting() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let output = Command::new(bin)
        .args(["--scenario", "chat", "--delay", "0", "--text"])
        .output()
        .await
        .unwrap();

    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("[status]"));
    assert!(stdout.contains("[message]"));
    assert!(stdout.contains("[tool]"));
}

#[tokio::test]
async fn test_prompt_inference_torture() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let prompt_cases = [
        ("   /plan   Add extra tasks  ", "Proposed Plan:"),
        ("   /review   ", "Read-only diff review complete:"),
        ("   /teamwork Build new system ", "Build new system"),
        ("Please edit the database schema", "Updated src/routes/compare.ts"),
        ("Hit subscription quota and stop", "Rate or subscription quota limit reached"),
    ];

    for (prompt, expected_content) in prompt_cases {
        let output = Command::new(bin)
            .args(["-p", prompt, "-d", "0"])
            .output()
            .await
            .unwrap();

        assert_eq!(
            output.status.code(),
            Some(0),
            "Failed for prompt {:?}: stderr = {}",
            prompt,
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains(expected_content),
            "Prompt {:?} output did not contain {:?}. Output:\n{}",
            prompt,
            expected_content,
            stdout
        );
    }
}

#[tokio::test]
async fn test_approval_kinds_edit_and_network_subprocess() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let kinds = [
        ("edit", "Write changes to src/routes/compare.ts"),
        ("network", "Fetch schema from https://example.com/schema.json"),
    ];

    for (kind, expected_detail) in kinds {
        let mut cmd = Command::new(bin);
        cmd.args([
            "--scenario",
            "approval",
            "--approval-kind",
            kind,
            "--delay",
            "0",
        ]);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        tokio::spawn(async move {
            let _ = stdin.write_all(b"yes\n").await;
        });

        let output = tokio::time::timeout(TIMEOUT, child.wait_with_output())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(output.status.code(), Some(0));
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains(expected_detail));
        assert!(stdout.contains(&format!("\"kind\":\"{}\"", kind)));
    }
}

#[tokio::test]
async fn test_system_context_and_resume_flags_subprocess() {
    let bin = env!("CARGO_BIN_EXE_osmium-mock-cli");

    // --system-context
    let out_ctx = Command::new(bin)
        .args([
            "--scenario",
            "chat",
            "--delay",
            "0",
            "--system-context",
            "Previous conversation summary",
        ])
        .output()
        .await
        .unwrap();

    assert_eq!(out_ctx.status.code(), Some(0));
    let stdout_ctx = String::from_utf8_lossy(&out_ctx.stdout);
    assert!(stdout_ctx.contains("[Handoff context received]"));

    // --resume
    let out_res = Command::new(bin)
        .args([
            "--scenario",
            "chat",
            "--delay",
            "0",
            "--resume",
            "sess-9944",
        ])
        .output()
        .await
        .unwrap();

    assert_eq!(out_res.status.code(), Some(0));
    let stdout_res = String::from_utf8_lossy(&out_res.stdout);
    assert!(stdout_res.contains("[Resumed sess-9944]"));
}

#[tokio::test]
async fn test_mock_cli_binary_alias_parity() {
    let bin_osmium = env!("CARGO_BIN_EXE_osmium-mock-cli");
    let bin_alias = env!("CARGO_BIN_EXE_mock-cli");

    let out1 = Command::new(bin_osmium)
        .args(["--scenario", "plan", "--delay", "0"])
        .output()
        .await
        .unwrap();

    let out2 = Command::new(bin_alias)
        .args(["--scenario", "plan", "--delay", "0"])
        .output()
        .await
        .unwrap();

    assert_eq!(out1.status.code(), Some(0));
    assert_eq!(out2.status.code(), Some(0));
    assert_eq!(out1.stdout, out2.stdout);
}

