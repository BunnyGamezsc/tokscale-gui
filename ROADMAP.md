# Roadmap

A GUI port of [tokscale](https://github.com/junhoyeo/tokscale). The hard architecture
questions are answered; what is left is building views.

**Read first:** `CONTEXT.md` (glossary — mirrors upstream tokscale's vocabulary verbatim),
then `docs/adr/`.

## Flow

Work moves in three steps, one chat per step:

1. `/to-spec` — turn a conversation into a spec, published as a GitHub issue.
2. `/to-tickets` — break that spec into tracer-bullet tickets, one issue each.
3. `/implement` — one fresh chat per ticket. `/code-review` before commit.

Tracker is **GitHub Issues** on `BunnyGamezsc/tokscale-gui`, via `gh`. Triage labels are
the defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.

Small and obvious? Skip straight to implementing it. The flow is for work big enough that
one chat cannot hold it.

## Settled

Verified against the tree, not inherited on faith. Do not relitigate these.

**Stack**

- Tauri v2. One binary, no sidecar, no separate CLI.
- `tokscale-core` as an in-process dependency, pinned to fork tag `gui-v4.15.1-lib.1` and
  `[patch]`ed to the `vendor/tokscale` submodule (branch `lib-target`) for day-to-day work.
  Bump both together. See ADR 0001 and 0002.
- React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui. pnpm.
- TanStack **Router and Query only**. Table, Charts and Hotkeys were considered and never
  installed — Models hand-rolls sorting over 38–198 Entries, and the graph is hand-rolled SVG.
  #31 re-tested the Hotkeys half against a real binding set and it still holds: seven
  bindings, one `keydown` listener, one pure resolver. See ADR 0003.
- The IPC boundary is **hand-written DTOs** in `src-tauri/src/dto.rs`, uniformly camelCase.
  `tauri-specta` was researched and rejected: P1 reads 15 fields rather than the ~150 that
  made generation look worthwhile, and `#[specta(remote)]` hits the orphan rule from the GUI
  crate. Keep `dto.rs` and `src/lib/api.ts` in step by hand.

**Backend shape**

- `scan` parses the corpus once into a Snapshot held in `tauri::State`. Report commands
  re-aggregate from it (41–100 ms) rather than rescanning (~2 min cold).
- Unforced `scan` returns the held Snapshot, so a webview reload costs nothing. Refresh forces.
- Everything runs on `spawn_blocking` — a cold scan on the async runtime starves every other
  command.
- `graph_report` is the one asymmetry: it re-enters the parse through core's private
  `GraphSink`. The asymmetry stays. Ticket 27 measured the order the app actually uses —
  Scan, then the first graph call — at **0.28 s cold and 0.76 s warm** in release, because
  the re-entered parse reads the on-disk cache the Scan just wrote. The earlier
  "~1.3 s warm / ~15 s cold" was a graph call with *no* Scan in front of it, and the UI
  cannot make that call: `useGraph` is gated on the Scan landing. Neither of those two
  figures reproduced; see #27 for the full table and the build each number came from.
- The Report Filter's `clients` is honoured by **two different mechanisms**, one per path.
  Core's report-time predicate consults `year`/`since`/`until` and never `clients` — pinned
  by `a_client_narrowing_is_inert_against_the_held_snapshot` — so Overview and Models, which
  are served from the held Snapshot, are narrowed in the command layer by `narrow_clients`
  before aggregation (#26). Daily and Stats go through `graph_report`, which re-enters the
  parse, and there `clients` is a parse input core already honours; a graph day is folded by
  a private `GraphSink` with no per-Client decomposition to subtract afterwards. The two
  paths agree exactly under both narrowings — `daily_detail_agrees_with_the_daily_row` runs
  a whole-corpus, a narrowed-range and a narrowed-Client arm, worst delta 0.0 on 71/36/47
  active days. A narrowed graph call walks a subset of the warmed cache and is *cheaper*
  than an unnarrowed one, which is what #27's model predicts: 28 ms against 331 ms warm in
  release, 36 ms against 259 ms cold. A narrowed graph also re-buckets the Ramp over the days
  the Filter kept, so narrowing re-colours the grid on purpose.
- Manual pricing overrides are written to `~/.config/tokscale/custom-pricing.json`, the same
  file the CLI and TUI read. Saves merge rather than replace, so hand-written tiers survive.

**Appearance**

- Hidden titlebar with overlaid traffic lights (`titleBarStyle: "Overlay"` + `hiddenTitle`),
  vibrant sidebar via `windowEffects: ["sidebar"]`. `trafficLightPosition` is creation-time
  only — the shell's 44px spacer must stay in sync with `tauri.conf.json`.
- `macOSPrivateApi: true` is required for vibrancy and **blocks App Store distribution**.
  Developer ID + notarization only. No App Sandbox — it is incompatible with reading other
  tools' credentials.
- Warm stone palette, one muted azure accent `oklch(0.545 0.115 250)` derived from tokscale's
  `#0073FF`, spent in exactly two places: the primary action and the graph Ramp.
- Theme is a **window** state, not a CSS class: `windowEffects` materials follow NSAppearance,
  so `set_theme` and `data-theme` are written together in `applyAppearance` and nowhere else.
  The window is created hidden so the first frame wears the right appearance; Rust shows it
  after 1500 ms if the frontend fails.
- `--ramp-0` is **not** a Ramp step. It is absence.

**P3 groundwork (researched, not built)**

- Upstream has **no OAuth loopback**. Its own login is a device-code poll; for
  Claude/Cursor/Grok/Kimi it is a *credential reader*. Do not build an OAuth client.
- Keychain access stays a `/usr/bin/security` subprocess. An in-process API would break
  access to other apps' items and prompt on every refresh.

## Built

Overview, Models, Daily, Stats and Pricing views. Scan/report command surface. Design system
and theming. Contribution graph. Manual pricing overrides. The Report Filter in the window
chrome, shared across Views. The keyboard surface and its Shortcuts sheet. The cold
first-run experience.

## Open

**All of the below is specced in [#20](https://github.com/BunnyGamezsc/tokscale-gui/issues/20)**
and sliced into tickets **#21–#31**, plus **#32** from #27's decision. Start with #22 or #23 — those have no blockers.
The list here stays as the plain-language index.

Roughly in the order they bite.

1. ~~**Cold first-run.**~~ Settled by #28 and written up in ADR 0004. The wait is still
   21–40 s; what changed is that the window explains it.

   - **Progressive fill was not taken, and the reason is not the parse.** `scan` already
     takes a Filter whose `clients` is a real parse input, so scanning one Client at a time
     is available today — but `scan` *replaces* the held Snapshot, so N per-Client scans
     clobber each other, and N is **52**, not a handful. Reopen it on that list — an
     accumulating Snapshot, a batching rule, a gate that is not an early return in five
     Views, and a corpus test that it agrees with a single-call Scan — not on the fact that
     `clients` is already a parse input. The sink-driven count stays rejected on #28's own
     measurement.
   - **A first run is `!hasSummary && isScanning`**, not a flag. `src/lib/scan-state.ts` is
     the scan-side sibling of #32's `graph-pending.ts`; the two share one `useDelayPassed`.
     Its 120 ms settle exists to stop a webview reload — an unforced `scan` returning the
     held Snapshot in milliseconds — from flashing the first-run panel.
   - **The window names what it is reading.** `client_catalog` reads core's const registry
     (`ClientId::ALL` filtered by `parse_local`), so unlike `clients` it answers *during*
     the Scan it describes.
   - **The estimate is the previous run, in `localStorage`.** `ScanSummary.elapsedMs` is 0
     on the unforced path and absent on a cold run, so the ETA was only ever visible on a
     Refresh inside one session. Its absence on a true first run is said in words.

2. ~~**`graph_report` re-enters the parse.**~~ Settled by #27: the ordering holds. A Scan
   warms the graph path, so the first visit to Daily costs 0.28–0.76 s, not 15 s. The fork
   does not widen; what is left is showing that sub-second pending state honestly — #32.

3. ~~**Contribution graph rendering and interaction.**~~ Settled by #29, on top of #25's
   bucketing (a logarithm across the active span, reasoned out on `ramp_level` in
   `commands.rs`). What #29 answered:

   - **The grid is a calendar.** `graph_report` returns only the days that had messages —
     core's `DailyFold` is a HashMap and `finish()` maps just its entries — so laying them
     out by index drew columns that were not weeks. `src/lib/calendar.ts` fills the gaps on
     the way into the grid: pure, tested by the #24 runner, and the commands keep returning
     what actually happened. It is also the only thing that makes `--ramp-0` reachable from
     data, since a day with no messages is never in the fold.
   - **A year is a calendar year**, Jan 1 to Dec 31, which is the bound `calculate_years`
     already uses. A trailing 52 weeks was the alternative and is what upstream draws; a
     fixed bound wins because it makes the width a constant. A year picker appears when the
     corpus spans more than one, so old usage is reachable.
   - **One cell size, 10/2/1**, replacing Overview's 10/2/1 and Stats' 13/3/2. A bounded
     year is at most 54 columns and the content column at the 880px minimum is 652px, so
     646px fits with no responsive branch. `GRAPH_HEIGHT` is derived, not hand-computed.
   - **Cells are buttons in a CSS grid, not SVG rects.** Focus ring, accessible name and
     Enter/Space are the platform's. A roving tabindex keeps it to one tab stop; arrows walk
     days and weeks. Clicking or activating a cell opens the same Daily Detail a Daily row
     does — `useDayDialog`, now shared by all three Views.

4. ~~**Keyboard surface.**~~ Settled by #31 and written up in ADR 0003, which carries the
   per-binding table. In short:

   - **No hotkey library**, and the count is the argument: seven bindings — `⌘1`–`⌘5`, `R`
     for Refresh, `?` for the Shortcuts sheet — are one `keydown` listener on the window
     and one pure resolver in `src/lib/keys.ts`. Reopen it on a count, not a feeling.
   - **`event.code`, not `event.key`.** Upstream spends 236 lines in `tui/keymap.rs`
     mapping Cyrillic and Greek back to US-QWERTY positions. The webview gives that for
     free from the physical key, so the table is not ported — the property is just chosen.
   - **Most TUI bindings do not survive**, and the reason is nearly always that the GUI
     already has the thing as a visible control: `s` is the Report Filter's Picker, `g` is
     Models' Group-By tabs, `c`/`t`/`d` are its sort headers. `p`/`l` belong to
     `applyAppearance`, not a keymap. The arrows and `Home`/`End` were already spent by #29.
     `j` is redundant rather than misread: Daily is newest-first, so today is the first row.
   - **The discovery surface is a Shortcuts sheet, not a ⌘K palette.** A palette reaches
     commands you cannot see; this window's are five links, a button and the Filter, all on
     screen. Palette-as-search over Models/Workspaces/Sessions stays open for P2 — it needs
     a Snapshot, so it is empty on the first run this list opens with. The sheet reads the
     same `BINDINGS` the resolver does, so the app cannot describe a binding it lacks.
   - **An interactive row keeps its click and gains a button** in its first cell. Daily's
     and Models' rows were pointer-only; a focusable `<tr>` would cost the tab order one
     stop per row, up to 198.
   - **Refresh has one owner.** `force` and `abandoned` are module state in `use-scan.ts`
     now, behind `refreshScan`, for the reason `useScanLanded` already existed.

5. **Scan-time vs report-time Client selection.** Two different operations share one word.
   Turning a Client off *for scanning* changes what the corpus is and costs a full rescan;
   narrowing a report changes what an Entry means and costs 41–100 ms. Decide whether the GUI
   exposes the first at all (upstream's `s` picker writes `enabled_clients` and rescans), where
   it lives if so, and what the two things are **called** — `CONTEXT.md` needs the term.

6. **Vendor CLI resolution.** A `.app` launched from Finder inherits launchd's minimal
   environment, not the user's shell PATH. tokscale shells out to `codex`, `grok`, `gh`,
   `claude`, `kiro` — none of which are on that PATH for Homebrew, nvm, bun, mise or asdf
   installs. Blocks P3 sync and auth. Rated a certainty, not a risk.

7. **Rust toolchain floor.** `rust-version` in `src-tauri/Cargo.toml` says `1.77.2`, which is
   untrue. The original 1.92 floor came from `specta`, which was dropped, so the real floor is
   unknown rather than high. Establish it and pin it — `rust-toolchain.toml`, the manifest, or
   both — and decide whether the submodule needs its own.

## Not yet specified

**P2 views** — Hourly (table vs profile toggle), Agents, Usage/quota cards, hidden Minutely,
settings screen, `gui.json` persistence, interval refresh. Shape depends on how P1 lands.

**P3** — auth for Claude/Codex/Cursor/Grok/Kimi, `cursor`/`antigravity`/`trae` sync, Codex
multi-account. Blocked on (6).
