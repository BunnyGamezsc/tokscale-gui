# Scaffold the Tauri and React application shell

Type: task
Status: open
Blocked by: —

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

**Skill for this ticket type:** No skill required. If the work turns out to need a decision, stop and raise it
  rather than deciding alone.

## When done

1. Append the answer to this file under `## Answer`.
2. Change `Status:` to `resolved`.
3. Append a one-line gist + link to `## Decisions so far` in [the map](../map.md).
4. Graduate any fog the answer sharpened into new tickets; clear those patches from
   `## Not yet specified`. If the answer puts work past the destination, rule it out of
   scope rather than resolving it.

Resolve **one ticket per session** (research tickets excepted).

## Question

Nothing to decide — this gives later prototype and layout tickets something to run in.

Scaffold at the `tokscalegui/` root with pnpm: Tauri v2, React, Vite, TypeScript,
Tailwind v4, shadcn/ui, and TanStack Router. Get a window opening with an empty
sidebar shell and one route. Initialize git.

No `tokscale-core` dependency yet — that arrives with "Prove tokscale-core scans and
aggregates in-process".

Record in the answer: the resulting versions of Tauri, React, Tailwind and shadcn, the
dev-server command, and anything the toolchain forced that contradicts the map's
standing decisions.
