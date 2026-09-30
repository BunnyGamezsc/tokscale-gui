//! Daily and session projections of the held Snapshot, never another index or scan.
use std::collections::{BTreeMap, BTreeSet};

use tauri::Manager;
use tokscale_core::{filter_messages_for_report, GroupBy, UnifiedMessage};

use crate::commands::{Filter, Snapshot};
use crate::dto::{DailyTotal, InsightsReport, ModelSpend, SessionSpend, Workspace};
use crate::machines::FleetState;

fn priced(m: &UnifiedMessage) -> bool {
    !(m.cost == 0.0
        && m.tokens.total() > 0
        && m.cost_source == tokscale_core::sessions::CostSource::Unknown)
}

fn workspace(m: &UnifiedMessage) -> Option<Workspace> {
    m.workspace_key.as_ref().map(|key| Workspace {
        key: key.clone(),
        label: m.workspace_label.clone().unwrap_or_else(|| key.clone()),
    })
}

fn report_of(messages: Vec<UnifiedMessage>, filter: &Filter) -> InsightsReport {
    let filtered = filter_messages_for_report(
        filter.narrow_clients(messages),
        &filter.report_options(GroupBy::Model),
    );
    let mut daily: BTreeMap<String, DailyTotal> = BTreeMap::new();
    let mut sessions: BTreeMap<(String, String), SessionSpend> = BTreeMap::new();
    let mut models: BTreeMap<(String, String), f64> = BTreeMap::new();
    let mut workspaces: BTreeMap<String, Workspace> = BTreeMap::new();
    let mut unassigned_cost = 0.0;
    for m in filtered {
        let day = daily.entry(m.date.clone()).or_insert_with(|| DailyTotal {
            date: m.date.clone(),
            cost: 0.0,
            tokens: 0,
            message_count: 0,
            cost_is_complete: true,
        });
        day.cost += m.cost;
        day.tokens = day.tokens.saturating_add(m.tokens.total());
        day.message_count = day.message_count.saturating_add(m.message_count);
        day.cost_is_complete &= priced(&m);
        *models
            .entry((m.provider_id.clone(), m.model_id.clone()))
            .or_default() += m.cost;
        let ws = workspace(&m);
        if let Some(ws) = &ws {
            workspaces.insert(ws.key.clone(), ws.clone());
        }
        if m.session_id.is_empty() {
            unassigned_cost += m.cost;
            continue;
        }
        // Session IDs are client-local. Pool all models of one conversation.
        let session = sessions
            .entry((m.client.clone(), m.session_id.clone()))
            .or_insert_with(|| SessionSpend {
                client: m.client.clone(),
                session_id: m.session_id.clone(),
                title: m.session_title.clone(),
                models: Vec::new(),
                providers: Vec::new(),
                workspaces: Vec::new(),
                first_day: m.date.clone(),
                last_day: m.date.clone(),
                first_timestamp: None,
                last_timestamp: None,
                days: Vec::new(),
                tokens: 0,
                message_count: 0,
                cost: 0.0,
                cost_is_complete: true,
            });
        if session.title.is_none() {
            session.title = m.session_title.clone();
        }
        if !session.models.contains(&m.model_id) {
            session.models.push(m.model_id.clone());
        }
        if !session.providers.contains(&m.provider_id) {
            session.providers.push(m.provider_id.clone());
        }
        if let Some(ws) = ws {
            if !session.workspaces.iter().any(|w| w.key == ws.key) {
                session.workspaces.push(ws);
            }
        }
        session.first_day = session.first_day.clone().min(m.date.clone());
        session.last_day = session.last_day.clone().max(m.date.clone());
        if m.timestamp > 0 {
            session.first_timestamp = Some(
                session
                    .first_timestamp
                    .map_or(m.timestamp, |t| t.min(m.timestamp)),
            );
            session.last_timestamp = Some(
                session
                    .last_timestamp
                    .map_or(m.timestamp, |t| t.max(m.timestamp)),
            );
        }
        session.days.push(m.date.clone());
        session.tokens = session.tokens.saturating_add(m.tokens.total());
        session.message_count = session.message_count.saturating_add(m.message_count);
        session.cost += m.cost;
        session.cost_is_complete &= priced(&m);
    }
    let mut sessions: Vec<_> = sessions.into_values().collect();
    for session in &mut sessions {
        session.days = std::mem::take(&mut session.days)
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        session.models.sort();
        session.providers.sort();
        session.workspaces.sort();
    }
    sessions.sort_by(|a, b| {
        b.cost
            .total_cmp(&a.cost)
            .then_with(|| (&a.client, &a.session_id).cmp(&(&b.client, &b.session_id)))
    });
    InsightsReport {
        days: daily.into_values().collect(),
        sessions,
        models: models
            .into_iter()
            .map(|((provider, model), cost)| ModelSpend {
                provider,
                model,
                cost,
            })
            .collect(),
        workspaces: workspaces.into_values().collect(),
        unassigned_cost,
    }
}

