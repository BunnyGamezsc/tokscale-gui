# 5. Scan-time and report-time Client selection

Date: 2026-09-10

## Status

Accepted

## Context

Two operations share one word, and the word is "clients".

Choosing which Clients a **Scan** parses decides what the Snapshot *is*. It costs a
full rescan — #28 measured ~22 s on the real corpus with a warm pricing cache, and
20–40 s unwarmed. Narrowing a **Report Filter** by Client decides what an Entry
*means*, and costs a re-aggregation: 41–100 ms on the Snapshot path, 28–331 ms on the
graph path. Same noun, two orders of magnitude apart.

The collapse is not the GUI's invention — it is inherited, and it is verifiable in
twelve lines. `build_client_filter` (`tokscale-cli/src/main.rs:1065`) resolves `--client`
flags, falls back to `defaultClients` from `settings.json`, and hands the result to
`tokscale_core` as `LocalParseOptions.clients` — the *same* field the TUI's `s` picker
drives through `enabled_clients`. One list, one name, both meanings.

It is also in this repo's own wire format. `Filter.clients` is a single DTO field
honoured by two mechanisms: on the Snapshot path core's report-time predicate never
consults it, so `narrow_clients` applies it in the command layer, while on the graph
path it is a genuine parse input core honours. #26 made those two agree on purpose —
`a_client_narrowing_is_inert_against_the_held_snapshot` and
`daily_detail_agrees_with_the_daily_row` pin it — and `scan` takes the same `Filter`
type, where that field would be a *scan-time* selection instead.

Upstream has three things here, not two, and the ROADMAP's line about the `s` picker
was half right. `s` opens `ClientPickerDialog` (`tui/app.rs:905` → `1925`), which
mutates an in-memory `enabled_clients` and sets `needs_reload`, causing a rescan. It
does **not** call `settings.save()`. The persisted thing is `defaultClients`, and that
is a default for the CLI's `--client` flags — a report-time default that happens to be
persisted, and not the picker's store. So: a session-scoped scan selection, a persisted
report-time default, and a live report-time filter.

## Decision

### 1. The vocabulary: **Enabled Clients**, and it is a constant here

`CONTEXT.md` gains **Enabled Clients** — the set of Clients a Scan actually parses —
and **Default Clients** for upstream's `defaultClients`, with **Report Filter** and
**Scan** now defined against them. The term is upstream's own word (`enabled_clients`),
not an invention, which is what the glossary's own rule asks for.

In the GUI, Enabled Clients is a **constant**: every `parse_local` Client, always. That
is the set `client_catalog` already names, pinned by
`the_catalog_names_every_client_a_scan_reads`.

### 2. Scan-time Client selection does not exist in the GUI

The Snapshot is always the whole machine; narrowing is purely a reading concern.

**The cost model is inverted.** Scan-time selection buys scan *time* — and only on the
runs where it is already cheapest. A cold run is ~22 s once; every later run reads the
cache. Turning Clients off to make that faster costs a full rescan to take effect, then
another to undo, so the lever charges more than it saves unless the user never changes
their mind. Meanwhile the thing users actually want from a Client picker — "show me only
Claude Code" — is served in 41–100 ms by the control already in the chrome.

