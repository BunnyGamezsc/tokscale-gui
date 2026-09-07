//! The P1 command surface designed by ticket 09.
//!
//! Five commands over a backend Snapshot. `scan` parses the corpus once into
//! `tauri::State`; the report commands re-aggregate from what is held rather
//! than rescanning, which ticket 09 measured at 41-100 ms against 879-3518 ms.
//!
//! Everything runs on `spawn_blocking`. A cold Scan blocks for 21-40 s, and
//! ticket 14 measured that leaving it on the async runtime starves every other
//! command that lives there.

use std::sync::Mutex;
use std::time::Instant;

use tokscale_core::{
    aggregate_model_usage_entries_with_rollup, filter_messages_for_report,
    generate_local_graph_report, model_report_token_totals, parse_local_unified_messages_with_pricing,
    pricing::PricingService, GroupBy, LocalParseOptions, ReportOptions, UnifiedMessage,
    WorktreeRollup,
};

use crate::dto::{Client, Day, Entry, Report, ScanSummary, Unpriced};

/// The Snapshot: the corpus of Unified Messages produced by one Scan, held for
/// reports to be aggregated from. Replaced only by another Scan; it does not
/// expire (CONTEXT.md: **Snapshot**).
#[derive(Default)]
pub struct Snapshot(pub Mutex<Option<Vec<UnifiedMessage>>>);

/// The Report Filter: client, date-range and year constraints applied *before*
/// aggregation. Narrowing it changes what each Entry means, not which Entries
/// are displayed (CONTEXT.md: **Report Filter**).
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub clients: Option<Vec<String>>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub year: Option<String>,
}

impl Filter {
    fn report_options(&self, group_by: GroupBy) -> ReportOptions {
        ReportOptions {
            home_dir: None,
            // Ticket 09: this is the ten lines `tokscale-cli` was supposed to
            // buy us. `use_env_roots` is simply "no explicit home was given".
            use_env_roots: true,
            clients: self.clients.clone(),
            since: self.since.clone(),
            until: self.until.clone(),
            year: self.year.clone(),
            group_by,
            worktree_rollup: WorktreeRollup::default(),
            scanner_settings: Default::default(),
        }
    }

    fn parse_options(&self) -> LocalParseOptions {
        LocalParseOptions {
            home_dir: None,
            use_env_roots: true,
            clients: self.clients.clone(),
            since: self.since.clone(),
            until: self.until.clone(),
            year: self.year.clone(),
            scanner_settings: Default::default(),
        }
    }
}

fn parse_group_by(s: &str) -> Result<GroupBy, String> {
    s.parse::<GroupBy>()
        .map_err(|_| format!("unknown group-by: {s}"))
}

/// Runs blocking work off the async runtime, and gives it a runtime to await
/// core's `async fn`s on. Both halves are needed: core's entry points are async
/// but do their work synchronously on the calling thread.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("worker thread failed: {e}"))?
}

