//! CLI arguments parsing and scenario validation tests.

use clap::Parser;
use osmium_mock_cli::args::{CliArgs, MockCliOptions, MockScenarioName};

#[test]
fn test_parses_cli_flags_and_supports_version_and_help() {
    let args = CliArgs::try_parse_from(["mock-cli", "--version"]).unwrap();
    assert!(args.version);

    let parsed = CliArgs::try_parse_from([
        "mock-cli",
        "--scenario",
        "edit",
        "--delay",
        "5",
        "--cwd",
        "/tmp/demo",
        "--write-file",
    ])
    .unwrap();

    let opts = MockCliOptions::from_args(parsed).unwrap();
    assert_eq!(opts.scenario, MockScenarioName::Edit);
    assert_eq!(opts.delay_ms, 5);
    assert_eq!(opts.cwd, std::path::PathBuf::from("/tmp/demo"));
    assert!(opts.write_file);
}

#[test]
fn test_rejects_unknown_scenario_returning_err() {
    let parsed = CliArgs::try_parse_from(["mock-cli", "--scenario", "does-not-exist"]).unwrap();
    assert!(MockCliOptions::from_args(parsed).is_err());
}
