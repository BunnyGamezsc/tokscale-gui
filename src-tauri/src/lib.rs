//! Tokscale GUI — Tauri backend.
//!
//! Data comes from `tokscale-core` in-process (ADR 0001). The command surface
//! is deliberately near-empty: it is designed by ticket 09, not here. What
//! lives here for now is ticket 08's measurement harness.

mod probe;

/// Cheap round-trip. Ticket 08 polls this *during* a scan to find out whether
/// the scan starves the IPC runtime — a scan that blocks other commands needs
/// a dedicated thread and progress reporting; one that does not, does not.
#[tauri::command]
fn ping() -> &'static str {
    "ok"
}

#[tauri::command]
async fn scan_probe() -> Result<probe::ScanProbe, String> {
    let result = probe::run().await;
    // Ticket 08 is run from a terminal and read from the window; echoing the
    // same value to stderr means the numbers survive the window being closed.
    match &result {
        Ok(probe) => eprintln!(
            "SCAN_PROBE {}",
            serde_json::to_string(probe).unwrap_or_default()
        ),
        Err(e) => eprintln!("SCAN_PROBE_ERROR {e}"),
    }
    result
}

/// Frontend hands its ping profile back so repeat runs can be captured from a
/// terminal rather than read off a screenshot.
#[tauri::command]
fn report_ping_profile(profile: serde_json::Value) {
    eprintln!("PING_PROFILE {profile}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping, scan_probe, report_ping_profile])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
