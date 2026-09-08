//! Tokscale GUI — Tauri backend.
//!
//! Data comes from `tokscale-core` in-process (ADR 0001).
//!
//! The command surface designed by ticket 09 now lives in `commands`:
//!
//! - Five commands, all `async` and all dispatched onto `spawn_blocking`:
//!   `scan`, `model_report`, `graph_report`, `clients`, `unpriced`.
//! - `scan` parses once into a snapshot held in `tauri::State`; the report
//!   commands re-aggregate from that snapshot rather than rescanning.
//! - Progress is a `scan:progress` Tauri event, emitted around the discovery
//!   phase only.
//! - camelCase across the whole boundary. Ticket 09 planned to get that from
//!   `#[derive(specta::Type)]` in the forked core; building it showed P1 reads
//!   15 fields rather than the ~150 that made GUI-side DTOs look expensive, so
//!   the boundary is declared in `dto` instead. See that module.
//!
//! Ticket 08's scan probe and ticket 14's threading bench both lived here and
//! have been removed; their measurements are recorded on the issues.
//!
//! Ticket 07 settled appearance: the window is created hidden and the frontend
//! shows it once it has set the theme, so the first frame is already wearing the
//! right NSAppearance (see `src/theme.ts`). The timer below is the safety net
//! for that arrangement.

use std::time::Duration;

use tauri::Manager;

mod commands;
mod dto;
mod pricing;

/// How long the backend waits for the frontend to show the window itself.
/// Comfortably longer than a cold webview start, short enough that a user who
/// hit a frontend error is not left staring at a Dock icon and no window.
const SHOW_FALLBACK: Duration = Duration::from_millis(1500);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_FALLBACK);
                // No-op once the frontend has already shown it. A failed probe
                // counts as not-visible: this is the safety net, so it should
                // err towards firing.
                if !window.is_visible().unwrap_or(false) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });
            Ok(())
        })
        .manage(commands::Snapshot::default())
        .invoke_handler(tauri::generate_handler![
            commands::scan,
            commands::model_report,
            commands::graph_report,
            commands::clients,
            commands::unpriced,
            pricing::custom_pricing,
            pricing::set_custom_pricing,
            pricing::clear_custom_pricing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
