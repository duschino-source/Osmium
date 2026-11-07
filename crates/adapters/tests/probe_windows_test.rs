//! Windows executable-resolution regressions.
//!
//! `npm install -g` creates `codex` (a POSIX shell script) beside `codex.cmd`
//! (the actual Windows launcher). Returning the extensionless script makes
//! detection report "not a valid Win32 application" for an installed CLI.

#![cfg(windows)]

use osmium_adapters::find_in_path;
use tempfile::tempdir;

#[test]
fn prefers_the_cmd_shim_over_the_extensionless_npm_script() {
    let dir = tempdir().expect("tempdir");
    let shim = dir.path().join("codex");
    std::fs::write(
        &shim,
        "#!/bin/sh\nexec node \"$basedir/node_modules/codex/bin.js\" \"$@\"\n",
    )
    .expect("write extensionless shim");
    let cmd = dir.path().join("codex.cmd");
    std::fs::write(
        &cmd,
        "@echo off\r\nnode \"%~dp0\\node_modules\\codex\\bin.js\" %*\r\n",
    )
    .expect("write cmd shim");

    let found = find_in_path(shim.to_str().expect("utf-8 path")).expect("resolved");
    assert_eq!(
        found, cmd,
        "an extensionless npm shell script must not shadow its .cmd launcher"
    );
}

#[test]
fn explicit_executable_extension_is_kept() {
    let dir = tempdir().expect("tempdir");
    let cmd = dir.path().join("tool.cmd");
    std::fs::write(&cmd, "@echo off\r\n").expect("write cmd");

    let found = find_in_path(cmd.to_str().expect("utf-8 path")).expect("resolved");
    assert_eq!(found, cmd);
}

#[test]
fn extensionless_pe_executable_is_still_accepted() {
    let dir = tempdir().expect("tempdir");
    let exe = dir.path().join("real-tool");
    std::fs::write(&exe, b"MZ\x90\x00not-a-real-program-but-a-PE-magic")
        .expect("write PE-magic file");

    let found = find_in_path(exe.to_str().expect("utf-8 path")).expect("resolved");
    assert_eq!(found, exe);
}
