//! **Usage (the tab)**: vendor-reported subscription quota, read through the
//! fork's `tokscale-cli` fetchers (ADR 0007). These are each provider's own
//! figures and are never reconciled against tokscale's computed usage
//! (CONTEXT.md, "Two meanings of usage").

use tokscale_cli::commands::usage::{
    fetch_all_report_and_unconfigured, load_cache_any_age, save_cache, UsageFetchIntent,
    UsageFetchReport, UsageOutput,
};

use crate::dto::{Quota, QuotaCard, QuotaMetric};

/// Fetches every provider that has credentials, each on a thread the fork owns.
///
/// `CliReadOnly`, not `TuiSurface`: the TUI's intent saves the current Codex
/// login into tokscale's account store, and a read-only View must not write
/// accounts (#41 owns that).
///
/// Called straight from `blocking` with no `block_on` around it. The fetchers
/// build their own runtimes, and `antigravity::has_credentials` builds one on
/// the calling thread, so entering a runtime here is what would panic.
#[tauri::command]
pub async fn quota() -> Result<Quota, String> {
    crate::commands::blocking(|| {
        let (report, not_set_up) =
            fetch_all_report_and_unconfigured(UsageFetchIntent::CliReadOnly);
        // ponytail: the cache is one file with one timestamp, so a partial fetch
        // replaces it and a provider that failed loses its stale card. Stale is
        // for "nothing could be reached"; per-provider history needs its own file.
        if !report.outputs.is_empty() {
            save_cache(&report.outputs);
        }
        let cached = report.outputs.is_empty().then(load_cache_any_age).flatten();
        Ok(quota_of(report, &not_set_up, cached))
    })
    .await
}

/// The fetch report as cards. When every fetch failed and an earlier result is
/// on disk, that result shows, marked stale, instead of an empty View.
fn quota_of(
    report: UsageFetchReport,
    not_set_up: &[&str],
    cached: Option<(u64, Vec<UsageOutput>)>,
) -> Quota {
    let (outputs, stale_since, state) = match cached {
        Some((at, outputs)) if report.outputs.is_empty() && !report.diagnostics.is_empty() => {
            (outputs, Some(at), "stale")
        }
        _ => (report.outputs, None, "fresh"),
    };
    let mut cards: Vec<QuotaCard> = outputs.into_iter().map(|o| card(o, state)).collect();

    for d in report.diagnostics {
        // An account-less diagnostic goes beside its provider's card when there
        // is one: Codex's OpenCode fallback can succeed after the native fetch
        // fails, and a stale card should say why it is stale.
        let beside = match d.account {
            None => cards.iter().position(|c| c.provider == d.provider),
            Some(_) => None,
        };
        match beside {
            Some(i) => cards[i].diagnostics.push(d.message),
            None => cards.push(QuotaCard {
                account: d.account.as_ref().map(|a| a.display_name()),
                provider: d.provider,
                state: "failed",
                diagnostics: vec![d.message],
                ..Default::default()
            }),
        }
    }

    Quota {
        cards,
        not_set_up: not_set_up.iter().map(|s| s.to_string()).collect(),
        stale_since,
    }
}

