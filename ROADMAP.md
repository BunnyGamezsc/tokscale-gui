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
  than an unnarrowed one: 28 ms against 331 ms warm in release.
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
chrome, shared across Views.

## Open

**All of the below is specced in [#20](https://github.com/BunnyGamezsc/tokscale-gui/issues/20)**
and sliced into tickets **#21–#31**, plus **#32** from #27's decision. Start with #21, #22 or #23 — those have no blockers.
The list here stays as the plain-language index.

Roughly in the order they bite.

1. **Cold first-run.** A first scan is 21–40 s of spinner against an empty window. Main-thread
   p99 stays at 86–241 ms so nothing freezes, but that is not the same as good. Levers:
   scan one client at a time so the Overview fills progressively (zero fork cost, but pulling
   cross-client work out of one call is unverified), a sink-driven message count (three `pub`
   lines, advances in seven uneven lumps), or accept it and spend the effort on what the empty
   window says. Also: is a first run visually distinct from a refresh?

2. ~~**`graph_report` re-enters the parse.**~~ Settled by #27: the ordering holds. A Scan
   warms the graph path, so the first visit to Daily costs 0.28–0.76 s, not 15 s. The fork
   does not widen; what is left is showing that sub-second pending state honestly — #32.

3. **Contribution graph rendering and interaction.** Ramp bucketing is settled (#25): a
   logarithm across the active span, which beat core's ratio thresholds and the TUI's clamped
   ratio because both are linear in dollars and strand nine tenths of a skewed month on one
   step, and beat quantile because rank cannot tell a flat month from a skewed one. The
   reasoning and the measured histograms live on `ramp_level` in `commands.rs`. Still open:
   cell sizing and whether the grid is responsive, how a year is bounded and multiple years
   navigated, and hover beyond the native `<title>`.

4. **Keyboard surface.** No hotkey library is installed and there is no ⌘K palette. Decide
   whether a five-destination window needs more than a few `keydown` listeners, which of
   upstream's TUI bindings survive the port (most exist because a terminal has no sidebar —
   `client_ui.rs` exhausts lowercase Latin assigning one character per client), and whether
   ⌘K is the discovery surface, a search over Models/Workspaces/Sessions, or both. Note `j`
   is not a filter: it scrolls Daily to today.

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
