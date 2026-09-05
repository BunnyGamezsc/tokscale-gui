# Design the Tauri command surface for P1

Type: grilling
Status: open
Blocked by: 04, 07

## Start here

New session? Read these first — they hold decisions already settled; do not relitigate them.

- **[The map](../map.md)** — the `## Notes` section is the binding list of standing decisions,
  and `## Decisions so far` indexes every resolved ticket. Read it before anything else.
- **[CONTEXT.md](../../CONTEXT.md)** — glossary. Mirrors upstream tokscale's vocabulary
  verbatim, including the ambiguities it inherits. Use these terms exactly.
- **[ADR 0001](../../docs/adr/0001-depend-on-tokscale-core.md)** and
  **[ADR 0002](../../docs/adr/0002-fork-tokscale-cli-for-a-library-target.md)** — both carry
  dated amendments; read to the end.
- Resolved research lives in sibling tickets `03`, `04` and `05`. Zoom into them on demand
  rather than re-researching.

Upstream tokscale source is at `tokscale/` in the repo root today; after
"Fork tokscale and vendor it as a submodule" resolves, it lives at `vendor/tokscale/`.

**Skill for this ticket type:** Call the Skill tool twice, for `grilling` and `domain-modeling`. This is HITL —
  ask the human and wait; never answer for them.

## When done

1. Append the answer to this file under `## Answer`.
2. Change `Status:` to `resolved`.
3. Append a one-line gist + link to `## Decisions so far` in [the map](../map.md).
4. Graduate any fog the answer sharpened into new tickets; clear those patches from
   `## Not yet specified`. If the answer puts work past the destination, rule it out of
   scope rather than resolving it.

Resolve **one ticket per session** (research tickets excepted).

## Question

What is the IPC contract between the Rust backend and the React frontend for P1?

Decide: the set of commands and their granularity — one fat `getReport(filters)` versus
per-view commands; where filtering, grouping and sorting execute, in Rust over the full
dataset or in TanStack Table over a transferred set; whether scan results are cached in
the backend between calls and how a refresh invalidates that cache; how a long scan
reports progress (Tauri events versus polling); how errors and partial scan failures
cross the boundary; and which wrapper structs get `#[derive(Type)]`.

Constrained by what "Prove tokscale-core scans and aggregates in-process" measures — if
a scan is slow or the payload is large, that forces the answer.

## Notes carried in from research

From "Research: tauri-specta type generation":

- Decide which `tokscale-core` structs get `#[derive(specta::Type)]` in the fork (behind a
  feature gate) versus which get local wrapper DTOs in the GUI crate. 22 structs / ~153 fields
  are in scope. Deriving in the fork is cheaper but deepens fork coupling — upstream changes to
  those structs will then conflict.
- `GroupBy` derives `Serialize` but not `Deserialize`; `ReportOptions` and `LocalParseOptions`
  derive neither. Commands taking filter/grouping input need a serde-able input type regardless
  of which typegen library is used — decide whether that is a fork change or a GUI-side mirror.
- Confirm `dangerously_cast_bigints_to_number()` is acceptable: all 41 `i64` fields are token
  counts, millisecond durations, or unix timestamps, comfortably under 2^53.
- `specta-typescript` 0.0.12 maps `f64` to `number | null`, affecting ~17 cost fields. Decide
  whether the frontend handles null or the backend guarantees finite values.