#[tauri::command]
pub async fn insights_report(
    app: tauri::AppHandle,
    filter: Option<Filter>,
) -> Result<InsightsReport, String> {
    crate::commands::blocking(move || {
        let filter = filter.unwrap_or_default();
        let messages = crate::commands::held(
            &app.state::<Snapshot>(),
            &app.state::<FleetState>(),
            &filter,
        )?;
        Ok(report_of(messages, &filter))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "reads this machine's real transcripts; emits only aggregate totals"]
    fn real_feature_projections_agree() {
        let messages = tauri::async_runtime::block_on(crate::commands::priced_parse(
            Filter::default().parse_options(),
        ))
        .unwrap();
        let count = messages.len();
        let entries = tokscale_core::aggregate_model_usage_entries_with_rollup(
            messages.clone(),
            &GroupBy::ClientProviderModel,
            tokscale_core::WorktreeRollup::default(),
        );
        let cost: f64 = entries.iter().map(|e| e.cost).sum();
        let summary = crate::dto::ScanSummary::of(&messages, 0);
        let zone =
            tokscale_core::BucketTimezone::from_scanner_settings(&crate::settings::scanner());
        let spending = crate::spending::status_of(
            &messages,
            zone.day_key(chrono::Utc::now().timestamp_millis()),
        );
        let report = report_of(messages, &Filter::default());
        let daily: f64 = report.days.iter().map(|d| d.cost).sum();
        let sessions: f64 =
            report.sessions.iter().map(|s| s.cost).sum::<f64>() + report.unassigned_cost;
        assert!((cost - daily).abs() < 0.000001);
        assert!((cost - sessions).abs() < 0.000001);
        assert!((cost - spending.days.iter().map(|d| d.cost).sum::<f64>()).abs() < 0.000001);
        if let Ok(path) = std::env::var("TOKSCALE_SMOKE_FIXTURE") {
            let (total_input, total_output, total_cache_read, _) =
                tokscale_core::model_report_token_totals(&entries);
            let model = crate::dto::Report {
                entries: entries.iter().map(crate::dto::Entry::from).collect(),
                total_input,
                total_output,
                total_cache_read,
                total_messages: report.days.iter().map(|d| d.message_count).sum(),
                total_cost: cost,
                elapsed_ms: 0,
            };
            let fixture = serde_json::json!({"scan": summary, "insights_report": report, "spending_status": spending, "model_report": model});
            std::fs::write(path, serde_json::to_vec(&fixture).unwrap()).unwrap();
        }
        println!("Validated {count} messages, {} days and {} sessions; total cost ${cost:.2}; all three projections agree", report.days.len(), report.sessions.len());
    }
    fn msg(client: &str, session: &str, model: &str, day: &str, cost: f64) -> UnifiedMessage {
        UnifiedMessage {
            client: client.into(),
            session_id: session.into(),
            model_id: model.into(),
            provider_id: "anthropic".into(),
            workspace_key: Some("/project".into()),
            workspace_label: Some("Project".into()),
            timestamp: 0,
            date: day.into(),
            tokens: tokscale_core::TokenBreakdown {
                input: 100,
                ..Default::default()
            },
            cost,
            cost_source: Default::default(),
            duration_ms: None,
            message_count: 1,
            agent: None,
            dedup_key: None,
            session_title: Some("Chat".into()),
            is_turn_start: false,
            model_attribution_conflicted: false,
        }
    }
    #[test]
    fn pools_models_without_colliding_client_ids_and_accounts_for_unknown_sessions() {
        let report = report_of(
            vec![
                msg("claude-code", "s1", "opus", "2026-09-01", 10.0),
                msg("claude-code", "s1", "sonnet", "2026-09-02", 2.0),
                msg("codex", "s1", "gpt", "2026-09-01", 4.0),
                msg("codex", "", "gpt", "2026-09-01", 1.0),
            ],
            &Filter::default(),
        );
        assert_eq!(report.sessions.len(), 2);
        assert_eq!(report.sessions[0].cost, 12.0);
        assert_eq!(report.sessions[0].models, vec!["opus", "sonnet"]);
        assert_eq!(report.sessions[0].days, vec!["2026-09-01", "2026-09-02"]);
        assert_eq!(
            report.days.iter().map(|d| d.cost).sum::<f64>(),
            report.sessions.iter().map(|s| s.cost).sum::<f64>() + report.unassigned_cost
        );
        assert!(report.sessions[0].first_timestamp.is_none());
    }
    #[test]
    fn projections_follow_the_same_filter_and_keep_unpriced_usage() {
        let report = report_of(
            vec![
                msg("claude-code", "s1", "opus", "2026-09-01", 10.0),
                msg("codex", "s1", "gpt", "2026-09-02", 0.0),
            ],
            &Filter {
                since: Some("2026-09-02".into()),
                clients: Some(vec!["codex".into()]),
                ..Default::default()
            },
        );
        assert_eq!(report.days.len(), 1);
        assert_eq!(report.days[0].tokens, 100);
        assert!(!report.days[0].cost_is_complete);
        assert!(!report.sessions[0].cost_is_complete);
    }
}
