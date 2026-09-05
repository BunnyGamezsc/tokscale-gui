//! Ticket 08 — prove `tokscale-core` scans and aggregates in-process.
//!
//! This module is a measurement harness, not the command surface. The real
//! surface is designed by ticket 09; everything here exists to answer one
//! question with numbers: what does calling the scan and aggregation path from
//! inside Tauri actually cost on this machine?
//!
//! It is deliberately chatty — it re-runs the same report under every
//! `GroupBy` because each strategy changes what a row *means*, and the row
//! counts it produces are what the virtualization thresholds get decided from.

use std::time::Instant;

use serde::Serialize;
use tokscale_core::{scanner::ScannerSettings, ClientId, GroupBy, ReportOptions, WorktreeRollup};

/// One timed call, with whatever count that call is interesting for.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    pub label: String,
    pub wall_ms: u128,
    /// `processing_time_ms` as core reported it, where the call returns one.
    /// Core measures from its own entry point, so the gap between this and
    /// `wall_ms` is the cost of getting into and out of core — worth seeing
    /// separately before trusting core's own figure in the UI.
    pub core_reported_ms: Option<u32>,
    pub rows: usize,
}

/// A client that actually has data on this machine, and how much.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedClient {
    pub id: String,
    pub display_name: String,
    pub files: usize,
}

/// A client that produced rows in the aggregated report, whatever kind of
/// source it was read from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientUsage {
    pub client: String,
    pub messages: i32,
    pub rows: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProbe {
    pub home_dir: String,
    pub bucket_timezone: Option<String>,
    /// Every client id core knows about, whether or not it is installed here.
    pub clients_known: usize,
    /// Clients whose *file* scan turned up at least one transcript.
    ///
    /// This deliberately undercounts: a client whose usage lives in a SQLite
    /// database (Devin, Zed, Goose, Kiro, Crush, OpenCode, …) contributes no
    /// entries to `ScanResult::files` and so never appears here, even though
    /// it produces rows in the report. `clients_with_usage` is the honest
    /// count; this one is kept because the gap between the two is itself the
    /// finding.
    pub clients_detected: Vec<DetectedClient>,

    /// Clients that actually produced aggregate rows, from the report itself.
    /// This is the number that answers "how many clients were detected".
    pub clients_with_usage: Vec<ClientUsage>,
    /// Files the scanner located, summed across every client.
    pub files_found: usize,
    /// Non-file sources (SQLite databases and the like) the scan located.
    pub db_sources_found: usize,

    pub timings: Vec<Timing>,

    pub total_messages: i32,
    pub total_cost: f64,
    pub total_input: i64,
    pub total_output: i64,
    pub total_cache_read: i64,
    pub total_cache_write: i64,

    /// Daily contributions from the graph report — the Stats/Daily row count.
    pub contribution_days: usize,
    pub date_range: Option<(String, String)>,

    /// One aggregate row, serialized exactly as it would cross the IPC
    /// boundary. The ticket asks for the *actual* shape, so this carries a
    /// real row rather than a description of one.
    pub sample_entry: Option<serde_json::Value>,
    pub sample_contribution: Option<serde_json::Value>,
}

