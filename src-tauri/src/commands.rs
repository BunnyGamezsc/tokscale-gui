//! The P1 command surface designed by ticket 09.
//!
//! Six commands over a backend Snapshot (the list is in `lib.rs`). `scan` parses the corpus once into
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
    generate_local_graph_report, model_report_token_totals,
    parse_local_unified_messages_with_pricing, pricing::PricingService, BucketTimezone, ClientId,
    GroupBy, LocalParseOptions, ReportOptions, UnifiedMessage, WorktreeRollup,
};

use crate::dto::{
    AgentRow, AgentsReport, Client, Day, Entry, HourSlot, HourlyReport, MinuteSlot,
    MinutelyReport, Report, ScanSummary, Unpriced,
};

/// The Snapshot: the corpus of Unified Messages produced by one Scan, held for
/// reports to be aggregated from. Replaced only by another Scan; it does not
/// expire (CONTEXT.md: **Snapshot**).
#[derive(Default)]
pub struct Snapshot(pub Mutex<Option<Vec<UnifiedMessage>>>);

/// The Report Filter: client, date-range and year constraints applied *before*
/// aggregation. Narrowing it changes what each Entry means, not which Entries
/// are displayed (CONTEXT.md: **Report Filter**).
///
/// Not to be confused with **Enabled Clients**, the set of Clients a Scan
/// parses (CONTEXT.md). The wire format collapses the two — `clients` below is
/// one field, and `scan` takes a whole `Filter` — so on the `scan` command this
/// same field *would* be a scan-time selection rather than a report-time one.
/// Ticket 30 decided the GUI's Enabled Clients are a constant, so the frontend
/// never sends `scan` a Filter at all (`api.scan(undefined, forced)`) and the
/// two meanings never both go down the wire. ADR 0005 records why, and why the
/// field was not split to say so in the type.
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
            clients: Some(self.clients.clone().unwrap_or_else(enabled_clients)),
            since: self.since.clone(),
            until: self.until.clone(),
            year: self.year.clone(),
            group_by,
            worktree_rollup: WorktreeRollup::default(),
            scanner_settings: crate::settings::scanner(),
        }
    }

    /// Client narrowing, applied to the held Snapshot *before* aggregation.
    ///
    /// One `Filter` field, two mechanisms. On the graph path `clients` is a
    /// parse input and core honours it (`generate_graph_with_loaded_pricing`
    /// picks which clients to walk). On the Snapshot path it is inert: core's
    /// report-time predicate consults `year`/`since`/`until` and never
    /// `clients`, pinned by `a_client_narrowing_is_inert_against_the_held_
    /// snapshot`. So the Snapshot path has to do it here, and an Entry pooled
    /// across Clients carries no breakdown to subtract afterwards
    /// (`narrowing_by_client_cannot_be_done_after_aggregation`).
    ///
    /// An empty selection narrows to nothing rather than to everything — that
    /// is what core's parse path does with `Some(vec![])` too.
    fn narrow_clients(&self, messages: Vec<UnifiedMessage>) -> Vec<UnifiedMessage> {
        match &self.clients {
            Some(want) => messages
                .into_iter()
                .filter(|m| want.contains(&m.client))
                .collect(),
            None => messages,
        }
    }

    pub(crate) fn parse_options(&self) -> LocalParseOptions {
        LocalParseOptions {
            home_dir: None,
            use_env_roots: true,
            clients: Some(self.clients.clone().unwrap_or_else(enabled_clients)),
            since: self.since.clone(),
            until: self.until.clone(),
            year: self.year.clone(),
            scanner_settings: crate::settings::scanner(),
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
pub(crate) async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("worker thread failed: {e}"))?
}

/// The held Snapshot, cloned out from under the lock so the report commands
/// can fold it inside `blocking` without holding the lock there.
fn held(state: &Snapshot) -> Result<Vec<UnifiedMessage>, String> {
    let guard = state.0.lock().map_err(|_| "snapshot lock poisoned")?;
    Ok(guard.as_ref().ok_or("no snapshot: run a scan first")?.clone())
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

    let messages =
        blocking(move || tauri::async_runtime::block_on(priced_parse(filter.parse_options())))
            .await?;

    let summary = ScanSummary::of(&messages, started.elapsed().as_millis() as u32);
    *state.0.lock().map_err(|_| "snapshot lock poisoned")? = Some(messages);
    Ok(summary)
}

/// The Snapshot parse, pricing included — what `scan` runs, and what the two
/// ignored probes below run so they measure the app's call rather than a copy.
pub(crate) async fn priced_parse(options: LocalParseOptions) -> Result<Vec<UnifiedMessage>, String> {
    // A forced rescan re-reads the manual pricing overrides. The cached
    // service would not: it reads `custom-pricing.json` once per launch,
    // so a rate entered in this session would not show up until restart.
    match crate::pricing::reloaded() {
        Some(fresh) => parse_local_unified_messages_with_pricing(options, Some(&fresh)).await,
        None => {
            // No upstream pricing cached on disk yet, so this is the
            // first scan: fetch through the shared service, which also
            // populates those caches for the branch above.
            let pricing = PricingService::get_or_init().await.ok();
            parse_local_unified_messages_with_pricing(options, pricing.as_deref()).await
        }
    }
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
    let messages = held(&state)?;
    blocking(move || Ok(report_of(messages, &group_by, &filter, started))).await
}

fn report_of(
    messages: Vec<UnifiedMessage>,
    group_by: &GroupBy,
    filter: &Filter,
    started: Instant,
) -> Report {
    let options = filter.report_options(group_by.clone());
    let filtered = filter_messages_for_report(filter.narrow_clients(messages), &options);
    let total_messages = filtered.iter().map(|m| m.message_count).sum();
    let entries =
        aggregate_model_usage_entries_with_rollup(filtered, &group_by, WorktreeRollup::default());
    let (total_input, total_output, total_cache_read, _) = model_report_token_totals(&entries);

    Report {
        total_cost: entries.iter().map(|e| e.cost).sum(),
        entries: entries.iter().map(Entry::from).collect(),
        total_input,
        total_output,
        total_cache_read,
        total_messages,
        elapsed_ms: started.elapsed().as_millis() as u32,
    }
}

/// Usage by hour, folded from the held Snapshot.
///
/// Not core's `get_hourly_report`, which puts its own client list together and
/// parses again. Its fold is not private the way `graph_report`'s is, and the
/// Unified Message already carries `timestamp`, so this costs what
/// `model_report` costs (#36).
#[tauri::command]
pub async fn hourly_report(
    state: tauri::State<'_, Snapshot>,
    filter: Option<Filter>,
) -> Result<HourlyReport, String> {
    let filter = filter.unwrap_or_default();
    let started = Instant::now();
    let messages = held(&state)?;
    blocking(move || {
        let zone = BucketTimezone::from_scanner_settings(&crate::settings::scanner());
        Ok(hourly_of(messages, &filter, &zone, started))
    })
    .await
}

