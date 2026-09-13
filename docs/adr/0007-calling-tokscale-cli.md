# 7. Calling tokscale-cli from the GUI

Date: 2026-09-13

## Status

Accepted

## Context

#39 is the first ticket to depend on the fork's `tokscale-cli` library target (ADR 0002),
for the Usage View's quota cards. That dependency raised four questions, and each one
changes the structure of the code, not just its details:

1. `tokscale-cli` has no feature gating. Adding it brings in the whole CLI: clap, ratatui,
   crossterm, indicatif, the `wrapped` image stack, qrcode, rpassword.
2. Most of the CLI is `run_*` functions that print. The GUI needs data.
3. The quota fetchers are blocking `fn`s that build their own tokio runtimes, and every GUI
   command runs inside `blocking`, on Tauri's runtime.
4. The fetch path reads the Keychain and may spawn vendor CLIs, from an unsigned app that
   Finder launches with launchd's PATH (ADR 0006).

## Decision

### Accept the weight, no feature gate

Measured on the author's machine with `CARGO_BUILD_JOBS=4`. Each build was a clean
`target/release`:

| | `tokscale-core` only | + `tokscale-cli` |
| --- | --- | --- |
| Unique normal deps (`cargo tree -e normal`) | 382 | 548 |
| Max tree depth | 16 | 16 |
| Clean release build | 3m17s (635 s CPU) | 5m36s (1107 s CPU) |
| Release binary | 23,423,248 B | 25,310,272 B (+8.1%) |
| `cargo +1.88 check --locked` | builds (#22) | builds, floor unchanged |

The 166 new crates are the TUI (ratatui, crossterm, arboard), `wrapped`'s image stack
(image, imageproc and its nalgebra, resvg, usvg, tiny-skia, ab_glyph), clap, indicatif,
comfy-table, qrcode and rpassword. None of it is reachable from the Usage path, so the
linker drops it and the binary grows by 1.9 MB, most of which is the fetchers, reqwest's
native TLS and rusqlite. The real cost is the extra ~2m20s on a
clean build. Incremental GUI builds don't recompile the CLI crate.

A gate would need `cfg` on `pub mod tui`, on `commands::wrapped`, on `shared.rs`'s clap
derives (which `ClientFlags` uses), `required-features` on the binary, and every
cross-module reference into those. All of that lands in the files upstream changes most,
and ADR 0002 says the conflict surface never shrinks. Reopen this if the binary grows past
what a quota View justifies, or a clean build stops finishing on this machine.

### Prefer a function that already returns data; add a seam only when none exists

The rule for every P3 ticket. Any seam gets listed in ADR 0002. This ticket calls three
functions:

- `save_cache`: already public, already returns nothing that prints.
- `fetch_all_report_and_unconfigured`: **a seam.** `fetch_all_report_with_intent` drops
  providers with no credentials, and `usage_providers` is private. The GUI could call each
  `has_credentials` again, but Claude's runs `security` and Antigravity's builds a runtime to
  probe a port. So the fork returns the skipped names from the pass it already makes.
- `load_cache_any_age`: **a seam.** `load_cache` returns `None` once the file is five
  minutes old, which makes it a freshness cache, not a last-known result. The name follows
  upstream's own `PricingService::load_cached_any_age`.

The fork's types stop at `usage.rs`. `UsageOutput` and friends derive `Serialize`, but the
boundary is hand-written camelCase DTOs (ADR 0001): `Quota`, `QuotaCard`, `QuotaMetric`.
`quota_of` does the mapping and is the tested part. It takes the report, the not-set-up
names and the cache, and returns cards that are `fresh`, `stale` or `failed`:

- A diagnostic with an account, or with no card for its provider, becomes a failed card.
- A diagnostic with no account sits beside its provider's card. Codex's OpenCode fallback
  can succeed after the native fetch fails, and a stale card should say why it's stale.
- The cache replaces the result only when the fetch produced no outputs *and* some
  diagnostics. No outputs and no diagnostics means nothing is set up, and old cards would
  misstate that.

### `CliReadOnly`, never `TuiSurface`

`TuiSurface` routes Codex through `fetch_all_report_importing_current_auth`, which saves
the current Codex login into tokscale's account store. A read-only View doesn't write
accounts; importing is #41's. `CliReadOnly` can still write back a refreshed token for an
account already in that store (`persist_refreshed_tokens`), as `tokscale usage` does. That
refreshes an existing account. It doesn't import one.

### No runtime around the fetch

Every fetcher runs on a `std::thread::scope` thread (`fetch_all_report_with_codex`), and a
fresh OS thread has no tokio context, so their `new_current_thread().block_on` is safe
there. The exception is `has_credentials`, which runs on the *calling* thread, and
`antigravity::has_credentials` builds a runtime and `block_on`s. So `quota` calls the fork
directly inside `blocking`. It does not wrap the call in `tauri::async_runtime::block_on`,
which is how the core commands call their `async fn`s, and doing that here would be the
nested-runtime panic.

The `real_quota_fetch` probe runs the command exactly as Tauri does: `block_on(quota())`,
with the fetch on the blocking pool. On the author's machine it finished in 1,003 ms with
no panic. Claude, Codex, Copilot and Grok Build came back fresh, and nine providers were not
set up, Antigravity among them, so its runtime-building `has_credentials` ran on the
blocking-pool thread. No Keychain read stalled on a prompt.

`cursor.rs`'s three `Runtime::new()` calls aren't on this path. #40 and #41 reach them and
need the same check.

### Vendor spawns: Grok is on this path, Codex isn't

Traced from `fetch_all_report_with_intent(CliReadOnly)`:

- **Codex** reaches `codex::fetch_all_report`, which reads `~/.codex/auth.json` (or the
  `Codex Auth` Keychain item, or OpenCode's file) and calls HTTP. It spawns nothing, and
  `codex_activity.rs` isn't reached.
- **Grok** falls back to `grok agent --no-leader stdio` when its network fetch returns no
  metrics and `auth.json` holds one credential (`grok.rs`). In a Finder-launched build that
  bare name doesn't resolve, `.ok()?` swallows the failure, and the card silently loses its
  billing figures.

So the seam lands now. `tokscale_cli::spawn` holds a process-wide resolver.
`run` installs `vendor::for_spawn` before the builder, and Grok's spawn goes through
`spawn::command`. With no resolver installed it's `Command::new(name)`, so the CLI binary
behaves as upstream. #41 moves `codex_activity.rs` onto the same call.

**A gap #41 will hit:** an absolute path resolves the binary, not its interpreter. Under
nvm, `codex` and `gemini` are `#!/usr/bin/env node` scripts, and with launchd's PATH `env`
can't find `node`. So ADR 0006's "spawn the returned `PathBuf`" isn't enough for them.
The child also needs the binary's own directory on its PATH. Grok is a Mach-O binary and
isn't affected, so this ticket doesn't fix it.

### The Keychain prompt

With no `~/.claude/.credentials.json` (this machine), Claude reads the `Claude
Code-credentials` item through `helpers::read_keychain`. A Keychain item's access control
is checked against the process reading it, and that is `/usr/bin/security`, not this app.
From a terminal, `security find-generic-password -s "Claude Code-credentials" -w` returned
at once with no prompt, so that item already trusts `security`. The parent process isn't
part of the check, so an unsigned or rebuilt GUI binary doesn't add a prompt.

Two items on the path may differ, and neither was checked. The session's probe of them was
denied, and the packaged app wasn't clicked through:

- `Codex Auth`, written in-process by Codex's own binary, which would trust that binary
  and not `security`. Read only when `~/.codex/auth.json` is missing.
- `gh:github.com`, which Copilot's `has_credentials` reads on every fetch. `gh` stores it
  through go-keyring, whose macOS backend itself runs `/usr/bin/security`, so it probably
  trusts it.

The View explains before a prompt can appear. Its footnote is on screen during the first
fetch and names `security` as the reader, so a dialog naming `security` isn't a surprise.

### Stale, and the shared cache file

The GUI saves outputs to the fork's `subscription-usage-cache.json` when a fetch returns
any. It's the file the TUI reads, so either tool's last fetch warms the other. A partial
fetch replaces the file, so a provider that failed loses its stale card. Stale is for "no
provider could be reached" (marked `ponytail:` in `usage.rs`).

### What the View doesn't do

It shows no tokscale-computed figure, so nothing can be read as a reconciliation. `R`
stays a Scan, and the View has its own **Fetch again**. Interval refresh (ADR 0008) doesn't
fetch quota. A revisit inside five minutes, the fork's own cache lifetime, reuses the
last answer.

## Consequences

- A clean release build takes ~2m20s longer. Disk and memory pressure make that the
  number to watch, not binary size.
- The fork now carries three seams and one moved call site. ADR 0002 lists them.
- `spawn::set_resolver` is global and first-write-wins, so it's installed at the top of
  `run`, before any command can fetch.
- #41 inherits two known problems: the interpreter gap for nvm scripts, and whether
  `Codex Auth` prompts.
