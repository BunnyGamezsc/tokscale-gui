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
        let days = || messages.iter().map(|m| m.date.as_str());

        Self {
            messages: messages.len(),
            first_day: days().min().map(str::to_string),
            last_day: days().max().map(str::to_string),
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

/// One hour of one day. `date` is the message's own Bucket Timezone day, the
/// key Daily folds on; `hour` is 0-23 in that zone, or `None` for usage with no
/// usable time (#36), which counts in its day but has no hour to draw.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourSlot {
    pub date: String,
    pub hour: Option<u8>,
    pub tokens: i64,
    pub message_count: i32,
    pub cost: f64,
}

/// Hour slots in chronological order, untimed first within a day.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyReport {
    pub slots: Vec<HourSlot>,
    pub total_messages: i32,
    pub total_cost: f64,
    pub elapsed_ms: u32,
}

/// One minute of one day. `minute` counts from the day's midnight in the Bucket
/// Timezone, so 0..1440; `None` is untimed, as in Hourly.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinuteSlot {
    pub date: String,
    pub minute: Option<u16>,
    pub tokens: i64,
    pub message_count: i32,
    pub cost: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinutelyReport {
    pub slots: Vec<MinuteSlot>,
    pub total_messages: i32,
    pub total_cost: f64,
    pub elapsed_ms: u32,
}

/// One agent's usage. `agent` is the TUI's normalized name, or `None` for
/// usage with no recorded agent, which is a row rather than dropped (#37).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRow {
    pub agent: Option<String>,
    /// The Clients this agent's usage came from, sorted.
    pub clients: Vec<String>,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub message_count: i32,
    pub cost: f64,
}

/// Agents by cost, most expensive first. The totals are Overview's.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsReport {
    pub agents: Vec<AgentRow>,
    pub total_input: i64,
    pub total_output: i64,
    pub total_cache_read: i64,
    pub total_messages: i32,
    pub total_cost: f64,
    pub elapsed_ms: u32,
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

/// **Usage (the tab)**: quota as each provider reported it (#39).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    pub cards: Vec<QuotaCard>,
    /// Providers with no credentials. They were not fetched at all.
    pub not_set_up: Vec<String>,
    /// Set when every fetch failed and the cards are the last result on disk:
    /// when that result was fetched, in Unix seconds.
    pub stale_since: Option<u64>,
}

/// One provider account. `state` is `"fresh"`, `"stale"` or `"failed"`. A
/// failed card has diagnostics and no metrics; diagnostics on a card with
/// metrics are a problem beside a result that still arrived.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaCard {
    pub provider: String,
    pub account: Option<String>,
    pub plan: Option<String>,
    pub state: &'static str,
    pub diagnostics: Vec<String>,
    pub metrics: Vec<QuotaMetric>,
    pub balance: Option<String>,
    pub unlimited: bool,
    pub overage_limit_reached: bool,
    /// Resets that can be spent early, for a provider that has them.
    pub reset_credits: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaMetric {
    pub label: String,
    pub used_percent: f64,
    pub remaining_percent: f64,
    /// The provider's own wording of what's left ("12/50 left"), when it has one.
    pub remaining_label: Option<String>,
    /// As sent: RFC 3339 from most providers, free text from a few.
    pub resets_at: Option<String>,
}

/// **Sync** (#40): when a provider's cache last received data, in Unix seconds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub provider: &'static str,
    pub last_synced_at: Option<u64>,
}

/// One sync's result. `state` is `"synced"`, `"notSetUp"` or `"failed"`.
/// `count` is in `unit` (`"rows"` for Cursor, `"sessions"` otherwise) and is 0
/// unless synced. `message` says why it didn't sync, or what went wrong beside
/// a sync that did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub provider: &'static str,
    pub state: &'static str,
    pub count: usize,
    pub unit: &'static str,
    pub message: Option<String>,
}

/// **Accounts** (#41): each provider's saved accounts, active first. No tokens.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Accounts {
    pub cursor: Vec<Account>,
    pub codex: Vec<Account>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: Option<String>,
    pub active: bool,
}

/// `state` is `"added"`, `"notSetUp"` (the vendor's tool isn't signed in) or
/// `"failed"`. `message` says which, for the two that aren't added.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountAdded {
    pub state: &'static str,
    pub message: Option<String>,
}

/// The codex CLI's current login's activity. `status` is `"available"`,
/// `"unsupportedCli"` (not found, or too old), `"unsupportedAuth"` or
/// `"unavailable"`; `message` is set for all but the first.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexActivity {
    pub status: &'static str,
    pub lifetime_tokens: Option<u64>,
    pub current_streak_days: Option<u64>,
    pub message: Option<String>,
}
