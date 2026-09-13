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

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuiSettings {
    pub appearance: Appearance,
    pub auto_refresh_enabled: bool,
    pub auto_refresh_ms: u64,
    pub minutely_view_enabled: bool,
}

impl Default for GuiSettings {
    fn default() -> Self {
        Self {
            appearance: Appearance::System,
            auto_refresh_enabled: false,
            auto_refresh_ms: DEFAULT_REFRESH_MS,
            minutely_view_enabled: false,
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
        appearance: pick(doc, "appearance").unwrap_or(d.appearance),
        auto_refresh_enabled: pick(doc, "autoRefreshEnabled").unwrap_or(d.auto_refresh_enabled),
        auto_refresh_ms: pick(doc, "autoRefreshMs")
            .unwrap_or(d.auto_refresh_ms)
            .clamp(MIN_REFRESH_MS, MAX_REFRESH_MS),
        minutely_view_enabled: pick(doc, "minutelyViewEnabled").unwrap_or(d.minutely_view_enabled),
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
        auto_refresh_ms: settings.auto_refresh_ms.clamp(MIN_REFRESH_MS, MAX_REFRESH_MS),
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
    crate::commands::blocking(move || Ok(settings_of(&load(&path)))).await
}

/// Saves the settings and returns them as stored, clamped.
#[tauri::command]
pub async fn set_gui_settings(
    app: tauri::AppHandle,
    settings: GuiSettings,
) -> Result<GuiSettings, String> {
    let path = path(&app)?;
    crate::commands::blocking(move || {
        let doc = with_settings(load(&path), &settings);
        crate::pricing::write_json(&path, &doc)?;
        Ok(settings_of(&doc))
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
        let s = settings_of(&json!({ "appearance": "dark" }));
        assert_eq!(s.appearance, Appearance::Dark);
        assert!(!s.auto_refresh_enabled);
        assert!(!s.minutely_view_enabled);
    }

    /// One bad value costs that key, not the file.
    #[test]
    fn a_mistyped_key_costs_only_itself() {
        let s = settings_of(&json!({ "appearance": "sepia", "minutelyViewEnabled": true }));
        assert_eq!(s.appearance, Appearance::System);
        assert!(s.minutely_view_enabled);
    }

    #[test]
    fn an_out_of_range_interval_is_clamped() {
        assert_eq!(settings_of(&json!({ "autoRefreshMs": 1 })).auto_refresh_ms, MIN_REFRESH_MS);
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
                auto_refresh_ms: 5,
                ..Default::default()
            },
        );
        assert_eq!(out["fromANewerBuild"], json!([1, 2]));
        assert_eq!(out["appearance"], "dark");
        assert_eq!(out["autoRefreshMs"], MIN_REFRESH_MS);
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tokscale-gui-gui-{}-{name}", std::process::id()));
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
