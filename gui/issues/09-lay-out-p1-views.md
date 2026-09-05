# Lay out the P1 views

Type: prototype
Status: open
Blocked by: 06, 08

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

**Skill for this ticket type:** Call the Skill tool with `prototype`. This is HITL — iterate with the human;
  never answer their side of it yourself.

## When done

1. Append the answer to this file under `## Answer`.
2. Change `Status:` to `resolved`.
3. Append a one-line gist + link to `## Decisions so far` in [the map](../map.md).
4. Graduate any fog the answer sharpened into new tickets; clear those patches from
   `## Not yet specified`. If the answer puts work past the destination, rule it out of
   scope rather than resolving it.

Resolve **one ticket per session** (research tickets excepted).

## Question

How do Overview, Models, Daily and Stats look and behave as GUI views rather than
terminal tabs?

Upstream's equivalents are `tui/ui/overview.rs`, `models.rs`, `daily.rs` and `stats.rs`
— read them for what each view shows, but do not treat their layout as binding.

Build them against real data and iterate with the user. Resolve per view: what appears
above the fold, which columns are shown by default and which are secondary, how totals
and summary figures are presented, what a row's detail or drill-down does, and how the
Daily view's detail dialog translates to a GUI.
