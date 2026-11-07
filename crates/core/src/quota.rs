use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::storage::{SqliteStorage, StorageError};
use crate::types::CliUsageStats;

#[derive(Debug, Error)]
pub enum QuotaError {
    #[error("Storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("All configured CLIs have hit their quota limits: {0}")]
    AllClisExhausted(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QuotaFallbackPolicy {
    NextSecondary,
    Ask,
    Stop,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FallbackOutcome {
    SwitchedToSecondary { next_cli: String },
    PausedQuota,
    WaitingApproval { suggested_cli: String },
    Exhausted { message: String },
}

pub struct QuotaTracker {
    storage: SqliteStorage,
}

impl QuotaTracker {
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage }
    }

    /// Records factual turn completion in SQLite cli_usage without synthesizing fake metrics.
    pub async fn record_turn_usage(
        &self,
        cli_id: &str,
        limit_hit: bool,
        note: Option<&str>,
    ) -> Result<CliUsageStats, QuotaError> {
        let stats = self.storage.record_cli_turn_usage(cli_id, limit_hit, note).await?;
        Ok(stats)
    }

    pub async fn get_usage(&self, cli_id: &str) -> Result<CliUsageStats, QuotaError> {
        let stats = self.storage.get_cli_usage(cli_id).await?;
        Ok(stats)
    }

    /// Calculates the next CLI candidate in the priority chain [primary, ...secondaries]
    pub fn determine_next_cli(
        primary: &str,
        secondaries: &[String],
        current: &str,
        exhausted: &[String],
    ) -> Option<String> {
        let mut chain = Vec::with_capacity(1 + secondaries.len());
        chain.push(primary);
        for s in secondaries {
            chain.push(s.as_str());
        }

        chain
            .into_iter()
            .find(|&candidate| candidate != current && !exhausted.iter().any(|e| e == candidate))
            .map(|s| s.to_string())
    }

    /// Evaluates fallback policy when limit_hit is true.
    pub fn handle_limit_hit(
        policy: QuotaFallbackPolicy,
        primary: &str,
        secondaries: &[String],
        current_cli: &str,
        exhausted_clis: &[String],
    ) -> FallbackOutcome {
        match policy {
            QuotaFallbackPolicy::Stop => FallbackOutcome::PausedQuota,
            QuotaFallbackPolicy::Ask => {
                let suggested = Self::determine_next_cli(primary, secondaries, current_cli, exhausted_clis)
                    .unwrap_or_else(|| primary.to_string());
                FallbackOutcome::WaitingApproval { suggested_cli: suggested }
            }
            QuotaFallbackPolicy::NextSecondary => {
                if let Some(next) = Self::determine_next_cli(primary, secondaries, current_cli, exhausted_clis) {
                    FallbackOutcome::SwitchedToSecondary { next_cli: next }
                } else {
                    let mut all = vec![primary.to_string()];
                    all.extend_from_slice(secondaries);
                    FallbackOutcome::Exhausted {
                        message: format!("All configured CLIs ({}) have hit their quota limits.", all.join(", ")),
                    }
                }
            }
        }
    }
}