/// Read the `scanner` key out of `~/.config/tokscale/settings.json`.
///
/// The CLI does this through `tui::settings::load_scanner_settings_for_home`,
/// which lives in `tokscale-cli`, not core — so a core-only dependency has to
/// read the file itself. Kept deliberately small and non-fatal: a missing or
/// malformed settings file degrades to defaults rather than failing the scan,
/// which is the same thing the CLI's loader does.
fn load_scanner_settings() -> ScannerSettings {
    let Some(dir) = tokscale_core::paths::home_dir() else {
        return ScannerSettings::default();
    };
    let path = dir.join(".config/tokscale/settings.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return ScannerSettings::default();
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("scanner").cloned())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn report_options(group_by: GroupBy, settings: &ScannerSettings) -> ReportOptions {
    ReportOptions {
        home_dir: None,
        // Mirrors the CLI's `use_env_roots(&home_dir)`: env-var scan roots are
        // honoured whenever no explicit home override is in play.
        use_env_roots: true,
        clients: None,
        since: None,
        until: None,
        year: None,
        group_by,
        worktree_rollup: WorktreeRollup::default(),
        scanner_settings: settings.clone(),
    }
}

pub async fn run() -> Result<ScanProbe, String> {
    let settings = load_scanner_settings();
    let home_dir = tokscale_core::get_home_dir_string(&None)?;
    let mut timings = Vec::new();

    // 1. File discovery alone, with no parsing. This is the floor: whatever
    //    the reports cost, they cost at least this.
    let all_clients: Vec<String> = ClientId::ALL
        .iter()
        .map(|c| c.as_str().to_string())
        .collect();
    let t = Instant::now();
    let scan = tokscale_core::scanner::scan_all_clients_with_scanner_settings(
        &home_dir,
        &all_clients,
        true,
        &settings,
    );
    let discovery_ms = t.elapsed().as_millis();

    let mut clients_detected = Vec::new();
    let mut files_found = 0usize;
    for client in ClientId::ALL.iter() {
        let files = scan.files[*client as usize].len();
        files_found += files;
        if files > 0 {
            clients_detected.push(DetectedClient {
                id: client.as_str().to_string(),
                display_name: client.display_name().to_string(),
                files,
            });
        }
    }
    let db_sources_found = scan.opencode_dbs.len()
        + scan.crush_dbs.len()
        + scan.micode_dbs.len()
        + scan.devin_dbs.len()
        + scan.copilot_vscode_sessions.len()
        + [
            scan.copilot_desktop_db.is_some(),
            scan.synthetic_db.is_some(),
            scan.kilo_db.is_some(),
            scan.hermes_db.is_some(),
            scan.goose_db.is_some(),
            scan.zed_db.is_some(),
            scan.kiro_db.is_some(),
            scan.zcode_db.is_some(),
        ]
        .iter()
        .filter(|present| **present)
        .count();

    timings.push(Timing {
        label: "scan_all_clients (file discovery only)".into(),
        wall_ms: discovery_ms,
        core_reported_ms: None,
        rows: files_found + db_sources_found,
    });

    // 2. The first full report. In-process this is cold only in the sense that
    //    nothing is memoized in *this* process; core's on-disk source-message
    //    cache under ~/.config/tokscale/cache is a separate axis, exercised by
    //    clearing it between runs rather than from here.
    let t = Instant::now();
    let report = tokscale_core::get_model_report(report_options(GroupBy::ClientModel, &settings))
        .await
        .map_err(|e| format!("get_model_report(client,model) failed: {e}"))?;
    timings.push(Timing {
        label: "get_model_report client,model (first call)".into(),
        wall_ms: t.elapsed().as_millis(),
        core_reported_ms: Some(report.processing_time_ms),
        rows: report.entries.len(),
    });

    // 3. The same call again, same process. `filter_messages_for_report` and
    //    `aggregate_model_usage_entries_with_rollup` are private to core, so a
    //    caller cannot parse once and re-aggregate — every report re-enters the
    //    whole pipeline. This second call measures what that repetition costs.
    let t = Instant::now();
    let repeat = tokscale_core::get_model_report(report_options(GroupBy::ClientModel, &settings))
        .await
        .map_err(|e| format!("get_model_report repeat failed: {e}"))?;
    timings.push(Timing {
        label: "get_model_report client,model (second call, same process)".into(),
        wall_ms: t.elapsed().as_millis(),
        core_reported_ms: Some(repeat.processing_time_ms),
        rows: repeat.entries.len(),
    });

    // 4. Every remaining group-by. Row counts here are the input to the
    //    virtualization decision, because `session,model` fans out per session
    //    while `model` collapses to a handful of rows.
    for group_by in [
        GroupBy::Model,
        GroupBy::ClientProviderModel,
        GroupBy::WorkspaceModel,
        GroupBy::Session,
        GroupBy::ClientSession,
    ] {
        let label = format!("get_model_report {group_by}");
        let t = Instant::now();
        let r = tokscale_core::get_model_report(report_options(group_by, &settings))
            .await
            .map_err(|e| format!("{label} failed: {e}"))?;
        timings.push(Timing {
            label,
            wall_ms: t.elapsed().as_millis(),
            core_reported_ms: Some(r.processing_time_ms),
            rows: r.entries.len(),
        });
    }

    // 5. The graph report — the Daily and Stats views' data source.
    let t = Instant::now();
    let graph =
        tokscale_core::generate_local_graph_report(report_options(GroupBy::ClientModel, &settings))
            .await
            .map_err(|e| format!("generate_local_graph_report failed: {e}"))?;
    timings.push(Timing {
        label: "generate_local_graph_report".into(),
        wall_ms: t.elapsed().as_millis(),
        core_reported_ms: Some(graph.meta.processing_time_ms),
        rows: graph.contributions.len(),
    });

    // Distinct clients present in the aggregate, which is the count that
    // matters — unlike the file scan, it sees database-backed clients.
    let mut by_client: std::collections::BTreeMap<&str, (i32, usize)> =
        std::collections::BTreeMap::new();
    for entry in &report.entries {
        let slot = by_client.entry(entry.client.as_str()).or_insert((0, 0));
        slot.0 += entry.message_count;
        slot.1 += 1;
    }
    let clients_with_usage = by_client
        .into_iter()
        .map(|(client, (messages, rows))| ClientUsage {
            client: client.to_string(),
            messages,
            rows,
        })
        .collect();

    Ok(ScanProbe {
        home_dir,
        clients_with_usage,
        bucket_timezone: settings.bucket_timezone.clone(),
        clients_known: ClientId::COUNT,
        clients_detected,
        files_found,
        db_sources_found,
        total_messages: report.total_messages,
        total_cost: report.total_cost,
        total_input: report.total_input,
        total_output: report.total_output,
        total_cache_read: report.total_cache_read,
        total_cache_write: report.total_cache_write,
        contribution_days: graph.contributions.len(),
        date_range: Some((
            graph.meta.date_range_start.clone(),
            graph.meta.date_range_end.clone(),
        )),
        sample_entry: report.entries.first().and_then(|e| serde_json::to_value(e).ok()),
        sample_contribution: graph
            .contributions
            .last()
            .and_then(|c| serde_json::to_value(c).ok()),
        timings,
    })
}