/// Walks every enabled Client's data locations and parses transcripts into
/// Unified Messages, replacing the held Snapshot.
///
/// Errors are all-or-nothing: core swallows per-source parse failures, so there
/// is no partial-failure channel to report through (ticket 09).
///
/// A Snapshot is replaced only by another Scan and does not expire, so an
/// unforced call with one already held returns its summary rather than
/// rescanning. Without this every webview reload costs a fresh Scan — the
/// backend keeps the corpus, but the frontend's query cache does not survive a
/// reload and would ask again. `force` is what the Refresh control sends.
#[tauri::command]
pub async fn scan(
    state: tauri::State<'_, Snapshot>,
    filter: Option<Filter>,
    force: Option<bool>,
) -> Result<ScanSummary, String> {
    if !force.unwrap_or(false) {
        let guard = state.0.lock().map_err(|_| "snapshot lock poisoned")?;
        if let Some(held) = guard.as_ref() {
            return Ok(ScanSummary::of(held, 0));
        }
    }

    let filter = filter.unwrap_or_default();
    let started = Instant::now();

    let messages = blocking(move || {
        tauri::async_runtime::block_on(async move {
            // A forced rescan re-reads the manual pricing overrides. The cached
            // service would not: it reads `custom-pricing.json` once per launch,
            // so a rate entered in this session would not show up until restart.
            match crate::pricing::reloaded() {
                Some(fresh) => {
                    parse_local_unified_messages_with_pricing(
                        filter.parse_options(),
                        Some(&fresh),
                    )
                    .await
                }
                None => {
                    // No upstream pricing cached on disk yet, so this is the
                    // first scan: fetch through the shared service, which also
                    // populates those caches for the branch above.
                    let pricing = PricingService::get_or_init().await.ok();
                    parse_local_unified_messages_with_pricing(
                        filter.parse_options(),
                        pricing.as_deref(),
                    )
                    .await
                }
            }
        })
    })
    .await?;

    let summary = ScanSummary::of(&messages, started.elapsed().as_millis() as u32);
    *state.0.lock().map_err(|_| "snapshot lock poisoned")? = Some(messages);
    Ok(summary)
}

/// Re-aggregates the held Snapshot under a Group-By and Report Filter.
#[tauri::command]
pub async fn model_report(
    state: tauri::State<'_, Snapshot>,
    group_by: String,
    filter: Option<Filter>,
) -> Result<Report, String> {
    let group_by = parse_group_by(&group_by)?;
    let filter = filter.unwrap_or_default();
    let started = Instant::now();

    let messages = {
        let guard = state.0.lock().map_err(|_| "snapshot lock poisoned")?;
        guard
            .as_ref()
            .ok_or("no snapshot: run a scan first")?
            .clone()
    };

    let options = filter.report_options(group_by.clone());
    let filtered = filter_messages_for_report(messages, &options);
    let total_messages = filtered.iter().map(|m| m.message_count).sum();
    let entries =
        aggregate_model_usage_entries_with_rollup(filtered, &group_by, WorktreeRollup::default());
    let (total_input, total_output, total_cache_read, total_cache_write) =
        model_report_token_totals(&entries);

    Ok(Report {
        total_cost: entries.iter().map(|e| e.cost).sum(),
        entries: entries.iter().map(Entry::from).collect(),
        total_input,
        total_output,
        total_cache_read,
        total_cache_write,
        total_messages,
        elapsed_ms: started.elapsed().as_millis() as u32,
    })
}

/// The Contribution Graph's days.
///
/// The one asymmetry in the surface (ticket 09): this cannot be served from the
/// Snapshot, because core streams it through a private `GraphSink` that also
/// runs sessionize and active-time, so it re-enters the parse. It stays a ~0.9 s
/// call invalidated only by a `scan`.
#[tauri::command]
pub async fn graph_report(filter: Option<Filter>) -> Result<Vec<Day>, String> {
    let filter = filter.unwrap_or_default();

    let result = blocking(move || {
        tauri::async_runtime::block_on(generate_local_graph_report(
            filter.report_options(GroupBy::Model),
        ))
    })
    .await?;

    // Ramp bucketing is provisional and belongs to ticket 12. Core's own
    // `intensity` is a 0-4 linear split on cost relative to the busiest day,
    // which collapses under the skew real usage has. Ranking active days and
    // cutting into fifths keeps all five steps populated; whether the shipped
    // answer is quantile, logarithmic or something else is 12's call.
    let mut active: Vec<f64> = result
        .contributions
        .iter()
        .map(|c| c.totals.cost)
        .filter(|c| *c > 0.0)
        .collect();
    active.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let level_of = |cost: f64| -> u8 {
        if cost <= 0.0 || active.is_empty() {
            return 0;
        }
        let rank = active.partition_point(|c| *c < cost);
        let step = (rank * 5) / active.len();
        (step.min(4) + 1) as u8
    };

    Ok(result
        .contributions
        .iter()
        .map(|c| Day {
            date: c.date.clone(),
            level: level_of(c.totals.cost),
            cost: c.totals.cost,
            tokens: c.totals.tokens,
        })
        .collect())
}

