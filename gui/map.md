# Map: tokscale GUI port

Label: wayfinder:map

## Destination

A decision-complete plan for **tokscalegui** — a lightweight macOS desktop GUI port of
tokscale covering phases P1–P3 — with every architecture, data-boundary and UX question
resolved, so implementation can proceed without further discovery.

## Notes

**Domain**: developer tooling / data visualization. Porting a 197,096-line Rust TUI
(`junhoyeo/tokscale`) that reports AI coding-agent token usage and cost across ~50 clients.

**Read first**: `CONTEXT.md` (glossary — mirrors upstream tokscale's vocabulary verbatim),
`docs/adr/0001-depend-on-tokscale-core.md`, `docs/adr/0002-fork-tokscale-cli-for-a-library-target.md`.

**Skills every session should consult**: `grilling` + `domain-modeling` by default;
`prototype` for prototype tickets; `research` for research tickets. `apple-design` and
`frontend-design` are relevant to the design-system and view-layout tickets.

**Starting a session on a ticket**: open a fresh chat in the repo root and say
*"work the wayfinder map at `gui/map.md`"*, optionally naming a
ticket. `/wayfinder` itself is user-invocation-only — an agent cannot start it. Each ticket
carries its own `## Start here` block; one ticket per session, research excepted.

**This map plans; it does not build.** Implementing P1–P3 follows after the map clears.
Prototype tickets may produce throwaway code to react to, but shipping code is not the
destination.

### Standing decisions (locked in charting — do not relitigate)

- Tauri v2. One binary, no sidecar, no separate CLI.
- `tokscale-core` (110,929 LOC `rlib`) as an in-process git-tag-pinned dependency.
- `tokscale-cli` is `[[bin]]`-only, so it is privately forked to add a `[lib]` target and
  vendored as a submodule. No upstream PR — the fork is permanent.
- React + Vite + TypeScript + Tailwind v4 + shadcn/ui. pnpm.
- TanStack Router, Query, Table, Charts (pinned exact, alpha `0.16.0`), Hotkeys.
  Form added with the P2 settings screen. Not adopting Start, DB, Store, AI,
  Markdown, Highlight.
- `tauri-specta` generates the TypeScript types for the command boundary.
- Contribution graph hand-rolled in SVG, insulated from TanStack Charts' alpha churn.
- Windowed app, left sidebar collapsible to icons, hidden titlebar with overlaid traffic
  lights, vibrant sidebar, ⌘K command palette. Optional tray item deferred.
- Soft warm palette — `stone` base, low contrast, muted azure accent derived from
  tokscale's `#0073FF`. Dark-first with a real light mode. No TUI palettes ported.
- Reads `~/.config/tokscale/settings.json`; GUI-only keys go to a sibling `gui.json`.
- Manual + interval refresh matching upstream `autoRefreshMs`. No filesystem watcher.
- ~~OAuth via system browser + loopback listener.~~ **Corrected by research:** upstream runs a
  device-code poll for its own login and otherwise *reads* credentials other tools already wrote.
  Reuse upstream's mechanisms as they are; do not build an OAuth client.
- Keychain access stays as a `/usr/bin/security` subprocess. An in-process Keychain API would
  break access to other apps' items and prompt on every refresh.
- No App Sandbox. Developer ID + notarization only; the Mac App Store is out.
- macOS-first, written cross-platform-clean.

### Phases

- **P1** — Overview, Models, Daily, Stats + filtering, group-by, sort, export.
- **P2** — Hourly, Agents, Usage (quotas), Minutely, settings, themes.
- **P3** — auth (Claude/Codex/Cursor/Grok/Kimi), `cursor`/`antigravity`/`trae` sync,
  Codex multi-account.

## Decisions so far

<!-- one line per closed ticket -->

- [Establish the design system and soft palette](https://github.com/BunnyGamezsc/tokscale-gui/issues/7) — **Ruled, on shadcn's token contract.** Three registers built against real data and flipped through in the running window in both themes; Ruled wins because every Group-By yields 38–198 Entries, three of four P1 views are dense tables, and it is the only register where a full report *and* the Contribution Graph fit one 760px window. `shadcn/ui` is now actually installed (radix primitives) and the palette **is** its token contract, so later components inherit it with no second mapping. The accent is *derived*: tokscale's `#0073FF` is `oklch(0.5886 0.2258 258.78)`, halved in chroma and walked ~11° warmer to `oklch(0.545 0.115 250)` / `oklch(0.660 0.100 248)`, and spent in exactly two places — the primary action and the Ramp — so the graph is the only chromatic event in the window. Type: SF for text, **Geist Mono for figures** (`tabular-nums` alone did not align mixed-width costs); six sizes, 11/12/13/16/17/30, with `figure` outranking `title` on purpose. Density `--row-h: 27px` on a 4px rhythm. The Ramp is five real oklch values per theme that separate by lightness alone, plus `--ramp-0`, which is **not a step** — absence, not lowest intensity. **Theme switching is resolved**: `system | light | dark` in `gui.json`, one function doing both writes, shadcn's `dark` variant rekeyed from `.dark` to `[data-theme]`, window created hidden so the first frame wears the right NSAppearance, and a 1500ms Rust fallback so a frontend failure cannot leave the app windowless. `tuiLightMode` is deliberately never consulted — it describes a terminal, not this window. And the defect only a launch could find: with `theme: "Dark"` pinned, **"system" was circular** — `prefers-color-scheme` in a WKWebView reports the *window's* appearance, so the first promoted build rendered dark on a Light-mode Mac while `tsc` stayed clean.

- [Research: OAuth loopback and macOS Keychain from Tauri v2](issues/05-research-oauth-and-keychain.md) — **Premise was wrong: upstream has no OAuth loopback.** tokscale's own login is a device-code poll; for Claude/Cursor/Grok/Kimi it is a *credential reader*, not an OAuth client. The one loopback belongs to a spawned `codex login` child on fixed port 1455. Keychain is read by shelling out to `/usr/bin/security` — load-bearing, must not be modernized to an in-process API. App Sandbox is incompatible with the whole model; Tauri's stock hardened-but-unsandboxed build is correct. Two new hazards: launchd PATH, and Antigravity's `ps`/`lsof` scraping.

- [Research: tauri-specta type generation](issues/04-research-tauri-specta.md) — Viable on Tauri v2 and clearly better than ts-rs (it generates typed invoke wrappers and events, not just types). Pin `=2.0.0-rc.25`; it has been RC for ~3 years but Tauri core itself ships a first-party `specta` feature. **`#[specta(remote)]` cannot be used from the GUI crate — orphan rule, E0117** — so specta derives must live in the forked `tokscale-core` (~25 attribute lines) instead of ~150 duplicated DTO fields. 41 `i64` fields are hard export errors, cleared by `dangerously_cast_bigints_to_number()`; `f64` now emits `number | null`.

- [Research: Tauri v2 macOS window chrome](issues/03-research-macos-window-chrome.md) — Overlay titlebar + sidebar vibrancy is viable on tauri 2.11.5: `decorations: true` + `titleBarStyle: "Overlay"` + `hiddenTitle: true`, `windowEffects` material `sidebar`. Costs: `macOSPrivateApi: true` is required for vibrancy and blocks App Store distribution; `trafficLightPosition` is creation-time only (runtime moves need objc2); a known inset-reset bug is fixed only in 2.12. Linux has no vibrancy.

## Not yet specified

- **P2 view specifics.** Hourly (table vs profile toggle), Agents, Usage/quota cards, and
  the hidden Minutely tab. Shape depends on how the P1 views land.
- **Settings screen.** Which of upstream's `settings.json` fields are user-editable in the
  GUI vs read-only, and how `gui.json` keys are presented alongside them.
- **P3 auth and sync UX.** How login state, multi-account Codex, and long-running syncs are
  surfaced — progress, cancellation, failure recovery. Now also: how a *missing* credential is
  presented, given that most providers are read-only detections rather than logins the GUI can
  initiate; and how the fixed-port collision on `codex login` (127.0.0.1:1455) is handled when a
  terminal `codex login` already holds it.
- **Antigravity support.** It scrapes a CSRF token out of `ps -ww -eo pid,ppid,args` and finds its
  port via `lsof`. The riskiest single client path; may warrant being cut from scope.
- **Credential-reading fragility.** Recent macOS extends `com.apple.macl` protection to an
  XProtect-updatable allowlist of non-sandboxed apps' Application Support folders. Cursor and
  Trae are not on it today, but both reads must degrade to their manual-paste fallbacks. Trae's
  offline AES decryption is also brittle across Trae updates.
- **Failure, empty and loading states.** ~50 clients scanned, most absent on any given
  machine. What "no data", "client not installed", and "parser failed" look like, and
  whether a partial scan failure is fatal or degraded.
- **Performance envelope.** Real scan durations and row counts on this machine, and the
  virtualization thresholds they imply. Blocked on measuring an actual scan.
- **Distribution.** Signing identity, notarization workflow, and whether the app self-updates.
  The Mac App Store is now ruled out twice over — by `macOSPrivateApi` for vibrancy, and far
  more fundamentally because App Sandbox is incompatible with reading other tools' files and
  Keychain items. Direct Developer ID distribution is settled; the rest is open.
- **Cross-platform.** What actually breaks on Windows/Linux once macOS is working.

## Out of scope

- **P4 features** — leaderboard `submit`, `autosubmit` scheduling, Wrapped image
  generation, and the LLM-backed `report` pipeline. Ruled out during charting.
- **Implementing P1–P3.** This map's destination is a decision-complete plan; the build
  follows it.
- **Upstreaming the `[lib]` target** to `junhoyeo/tokscale`. Explicitly declined.
- **Shipping non-macOS builds.** Code stays portable; only macOS is targeted and tested.
