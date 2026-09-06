//! Tokscale GUI — Tauri backend.
//!
//! Data comes from `tokscale-core` in-process (ADR 0001).
//!
//! The command surface is designed by ticket 09 and is not built yet. What it
//! decided, so the next session does not have to re-read the issue:
//!
//! - Five commands, all `async` and all dispatched onto `spawn_blocking`:
//!   `scan`, `model_report`, `graph_report`, `clients`, `settings`.
//! - `scan` parses once into a snapshot held in `tauri::State`; the report
//!   commands re-aggregate from that snapshot rather than rescanning.
//! - Progress is a `scan:progress` Tauri event, emitted around the discovery
//!   phase only.
//! - camelCase across the whole boundary, with `tauri-specta` generating the
//!   TypeScript from `#[derive(specta::Type)]` in the forked core.
//!
//! Ticket 08's scan probe and ticket 14's threading bench both lived here and
//! have been removed; their measurements are recorded on the issues.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
