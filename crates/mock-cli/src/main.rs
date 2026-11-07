//! Binary entrypoint for osmium-mock-cli.

#[tokio::main]
async fn main() -> std::process::ExitCode {
    osmium_mock_cli::cli_main().await
}