fn card(o: UsageOutput, state: &'static str) -> QuotaCard {
    let credit = o.credit_status.as_ref();
    QuotaCard {
        account: o.account_display_name().or_else(|| o.email.clone()),
        balance: credit.and_then(|c| c.balance.clone()),
        unlimited: credit.and_then(|c| c.unlimited).unwrap_or(false),
        overage_limit_reached: credit.and_then(|c| c.overage_limit_reached).unwrap_or(false),
        reset_credits: o.reset_credits.as_ref().map(|r| r.available_count),
        provider: o.provider,
        plan: o.plan,
        state,
        diagnostics: Vec::new(),
        metrics: o
            .metrics
            .into_iter()
            .map(|m| QuotaMetric {
                label: m.label,
                used_percent: m.used_percent,
                remaining_percent: m.remaining_percent,
                remaining_label: m.remaining_label,
                resets_at: m.resets_at,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokscale_cli::commands::usage::UsageFetchDiagnostic;

    /// Through serde, so a field upstream adds to `UsageOutput` doesn't break it.
    fn output(provider: &str) -> UsageOutput {
        serde_json::from_value(serde_json::json!({
            "provider": provider,
            "plan": "Max 20x",
            "email": null,
            "metrics": [{
                "label": "Session",
                "used_percent": 40.0,
                "remaining_percent": 60.0,
                "remaining_label": null,
                "resets_at": "2026-09-13T18:00:00Z"
            }],
            "reset_credits": { "available_count": 2 }
        }))
        .unwrap()
    }

    fn report(outputs: Vec<UsageOutput>, diagnostics: Vec<UsageFetchDiagnostic>) -> UsageFetchReport {
        UsageFetchReport { outputs, diagnostics }
    }

    #[test]
    fn a_fetch_maps_to_fresh_cards_and_names_what_is_not_set_up() {
        let q = quota_of(report(vec![output("Claude")], vec![]), &["Z.ai", "Amp"], None);

        assert_eq!(q.cards.len(), 1);
        let c = &q.cards[0];
        assert_eq!((c.provider.as_str(), c.state), ("Claude", "fresh"));
        assert_eq!(c.plan.as_deref(), Some("Max 20x"));
        assert_eq!(c.reset_credits, Some(2));
        assert_eq!(c.metrics[0].remaining_percent, 60.0);
        assert_eq!(c.metrics[0].resets_at.as_deref(), Some("2026-09-13T18:00:00Z"));
        assert_eq!(q.not_set_up, ["Z.ai", "Amp"]);
        assert_eq!(q.stale_since, None);
    }

    #[test]
    fn a_failed_provider_is_its_own_card_and_the_others_still_show() {
        let q = quota_of(
            report(
                vec![output("Claude"), output("Codex")],
                vec![
                    UsageFetchDiagnostic::new("Sakana", None, "session expired"),
                    UsageFetchDiagnostic::new("Codex", None, "native fetch failed"),
                ],
            ),
            &[],
            Some((1, vec![output("Sakana")])),
        );

        let states: Vec<_> = q.cards.iter().map(|c| (c.provider.as_str(), c.state)).collect();
        assert_eq!(states, [("Claude", "fresh"), ("Codex", "fresh"), ("Sakana", "failed")]);
        assert_eq!(q.cards[1].diagnostics, ["native fetch failed"]);
        assert_eq!(q.cards[2].diagnostics, ["session expired"]);
        assert!(q.cards[2].metrics.is_empty());
        assert_eq!(q.stale_since, None, "the cache is only for a fetch that got nothing");
    }

    #[test]
    fn when_every_fetch_fails_the_last_result_shows_stale() {
        let offline = report(vec![], vec![UsageFetchDiagnostic::new("Claude", None, "offline")]);

        let q = quota_of(offline.clone(), &[], Some((1_757_000_000, vec![output("Claude")])));
        assert_eq!(q.stale_since, Some(1_757_000_000));
        assert_eq!(q.cards.len(), 1);
        assert_eq!(q.cards[0].state, "stale");
        assert_eq!(q.cards[0].metrics.len(), 1);
        assert_eq!(q.cards[0].diagnostics, ["offline"]);

        let q = quota_of(offline, &[], None);
        assert_eq!(q.cards[0].state, "failed");
    }

    /// The real fetch, through `blocking` as the command runs it: settles
    /// whether the fetchers' own runtimes panic there. Prints states and counts,
    /// never figures or accounts. Writes the real subscription cache on success.
    ///
    /// `cargo test --lib -- --ignored --nocapture real_quota_fetch`
    #[test]
    #[ignore]
    fn real_quota_fetch() {
        let started = std::time::Instant::now();
        let q = tauri::async_runtime::block_on(quota()).expect("fetch");
        println!("{} ms, stale: {}", started.elapsed().as_millis(), q.stale_since.is_some());
        for c in &q.cards {
            println!(
                "{} {}: {} metrics, {} diagnostics",
                c.provider,
                c.state,
                c.metrics.len(),
                c.diagnostics.len()
            );
        }
        println!("not set up: {:?}", q.not_set_up);
    }
}
