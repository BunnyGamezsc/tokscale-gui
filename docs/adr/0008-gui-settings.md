# 8. The GUI's own settings

Date: 2026-09-13

## Status

Accepted

(0007 is reserved for #39.)

## Context

#38 adds three settings: appearance, interval refresh, and the hidden Minutely View. They
need a file that survives a relaunch. ADR 0005 already rules out the CLI's `settings.json`,
because the CLI is its only writer. That leaves two places: the Tauri app config directory,
or a new file beside the CLI's under `~/.config/tokscale/`.

Two of the settings have costs that settings can break. Appearance has to be right before
the first frame (ADR/ticket 07: the window is created hidden). And a GUI Refresh is a full
Scan, so interval refresh could turn into a Scan every minute on a laptop.

## Decision

### `gui.json` lives in the app config directory

`~/Library/Application Support/dev.bunnygamezsc.tokscale-gui/gui.json`.

- `~/.config/tokscale/` is the CLI's namespace. A GUI file there reads as something the
  CLI understands, and upstream could one day ship a file with that name.
- Nothing else reads these settings. Appearance, the refresh interval and a hidden View are
  about this window. Sharing a directory with the CLI buys nothing.
- `TOKSCALE_CONFIG_DIR` moves core's config root, which the probes use for hermetic runs.
  GUI preferences shouldn't move with it.

The module (`src-tauri/src/gui.rs`) copies `pricing.rs`'s split. `settings_of` and
`with_settings` are pure over the JSON document: missing or mistyped keys fall back per key,
unknown keys are kept on save, and the interval is clamped. The IO wrapper degrades an absent
or unparseable file to the defaults, like `settings.rs` and unlike `pricing.rs`. The GUI is
this file's only writer, so a broken file holds nobody else's data, and refusing to read it
would lock the user out of the screen that fixes it. `settings.rs` is unchanged and still
never writes.

### Appearance is read before the window shows

`main.tsx` calls `gui_settings`, seeds the query cache and passes the value into
`initTheme`, which shows the window. Reading a small file takes milliseconds, well under the
1500 ms Rust fallback. `applyAppearance` is still the only writer of the theme, and the
Settings sheet calls it on change.

### Interval refresh rescans, through `refreshScan`, with the TUI's numbers

The `a_warm_scan_and_the_minutely_fold` probe, release build, author's corpus (16,318
messages):

| Run | Time |
| --- | --- |
| First Scan in process (warm disk cache) | 837 ms |
| Second Scan: what an interval tick pays | 214 ms |
| Third Scan | 212 ms |

A tick at the 30 s floor is under 1% duty. So the TUI's numbers hold: **off by default,
60 s default, 30 s–1 h**.

**It rescans, not refetches.** Every report except the graph folds the held Snapshot, so
refetching without a Scan returns what's already on screen. The rescan is the refresh.

A tick calls `refreshScan`, so it inherits the in-flight guard and can't stack Scans (#33).
A tick while `document.hidden` is skipped, since nobody can see what it would change.

### Shift+R does not toggle it

Recorded in ADR 0003's rejected table. Starting a recurring Scan shouldn't be one stray
Shift away. The control is a checkbox on the Settings sheet (`⌘,`), which shows the state.

### Minutely is a Snapshot fold

Upstream keeps Minutely out of its on-disk cache because of cardinality. The GUI has no
such cache. The probe measured 3,778 minute slots in 6 ms (Hourly: 263 slots, 8 ms), 328 KB
as JSON, so it shares `slot_totals` with Hourly and follows Hourly's zone and untimed rules.
The minute is read with chrono rather than from core's hour key, because some zones are
offset by a half-hour.

## Consequences

- The warm figure depends on core's parse cache. After heavy use, a tick reparses changed
  transcripts and costs more. The floor has 100× headroom over the measured tick.
- A warm Scan runs past the 120 ms settle delay, so a tick shows the Refresh banner briefly.
  If that reads as flicker, the fix is a quiet tick in `use-scan.ts`, not a longer interval.
- The Minutely table isn't virtualized. That's fine at 3,778 rows. A corpus where it drags
  is the reason to virtualize (marked `ponytail:` in `views/minutely.tsx`).
- Uninstalling the app doesn't touch `~/.config/tokscale/`, and the CLI never sees GUI
  preferences.
