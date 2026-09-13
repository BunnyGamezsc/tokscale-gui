//! **Sync**: pulling Cursor, Antigravity and Trae usage into the local caches a
//! Scan reads (#40). A sync adds data to a Source; it doesn't change Enabled
//! Clients (ADR 0005), and nothing is on screen until the Refresh after it.

use std::path::Path;
use std::time::UNIX_EPOCH;

use tokscale_cli::antigravity::{get_antigravity_sessions_dir, sync_antigravity_cache, AntigravitySync};
use tokscale_cli::cursor::{
    get_cursor_cache_dir, is_cursor_logged_in, read_local_cursor_session_token, sync_cursor_cache,
    SyncCursorResult,
};
use tokscale_cli::trae::auth::{self, get_trae_cache_dir, TraeVariant};

use crate::dto::{SyncOutcome, SyncStatus};

/// The CLI's `tokscale trae sync --since` default.
const TRAE_SINCE_DAYS: i64 = 30;

/// When each provider's cache last received data, from the files a Scan reads.
#[tauri::command]
pub async fn sync_status() -> Result<Vec<SyncStatus>, String> {
    crate::commands::blocking(|| {
        let cursor = get_cursor_cache_dir().ok();
        let antigravity = get_antigravity_sessions_dir().ok();
        let trae = get_trae_cache_dir().join("sessions");
        Ok(vec![
            SyncStatus { provider: "cursor", last_synced_at: cursor.and_then(|d| newest(&d, "usage")) },
            SyncStatus {
                provider: "antigravity",
                last_synced_at: antigravity.and_then(|d| newest(&d, "")),
            },
            SyncStatus { provider: "trae", last_synced_at: newest(&trae, "usage-") },
        ])
    })
    .await
}

/// Syncs one provider. The frontend never starts one while a Scan runs, and
/// Refreshes through `refreshScan` after a successful one (#40).
///
/// Runtimes follow ADR 0007. Cursor's and Trae's syncs are `async fn`s that
/// build no runtime of their own, so they're awaited with `block_on` inside
/// `blocking`, as `priced_parse` is. Antigravity's is a plain `fn` whose RPCs
/// run on their own threads and runtime, so it's called with nothing around it.
#[tauri::command]
pub async fn sync(provider: String) -> Result<SyncOutcome, String> {
    crate::commands::blocking(move || match provider.as_str() {
        "cursor" => {
            // Reading the desktop login is a SQLite read, no network. Cursor's
            // sync reads it again and prefers it over a stored token.
            if !is_cursor_logged_in() && read_local_cursor_session_token().is_err() {
                return Ok(not_set_up("cursor", "Sign in to the Cursor app, then sync again."));
            }
            Ok(of_cursor(tauri::async_runtime::block_on(sync_cursor_cache(true))))
        }
        "antigravity" => Ok(of_antigravity(sync_antigravity_cache().map_err(|e| format!("{e:#}")))),
        "trae" => {
            let variants: Vec<TraeVariant> = auth::all_variants()
                .into_iter()
                .filter(|v| auth::has_credentials(*v) || auth::has_desktop_login(*v))
                .collect();
            Ok(of_trae(tauri::async_runtime::block_on(
                tokscale_cli::trae::sync::sync_trae(&variants, TRAE_SINCE_DAYS, false),
            )
            .map_err(|e| format!("{e:#}"))))
        }
        other => Err(format!("unknown sync provider: {other}")),
    })
    .await
}

fn of_cursor(r: SyncCursorResult) -> SyncOutcome {
    if r.synced {
        // `error` beside `synced` is "some accounts failed", worth showing.
        return SyncOutcome { message: r.error, ..synced("cursor", r.rows, "rows") };
    }
    failed("cursor", r.error.unwrap_or_else(|| "Cursor sync failed".into()))
}

fn of_antigravity(r: Result<AntigravitySync, String>) -> SyncOutcome {
    match r {
        // Sessions come from the running app's language server. Without one the
        // sync keeps what was cached and brings in nothing new.
        Ok(s) if s.detected_connections == 0 => {
            not_set_up("antigravity", "Antigravity isn't running. Open it, then sync again.")
        }
        Ok(s) => synced("antigravity", s.cached_sessions, "sessions"),
        Err(e) => failed("antigravity", e),
    }
}

fn of_trae(r: Result<Option<(TraeVariant, usize)>, String>) -> SyncOutcome {
    match r {
        Ok(Some((_, n))) => synced("trae", n, "sessions"),
        Ok(None) => not_set_up("trae", "Sign in to the Trae app, then sync again."),
        Err(e) => failed("trae", e),
    }
}