/// The hour of day a message belongs to, in the zone that produced its `date`.
///
/// **The day is never derived again.** `date` is what Daily folds on, so a slot
/// keyed on it sums to Daily's day by construction. Only the hour is read off
/// `timestamp`, and only when that instant falls on `date` in `zone`. Otherwise
/// the message is untimed: `timestamp <= 0` is the parsers' "no usable time"
/// marker, and an hour on a different day would contradict the day it counts in.
/// Core writes `date + "00:00"` instead, which a profile draws as a midnight spike.
fn hour_of(m: &UnifiedMessage, zone: &BucketTimezone) -> Option<u8> {
    if m.timestamp <= 0 {
        return None;
    }
    let key = zone.hour_key(m.timestamp)?; // "YYYY-MM-DD HH:00"
    let (day, hour) = key.split_once(' ')?;
    if day != m.date {
        return None;
    }
    hour.get(..2)?.parse().ok()
}

/// Tokens, messages and cost per `(date, slot)`, chronological, over the
/// Report Filter. Hourly and Minutely differ only in `slot`.
fn slot_totals<K: Ord>(
    messages: Vec<UnifiedMessage>,
    filter: &Filter,
    slot: impl Fn(&UnifiedMessage) -> Option<K>,
) -> std::collections::BTreeMap<(String, Option<K>), (i64, i32, f64)> {
    let options = filter.report_options(GroupBy::Model);
    let filtered = filter_messages_for_report(filter.narrow_clients(messages), &options);

    // `None` sorts before `Some(0)`, so the untimed slot opens its day.
    let mut totals: std::collections::BTreeMap<_, (i64, i32, f64)> = Default::default();
    for m in &filtered {
        let t = totals.entry((m.date.clone(), slot(m))).or_default();
        t.0 = t.0.saturating_add(m.tokens.total());
        // Clamped as Daily's `DayAccumulator` clamps it, so the two agree.
        t.1 = t.1.saturating_add(m.message_count.max(0));
        t.2 += m.cost;
    }
    totals
}

fn hourly_of(
    messages: Vec<UnifiedMessage>,
    filter: &Filter,
    zone: &BucketTimezone,
    started: Instant,
) -> HourlyReport {
    let slots: Vec<HourSlot> = slot_totals(messages, filter, |m| hour_of(m, zone))
        .into_iter()
        .map(|((date, hour), (tokens, message_count, cost))| HourSlot {
            date,
            hour,
            tokens,
            message_count,
            cost,
        })
        .collect();

    HourlyReport {
        total_messages: slots.iter().map(|s| s.message_count).sum(),
        total_cost: slots.iter().map(|s| s.cost).sum(),
        slots,
        elapsed_ms: started.elapsed().as_millis() as u32,
    }
}

/// Usage by minute, folded from the held Snapshot like `hourly_report` (#38).
///
/// Upstream keeps Minutely out of its on-disk cache for cardinality. The GUI
/// has no such cache, and a minute slot is at most one per message, so this is
/// Hourly's fold at a finer key. `a_warm_scan_and_the_minutely_fold` measured it.
#[tauri::command]
pub async fn minutely_report(
    state: tauri::State<'_, Snapshot>,
    filter: Option<Filter>,
) -> Result<MinutelyReport, String> {
    let filter = filter.unwrap_or_default();
    let started = Instant::now();
    let messages = held(&state)?;
    blocking(move || {
        let zone = BucketTimezone::from_scanner_settings(&crate::settings::scanner());
        Ok(minutely_of(messages, &filter, &zone, started))
    })
    .await
}

/// The minute of day a message belongs to, on `hour_of`'s terms: read in the
/// Bucket Timezone, and untimed when that instant is not on the message's `date`.
/// Computed with chrono rather than from `hour_key`, because a zone's offset
/// is not always whole hours (India is +05:30).
fn minute_of(m: &UnifiedMessage, zone: &BucketTimezone) -> Option<u16> {
    use chrono::{TimeZone, Timelike};
    if m.timestamp <= 0 {
        return None;
    }
    let (date, minute) = match zone {
        BucketTimezone::Local => {
            let t = chrono::Local.timestamp_millis_opt(m.timestamp).single()?;
            (t.date_naive(), t.hour() * 60 + t.minute())
        }
        BucketTimezone::Pinned(tz) => {
            let t = tz.timestamp_millis_opt(m.timestamp).single()?;
            (t.date_naive(), t.hour() * 60 + t.minute())
        }
    };
    (date.format("%Y-%m-%d").to_string() == m.date).then_some(minute as u16)
}

fn minutely_of(
    messages: Vec<UnifiedMessage>,
    filter: &Filter,
    zone: &BucketTimezone,
    started: Instant,
) -> MinutelyReport {
    let slots: Vec<MinuteSlot> = slot_totals(messages, filter, |m| minute_of(m, zone))
        .into_iter()
        .map(|((date, minute), (tokens, message_count, cost))| MinuteSlot {
            date,
            minute,
            tokens,
            message_count,
            cost,
        })
        .collect();

    MinutelyReport {
        total_messages: slots.iter().map(|s| s.message_count).sum(),
        total_cost: slots.iter().map(|s| s.cost).sum(),
        slots,
        elapsed_ms: started.elapsed().as_millis() as u32,
    }
}

/// Usage by agent, folded from the held Snapshot.
///
/// The TUI builds this inside `tui::data`'s aggregation, in `tokscale-cli`,
/// which the GUI does not depend on. The Unified Message already carries
/// `agent`, so the grouping rule is ported here rather than linked (#37).
#[tauri::command]
pub async fn agents_report(
    state: tauri::State<'_, Snapshot>,
    filter: Option<Filter>,
) -> Result<AgentsReport, String> {
    let filter = filter.unwrap_or_default();
    let started = Instant::now();
    let messages = held(&state)?;
    blocking(move || Ok(agents_of(messages, &filter, started))).await
}

/// The agent a message is grouped under, spelled the way the TUI spells it.
///
/// Normalizing matters: without it `omo` and `Sisyphus` are two rows whose
/// totals still add up, which would hide the split. The per-client choice of
/// normalizer mirrors `tui/data/mod.rs`. A name that normalizes to nothing is
/// no agent, not an agent called "".
fn agent_of(m: &UnifiedMessage) -> Option<String> {
    use tokscale_core::sessions::{
        normalize_agent_name, normalize_copilot_agent_name, normalize_opencode_agent_name,
    };
    let raw = m.agent.as_deref()?;
    let name = match m.client.as_str() {
        "opencode" => normalize_opencode_agent_name(raw),
        "copilot" => normalize_copilot_agent_name(raw),
        _ => normalize_agent_name(raw),
    };
    (!name.trim().is_empty()).then_some(name)
}

