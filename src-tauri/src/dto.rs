//! The IPC boundary types.
//!
//! Ticket 09 designed the command surface and chose camelCase across the whole
//! boundary. It reached that through feature-gated `serde(rename_all)` plus
//! `specta` derives in the forked core, on the grounds that GUI-side DTOs would
//! mean ~150 duplicated fields.
//!
//! Building it says otherwise: P1 reads 15 fields, not 150. Core's own shapes
//! are also inconsistent — `ModelUsage` is snake_case while its nested
//! `ModelPerformance` is camelCase (ticket 08 found this) — so serializing them
//! directly would export that seam to TypeScript. These DTOs are the narrow
//! waist: core's shapes stay core's business, and the boundary is uniformly
//! camelCase because it is declared so here, in one file.
//!
//! P2 may still want `tauri-specta` to generate these from Rust rather than
//! hand-keeping them in step with `src/lib/api.ts`. At 15 fields, hand-keeping
//! is cheaper than the rc-versioned dependency.

use serde::Serialize;
use tokscale_core::{ModelUsage, UnifiedMessage};

/// One row of an aggregated report. Its identity is determined by the active
/// Group-By and Report Filter (CONTEXT.md: **Entry**).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub client: String,
    pub model: String,
    pub provider: String,
    pub session_id: Option<String>,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub message_count: i32,
    pub cost: f64,
}

impl From<&ModelUsage> for Entry {
    fn from(u: &ModelUsage) -> Self {
        Self {
            client: u.client.clone(),
            model: u.model.clone(),
            provider: u.provider.clone(),
            session_id: u.session_id.clone(),
            input: u.input,
            output: u.output,
            cache_read: u.cache_read,
            cache_write: u.cache_write,
            message_count: u.message_count,
            cost: u.cost,
        }
    }
}

/// An aggregated report: the Entries plus the totals that go above them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub entries: Vec<Entry>,
    pub total_input: i64,
    pub total_output: i64,
    pub total_cache_read: i64,
    pub total_messages: i32,
    pub total_cost: f64,
    /// How long the re-aggregation took. Ticket 09 measured 41-100 ms against
    /// 879-3518 ms for a rescan; this is what proves that still holds.
    pub elapsed_ms: u32,
}

/// What a Scan produced, without the corpus itself — the messages stay in the
/// backend as the Snapshot and never cross the boundary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub messages: usize,
    pub first_day: Option<String>,
    pub last_day: Option<String>,
    pub elapsed_ms: u32,
}

impl ScanSummary {
    pub fn of(messages: &[UnifiedMessage], elapsed_ms: u32) -> Self {
        // `date` is already Bucket Timezone-bucketed by core, so this is the
        // real calendar day rather than a slice of a timestamp.
        let mut days: Vec<&str> = messages.iter().map(|m| m.date.as_str()).collect();
        days.sort_unstable();

        Self {
            messages: messages.len(),
            first_day: days.first().map(|s| s.to_string()),
            last_day: days.last().map(|s| s.to_string()),
            elapsed_ms,
        }
    }
}

/// One day of the Contribution Graph. `level` is a Ramp step, 1-5, or 0 for a
/// day with no usage at all — absence is not a step.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub level: u8,
    pub cost: f64,
    pub tokens: i64,
}

/// A Client that produced usage, with how much.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub id: String,
    pub messages: i32,
    pub cost: f64,
}

/// A model that spent tokens but produced no cost — a candidate for a manual
/// rate. Token totals are carried so the user can see which row is worth
/// pricing first.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unpriced {
    pub model: String,
    pub provider: String,
    pub clients: Vec<String>,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub messages: i32,
    pub cost: f64,
}

/// Where one vendor CLI was found, for the window to say so.
///
/// `state` is `"onPath"`, `"offPath"` or `"missing"` — the three arms of
/// `vendor::Resolution`, kept as a string rather than a tagged enum because the
/// boundary is plain data and this is three more fields of it (ADR 0006).
/// `path` is `None` only for `"missing"`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VendorCli {
    pub name: String,
    pub state: &'static str,
    pub path: Option<String>,
}