fn synced(provider: &'static str, count: usize, unit: &'static str) -> SyncOutcome {
    SyncOutcome { provider, state: "synced", count, unit, message: None }
}

fn not_set_up(provider: &'static str, message: &str) -> SyncOutcome {
    SyncOutcome { provider, state: "notSetUp", count: 0, unit: "", message: Some(message.into()) }
}

fn failed(provider: &'static str, message: String) -> SyncOutcome {
    SyncOutcome { provider, state: "failed", count: 0, unit: "", message: Some(message) }
}

/// Newest mtime among `dir`'s entries starting with `prefix`, in Unix seconds.
fn newest(dir: &Path, prefix: &str) -> Option<u64> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(prefix))
        .filter_map(|e| e.metadata().ok()?.modified().ok())
        .max()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn antigravity(connections: usize) -> AntigravitySync {
        AntigravitySync {
            cache_dir: PathBuf::new(),
            known_sessions: 3,
            detected_connections: connections,
            detected_sessions: 4,
            filesystem_candidates: 4,
            export_candidates: 4,
            cached_sessions: 4,
        }
    }

    #[test]
    fn cursor_maps_synced_partial_and_failed() {
        let ok = of_cursor(SyncCursorResult { synced: true, rows: 412, error: None });
        assert_eq!((ok.state, ok.count, ok.unit, ok.message), ("synced", 412, "rows", None));

        let partial = of_cursor(SyncCursorResult {
            synced: true,
            rows: 10,
            error: Some("Some accounts failed to sync (1/2)".into()),
        });
        assert_eq!(partial.state, "synced");
        assert_eq!(partial.message.as_deref(), Some("Some accounts failed to sync (1/2)"));

        let bad = of_cursor(SyncCursorResult { synced: false, rows: 0, error: Some("401".into()) });
        assert_eq!((bad.provider, bad.state, bad.message.as_deref()), ("cursor", "failed", Some("401")));
    }

    #[test]
    fn antigravity_needs_the_app_running_and_names_its_error() {
        let ok = of_antigravity(Ok(antigravity(1)));
        assert_eq!((ok.state, ok.count, ok.unit), ("synced", 4, "sessions"));

        assert_eq!(of_antigravity(Ok(antigravity(0))).state, "notSetUp");

        let bad = of_antigravity(Err("sync: lock held".into()));
        assert_eq!((bad.state, bad.message.as_deref()), ("failed", Some("sync: lock held")));
    }

    #[test]
    fn trae_maps_synced_not_set_up_and_failed() {
        let ok = of_trae(Ok(Some((TraeVariant::Ide, 7))));
        assert_eq!((ok.state, ok.count, ok.unit), ("synced", 7, "sessions"));
        assert_eq!(of_trae(Ok(None)).state, "notSetUp");
        let bad = of_trae(Err("token expired".into()));
        assert_eq!((bad.provider, bad.state, bad.message.as_deref()), ("trae", "failed", Some("token expired")));
    }

    /// The real sync, then the Scan the Refresh after it runs, on this machine:
    /// proves synced rows reach the Snapshot, not just the cache. Prints counts,
    /// never usage. Writes the real provider caches.
    ///
    /// `cargo test --lib -- --ignored --nocapture real_sync_reaches_the_scan`
    #[test]
    #[ignore]
    fn real_sync_reaches_the_scan() {
        use crate::commands::{blocking, priced_parse, Filter};
        use tauri::async_runtime::block_on;

        let scanned = |client: &'static str| {
            let messages = block_on(blocking(|| block_on(priced_parse(Filter::default().parse_options()))))
                .expect("scan");
            messages.iter().filter(|m| m.client == client).map(|m| m.message_count).sum::<i32>()
        };

        for provider in ["cursor", "antigravity", "trae"] {
            let before = scanned(provider);
            let started = std::time::Instant::now();
            let r = block_on(sync(provider.into())).expect("sync");
            let ms = started.elapsed().as_millis();
            let after = scanned(provider);
            println!(
                "{provider}: {} {} {} in {ms} ms ({:?}); Scan messages {before} -> {after}",
                r.state, r.count, r.unit, r.message
            );
        }
        println!("status: {:?}", block_on(sync_status()).expect("status"));

        // Core's own default set, which the GUI used before #40: no Cursor lane.
        let core_default = tokscale_core::LocalParseOptions { clients: None, ..Filter::default().parse_options() };
        let messages = block_on(blocking(move || block_on(priced_parse(core_default)))).expect("scan");
        let cursor = messages.iter().filter(|m| m.client == "cursor").count();
        println!("cursor messages under core's default client set: {cursor}");
    }
}