fn agents_of(messages: Vec<UnifiedMessage>, filter: &Filter, started: Instant) -> AgentsReport {
    let options = filter.report_options(GroupBy::Model);
    let filtered = filter_messages_for_report(filter.narrow_clients(messages), &options);

    // The TUI skips messages with no agent. Here they are a row of their own
    // (`agent: None`), so the View's total is Overview's.
    let mut rows: std::collections::BTreeMap<Option<String>, AgentRow> = Default::default();
    for m in &filtered {
        let agent = agent_of(m);
        let row = rows.entry(agent.clone()).or_insert_with(|| AgentRow {
            agent,
            clients: Vec::new(),
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
            message_count: 0,
            cost: 0.0,
        });
        if !row.clients.contains(&m.client) {
            row.clients.push(m.client.clone());
        }
        // Unclamped, as core's model fold sums them, so the totals are Overview's.
        row.input = row.input.saturating_add(m.tokens.input);
        row.output = row.output.saturating_add(m.tokens.output);
        row.cache_read = row.cache_read.saturating_add(m.tokens.cache_read);
        row.cache_write = row.cache_write.saturating_add(m.tokens.cache_write);
        row.message_count = row.message_count.saturating_add(m.message_count);
        row.cost += m.cost;
    }

    let mut agents: Vec<AgentRow> = rows.into_values().collect();
    for a in &mut agents {
        a.clients.sort();
    }
    // The TUI's order: cost, then tokens, then name.
    let tokens = |a: &AgentRow| a.input + a.output + a.cache_read + a.cache_write;
    agents.sort_by(|a, b| {
        b.cost
            .total_cmp(&a.cost)
            .then_with(|| tokens(b).cmp(&tokens(a)))
            .then_with(|| a.agent.cmp(&b.agent))
    });

    AgentsReport {
        total_input: agents.iter().map(|a| a.input).sum(),
        total_output: agents.iter().map(|a| a.output).sum(),
        total_cache_read: agents.iter().map(|a| a.cache_read).sum(),
        total_messages: agents.iter().map(|a| a.message_count).sum(),
        total_cost: agents.iter().map(|a| a.cost).sum(),
        agents,
        elapsed_ms: started.elapsed().as_millis() as u32,
    }
}

/// Which Ramp step a day's cost falls on, given every active day's cost.
///
/// Absence is not a step. A zero-cost day is `0` — `--ramp-0`, which the graph
/// renders as "no usage" — and never shares a value with the cheapest active
/// day, which is `1`.
///
/// **The bucketing is logarithmic across the active span**: `t = ln(cost/min) /
/// ln(max/min)` over the active days, cut into five. Ticket 25 measured the
/// three candidates against `skewed()` in the tests below — 85 days spanning
/// three and a third decades, $0.02 to $41.50 with a median of $0.86, one day
/// dominating — counting days per step:
///
/// | candidate                             | 1  | 2  | 3  | 4  | 5  |
/// | ------------------------------------- | -- | -- | -- | -- | -- |
/// | core's ratio thresholds (¼, ½, ¾)      | 83 |  1 |  0 |  1 |  0 |
/// | the TUI's clamped continuous ratio    | 83 |  1 |  0 |  0 |  1 |
/// | quantile — rank cut into fifths       | 17 | 17 | 17 | 17 | 17 |
/// | **logarithmic across the span**       |  4 | 17 | 59 |  3 |  2 |
///
/// Both rivals are linear in dollars against the busiest day, so the dominant
/// day draws the other 83 as one shade — the collapse the placeholder existed
/// to avoid. Quantile does not collapse, but it reports *rank* rather than
/// size: exactly a fifth of the days per step whatever the costs are, so a flat
/// month and a savagely skewed one draw the same picture. The logarithm encodes
/// magnitude instead — one step is a fixed factor in dollars — so the graph
/// changes when the spending does. On the author's real corpus (70 active days,
/// $0.0058 to $104.67) it fills every step: 4 / 6 / 9 / 36 / 15.
///
/// **A distribution with no spread is not required to fill five steps.** When
/// every active day costs the same (including the case of a single active day)
/// `max == min`, there is no ordering to draw and every active day *is* the
/// busiest day, so every one of them is step 5. Only a distribution that
/// actually has spread is held to populating the whole Ramp — which is why
/// quantile's answer for these cases (every day ranks 0, so every day lands on
/// the *bottom* step, the busiest included) is wrong rather than merely
/// arbitrary.
pub fn ramp_level(active: &[f64], cost: f64) -> u8 {
    if cost <= 0.0 {
        return 0;
    }
    let (min, max) = active
        .iter()
        .copied()
        .filter(|c| *c > 0.0)
        .fold((f64::INFINITY, 0.0f64), |(lo, hi), c| {
            (lo.min(c), hi.max(c))
        });
    if max <= min {
        return 5;
    }
    ((cost / min).ln() / (max / min).ln() * 5.0)
        .ceil()
        .clamp(1.0, 5.0) as u8
}

/// The Contribution Graph's days.
///
/// The one asymmetry in the surface (ticket 09): this cannot be served from the
/// Snapshot, because core streams it through a private `GraphSink` that also
/// runs sessionize and active-time, so it re-enters the parse. Invalidated only
/// by a `scan`.
///
/// Ticket 27 settled what that costs and decided to keep it. The re-entered
/// parse reads the same on-disk cache the Scan just wrote, so the first graph
/// call after a Scan is sub-second — 0.28 s cold, 0.76 s warm in release — not
/// the several seconds it costs when called with no Scan in front of it. The UI
/// cannot make that call: `useGraph` is gated on the Scan landing. See
/// `a_scan_warms_the_graph_path`, which also measures a Client-narrowed call:
/// it walks a subset of the same warmed cache, so it is cheaper still.
///
/// A narrowed graph re-buckets. `ramp_level` is computed over the days the
/// Report Filter kept, so the Ramp always describes the distribution the user
/// is looking at rather than one they filtered away — narrowing to a quiet
/// Client re-colours every cell, and that is the bucketing telling the truth
/// about the narrowed question.
#[tauri::command]
pub async fn graph_report(filter: Option<Filter>) -> Result<Vec<Day>, String> {
    let filter = filter.unwrap_or_default();

    let result = blocking(move || {
        tauri::async_runtime::block_on(generate_local_graph_report(
            filter.report_options(GroupBy::Model),
        ))
    })
    .await?;

    let active: Vec<f64> = result
        .contributions
        .iter()
        .map(|c| c.totals.cost)
        .filter(|c| *c > 0.0)
        .collect();

    Ok(result
        .contributions
        .iter()
        .map(|c| Day {
            date: c.date.clone(),
            // A day spent entirely on unpriced models costs $0 but is not
            // absence (#29): it takes the bottom step rather than `--ramp-0`.
            level: ramp_level(&active, c.totals.cost).max(u8::from(c.totals.tokens > 0)),
            cost: c.totals.cost,
            tokens: c.totals.tokens,
        })
        .collect())
}

/// Every Client a Scan reads, by display name.
///
/// Read off `ClientId::ALL` rather than the Snapshot, which is what makes it
/// answerable *during* a Scan: `clients` below reports what a finished Scan
/// found, so before one lands the window cannot name a single Client. This is
/// the set `enabled_clients` hands core, minus core's own `synthetic` pseudo-
/// source, which has no data location to read.
///
/// Const data, no Snapshot, no I/O: it spawns nothing and cannot fail, which is
/// why it is not `async` and does not go through `blocking`.
#[tauri::command]
pub fn client_catalog() -> Vec<String> {
    ClientId::iter()
        .filter(|c| enabled(*c))
        .map(|c| c.display_name().to_string())
        .collect()
}

/// **Enabled Clients**: core's `parse_local` set plus Cursor. Upstream marks
/// Cursor `parse_local: false` because its Source is the sync cache, and the
/// CLI only reads it when a sync is in play. Left to core's default, a Scan
/// never reads what a Cursor sync wrote (#40, ADR 0005).
fn enabled(c: ClientId) -> bool {
    c.parse_local() || c == ClientId::Cursor
}

/// What a Scan and the graph ask core for when the Report Filter names no
/// Client: `resolve_local_parse_request`'s default, with Cursor added.
fn enabled_clients() -> Vec<String> {
    ClientId::iter()
        .filter(|c| enabled(*c))
        .map(|c| c.as_str().to_string())
        .chain(["synthetic".to_string()])
        .collect()
}

