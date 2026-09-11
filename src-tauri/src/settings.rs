//! The `scanner` key of `~/.config/tokscale/settings.json`, read-only.
//!
//! Ticket 30 decided the GUI's **Enabled Clients** are a constant — every
//! `parse_local` Client, always — so the Snapshot is "the whole machine". That
//! claim is only true if the machine includes the places the user told tokscale
//! about by hand: `extraScanPaths` and `opencodeDbPaths` widen what a Scan
//! reads, and `bucketTimezone` decides which calendar day a message lands in.
//! Until this module existed both commands passed `scanner_settings:
//! Default::default()`, so none of it reached core and `NoUsage` told the user
//! to edit a file the app ignored.
//!
//! **Read-only, on purpose.** `settings.json` has one writer and it is the CLI
//! (`tui::settings::Settings::save`), which rewrites the whole document. A
//! second writer would need to agree with it about every key it has never heard
//! of, including the ones a future upstream adds. Reading costs nothing and
//! keeps the file single-writer, so the GUI reads and never writes — ADR 0005.
//!
//! Two keys are deliberately *not* read. `defaultClients` is a default for the
//! CLI's `--client` flags (`build_client_filter`), not a scan setting: honouring
//! it would silently narrow the GUI's Snapshot with no control on screen saying
//! so, which is the exact confusion ticket 30 exists to remove. And nothing here
//! pins `bucketTimezone` — pinning is a write, and the CLI owns it.

use tokscale_core::ScannerSettings;

/// The user's scanner settings, or the defaults.
///
/// Unlike `pricing::read_file`, a file that is missing, unreadable or broken
/// degrades to `Default` rather than erroring. The asymmetry is deliberate and
/// it comes from the direction of travel: the pricing module *writes*, so
/// treating a broken file as empty would erase a user's hand-written tiers,
/// while this module only reads, and the worst a broken file can do here is
/// scan the default locations. Failing the Scan instead would mean one stray
/// comma in a config file the GUI does not even edit makes the app unusable.
///
/// Re-read on every call rather than cached: the file is ~1 KB, the Scan it
/// feeds takes ~22 s, and a `OnceLock` would mean an edit made while the window
/// is open is ignored until relaunch — with no way to tell, since the GUI is
/// not the thing that changed it.
pub fn scanner() -> ScannerSettings {
    read(&tokscale_core::paths::get_config_dir().join("settings.json"))
}

fn read(path: &std::path::Path) -> ScannerSettings {
    // `ScannerSettings` is `#[serde(default)]` at both levels, so an older file
    // with no `scanner` key, or an empty one, deserializes cleanly.
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|doc| doc.get("scanner").cloned())
        .and_then(|s| serde_json::from_value(s).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(name: &str, body: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tokscale-gui-settings-{}-{name}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(&path, body).unwrap();
        path
    }

    /// The whole point of the module: the three `scanner` keys a real
    /// `settings.json` carries have to land in the struct core reads. If a
    /// spelling drifts — the file is camelCase, the struct is snake_case, and
    /// only a `rename_all` bridges them — the scan silently keeps using the
    /// default locations and the GUI is back to ignoring the file, invisibly.
    #[test]
    fn the_scanner_key_reaches_cores_own_type() {
        let path = at(
            "full",
            r#"{
              "colorPalette": "blue",
              "defaultClients": ["codex"],
              "scanner": {
                "opencodeDbPaths": ["/tmp/one.db"],
                "extraScanPaths": { "codex": ["/tmp/codex"] },
                "bucketTimezone": "America/Los_Angeles"
              }
            }"#,
        );

        let s = read(&path);
        assert_eq!(s.bucket_timezone.as_deref(), Some("America/Los_Angeles"));
        assert_eq!(s.opencode_db_paths, vec![std::path::PathBuf::from("/tmp/one.db")]);
        assert_eq!(
            s.extra_scan_paths.get("codex"),
            Some(&vec![std::path::PathBuf::from("/tmp/codex")])
        );

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    /// `defaultClients` is a CLI-flag default, not a scan setting. Reading it
    /// would narrow the Snapshot with nothing on screen saying so — the
    /// confusion ticket 30 removes. There is no field for it here, and this
    /// pins that a file carrying one still scans everything.
    #[test]
    fn default_clients_is_not_a_scan_setting() {
        let path = at("defaults", r#"{ "defaultClients": ["codex", "claude-code"] }"#);
        let s = read(&path);
        assert!(s.extra_scan_paths.is_empty());
        assert!(s.bucket_timezone.is_none());
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    /// A broken or absent file must not fail a Scan. This module only reads, so
    /// the worst a bad file can cost is the default locations; erroring would
    /// let one stray comma in a file the GUI never writes make it unusable.
    #[test]
    fn a_broken_or_absent_file_degrades_to_the_defaults() {
        let broken = at("broken", "{ not json at all");
        let s = read(&broken);
        assert!(s.bucket_timezone.is_none());
        assert!(s.opencode_db_paths.is_empty());
        std::fs::remove_dir_all(broken.parent().unwrap()).ok();

        let absent = std::env::temp_dir().join("tokscale-gui-no-settings-here.json");
        std::fs::remove_file(&absent).ok();
        assert!(read(&absent).extra_scan_paths.is_empty());
    }

    /// An older file with no `scanner` key at all is the common case, not an
    /// error: the key was added upstream after the file format existed.
    #[test]
    fn a_file_without_a_scanner_key_is_normal() {
        let path = at("legacy", r#"{ "colorPalette": "blue", "modelAliases": {} }"#);
        assert!(read(&path).bucket_timezone.is_none());
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }
}
