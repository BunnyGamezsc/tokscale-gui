//! `gui.json`: the GUI's own settings, in the Tauri app config directory.
//!
//! Not beside `settings.json` in `~/.config/tokscale/`: that directory is the
//! CLI's, and ADR 0008 records why the GUI keeps out of it. This file has one
//! writer, the GUI, the way `settings.json` has one writer, the CLI.
//!
//! Split like `pricing.rs`: `settings_of` and `with_settings` are pure over the
//! document, and `load` and `save` are the IO.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::Manager;

/// Interval refresh bounds, in milliseconds. Kept in step with
/// `src/lib/settings.ts`. The TUI's own, kept because #38 measured a warm
/// forced Scan at ~214 ms: under 1% of the 30 s floor.
pub const DEFAULT_REFRESH_MS: u64 = 60_000;
pub const MIN_REFRESH_MS: u64 = 30_000;
pub const MAX_REFRESH_MS: u64 = 3_600_000;
pub const DEFAULT_MACHINES_URL: &str = "https://tokscale-sync.bunnygamezsc.workers.dev";
static DOCUMENT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimit {
    pub provider: String,
    pub model: String,
    pub amount: f64,
}

fn valid_amount(amount: f64) -> bool {
    amount.is_finite() && amount > 0.0
}

fn normalized_limits(limits: Vec<ModelLimit>) -> Vec<ModelLimit> {
    let mut unique = std::collections::BTreeMap::new();
    for limit in limits {
        if valid_amount(limit.amount) && !limit.provider.is_empty() && !limit.model.is_empty() {
            unique.insert((limit.provider.clone(), limit.model.clone()), limit);
        }
    }
    unique.into_values().collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppStyle {
    Original,
    #[default]
    Nocturne,
    Terminal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiSettings {
    pub monthly_limit: Option<f64>,
    pub model_limits: Vec<ModelLimit>,
    pub spending_notifications_enabled: bool,
    pub appearance: Appearance,
    pub app_style: AppStyle,
    pub auto_refresh_enabled: bool,
    pub auto_refresh_ms: u64,
    pub minutely_view_enabled: bool,
    pub machine_id: String,
    pub machine_label: String,
    pub machines_base_url: String,
    pub machines_key_id: Option<String>,
}

impl Default for GuiSettings {
    fn default() -> Self {
        Self {
            monthly_limit: None,
            model_limits: Vec::new(),
            spending_notifications_enabled: false,
            appearance: Appearance::System,
            app_style: AppStyle::Nocturne,
            auto_refresh_enabled: false,
            auto_refresh_ms: DEFAULT_REFRESH_MS,
            minutely_view_enabled: false,
            machine_id: String::new(),
            machine_label: default_machine_label(),
            machines_base_url: DEFAULT_MACHINES_URL.to_string(),
            machines_key_id: None,
        }
    }
}

/// The settings a document says, key by key. A missing or mistyped key falls
/// back to its own default rather than taking the others down with it, and an
/// interval out of bounds is clamped.
pub fn settings_of(doc: &Value) -> GuiSettings {
    fn pick<T: serde::de::DeserializeOwned>(doc: &Value, key: &str) -> Option<T> {
        serde_json::from_value(doc.get(key)?.clone()).ok()
    }
    let d = GuiSettings::default();
    GuiSettings {
        monthly_limit: pick::<f64>(doc, "monthlyLimit").filter(|v| valid_amount(*v)),
        model_limits: normalized_limits(pick(doc, "modelLimits").unwrap_or_default()),
        spending_notifications_enabled: pick(doc, "spendingNotificationsEnabled").unwrap_or(false),
        appearance: pick(doc, "appearance").unwrap_or(d.appearance),
        app_style: pick(doc, "appStyle").unwrap_or(d.app_style),
        auto_refresh_enabled: pick(doc, "autoRefreshEnabled").unwrap_or(d.auto_refresh_enabled),
        auto_refresh_ms: pick(doc, "autoRefreshMs")
            .unwrap_or(d.auto_refresh_ms)
            .clamp(MIN_REFRESH_MS, MAX_REFRESH_MS),
        minutely_view_enabled: pick(doc, "minutelyViewEnabled").unwrap_or(d.minutely_view_enabled),
        machine_id: pick(doc, "machineId").unwrap_or(d.machine_id),
        machine_label: pick(doc, "machineLabel").unwrap_or(d.machine_label),
        machines_base_url: pick(doc, "machinesBaseUrl").unwrap_or(d.machines_base_url),
        machines_key_id: pick(doc, "machinesKeyId").unwrap_or(d.machines_key_id),
    }
}

/// Writes `settings` into `doc`, keeping every key it does not know about. A
/// document that is not an object is replaced: it is this app's own file, and
/// there is nothing in a non-object to keep.
pub fn with_settings(doc: Value, settings: &GuiSettings) -> Value {
    let mut map = match doc {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    let normalized = GuiSettings {
        monthly_limit: settings.monthly_limit.filter(|v| valid_amount(*v)),
        model_limits: normalized_limits(settings.model_limits.clone()),
        auto_refresh_ms: settings
            .auto_refresh_ms
            .clamp(MIN_REFRESH_MS, MAX_REFRESH_MS),
        ..settings.clone()
    };
    if let Value::Object(known) = serde_json::to_value(normalized).expect("settings serialize") {
        map.extend(known);
    }
    Value::Object(map)
}

/// The document on disk, or `{}` when it is absent or does not parse.
///
/// A broken file degrades rather than errors, like `settings.rs` and unlike
/// `pricing.rs`: nothing but the GUI writes it, so there is no one else's data
/// to protect, and an error here would leave the window unable to open its
/// own settings.
fn load(path: &Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| Value::Object(Map::new()))
}

/// Serialize every GUI document update, including warning history, so a settings
/// save cannot overwrite a threshold recorded by the refresh worker.
pub(crate) fn update_document<T>(
    path: &Path,
    update: impl FnOnce(&mut Value) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = DOCUMENT_LOCK
        .lock()
        .map_err(|_| "GUI document lock poisoned")?;
    let mut doc = load(path);
    let result = update(&mut doc)?;
    crate::pricing::write_json(path, &doc)?;
    Ok(result)
}

fn default_machine_label() -> String {
    hostname::get()
        .ok()
        .and_then(|name| name.into_string().ok())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "This machine".to_string())
}

/// Loads settings and creates the stable local identity on its first read.
pub(crate) fn load_settings(path: &Path) -> Result<GuiSettings, String> {
    let _guard = DOCUMENT_LOCK
        .lock()
        .map_err(|_| "GUI document lock poisoned")?;
    let doc = load(path);
    let mut settings = settings_of(&doc);
    let needs_save = settings.machine_id.is_empty();
    if needs_save {
        settings.machine_id = uuid::Uuid::new_v4().to_string();
        let next = with_settings(doc, &settings);
        crate::pricing::write_json(path, &next)?;
    }
    Ok(settings)
}

pub(crate) fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    path(app)
}

fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config directory: {e}"))?
        .join("gui.json"))
}

/// The GUI's settings. The frontend reads this before it shows the window, so
/// the first frame wears the saved appearance.
#[tauri::command]
pub async fn gui_settings(app: tauri::AppHandle) -> Result<GuiSettings, String> {
    let path = path(&app)?;
    crate::commands::blocking(move || load_settings(&path)).await
}

/// Saves the settings and returns them as stored, clamped.
#[tauri::command]
pub async fn set_gui_settings(
    app: tauri::AppHandle,
    settings: GuiSettings,
) -> Result<GuiSettings, String> {
    let path = path(&app)?;
    crate::commands::blocking(move || {
        update_document(&path, |doc| {
            let existing = settings_of(doc);
            let settings = GuiSettings {
                machine_id: if settings.machine_id.is_empty() {
                    if existing.machine_id.is_empty() {
                        uuid::Uuid::new_v4().to_string()
                    } else {
                        existing.machine_id
                    }
                } else {
                    settings.machine_id
                },
                ..settings
            };
            *doc = with_settings(doc.take(), &settings);
            Ok(settings_of(doc))
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_keys_fall_back_to_the_defaults() {
        assert_eq!(settings_of(&json!({})), GuiSettings::default());
        let s = settings_of(&json!({ "appearance": "dark", "appStyle": "terminal" }));
        assert_eq!(s.appearance, Appearance::Dark);
        assert_eq!(s.app_style, AppStyle::Terminal);
        assert!(!s.auto_refresh_enabled);
        assert!(!s.minutely_view_enabled);
    }

    /// One bad value costs that key, not the file.
    #[test]
    fn a_mistyped_key_costs_only_itself() {
        let s = settings_of(
            &json!({ "appearance": "sepia", "appStyle": "sepia", "minutelyViewEnabled": true }),
        );
        assert_eq!(s.appearance, Appearance::System);
        assert_eq!(s.app_style, AppStyle::Nocturne);
        assert!(s.minutely_view_enabled);
    }

    #[test]
    fn an_out_of_range_interval_is_clamped() {
        assert_eq!(
            settings_of(&json!({ "autoRefreshMs": 1 })).auto_refresh_ms,
            MIN_REFRESH_MS
        );
        assert_eq!(
            settings_of(&json!({ "autoRefreshMs": 86_400_000u64 })).auto_refresh_ms,
            MAX_REFRESH_MS
        );
    }

    #[test]
    fn saving_keeps_unknown_keys_and_clamps() {
        let doc = json!({ "fromANewerBuild": [1, 2], "appearance": "light" });
        let out = with_settings(
            doc,
            &GuiSettings {
                appearance: Appearance::Dark,
                app_style: AppStyle::Terminal,
                auto_refresh_ms: 5,
                ..Default::default()
            },
        );
        assert_eq!(out["fromANewerBuild"], json!([1, 2]));
        assert_eq!(out["appearance"], "dark");
        assert_eq!(out["appStyle"], "terminal");
        assert_eq!(out["autoRefreshMs"], MIN_REFRESH_MS);
    }

    #[test]
    fn every_style_and_appearance_round_trips_independently_on_disk() {
        let path = temp("styles");
        for app_style in [AppStyle::Original, AppStyle::Nocturne, AppStyle::Terminal] {
            for appearance in [Appearance::System, Appearance::Light, Appearance::Dark] {
                let settings = GuiSettings {
                    app_style,
                    appearance,
                    ..Default::default()
                };
                let doc = with_settings(json!({ "warningHistory": ["preserved"] }), &settings);
                crate::pricing::write_json(&path, &doc).unwrap();
                let loaded = load(&path);
                assert_eq!(settings_of(&loaded), settings);
                assert_eq!(loaded["warningHistory"], json!(["preserved"]));
            }
        }
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tokscale-gui-gui-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("gui.json")
    }

    #[test]
    fn an_absent_file_reads_as_the_defaults() {
        let path = temp("absent");
        std::fs::remove_file(&path).ok();
        assert_eq!(settings_of(&load(&path)), GuiSettings::default());
    }

    /// Unparseable reads as defaults, and a save over it writes a good file
    /// rather than refusing: the GUI is this file's only writer.
    #[test]
    fn an_unparseable_file_reads_as_the_defaults_and_a_save_repairs_it() {
        let path = temp("broken");
        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(settings_of(&load(&path)), GuiSettings::default());

        let dark = GuiSettings {
            appearance: Appearance::Dark,
            ..Default::default()
        };
        crate::pricing::write_json(&path, &with_settings(load(&path), &dark)).unwrap();
        assert_eq!(settings_of(&load(&path)), dark);
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }
}
