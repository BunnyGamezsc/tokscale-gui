# 2. Fork tokscale-cli to obtain a library target

Date: 2026-09-05

## Status

Accepted

## Context

Scope for this port covers phases P1–P3, where P3 is authentication and provider sync:
OAuth flows for Claude, Codex, Cursor, Grok and Kimi; `cursor`, `antigravity` and
`trae` sync; and Codex multi-account management.

None of that lives in `tokscale-core`. It lives in the `tokscale-cli` crate —
`auth.rs`, `cursor.rs`, `trae.rs`, `warp.rs`, `antigravity.rs`, `hindsight.rs` and the
`commands/` tree, some 12,500 lines for the auth and sync surface alone.

`tokscale-cli` declares only a `[[bin]]` target. It has no `[lib]`. None of that code
is reachable from another crate.

Three options were considered:

1. **Bundle the `tokscale` binary as a Tauri sidecar** and drive it over stdio using
   its existing `--json` output. No fork, upstream updates are a version bump.
2. **Fork `tokscale-cli` and add a `[lib]` target**, then call it in-process.
3. **Reimplement the auth and sync logic natively** in the Tauri backend.

## Decision

Fork the repository, add `crates/tokscale-cli/src/lib.rs` re-exporting the modules the
GUI needs, reduce `main.rs` to a thin shim over that library, and consume the fork as a
git submodule.

The project ships as a single binary with no bundled executable.

Option 1 was rejected because it entails shipping a second executable inside the app
bundle, which was ruled out as a product constraint.

Option 3 was rejected because reimplementing OAuth against five providers, plus
Electron `globalStorage` AES decryption and SQLite token extraction, would be both the
largest single work item in the project and a permanent source of divergence from
upstream.

No upstream pull request will be opened; the fork is maintained privately.

## Consequences

Every upstream update requires a merge into the fork. The conflict surface is small by
construction — one added file plus a reduced `main.rs` — but it is permanent, and it
never gets smaller, because the change is not being upstreamed.

Auth and sync run in-process. There is no subprocess, no stdio protocol, and no
serialization boundary, so errors surface as Rust values rather than parsed text.

The GUI is coupled to `tokscale-cli`'s module-internal API, which is markedly less
stable than `tokscale-core`'s, having never been designed for external callers. Upstream
is free to restructure it at will.

Should this maintenance burden prove unsustainable, the sidecar approach remains
available as a fallback, at the cost of the single-binary constraint.

**Amended 2026-09-05.** The fork's scope is wider than this ADR first assumed. Research
into `tauri-specta` established that `#[specta(remote)]` fails the orphan rule from the GUI
crate, so TypeScript type derives must be added to `tokscale-core` inside the fork as well.
The fork therefore spans both crates, and ADR 0001's dependency resolves to it rather than
to upstream. The merge conflict surface grows accordingly: no longer one added file plus a
reduced `main.rs`, but also every core struct carrying a derive attribute.

**Amended 2026-09-10**, reversing the amendment above. No derive was ever added to core.
The feature and the workspace dependency were plumbing with nothing behind them, and they
are reverted in the fork (`gui-v4.15.1-lib.2`). The GUI's IPC boundary is hand-written DTOs
instead; ADR 0001 records why, and what that costs.

The conflict surface is back to this ADR's original scope, the library-target commit,
plus one visibility change in core described below. That commit was never "one added
file" as first written, though. It adds
`lib.rs` and `shared.rs` (426 lines moved out of `main.rs`), reduces `main.rs`, and makes
small edits to the CLI's `Cargo.toml`, `tui/mod.rs`, `tui/ui/mod.rs` and `warp.rs`. Beyond
it there is one change to `crates/tokscale-core/src/lib.rs`, which makes three P1
aggregation entry points (`aggregate_model_usage_entries_with_rollup`,
`model_report_token_totals`, `filter_messages_for_report`) public. That is a visibility
change, not new code.

The `tokscale-cli` library target exists in the fork but is not yet a dependency of the GUI
crate, which depends on `tokscale-core` alone. It is dormant, not missing: P3 adds the
dependency when auth and sync are built.