**A narrowed Snapshot is a lie that outlives the click.** The Report Filter resets every
launch (#26 wanted it that way, and `filter.ts` is module state for exactly that reason).
A persisted scan selection does the opposite: every total in the window is silently
missing a Client, on every launch, with the only evidence a control on a settings screen
the user visited once. That is the failure mode the ticket describes, made permanent.

**"Persists across launches" has no home, and the nearest one is wrong.** `gui.json` is
P2 and does not exist. #28's `localStorage` precedent was argued on the ETA being a
*hint* — a wrong one costs a bad estimate. A Client selection changes what the Snapshot
is, so that precedent does not reach it. And the file that *is* "the same configuration
the CLI reads" stores `defaultClients`, which is not the picker's store: writing it from
the GUI would change what `tokscale` prints on the command line as a side effect of a
GUI setting.

**And nothing is lost.** Every Client is parsed, so every question remains askable at
re-aggregation speed. The only capability given up is making a cold run shorter, which
is the one ADR 0004 already decided to explain rather than shorten.

Consequence: `Filter.clients` is **not** split into two fields. There is only ever one
meaning on the wire, because the frontend never sends `scan` a Filter at all
(`api.scan(undefined, forced)`). Splitting the DTO to encode a distinction the app does
not make would be scaffolding, and it would break the agreement #26 pinned.

### 3. `settings.json` is read, never written

The GUI reads the `scanner` key of `~/.config/tokscale/settings.json` — `extraScanPaths`,
`opencodeDbPaths`, `bucketTimezone` — into core's own `ScannerSettings`
(`src-tauri/src/settings.rs`, ~15 lines of serde over the type core already exposes).

This is load-bearing for decision 2, not a bonus. "The Snapshot is always the whole
machine" was **false** before it: both commands passed `scanner_settings:
Default::default()`, so a user's hand-configured Sources never reached core. Two things
were untrue as a result. `CONTEXT.md` claimed the Bucket Timezone was pinned on first
scan, which the GUI never did or read. And `NoUsage` told a user with no usage to add
their paths to a file the app ignored — the one screen where that advice is the *only*
lever, since with Enabled Clients constant there is no Client to switch back on.

Of the three ways to get at it, this is the third of the ticket's list minus its cost:

- *Widen the fork* — move `Settings` from `tokscale-cli/src/tui/settings.rs` into
  `tokscale-core`. ADR 0002 is about what the library target exposes, and this would be
  a real widening: a settings type, its lossy deserializers, and its writer, for three
  fields the GUI reads and none it writes.
- *Persist somewhere GUI-only* — conflicts with the ticket's premise that this is the
  same configuration the CLI reads.
- *A small reader in `src-tauri`* — taken. The ticket's objection was "two writers on one
  file", and it is answered by not writing: `settings.json` keeps exactly one writer, the
  CLI, which rewrites the whole document including keys this repo has never heard of.
  Reading costs nothing and cannot desynchronise.

`defaultClients` is deliberately not read — honouring it would narrow the Snapshot with
nothing on screen saying so, which is the confusion this ADR exists to remove. Pinning
`bucketTimezone` is deliberately not done, because pinning is a write. Both are pinned by
tests. A broken or absent file degrades to the defaults rather than erroring, which is
the opposite of `pricing.rs` and for the opposite reason: that module writes, so treating
a broken file as empty would erase a user's tiers; this one only reads, and failing would
let one stray comma make the app unusable.

### 4. The rescan warning is a sentence, not a dialog

With Enabled Clients constant, exactly one action in the window costs a Scan: **Refresh**.
Both of its entrances now state the cost before it is taken — Overview's button through
`rescanNotice` (the previous run's duration when there is one, "20–40 seconds" when there
is not), and the Shortcuts sheet's `R` row, which is the only place that binding announces
itself.

Not a confirm dialog, for the reason ADR 0004 gives about the first-run wait: this window
explains costs rather than gating them. A rescan undoes nothing and loses nothing — it is
*slow*, and slow is a thing you tell someone, not a thing you make them confirm.

## Consequences

- Every Client control in the window is a Report Filter control, and the Report Filter's
  picker says so in its own copy rather than relying on where it sits. Report-time
  narrowing is untouched, so #26's agreement and its re-aggregation speed still hold.
- A user whose Clients live in non-standard locations is now served by the file the
  `NoUsage` screen names, and their pinned Bucket Timezone is honoured rather than
  ignored.
- If scan-time selection is ever reopened, the case has to be a *measurement* — a corpus
  where 52 parsers cost enough that a user would accept a rescan to shorten them — and it
  needs a persistence home decided first. `client_catalog` is already the right source for
  such a picker; `clients` never could be, since it reads the Snapshot.
- The GUI cannot repair a `settings.json` the CLI has never written. A machine where only
  the GUI has ever run has no pinned Bucket Timezone, and day keys follow the system zone
  exactly as they did before pinning existed.

## Amended 2026-09-13 (#40): Cursor is an Enabled Client

"Every `parse_local` Client" was one Client short. Upstream declares Cursor
`parse_local: false`: its Source is `~/.config/tokscale/cursor-cache`, which only a sync
writes, and the CLI reads it when a sync is in play. With `clients: None`, core's
`resolve_local_parse_request` skips the Cursor lane, so a Cursor sync would write rows no
View could show. Measured on the author's machine: a sync wrote 11 rows, and the Scan read
11 Cursor messages with the list below and 0 under core's default.

The GUI now hands core an explicit list whenever the Report Filter names no Client:
`enabled_clients()` in `commands.rs`, the `parse_local` set plus Cursor plus `synthetic`.
Scan and graph both use it, and `client_catalog` reads the same predicate (53 Clients).
Enabled Clients is still a constant. Sync adds data to a Source; it doesn't change which
Clients a Scan parses.

