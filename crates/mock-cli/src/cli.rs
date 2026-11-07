//! CLI runner implementation for binaries.

use crate::args::{CliArgs, MockCliOptions, MOCK_CLI_VERSION};
use crate::run_mock_cli_scenario_with_io;
use clap::Parser;
use std::process::ExitCode;

pub async fn cli_main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();

    // 1. Parse arguments via clap
    let cli_args = match CliArgs::try_parse_from(&args) {
        Ok(a) => a,
        Err(err) => {
            use clap::error::ErrorKind;
            match err.kind() {
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => {
                    print!("{}", err);
                    return ExitCode::from(0);
                }
                _ => {
                    eprintln!("{}", err);
                    return ExitCode::from(2); // Unrecognized flag or syntax error
                }
            }
        }
    };

    if cli_args.version {
        println!("mock-cli {}", MOCK_CLI_VERSION);
        return ExitCode::from(0);
    }

    // 2. Validate scenario
    let opts = match MockCliOptions::from_args(cli_args) {
        Ok(opts) => opts,
        Err(unknown_scen) => {
            let err_evt = serde_json::json!({
                "type": "status",
                "state": "error",
                "message": format!("Unknown scenario: {}", unknown_scen)
            });
            println!("{}", serde_json::to_string(&err_evt).unwrap());
            return ExitCode::from(3); // Unknown scenario
        }
    };

    // 3. Setup IO streams
    let stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let stdout = tokio::io::stdout();

    // 4. Run scenario with signal listener
    tokio::select! {
        res = run_mock_cli_scenario_with_io(&opts, Some(stdin), Some(stdout), None) => {
            match res {
                Ok(_) => ExitCode::from(0),
                Err(err) => {
                    eprintln!("mock-cli error: {}", err);
                    ExitCode::from(1) // Runtime error
                }
            }
        }
        _ = tokio::signal::ctrl_c() => {
            if opts.json {
                let cancel_evt = serde_json::json!({
                    "type": "status",
                    "state": "idle",
                    "message": "Cancelled via SIGINT"
                });
                println!("{}", serde_json::to_string(&cancel_evt).unwrap());
            }
            ExitCode::from(0)
        }
    }
}
