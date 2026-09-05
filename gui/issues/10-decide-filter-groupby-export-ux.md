# Decide the filtering, group-by, date-range and export UX

Type: grilling
Status: open
Blocked by: 09

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

The TUI drives these with modal dialogs on keypress — `s` for the source picker, `g`
for group-by, `c`/`d`/`t` for sort, `j` to jump to today, `e` to export.

Decide the GUI equivalents: whether filters live in a persistent toolbar, a sidebar
panel, or popovers; how ~50 clients are made selectable without an unusable list; how
the six group-by strategies are presented given that changing one changes what a row
*means*; how date ranges are chosen and what the presets are; whether filter state is
global across views or per-view; whether it survives restart; and what export produces
and how the file is chosen.

Also decide which TanStack Hotkeys bindings mirror the TUI, and whether the ⌘K palette
is the discovery surface for all of them.