/// The Clients that produced usage, read off the Snapshot's aggregate.
///
/// Ticket 09: this reads the aggregate, never `ScanResult::files` — "found, but
/// parsed nothing" is reconstructed view-side, not guessed at here.
///
/// Takes a Report Filter so Stats' per-Client figures follow the active one.
/// The Filter control itself asks with none, so its options stay the whole
/// corpus rather than collapsing to whatever is already selected.
#[tauri::command]
pub async fn clients(
    state: tauri::State<'_, Snapshot>,
    filter: Option<Filter>,
) -> Result<Vec<Client>, String> {
    let messages = held(&state)?;
    let filter = filter.unwrap_or_default();
    blocking(move || Ok(clients_of(messages, &filter))).await
}

fn clients_of(messages: Vec<UnifiedMessage>, filter: &Filter) -> Vec<Client> {
    let messages = filter_messages_for_report(
        filter.narrow_clients(messages),
        &filter.report_options(GroupBy::Model),
    );

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
    out.sort_by(|a, b| {
        b.cost
            .partial_cmp(&a.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// Models carrying tokens but no cost.
///
/// There is no per-Entry Cost Source to read — `ModelUsage` does not carry one —
/// so "unpriced" is reconstructed the way upstream reconstructs it: tokens were
/// spent and the computed cost is still zero. That is exactly the set a manual
/// rate is for.
#[tauri::command]
pub async fn unpriced(state: tauri::State<'_, Snapshot>) -> Result<Vec<Unpriced>, String> {
    let messages = held(&state)?;
    blocking(move || Ok(unpriced_of(messages))).await
}

fn unpriced_of(messages: Vec<UnifiedMessage>) -> Vec<Unpriced> {
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
    out
}

#[cfg(test)]
mod tests {
    //! Ticket 11's evidence — what a Report Filter can and cannot do against
    //! the *held* Snapshot, which is the whole question of whether narrowing
    //! re-aggregates or rescans — followed by ticket 25's, which settles the
    //! Ramp bucketing without running a Scan.

    use super::*;
    use tokscale_core::TokenBreakdown;

    /// Ticket 28: the first-run window names what is being read, so the list it
    /// names has to be the list a Scan actually walks. Both sides come from the
    /// same registry; what this pins is the predicate and the omission.
    #[test]
    fn the_catalog_names_every_client_a_scan_reads() {
        let catalog = client_catalog();
        assert_eq!(
            catalog.len() + 1,
            enabled_clients().len(),
            "the catalog must mirror what a Scan asks core for, minus synthetic"
        );
        assert!(catalog.contains(&"Claude Code".to_string()));
        // Core's default set leaves Cursor out; a Scan must not (#40).
        assert!(catalog.contains(&ClientId::Cursor.display_name().to_string()));
        // `synthetic` is core's pseudo-source, not a place on disk to look.
        assert!(!catalog.iter().any(|c| c.eq_ignore_ascii_case("synthetic")));
        // All 53 of core's declared Clients.
        assert_eq!(catalog.len(), 53);
    }

    fn msg(client: &str, model: &str, date: &str, cost: f64) -> UnifiedMessage {
        UnifiedMessage {
            client: client.to_string(),
            model_id: model.to_string(),
            provider_id: "anthropic".to_string(),
            session_id: "s1".to_string(),
            workspace_key: None,
            workspace_label: None,
            timestamp: 0,
            date: date.to_string(),
            tokens: TokenBreakdown {
                input: 100,
                output: 10,
                cache_read: 0,
                cache_write: 0,
                reasoning: 0,
            },
            cost,
            cost_source: Default::default(),
            duration_ms: None,
            message_count: 1,
            agent: None,
            dedup_key: None,
            session_title: None,
            is_turn_start: false,
            model_attribution_conflicted: false,
        }
    }

    fn corpus() -> Vec<UnifiedMessage> {
        vec![
            msg("claude-code", "sonnet", "2026-08-01", 1.0),
            msg("codex", "sonnet", "2026-08-15", 2.0),
            msg("claude-code", "sonnet", "2026-09-01", 4.0),
        ]
    }

    /// `since` and `until` are inclusive on both ends, and compared as plain
    /// `YYYY-MM-DD` strings against the message's already-bucketed `date`. So a
    /// date range needs no timezone arithmetic on the frontend: the Bucket
    /// Timezone was applied when the message was parsed, and a range is two day
    /// strings.
    #[test]
    fn a_date_range_is_two_inclusive_day_strings() {
        let f = Filter {
            since: Some("2026-08-01".into()),
            until: Some("2026-08-15".into()),
            ..Default::default()
        };
        let kept = filter_messages_for_report(corpus(), &f.report_options(GroupBy::Model));
        assert_eq!(kept.len(), 2, "both boundary days must be inside the range");
        assert_eq!(kept[0].date, "2026-08-01");
        assert_eq!(kept[1].date, "2026-08-15");
    }

    /// The finding ticket 11 turns on: core's *report-time* predicate consults
    /// `year`, `since` and `until` only. `clients` is a **scan-time** selector —
    /// it chooses which client parsers run — so sending it to `model_report`,
    /// which re-aggregates a Snapshot that is already parsed, does nothing at
    /// all. The seam is typed but silently inert on this path.
    #[test]
    fn a_client_narrowing_is_inert_against_the_held_snapshot() {
        let f = Filter {
            clients: Some(vec!["claude-code".into()]),
            ..Default::default()
        };
        let kept = filter_messages_for_report(corpus(), &f.report_options(GroupBy::Model));
        assert_eq!(
            kept.len(),
            3,
            "core's report filter ignores `clients`; every message survives"
        );
    }

    /// What ticket 26 builds on top of that finding: **the command layer does
    /// the narrowing core's predicate will not.** Same Filter, same corpus, but
    /// run through `narrow_clients` before aggregation — codex's $2.00 is gone,
    /// which is the whole point of a Client selection in the Report Filter.
    #[test]
    fn a_client_narrowing_excludes_that_clients_cost_before_aggregation() {
        let f = Filter {
            clients: Some(vec!["claude-code".into()]),
            ..Default::default()
        };
        let options = f.report_options(GroupBy::Model);
        let kept = filter_messages_for_report(f.narrow_clients(corpus()), &options);
        assert_eq!(kept.len(), 2, "only claude-code's messages survive");

        let entries = aggregate_model_usage_entries_with_rollup(
            kept,
            &options.group_by,
            WorktreeRollup::default(),
        );
        let cost: f64 = entries.iter().map(|e| e.cost).sum();
        assert!(
            (cost - 5.0).abs() < 1e-9,
            "narrowed report costs {cost}, want 5.0 (7.0 less codex's 2.0)"
        );
    }

    /// A narrowing that matches nothing is an empty report, not an error. An
    /// empty selection is a real one — "no Clients" rather than "no constraint"
    /// — which is also how core's parse path reads `Some(vec![])`.
    #[test]
    fn a_narrowing_that_matches_nothing_is_empty_rather_than_everything() {
        for clients in [vec![], vec!["kiro".to_string()]] {
            let f = Filter {
                clients: Some(clients.clone()),
                ..Default::default()
            };
            assert!(
                f.narrow_clients(corpus()).is_empty(),
                "{clients:?} must narrow to nothing"
            );
        }

        let f = Filter {
            since: Some("2027-01-01".into()),
            ..Default::default()
        };
        let kept = filter_messages_for_report(corpus(), &f.report_options(GroupBy::Model));
        assert!(kept.is_empty(), "a range past the corpus keeps nothing");
    }

    /// Why a Report Filter cannot be a table filter (CONTEXT.md: **Report
    /// Filter**). Under `model`, one Entry pools every Client that ran that
    /// model, and the pooled row carries no client breakdown. Dropping rows
    /// after aggregation therefore cannot answer "just claude-code" — the
    /// narrowing has to happen to Unified Messages, before they are pooled.
    #[test]
    fn narrowing_by_client_cannot_be_done_after_aggregation() {
        let all = aggregate_model_usage_entries_with_rollup(
            corpus(),
            &GroupBy::Model,
            WorktreeRollup::default(),
        );
        assert_eq!(all.len(), 1, "one model, so one pooled Entry");
        let pooled = all[0].cost;

        let narrowed: Vec<UnifiedMessage> = corpus()
            .into_iter()
            .filter(|m| m.client == "claude-code")
            .collect();
        let before = aggregate_model_usage_entries_with_rollup(
            narrowed,
            &GroupBy::Model,
            WorktreeRollup::default(),
        );
        assert_eq!(before.len(), 1);

        // 5.0 against 7.0: the difference is codex's share, and nothing in the
        // pooled Entry says which 2.0 of it to remove.
        assert!(
            (before[0].cost - 5.0).abs() < 1e-9 && (pooled - 7.0).abs() < 1e-9,
            "pooled {pooled}, narrowed {}",
            before[0].cost
        );
    }

    /// Not a test — a timing probe, run by hand:
    /// `cargo test --lib -- --ignored --nocapture graph_report_cost`
    ///
    /// The global Report Filter drives `graph_report` too, and `graph_report`
    /// re-enters the parse rather than reading the Snapshot. Ticket 09 measured
    /// that at ~0.9 s; the 2026-09-06 handoff flags the figure as stale, and a
    /// global filter is only usable on Daily and Stats if it is still about
    /// that. This prints the real number against the real corpus.
    ///
    /// Note what its two figures mean: both calls are made with **no Scan in
    /// front of them**, so "warm" here is the second call in the same process.
    /// The app never makes that call — it Scans first. Ticket 27's
    /// `a_scan_warms_the_graph_path` below measures the order the app actually
    /// uses, and gets a very different number.
    #[test]
    #[ignore]
    fn graph_report_cost() {
        let run = |label: &str| {
            let started = Instant::now();
            let out = tauri::async_runtime::block_on(generate_local_graph_report(
                Filter::default().report_options(GroupBy::Model),
            ));
            let ms = started.elapsed().as_millis();
            match out {
                Ok(r) => println!("{label}: {ms} ms, {} days", r.contributions.len()),
                Err(e) => println!("{label}: {ms} ms, failed: {e}"),
            }
        };
        run("graph_report cold");
        run("graph_report warm");
    }

    /// Ticket 27's probe: **does a Scan warm the graph path before the first
    /// Daily visit?**
    ///
    /// `graph_report_cost` above cannot answer that. Its warm figure is the
    /// *second graph call*, and the app never makes one before Daily is first
    /// opened — it runs a Scan, then one graph call. Those are two different
    /// measurements, so this reproduces the app's order instead.
    ///
    /// The Scan is not the `scan` command: that is a `#[tauri::command]` taking
    /// `tauri::State` and there is no app handle in a test. It is what `scan`
    /// calls, with the same pricing branch, which is what does the warming.
    ///
    /// Warm arm — a machine that has scanned before, which is every launch
    /// after the first:
    ///
    /// `cargo test --lib --release -- --ignored --nocapture a_scan_warms`
    ///
    /// Cold arm — a first-ever run. `TOKSCALE_CONFIG_DIR` gives core a hermetic
    /// config root, so the parse cache starts empty and the real one is left
    /// alone. It moves the pricing cache too, so the scan re-fetches rates:
    /// that is part of a genuine first run.
    ///
    /// `TOKSCALE_CONFIG_DIR=$(mktemp -d) cargo test --lib --release -- --ignored --nocapture a_scan_warms`
    ///
    /// Run it by name. Both probes in this module walk the same corpus, and the
    /// harness would otherwise run them in one process where whichever went
    /// first warms the other.
    ///
    /// Prints; never asserts. The figures are the point and they belong to the
    /// machine and corpus that produced them, so they are recorded on the
    /// ticket rather than frozen here (see the note in `lib.rs` about tickets
    /// 08 and 14).
    #[test]
    #[ignore]
    fn a_scan_warms_the_graph_path() {
        println!(
            "profile: {}, config dir: {}",
            if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            },
            std::env::var("TOKSCALE_CONFIG_DIR")
                .unwrap_or_else(|_| "default (warm arm)".to_string())
        );

        let started = Instant::now();
        let snapshot =
            tauri::async_runtime::block_on(priced_parse(Filter::default().parse_options()))
                .expect("scan");
        let summary = ScanSummary::of(&snapshot, started.elapsed().as_millis() as u32);
        println!(
            "scan: {} ms, {} messages, {} - {}",
            summary.elapsed_ms,
            summary.messages,
            summary.first_day.as_deref().unwrap_or("-"),
            summary.last_day.as_deref().unwrap_or("-"),
        );

        let graph = |label: &str, filter: Filter| {
            let started = Instant::now();
            let out = tauri::async_runtime::block_on(generate_local_graph_report(
                filter.report_options(GroupBy::Model),
            ));
            let ms = started.elapsed().as_millis();
            match out {
                Ok(r) => println!("{label}: {ms} ms, {} days", r.contributions.len()),
                Err(e) => println!("{label}: {ms} ms, failed: {e}"),
            }
        };
        // The one the ticket asks about: what a user pays on their first visit
        // to Daily.
        graph("first graph call after the scan", Filter::default());
        // What `graph_report_cost` calls warm, measured here for comparison: if
        // the two agree, the Scan did the warming and a second call buys
        // nothing more.
        graph("second graph call", Filter::default());
        // Ticket 26: every change to the Report Filter is another graph call,
        // and a Client narrowing is a *new parse* rather than a slice of the
        // last one. It walks a subset of the same warmed cache, so it should
        // come in at or under the unnarrowed figures. Seconds here would
        // contradict #27 and belongs on #27 as a finding.
        graph(
            "narrowed graph call (one client)",
            Filter {
                clients: Some(vec!["codex".to_string()]),
                ..Default::default()
            },
        );
    }

    /// Ticket 10's first contract: **a drill-down sums to the row it opened
    /// from.** A coarser Group-By's Entry decomposes exactly into the finer
    /// Group-By's Entries that share its key — so "what is this row made of"
    /// needs no new command and no per-row filter. It is one already-cached
    /// finer report, read locally.
    ///
    /// This is the converse of `narrowing_by_client_cannot_be_done_after_
    /// aggregation`: you cannot *narrow* a pooled Entry after the fact, but you
    /// can *explain* it by re-reading the corpus one axis finer.
    #[test]
    fn a_finer_group_by_decomposes_a_coarser_entry_exactly() {
        let corpus = vec![
            msg("claude-code", "sonnet", "2026-08-01", 1.0),
            msg("codex", "sonnet", "2026-08-15", 2.0),
            msg("claude-code", "sonnet", "2026-09-01", 4.0),
            msg("claude-code", "opus", "2026-09-01", 8.0),
        ];

        let coarse = aggregate_model_usage_entries_with_rollup(
            corpus.clone(),
            &GroupBy::Model,
            WorktreeRollup::default(),
        );
        let fine = aggregate_model_usage_entries_with_rollup(
            corpus,
            &"client,provider,model"
                .parse::<GroupBy>()
                .expect("group-by"),
            WorktreeRollup::default(),
        );

        assert_eq!(coarse.len(), 2, "two models");
        assert!(
            fine.len() > coarse.len(),
            "finer axis must split at least one row"
        );

        for row in &coarse {
            let parts: Vec<_> = fine.iter().filter(|f| f.model == row.model).collect();
            assert!(!parts.is_empty(), "{} has no parts", row.model);

            let cost: f64 = parts.iter().map(|p| p.cost).sum();
            let messages: i32 = parts.iter().map(|p| p.message_count).sum();
            let input: i64 = parts.iter().map(|p| p.input).sum();

            assert!(
                (cost - row.cost).abs() < 1e-9,
                "{}: parts sum to {cost}, row says {}",
                row.model,
                row.cost
            );
            assert_eq!(messages, row.message_count, "{}: message count", row.model);
            assert_eq!(input, row.input, "{}: input tokens", row.model);
        }
    }

    /// Ticket 10's second contract, and the one only the real corpus can settle:
    /// **Daily's detail dialog must agree with the Daily row it opened from.**
    ///
    /// The row comes from `graph_report`, which re-enters the parse through
    /// core's private `GraphSink`. The dialog is served by `model_report` over
    /// the held Snapshot with `since == until == that day` — 41-100 ms, no
    /// second `graph_report`, no rescan, and no fork change. That only works if
    /// the two paths bucket a day identically.
    ///
    /// Ticket 26 extends it to the narrowed case, because the Report Filter now
    /// drives both paths and they honour it by *different mechanisms*: a range
    /// is a report-time predicate on one side and a parse input on the other,
    /// and a Client selection is a parse input on the graph side but this
    /// module's `narrow_clients` on the Snapshot side. Agreeing on the whole
    /// corpus does not imply agreeing under a narrowing, so all three arms run.
    ///
    /// Not a unit test — it walks real disk. Run by hand:
    /// `cargo test --lib -- --ignored --nocapture daily_detail_agrees`
    #[test]
    #[ignore]
    fn daily_detail_agrees_with_the_daily_row() {
        // Built with pricing, as `scan` builds it: without it every message
        // costs 0.0 and the paths disagree for a reason unrelated to bucketing.
        // Unnarrowed, because narrowing is report-time.
        let snapshot =
            tauri::async_runtime::block_on(priced_parse(Filter::default().parse_options()))
                .expect("scan");
        println!("snapshot: {} messages", snapshot.len());

        // One arm: every active day of `base`'s graph, checked against the
        // one-day report the dialog actually asks for, under the same base
        // narrowing. Returns the active days so a later arm can narrow to them.
        let check = |label: &str, base: Filter| -> Vec<String> {
            let graph = tauri::async_runtime::block_on(generate_local_graph_report(
                base.report_options(GroupBy::Model),
            ))
            .expect("graph_report");

            let mut active = Vec::new();
            let mut worst = 0.0f64;
            for day in graph.contributions.iter().filter(|c| c.totals.cost > 0.0) {
                let f = Filter {
                    since: Some(day.date.clone()),
                    until: Some(day.date.clone()),
                    clients: base.clients.clone(),
                    ..Default::default()
                };
                let options = f.report_options(
                    "client,provider,model"
                        .parse::<GroupBy>()
                        .expect("group-by"),
                );
                let kept = filter_messages_for_report(f.narrow_clients(snapshot.clone()), &options);
                let entries = aggregate_model_usage_entries_with_rollup(
                    kept,
                    &options.group_by,
                    WorktreeRollup::default(),
                );
                let cost: f64 = entries.iter().map(|e| e.cost).sum();
                worst = worst.max((cost - day.totals.cost).abs());
                assert!(
                    !entries.is_empty(),
                    "{label}, {}: the row has cost but the one-day filter found nothing",
                    day.date
                );
                active.push(day.date.clone());
            }

            println!(
                "{label}: checked {} active days, worst delta {worst:.9}",
                active.len()
            );
            assert!(!active.is_empty(), "{label}: no active days to check");
            assert!(worst < 1e-6, "{label}: dialog and row disagree by {worst}");
            active
        };

        let active = check("whole corpus", Filter::default());

        // A narrowed range, taken from the corpus so it is guaranteed to hold
        // days: the graph re-parses under it while the dialog stays a
        // report-time predicate over the full Snapshot.
        let mid = active[active.len() / 2].clone();
        println!("narrowing to {mid}..");
        check(
            "narrowed range",
            Filter {
                since: Some(mid),
                ..Default::default()
            },
        );

        // A narrowed Client: the graph honours it by walking fewer clients,
        // the dialog by `narrow_clients` over the Snapshot. Two mechanisms,
        // one answer, or this fails.
        let mut counts: std::collections::BTreeMap<&str, usize> = Default::default();
        for m in &snapshot {
            *counts.entry(m.client.as_str()).or_default() += 1;
        }
        let busiest = counts
            .into_iter()
            .max_by_key(|(_, n)| *n)
            .map(|(c, _)| c.to_string())
            .expect("the corpus has a client");
        println!("narrowing to client {busiest}");
        check(
            "narrowed client",
            Filter {
                clients: Some(vec![busiest]),
                ..Default::default()
            },
        );
    }

    // ---- Ticket 36: Hourly ----

    /// Seoul has no DST and sits nine hours off UTC, so its midnight is 15:00
    /// the previous UTC day: an hour computed in the wrong zone lands on the
    /// wrong side of it.
    fn seoul() -> BucketTimezone {
        BucketTimezone::from_pinned_name(Some("Asia/Seoul"))
    }

    /// 2026-08-01 23:59:59 in Seoul.
    const BEFORE_MIDNIGHT: i64 = 1_785_596_399_000;

    /// A message at `timestamp`, dated the way core's rebucket pass dates it:
    /// the day that instant falls on in the Bucket Timezone.
    fn at(client: &str, timestamp: i64, cost: f64) -> UnifiedMessage {
        let mut m = msg(client, "sonnet", &seoul().day_key(timestamp), cost);
        m.timestamp = timestamp;
        m
    }

    fn midnight_corpus() -> Vec<UnifiedMessage> {
        let mut untimed = msg("claude-code", "sonnet", "2026-08-02", 16.0);
        untimed.timestamp = 0;
        vec![
            at("claude-code", BEFORE_MIDNIGHT - 12 * 3_600_000, 1.0), // 08-01 11:59
            at("claude-code", BEFORE_MIDNIGHT, 2.0),                  // 08-01 23:59:59
            at("codex", BEFORE_MIDNIGHT + 2_000, 4.0),                // 08-02 00:00:01
            at("claude-code", BEFORE_MIDNIGHT + 1_800_000, 8.0),      // 08-02 00:30
            untimed,
        ]
    }

    /// The agreement #36 asks for: **each day's hours sum to Daily's day.**
    /// Daily is `aggregate_by_date`'s fold (`graph_report` runs the same
    /// `DailyFold`), keyed on `date`. The messages sit a second either side of
    /// Seoul's midnight, which is the afternoon in UTC, so this also pins which
    /// zone the hour is read in.
    #[test]
    fn each_days_hours_sum_to_dailys_day_across_midnight() {
        let corpus = midnight_corpus();
        let report = hourly_of(corpus.clone(), &Filter::default(), &seoul(), Instant::now());
        let daily = tokscale_core::aggregate_by_date(corpus);
        assert_eq!(daily.len(), 2);

        for day in &daily {
            let slots: Vec<_> = report.slots.iter().filter(|s| s.date == day.date).collect();
            let cost: f64 = slots.iter().map(|s| s.cost).sum();
            let tokens: i64 = slots.iter().map(|s| s.tokens).sum();
            let messages: i32 = slots.iter().map(|s| s.message_count).sum();
            assert!((cost - day.totals.cost).abs() < 1e-9, "{}: {cost} vs {}", day.date, day.totals.cost);
            assert_eq!(tokens, day.totals.tokens, "{}: tokens", day.date);
            assert_eq!(messages, day.totals.messages, "{}: messages", day.date);
        }

        let hours = |date: &str| -> Vec<Option<u8>> {
            report.slots.iter().filter(|s| s.date == date).map(|s| s.hour).collect()
        };
        // In UTC these would be 02, 14, 15 and 15.
        assert_eq!(hours("2026-08-01"), vec![Some(11), Some(23)]);
        assert_eq!(hours("2026-08-02"), vec![None, Some(0)]);
        assert!((report.total_cost - 31.0).abs() < 1e-9);
        assert_eq!(report.total_messages, 5);
    }

    /// A message with no usable time is **untimed**, not 00:00. Core's own fold
    /// writes `date + "00:00"`, which draws a midnight spike in a profile. It
    /// still counts in its day, so the day keeps summing to Daily; it just has
    /// no hour. The same holds for a timestamp whose Bucket Timezone day is not
    /// the message's `date`: an hour there would contradict the day it counts in.
    #[test]
    fn a_message_without_a_usable_time_counts_in_its_day_with_no_hour() {
        let mut untimed = msg("claude-code", "sonnet", "2026-08-02", 1.0);
        untimed.timestamp = 0;
        let mut disagreeing = at("claude-code", BEFORE_MIDNIGHT, 2.0);
        disagreeing.date = "2026-08-02".into(); // Seoul says 08-01

        let report = hourly_of(vec![untimed, disagreeing], &Filter::default(), &seoul(), Instant::now());
        assert_eq!(report.slots.len(), 1, "one untimed slot, not a 00:00 one");
        let slot = &report.slots[0];
        assert_eq!((slot.date.as_str(), slot.hour), ("2026-08-02", None));
        assert_eq!(slot.message_count, 2);
        assert!((slot.cost - 3.0).abs() < 1e-9);
    }

    /// Hourly narrows on Overview's and Models' terms: `narrow_clients`, then
    /// core's date predicate, over the held Snapshot.
    #[test]
    fn hourly_follows_the_report_filter() {
        let codex = Filter {
            clients: Some(vec!["codex".into()]),
            ..Default::default()
        };
        let report = hourly_of(midnight_corpus(), &codex, &seoul(), Instant::now());
        assert_eq!(report.slots.len(), 1);
        assert!((report.total_cost - 4.0).abs() < 1e-9);

        let first_day = Filter {
            until: Some("2026-08-01".into()),
            ..Default::default()
        };
        let report = hourly_of(midnight_corpus(), &first_day, &seoul(), Instant::now());
        assert!(report.slots.iter().all(|s| s.date == "2026-08-01"));
        assert!((report.total_cost - 3.0).abs() < 1e-9);
    }

    /// Minutely keeps Hourly's day rule: its minutes sum to the day, the minute
    /// is read in the Bucket Timezone, and a half-hour zone lands on the right
    /// minute rather than on a whole-hour guess.
    #[test]
    fn minutes_sum_to_the_day_in_the_bucket_timezone() {
        let report = minutely_of(midnight_corpus(), &Filter::default(), &seoul(), Instant::now());
        let minutes = |date: &str| -> Vec<Option<u16>> {
            report.slots.iter().filter(|s| s.date == date).map(|s| s.minute).collect()
        };
        assert_eq!(minutes("2026-08-01"), vec![Some(11 * 60 + 59), Some(23 * 60 + 59)]);
        assert_eq!(minutes("2026-08-02"), vec![None, Some(0), Some(29)]);
        assert!((report.total_cost - 31.0).abs() < 1e-9);
        assert_eq!(report.total_messages, 5);

        let kolkata = BucketTimezone::from_pinned_name(Some("Asia/Kolkata"));
        let mut m = msg("codex", "sonnet", &kolkata.day_key(BEFORE_MIDNIGHT), 1.0);
        m.timestamp = BEFORE_MIDNIGHT; // 14:59:59 UTC is 20:29:59 in Kolkata
        let report = minutely_of(vec![m], &Filter::default(), &kolkata, Instant::now());
        assert_eq!(report.slots[0].minute, Some(20 * 60 + 29));
    }

    /// #38's probe: **what does an interval refresh cost?** A GUI Refresh is a
    /// forced Scan, so this runs `priced_parse` twice in one process. The first
    /// is a launch against the on-disk cache; the second is what every interval
    /// tick pays in a running app. Then the Minutely fold, with its slot count
    /// beside Hourly's, to see whether the cardinality upstream avoids caching
    /// is a problem for a fold.
    ///
    /// `CARGO_BUILD_JOBS=4 cargo test --lib --release -- --ignored --nocapture a_warm_scan`
    ///
    /// Prints; never asserts. The figures are recorded on #38.
    #[test]
    #[ignore]
    fn a_warm_scan_and_the_minutely_fold() {
        let scan = |label: &str| {
            let started = Instant::now();
            let snapshot =
                tauri::async_runtime::block_on(priced_parse(Filter::default().parse_options()))
                    .expect("scan");
            println!("{label}: {} ms, {} messages", started.elapsed().as_millis(), snapshot.len());
            snapshot
        };
        scan("first scan in process");
        scan("second scan (an interval tick)");
        let snapshot = scan("third scan");

        let zone = BucketTimezone::from_scanner_settings(&crate::settings::scanner());
        let started = Instant::now();
        let hourly = hourly_of(snapshot.clone(), &Filter::default(), &zone, started);
        println!("hourly fold: {} ms, {} slots", started.elapsed().as_millis(), hourly.slots.len());
        let started = Instant::now();
        let minutely = minutely_of(snapshot, &Filter::default(), &zone, started);
        println!(
            "minutely fold: {} ms, {} slots, {} KB as JSON",
            started.elapsed().as_millis(),
            minutely.slots.len(),
            serde_json::to_vec(&minutely).unwrap().len() / 1024
        );
    }

    // ---- Ticket 37: Agents ----

    fn by(client: &str, agent: Option<&str>, date: &str, cost: f64) -> UnifiedMessage {
        let mut m = msg(client, "sonnet", date, cost);
        m.agent = agent.map(str::to_string);
        m
    }

    fn agent_corpus() -> Vec<UnifiedMessage> {
        vec![
            by("opencode", Some("build"), "2026-08-01", 1.0),
            by("roocode", Some(" Build "), "2026-08-02", 2.0),
            by("opencode", Some("omo"), "2026-08-03", 4.0),
            by("opencode", Some("Sisyphus"), "2026-08-04", 8.0),
            by("claude-code", None, "2026-08-05", 16.0),
            by("codex", Some("   "), "2026-09-01", 32.0),
        ]
    }

    /// The acceptance test for #37: **Agents' totals are Overview's**, for the
    /// same corpus and Report Filter, narrowed by client and by date. Overview
    /// is `model_report`, so this compares against `report_of`.
    #[test]
    fn agents_totals_equal_overviews_under_the_same_filter() {
        let filters = [
            Filter::default(),
            Filter {
                clients: Some(vec!["opencode".into(), "codex".into()]),
                ..Default::default()
            },
            Filter {
                since: Some("2026-08-02".into()),
                until: Some("2026-08-31".into()),
                ..Default::default()
            },
        ];
        for f in &filters {
            let agents = agents_of(agent_corpus(), f, Instant::now());
            let overview = report_of(agent_corpus(), &GroupBy::Model, f, Instant::now());
            assert!((agents.total_cost - overview.total_cost).abs() < 1e-9, "{f:?}");
            assert_eq!(agents.total_input, overview.total_input, "{f:?}");
            assert_eq!(agents.total_output, overview.total_output, "{f:?}");
            assert_eq!(agents.total_cache_read, overview.total_cache_read, "{f:?}");
            assert_eq!(agents.total_messages, overview.total_messages, "{f:?}");
        }
    }

    /// Spellings of one agent are one row, as the TUI normalizes them; a
    /// message with no agent (or a blank one) is a row of its own, not dropped;
    /// and each row names the Clients it came from.
    #[test]
    fn agents_are_normalized_and_no_agent_is_a_row() {
        let report = agents_of(agent_corpus(), &Filter::default(), Instant::now());
        let row = |name: Option<&str>| {
            report
                .agents
                .iter()
                .find(|a| a.agent.as_deref() == name)
                .unwrap_or_else(|| panic!("no row for {name:?}: {:?}", report.agents))
        };

        assert_eq!(report.agents.len(), 3, "{:?}", report.agents);
        let build = row(Some("Build"));
        assert_eq!(build.clients, ["opencode", "roocode"]);
        assert!((build.cost - 3.0).abs() < 1e-9);
        assert!((row(Some("Sisyphus")).cost - 12.0).abs() < 1e-9);

        let none = row(None);
        assert_eq!(none.clients, ["claude-code", "codex"]);
        assert_eq!(none.message_count, 2);
        assert!((none.cost - 48.0).abs() < 1e-9);
    }

    /// #37's measurement: how much of the real corpus has no agent. Not a unit
    /// test; it walks real disk. Run by hand:
    /// `cargo test --lib -- --ignored --nocapture no_agent_share`
    #[test]
    #[ignore]
    fn no_agent_share() {
        let snapshot =
            tauri::async_runtime::block_on(priced_parse(Filter::default().parse_options()))
                .expect("scan");
        let report = agents_of(snapshot, &Filter::default(), Instant::now());
        for a in &report.agents {
            println!(
                "{:<30} {:>8} msgs {:>6.1}%  ${:>10.2} {:>6.1}%  [{}]",
                a.agent.as_deref().unwrap_or("(no agent)"),
                a.message_count,
                100.0 * a.message_count as f64 / report.total_messages as f64,
                a.cost,
                100.0 * a.cost / report.total_cost,
                a.clients.join(", "),
            );
        }
    }

    // ---- Ticket 25: Ramp bucketing ----

    /// A skewed month: eighty cheap days, a few heavy ones, and one that dwarfs
    /// them all. The case the placeholder existed for, and the only one held to
    /// filling the whole Ramp.
    fn skewed() -> Vec<f64> {
        let mut costs: Vec<f64> = (1..=80).map(|i| i as f64 * 0.02).collect();
        costs.extend([3.0, 4.5, 6.0, 12.0, 41.5]);
        costs
    }

    fn histogram(active: &[f64]) -> [usize; 6] {
        let mut h = [0usize; 6];
        for c in active {
            h[ramp_level(active, *c) as usize] += 1;
        }
        h
    }

    #[test]
    fn a_skewed_distribution_populates_every_step() {
        let h = histogram(&skewed());
        assert_eq!(h[0], 0, "no zero-cost days in this fixture");
        for step in 1..=5 {
            assert!(h[step] > 0, "step {step} is empty: {h:?}");
        }
    }

    /// Absence is not a step (ROADMAP: `--ramp-0` is absence). A day with no
    /// usage must never collide with the cheapest active day.
    #[test]
    fn a_day_with_no_usage_is_not_the_lowest_step() {
        let active = skewed();
        assert_eq!(ramp_level(&active, 0.0), 0);
        assert_eq!(ramp_level(&active, -0.0), 0);
        let cheapest = active.iter().copied().fold(f64::INFINITY, f64::min);
        assert_eq!(ramp_level(&active, cheapest), 1, "cheapest active day is 1");
    }

    #[test]
    fn the_busiest_day_is_always_the_top_step() {
        for active in [skewed(), vec![7.0], vec![2.0; 30], vec![0.01, 0.01, 99.0]] {
            let max = active.iter().copied().fold(0.0f64, f64::max);
            assert_eq!(ramp_level(&active, max), 5, "busiest of {active:?}");
        }
    }

    /// The degenerate distributions, decided rather than discovered: with no
    /// spread at all, every active day is the busiest day, so every active day
    /// is the top step. Five steps are not required to appear here.
    #[test]
    fn a_distribution_with_no_spread_is_all_top_step() {
        assert_eq!(ramp_level(&[9.0], 9.0), 5, "a single active day");
        let flat = vec![2.0; 12];
        assert!(
            flat.iter().all(|c| ramp_level(&flat, *c) == 5),
            "all active days equal"
        );
        assert_eq!(
            ramp_level(&flat, 0.0),
            0,
            "absence survives the degenerate case"
        );
    }

    /// One day dominating the rest must not drag the rest into a single step.
    /// A ten-thousand-fold outlier is exactly what defeats the linear rivals —
    /// under a clamped ratio all four ordinary days are step 1. The logarithm
    /// still separates them, though not one step each: with the span stretched
    /// over four decades a step is ~6x, so days within 6x of each other share
    /// one. That is the bucketing telling the truth about the distribution.
    #[test]
    fn one_dominant_day_does_not_flatten_the_rest() {
        let active = vec![0.05, 0.20, 0.80, 3.20, 500.0];
        let levels: Vec<u8> = active.iter().map(|c| ramp_level(&active, *c)).collect();

        assert_eq!(levels[4..], [5], "the dominant day tops out, alone");

        let ordinary: std::collections::BTreeSet<u8> = levels[..4].iter().copied().collect();
        assert!(
            ordinary.len() >= 3,
            "the ordinary days keep at least three distinct steps: {levels:?}"
        );
        assert!(
            levels[..4].windows(2).all(|w| w[0] <= w[1]),
            "and never invert: {levels:?}"
        );
    }
}
