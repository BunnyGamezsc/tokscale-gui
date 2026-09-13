//! **Accounts** (#41): Cursor's and Codex's saved accounts, read and written
//! through the fork's own credential stores, the files the CLI and TUI use.
//! Tokens never cross the IPC boundary and are never stored by the GUI.

use tokscale_cli::commands::codex_activity::{self, CodexAccountActivityStatus};
use tokscale_cli::commands::usage::codex;
use tokscale_cli::cursor;

use crate::dto::{Account, AccountAdded, Accounts, CodexActivity};

#[tauri::command]
pub async fn accounts() -> Result<Accounts, String> {
    crate::commands::blocking(|| {
        Ok(Accounts {
            cursor: cursor::list_accounts()
                .into_iter()
                .map(|a| Account { id: a.id, label: a.label, active: a.is_active })
                .collect(),
            codex: codex::list_accounts()
                .into_iter()
                .map(|a| Account { id: a.id, label: a.label, active: a.is_active })
                .collect(),
        })
    })
    .await
}

/// Adds the account each vendor's own tool is signed in to, and makes it active.
/// Always the user's explicit action: the Usage View's fetch never imports (ADR 0007).
#[tauri::command]
pub async fn add_account(provider: String) -> Result<AccountAdded, String> {
    crate::commands::blocking(move || match provider.as_str() {
        "cursor" => Ok(add_cursor()),
        "codex" => Ok(match codex::import_current_account(None) {
            Ok(_) => added(),
            Err(e) if codex::is_missing_credentials(&e) => {
                not_set_up("The codex CLI isn't signed in. Run `codex login`, then add again.")
            }
            Err(e) => failed(format!("{e:#}")),
        }),
        other => Err(format!("unknown account provider: {other}")),
    })
    .await
}

/// `tokscale cursor login` without its pasted-token fallback: read the desktop
/// app's `state.vscdb` login, validate it, save it.
fn add_cursor() -> AccountAdded {
    let Ok(token) = cursor::read_local_cursor_session_token() else {
        return not_set_up("Cursor isn't installed or isn't signed in. Sign in to the Cursor app, then add again.");
    };
    // An `async fn` that builds no runtime, so `block_on` inside `blocking` is
    // safe, as `sync` awaits `sync_cursor_cache` (ADR 0007).
    let check = tauri::async_runtime::block_on(cursor::validate_cursor_session(&token));
    if !check.valid {
        return failed(check.error.unwrap_or_else(|| "Cursor rejected the session.".into()));
    }
    match cursor::save_credentials(&token, None) {
        Ok(_) => added(),
        Err(e) => failed(format!("{e:#}")),
    }
}

/// Codex's switch also rewrites the codex CLI's `auth.json`, which is what makes
/// the Usage View's next fetch see the account as active.
#[tauri::command]
pub async fn switch_account(provider: String, id: String) -> Result<(), String> {
    crate::commands::blocking(move || {
        match provider.as_str() {
            "cursor" => cursor::set_active_account(&id),
            "codex" => codex::switch_active_account(&id).map(drop),
            other => return Err(format!("unknown account provider: {other}")),
        }
        .map_err(|e| format!("{e:#}"))
    })
    .await
}

/// Deletes the account's stored credentials. Cursor's usage cache for it is
/// archived, not purged. Codex refuses the active account.
#[tauri::command]
pub async fn remove_account(provider: String, id: String) -> Result<(), String> {
    crate::commands::blocking(move || {
        match provider.as_str() {
            "cursor" => cursor::remove_account(&id, false),
            "codex" => codex::remove_account(&id).map(drop),
            other => return Err(format!("unknown account provider: {other}")),
        }
        .map_err(|e| format!("{e:#}"))
    })
    .await
}

/// The codex CLI's current login's activity, from `codex app-server`, spawned
/// through `vendor::for_spawn`. Seconds when it answers, up to ten when it doesn't.
#[tauri::command]
pub async fn codex_activity() -> Result<CodexActivity, String> {
    crate::commands::blocking(|| {
        let s = codex_activity::fetch();
        Ok(CodexActivity {
            status: match s.status {
                CodexAccountActivityStatus::Available => "available",
                CodexAccountActivityStatus::UnsupportedCli => "unsupportedCli",
                CodexAccountActivityStatus::UnsupportedAuth => "unsupportedAuth",
                CodexAccountActivityStatus::Unavailable => "unavailable",
            },
            lifetime_tokens: s.lifetime_tokens,
            current_streak_days: s.current_streak_days,
            message: s.message,
        })
    })
    .await
}