**Amended 2026-09-13** (#39, ADR 0007). `tokscale-cli` is now a dependency of the GUI crate,
pinned to `gui-v4.15.1-lib.3`. That tag adds three seams to the conflict surface, each
added only because no function returned the data:

- `commands/usage/mod.rs`: `fetch_all_report_and_unconfigured`, which returns the report
  plus the providers skipped for lack of credentials. `fetch_all_report_with_intent` is now
  a wrapper over it, and the private `fetch_all_report_with_codex` returns both.
- `commands/usage/mod.rs`: `load_cache_any_age`, the subscription cache with its timestamp
  and no expiry. `load_cache_at` now calls the any-age reader and applies the five minutes.
- `spawn.rs` (new file, one line in `lib.rs`): a process-wide resolver for vendor CLI
  spawns, and one call site moved onto it, `Command::new("grok")` in
  `commands/usage/grok.rs`. With no resolver installed it is `Command::new(name)`.

No feature gate was added; ADR 0007 records the measurement behind that.

**Amended 2026-09-13** (#40). `gui-v4.15.1-lib.4` adds three more seams for provider sync.
Cursor needed none: `cursor::sync_cursor_cache` already returns a `SyncCursorResult`.

- `antigravity.rs`: `sync_antigravity_cache`, the body of `run_antigravity_sync`, returning
  the seven counts it used to print as `AntigravitySync`. `run_antigravity_sync` prints
  from it, unchanged in output.
- `trae.rs`: `sync::sync_trae`, the variant fall-over from `run_trae_sync`, returning the
  variant that succeeded and its session count. Unlike `run_trae_sync` it doesn't filter
  by `has_credentials`, which `run_trae_sync` now does before calling it.
- `trae.rs`: `auth::has_desktop_login`, whether the desktop client's `storage.json`
  exists. `decrypt_from_storage` now reads its path through the same private
  `storage_path`.

**Amended 2026-09-13** (#41). `gui-v4.15.1-lib.5` adds two seams and changes the spawn seam.
Account listing, adding, switching and removing needed none: `cursor::list_accounts`,
`read_local_cursor_session_token`, `validate_cursor_session`, `save_credentials`,
`set_active_account` and `remove_account`, and Codex's `list_accounts`,
`import_current_account`, `switch_active_account` and `remove_account` are already public
and return data. The `run_*` wrappers over them aren't called.

- `commands/codex_activity.rs`: `fetch`, the body of `run`, returning the
  `CodexAccountActivitySnapshot` it used to print. Its `codex app-server` spawn moved from
  `Command::new("codex")` onto `spawn::command`. Its transport's `Drop` now sends SIGTERM
  (through `/bin/kill`) before SIGKILL and no longer joins its reader threads. npm's `codex`
  is a node wrapper that gives the native binary our pipes and can't forward SIGKILL, so
  killing it orphaned the app-server with the pipes open and the join hung forever. That
  happened from a terminal too. It isn't a launchd problem.
- `commands/usage/codex.rs`: `is_missing_credentials` made public, so the GUI can tell "the
  codex CLI isn't signed in" from a failed import. A visibility change.
- `spawn.rs`: `command` now also puts the resolved binary's directory at the front of the
  child's `PATH`. Under nvm `codex` is a `#!/usr/bin/env node` script, and launchd's PATH
  has no `node` (ADR 0007's interpreter gap). With no resolver installed it's still
  `Command::new(name)` with the environment untouched.

**Amended 2026-09-14** (Windows port). `gui-v4.15.1-lib.6` changes two existing
spawn paths without adding a seam:

- `spawn.rs`: the resolver path sets Windows `CREATE_NO_WINDOW`, so a GUI-subsystem
  parent does not open a console window for a vendor CLI. The CLI's unresolved
  `Command::new(name)` path stays unchanged.
- `commands/codex_activity.rs`: `AppServerTransport::drop` runs
  `taskkill /T /F` on Windows before the existing `kill` and `wait`. Killing the
  npm `codex.cmd` wrapper alone leaves its node and `codex.exe` children alive.
