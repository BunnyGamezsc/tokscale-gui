//! Tokscale GUI — Tauri backend.
//!
//! Data comes from `tokscale-core` in-process (ADR 0001). The command surface
//! is deliberately near-empty: it is designed by ticket 08, not here.

#[tauri::command]
fn ping() -> &'static str {
    "ok"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
