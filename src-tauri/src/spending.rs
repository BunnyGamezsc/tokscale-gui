//! Local spending and persistent once-per-month warning thresholds.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tokscale_core::{BucketTimezone, UnifiedMessage};

use crate::dto::{ModelSpend, SpendingDay, SpendingStatus};

const THRESHOLDS: [u8; 4] = [50, 75, 90, 100];

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WarningHistory {
    month: String,
    fired: BTreeMap<String, Vec<u8>>,
}

fn crossed(spent: f64, limit: f64, fired: &[u8]) -> Vec<u8> {
    if !spent.is_finite() || !limit.is_finite() || limit <= 0.0 {
        return Vec::new();
    }
    THRESHOLDS
        .into_iter()
        .filter(|t| spent >= limit * f64::from(*t) / 100.0 && !fired.contains(t))
        .collect()
}

pub(crate) fn status_of(messages: &[UnifiedMessage], today: String) -> SpendingStatus {
    let month = &today[..7];
    let mut days: BTreeMap<String, (f64, bool)> = BTreeMap::new();
    // Include all known pairs, even those with no spending this month, for the picker.
    let mut models: BTreeMap<(String, String), f64> = BTreeMap::new();
    for m in messages {
        let day = days.entry(m.date.clone()).or_insert((0.0, true));
        day.0 += m.cost;
        day.1 &= !(m.cost == 0.0
            && m.tokens.total() > 0
            && m.cost_source == tokscale_core::sessions::CostSource::Unknown);
        let cost = models
            .entry((m.provider_id.clone(), m.model_id.clone()))
            .or_default();
        if m.date.starts_with(month) && m.date <= today {
            *cost += m.cost;
        }
    }
    SpendingStatus {
        first_day: days.keys().next().cloned(),
        today,
        days: days
            .into_iter()
            .map(|(date, (cost, cost_is_complete))| SpendingDay {
                date,
                cost,
                cost_is_complete,
            })
            .collect(),
        models: models
            .into_iter()
            .map(|((provider, model), cost)| ModelSpend {
                provider,
                model,
                cost,
            })
            .collect(),
        notification_permission: "unknown".into(),
        notification_error: None,
    }
}

/// Mutates the history only after successful delivery. Permission-denied checks
/// don't consume rungs; a later permission grant can still deliver them.
fn warn(
    doc: &mut serde_json::Value,
    status: &SpendingStatus,
    mut deliver: impl FnMut(&str, u8, f64, f64) -> Result<(), String>,
) -> Result<(), String> {
    let settings = crate::gui::settings_of(doc);
    if !settings.spending_notifications_enabled {
        return Ok(());
    }
    let month = status.today[..7].to_string();
    let mut history: WarningHistory = doc
        .get("budgetWarnings")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    if history.month != month {
        history = WarningHistory {
            month,
            ..Default::default()
        };
    }
    let total: f64 = status
        .days
        .iter()
        .filter(|d| d.date.starts_with(&history.month) && d.date <= status.today)
        .map(|d| d.cost)
        .sum();
    let mut limits = Vec::new();
    if let Some(amount) = settings.monthly_limit {
        limits.push((
            "global".to_string(),
            "All local usage".to_string(),
            total,
            amount,
        ));
    }
    for limit in settings.model_limits {
        let cost = status
            .models
            .iter()
            .find(|m| m.provider == limit.provider && m.model == limit.model)
            .map_or(0.0, |m| m.cost);
        let key = serde_json::to_string(&(limit.provider.clone(), limit.model.clone()))
            .expect("pair serializes");
        limits.push((
            key,
            format!("{} via {}", limit.model, limit.provider),
            cost,
            limit.amount,
        ));
    }
    let mut error = None;
    for (key, label, cost, amount) in limits {
        let fired = history.fired.entry(key).or_default();
        for threshold in crossed(cost, amount, fired) {
            match deliver(&label, threshold, cost, amount) {
                Ok(()) => fired.push(threshold),
                Err(e) => {
                    error = Some(e);
                    break;
                }
            }
        }
    }
    doc["budgetWarnings"] = serde_json::to_value(history).expect("history serializes");
    error.map_or(Ok(()), Err)
}