/// The Clients that produced usage, read off the Snapshot's aggregate.
///
/// Ticket 09: this reads the aggregate, never `ScanResult::files` — "found, but
/// parsed nothing" is reconstructed view-side, not guessed at here.
#[tauri::command]
pub async fn clients(state: tauri::State<'_, Snapshot>) -> Result<Vec<Client>, String> {
    let messages = {
        let guard = state.0.lock().map_err(|_| "snapshot lock poisoned")?;
        guard
            .as_ref()
            .ok_or("no snapshot: run a scan first")?
            .clone()
    };

    let mut by_client: std::collections::BTreeMap<String, Client> = Default::default();
    for m in &messages {
        let entry = by_client.entry(m.client.clone()).or_insert_with(|| Client {
            id: m.client.clone(),
            messages: 0,
            cost: 0.0,
        });
        entry.messages += m.message_count;
        entry.cost += m.cost;
    }

    let mut out: Vec<Client> = by_client.into_values().collect();
    out.sort_by(|a, b| b.cost.partial_cmp(&a.cost).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

/// Reads `~/.config/tokscale/settings.json`.
///
/// Read-only in P1. Ticket 09 was explicit that a load-then-write-back would
/// replace a user's config with defaults if the file exists but did not parse,
/// so nothing here writes until that refusal is implemented alongside it.
#[tauri::command]
pub async fn settings() -> Result<serde_json::Value, String> {
    blocking(|| {
        let Some(home) = std::env::var_os("HOME") else {
            return Ok(serde_json::Value::Null);
        };
        let path = std::path::Path::new(&home).join(".config/tokscale/settings.json");
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("{} did not parse: {e}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
            Err(e) => Err(format!("{} could not be read: {e}", path.display())),
        }
    })
    .await
}

/// Models carrying tokens but no cost.
///
/// There is no per-Entry Cost Source to read — `ModelUsage` does not carry one —
/// so "unpriced" is reconstructed the way upstream reconstructs it: tokens were
/// spent and the computed cost is still zero. That is exactly the set a manual
/// rate is for.
#[tauri::command]
pub async fn unpriced(state: tauri::State<'_, Snapshot>) -> Result<Vec<Unpriced>, String> {
    let messages = {
        let guard = state.0.lock().map_err(|_| "snapshot lock poisoned")?;
        guard
            .as_ref()
            .ok_or("no snapshot: run a scan first")?
            .clone()
    };

    let mut by_model: std::collections::BTreeMap<String, Unpriced> = Default::default();
    for m in &messages {
        let entry = by_model
            .entry(m.model_id.clone())
            .or_insert_with(|| Unpriced {
                model: m.model_id.clone(),
                provider: m.provider_id.clone(),
                clients: Vec::new(),
                input: 0,
                output: 0,
                cache_read: 0,
                cache_write: 0,
                messages: 0,
                cost: 0.0,
            });
        entry.input += m.tokens.input;
        entry.output += m.tokens.output;
        entry.cache_read += m.tokens.cache_read;
        entry.cache_write += m.tokens.cache_write;
        entry.messages += m.message_count;
        entry.cost += m.cost;
        if !entry.clients.contains(&m.client) {
            entry.clients.push(m.client.clone());
        }
    }

    let mut out: Vec<Unpriced> = by_model
        .into_values()
        .filter(|u| u.cost <= 0.0 && u.input + u.output + u.cache_read + u.cache_write > 0)
        .collect();
    // Most tokens first: that is the row where a rate is worth the most.
    out.sort_by_key(|u| std::cmp::Reverse(u.input + u.output + u.cache_read + u.cache_write));
    Ok(out)
}
