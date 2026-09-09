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
    generate_local_graph_report, model_report_token_totals,
    parse_local_unified_messages_with_pricing, pricing::PricingService, GroupBy, LocalParseOptions,
    ReportOptions, UnifiedMessage, WorktreeRollup,
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
                    parse_local_unified_messages_with_pricing(filter.parse_options(), Some(&fresh))
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
    let (total_input, total_output, total_cache_read, _) = model_report_token_totals(&entries);

    Ok(Report {
        total_cost: entries.iter().map(|e| e.cost).sum(),
        entries: entries.iter().map(Entry::from).collect(),
        total_input,
        total_output,
        total_cache_read,
        total_messages,
        elapsed_ms: started.elapsed().as_millis() as u32,
    })
}

/// Which Ramp step a day's cost falls on, given every active day's cost.
///
/// Absence is not a step. A zero-cost day is `0` — `--ramp-0`, which the graph
/// renders as "no usage" — and never shares a value with the cheapest active
/// day, which is `1`.
///
/// **The bucketing is logarithmic across the active span**: `t = ln(cost/min) /
/// ln(max/min)` over the active days, cut into five. Ticket 25 measured the
/// three candidates against a deliberately skewed 90 days (min $0.011, median
/// $0.41, max $41.50 — one dominant day), counting days per step:
///
/// | candidate                             | 1  | 2  | 3  | 4  | 5  |
/// | ------------------------------------- | -- | -- | -- | -- | -- |
/// | core's ratio thresholds (¼, ½, ¾)      | 89 |  0 |  0 |  1 |  0 |
/// | the TUI's clamped continuous ratio    | 89 |  0 |  0 |  0 |  1 |
/// | quantile — rank cut into fifths       | 18 | 18 | 18 | 18 | 18 |
/// | **logarithmic across the span**       | 13 | 28 | 42 |  6 |  1 |
///
/// Both rivals are linear in dollars against the busiest day, so a spread of
/// three and a half decades draws as two shades: 89 of 90 days indistinguishable.
/// That is the collapse the placeholder existed to avoid.
///
/// On the author's real corpus — 70 active days from $0.0058 to $104.67, four
/// and a quarter decades — the shipped function fills every step: 4 / 6 / 9 /
/// 36 / 15, busiest day at 5. Quantile would have drawn 14 / 14 / 14 / 14 / 14
/// there, as it draws everywhere.
///
/// Quantile does not collapse — but it cannot, and that is the objection. It
/// reports *rank*, not size, so it emits exactly a fifth of the days per step
/// whatever the costs are: a flat month and a savagely skewed one draw the same
/// picture. Logarithmic encodes magnitude instead — one step is a fixed factor
/// in dollars — so the graph changes when the spending does.
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
            level: ramp_level(&active, c.totals.cost),
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
    out.sort_by(|a, b| {
        b.cost
            .partial_cmp(&a.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
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

#[cfg(test)]
mod tests {
    //! Ticket 11's evidence — what a Report Filter can and cannot do against
    //! the *held* Snapshot, which is the whole question of whether narrowing
    //! re-aggregates or rescans — followed by ticket 25's, which settles the
    //! Ramp bucketing without running a Scan.

    use super::*;
    use tokscale_core::TokenBreakdown;

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
    /// Not a unit test — it walks real disk. Run by hand:
    /// `cargo test --lib -- --ignored --nocapture daily_detail_agrees`
    #[test]
    #[ignore]
    fn daily_detail_agrees_with_the_daily_row() {
        // The Snapshot must be built with pricing, exactly as `scan` builds it.
        // Without it every message costs 0.0 while `graph_report` fetches its
        // own rates, and the two paths disagree for a reason that has nothing
        // to do with how a day is bucketed.
        let snapshot = tauri::async_runtime::block_on(async {
            let pricing = PricingService::get_or_init().await.ok();
            parse_local_unified_messages_with_pricing(
                Filter::default().parse_options(),
                pricing.as_deref(),
            )
            .await
        })
        .expect("scan");
        println!("snapshot: {} messages", snapshot.len());

        let graph = tauri::async_runtime::block_on(generate_local_graph_report(
            Filter::default().report_options(GroupBy::Model),
        ))
        .expect("graph_report");

        let mut checked = 0;
        let mut worst = 0.0f64;
        for day in graph.contributions.iter().filter(|c| c.totals.cost > 0.0) {
            let f = Filter {
                since: Some(day.date.clone()),
                until: Some(day.date.clone()),
                ..Default::default()
            };
            let options = f.report_options(
                "client,provider,model"
                    .parse::<GroupBy>()
                    .expect("group-by"),
            );
            let kept = filter_messages_for_report(snapshot.clone(), &options);
            let entries = aggregate_model_usage_entries_with_rollup(
                kept,
                &options.group_by,
                WorktreeRollup::default(),
            );
            let cost: f64 = entries.iter().map(|e| e.cost).sum();
            let delta = (cost - day.totals.cost).abs();
            if delta > worst {
                worst = delta;
                println!(
                    "{}: dialog {cost:.6} vs row {:.6} ({} entries)",
                    day.date,
                    day.totals.cost,
                    entries.len()
                );
            }
            assert!(
                !entries.is_empty(),
                "{} has cost but the one-day filter found nothing",
                day.date
            );
            checked += 1;
        }

        println!("checked {checked} active days, worst delta {worst:.9}");
        assert!(checked > 0, "no active days to check");
        assert!(worst < 1e-6, "dialog and row disagree by {worst}");
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

    /// The rivals, on the same distribution, for the record. Core's ratio
    /// thresholds and the TUI's clamped ratio are both linear in dollars
    /// against the busiest day, so the dominant day flattens everything else
    /// into one shade.
    #[test]
    fn the_linear_rivals_collapse_where_the_logarithm_does_not() {
        let active = skewed();
        let max = active.iter().copied().fold(0.0f64, f64::max);

        let linear_bottom = active
            .iter()
            .filter(|c| (**c / max * 5.0).ceil().max(1.0) as u8 == 1)
            .count();
        assert!(
            linear_bottom * 10 >= active.len() * 9,
            "a clamped ratio strands over nine tenths of the month on the bottom \
             step: {linear_bottom} of {}",
            active.len()
        );

        assert!(
            histogram(&active)[1] < linear_bottom / 2,
            "the logarithm must spread what the ratio flattens"
        );
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

        assert_eq!(levels[4], 5, "the dominant day tops out");
        assert_eq!(levels[4..], [5], "and is alone up there");

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