#[tauri::command]
pub async fn request_spending_notifications(app: tauri::AppHandle) -> Result<String, String> {
    crate::commands::blocking(move || {
        app.notification()
            .request_permission()
            .map(|p| format!("{p:?}").to_lowercase())
            .map_err(|e| e.to_string())
    })
    .await
}

/// Uses the same Snapshot as the views; no parse and no independent refresh timer.
#[tauri::command]
pub async fn spending_status(app: tauri::AppHandle) -> Result<SpendingStatus, String> {
    crate::commands::blocking(move || {
        let messages = app.state::<crate::commands::Snapshot>().local()?.messages;
        let zone = BucketTimezone::from_scanner_settings(&crate::settings::scanner());
        let today = zone.day_key(chrono::Utc::now().timestamp_millis());
        let mut status = status_of(&messages, today);
        let today_total = status.days.iter().find(|d| d.date == status.today);
        if let Err(error) = crate::tray::update(
            &app,
            &status.today,
            today_total.map_or(0.0, |d| d.cost),
            today_total.is_none_or(|d| d.cost_is_complete),
        ) {
            eprintln!("spending tray update failed: {error}");
        }
        status.notification_permission = app
            .notification()
            .permission_state()
            .map(|p| format!("{p:?}").to_lowercase())
            .unwrap_or_else(|_| "unknown".into());
        let path = crate::gui::settings_path(&app)?;
        if status.notification_permission == "granted" {
            // Save successful rungs even when delivery of a later rung fails.
            let result = crate::gui::update_document(&path, |doc| {
                Ok(warn(doc, &status, |label, threshold, cost, amount| {
                    app.notification()
                        .builder()
                        .title(format!("Monthly spending: {threshold}% of limit"))
                        .body(format!(
                            "{label}: ${cost:.2} of ${amount:.2} this month. Local usage estimate."
                        ))
                        .show()
                        .map_err(|e| e.to_string())
                })
                .err())
            });
            status.notification_error = match result {
                Ok(error) => error,
                Err(error) => Some(error),
            };
        }
        Ok(status)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn status(today: &str) -> SpendingStatus {
        SpendingStatus {
            today: today.into(),
            first_day: Some(today.into()),
            days: vec![SpendingDay {
                date: today.into(),
                cost: 100.0,
                cost_is_complete: true,
            }],
            models: vec![ModelSpend {
                provider: "anthropic".into(),
                model: "opus".into(),
                cost: 60.0,
            }],
            notification_permission: "granted".into(),
            notification_error: None,
        }
    }

    #[test]
    fn warns_once_per_pair_and_month_across_restarts() {
        let mut doc = json!({ "monthlyLimit": 100, "modelLimits": [{ "provider": "anthropic", "model": "opus", "amount": 50 }], "spendingNotificationsEnabled": true });
        let mut count = 0;
        warn(&mut doc, &status("2026-09-30"), |_, _, _, _| {
            count += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(count, 8);
        let mut doc: serde_json::Value = serde_json::from_str(&doc.to_string()).unwrap();
        warn(&mut doc, &status("2026-09-30"), |_, _, _, _| {
            count += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(count, 8);
        warn(&mut doc, &status("2026-10-01"), |_, _, _, _| {
            count += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(count, 16);
    }

    #[test]
    fn failed_delivery_preserves_successful_rungs_and_retries_only_failures() {
        let mut doc = json!({ "monthlyLimit": 100, "spendingNotificationsEnabled": true });
        assert!(warn(&mut doc, &status("2026-09-30"), |_, rung, _, _| {
            if rung == 75 {
                Err("denied".into())
            } else {
                Ok(())
            }
        })
        .is_err());
        assert_eq!(doc["budgetWarnings"]["fired"]["global"], json!([50]));
        let mut rungs = vec![];
        warn(&mut doc, &status("2026-09-30"), |_, rung, _, _| {
            rungs.push(rung);
            Ok(())
        })
        .unwrap();
        assert_eq!(rungs, vec![75, 90, 100]);
        assert!(crossed(99.99, 100.0, &[50, 75, 90]).is_empty());
        assert!(crossed(100.0, 0.0, &[]).is_empty());
    }
}