fn added() -> AccountAdded {
    AccountAdded { state: "added", message: None }
}

fn not_set_up(message: &str) -> AccountAdded {
    AccountAdded { state: "notSetUp", message: Some(message.into()) }
}

fn failed(message: String) -> AccountAdded {
    AccountAdded { state: "failed", message: Some(message) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The spawn as the command runs it. Under launchd's PATH this is what a
    /// Finder-launched build does, short of Finder itself (ADR 0006):
    ///
    /// ```text
    /// env -i HOME=$HOME PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    ///   cargo test --lib -- --ignored --nocapture real_codex_activity
    /// ```
    ///
    /// Prints the status only, never figures.
    #[test]
    #[ignore]
    fn real_codex_activity() {
        tokscale_cli::spawn::set_resolver(crate::vendor::for_spawn);
        let a = tauri::async_runtime::block_on(codex_activity()).expect("activity");
        println!("{} {:?}, lifetime present: {}", a.status, a.message, a.lifetime_tokens.is_some());
    }

    /// A switch reaching the Usage View's next fetch and Cursor's sync, through
    /// the real commands, in a throwaway HOME holding two fabricated accounts
    /// per provider. Their tokens are junk, so every fetch and sync fails, naming
    /// the account it tried. No Cursor app exists there, so the sync can't
    /// re-activate a desktop login.
    ///
    /// ```text
    /// P=$TMPDIR/tokscale-gui-accounts-probe; env -i HOME=$P CODEX_HOME=$P/.codex PATH=... \
    ///   cargo test --lib -- --ignored --nocapture switching_reaches_usage_and_sync
    /// ```
    #[test]
    #[ignore]
    fn switching_reaches_usage_and_sync() {
        use serde_json::json;
        use tauri::async_runtime::block_on;

        let home = std::path::PathBuf::from(std::env::var("HOME").unwrap());
        assert!(home.ends_with("tokscale-gui-accounts-probe"), "needs a throwaway HOME");
        let config = home.join(".config/tokscale");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();

        let tokens = |id: &str| json!({ "access_token": format!("junk-{id}"), "refresh_token": "junk", "account_id": id });
        let codex = |id: &str, label: &str| json!({ "tokens": tokens(id), "createdAt": "2026-09-13T00:00:00Z", "label": label });
        let store = json!({ "version": 1, "activeAccountId": "acct-a",
            "accounts": { "acct-a": codex("acct-a", "Alpha"), "acct-b": codex("acct-b", "Beta") } });
        std::fs::write(config.join("codex-credentials.json"), store.to_string()).unwrap();
        std::fs::write(home.join(".codex/auth.json"), json!({ "tokens": tokens("acct-a") }).to_string()).unwrap();
        let session = |id: &str| json!({ "sessionToken": format!("{id}%3A%3Ajunk"), "userId": id, "createdAt": "2026-09-13T00:00:00Z" });
        let store = json!({ "version": 1, "activeAccountId": "user_a",
            "accounts": { "user_a": session("user_a"), "user_b": session("user_b") } });
        std::fs::write(config.join("cursor-credentials.json"), store.to_string()).unwrap();

        let active = || {
            let a = block_on(accounts()).unwrap();
            let cursor = a.cursor.into_iter().find(|x| x.active).map(|x| x.id);
            (cursor, a.codex.into_iter().find(|x| x.active).and_then(|x| x.label))
        };
        let codex_cards = || {
            let q = block_on(crate::usage::quota()).unwrap();
            q.cards.into_iter().filter(|c| c.provider == "Codex").map(|c| c.account).collect::<Vec<_>>()
        };

        println!("before: {:?}, Codex cards {:?}", active(), codex_cards());
        block_on(switch_account("codex".into(), "acct-b".into())).unwrap();
        block_on(switch_account("cursor".into(), "user_b".into())).unwrap();
        let cards = codex_cards();
        println!("after switch: {:?}, Codex cards {cards:?}", active());
        let s = block_on(crate::sync::sync("cursor".into())).unwrap();
        println!("cursor sync: {} {:?}; after: {:?}", s.state, s.message, active());

        assert_eq!(active(), (Some("user_b".into()), Some("Beta".into())));
        assert_eq!(cards.first(), Some(&Some("Beta".into())), "the active account's card leads");
        std::fs::remove_dir_all(&home).ok();
    }
}
