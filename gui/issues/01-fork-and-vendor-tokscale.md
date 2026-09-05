# Fork tokscale and vendor it as a submodule

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

Nothing to decide — this unblocks every Rust-side decision on the map.

Fork `junhoyeo/tokscale` under the user's account, add
`crates/tokscale-cli/src/lib.rs` re-exporting the modules the GUI needs (`auth`,
`cursor`, `trae`, `warp`, `antigravity`, `hindsight`, `commands`), reduce `main.rs`
to a thin shim over that library, and vendor the fork as a submodule at
`vendor/tokscale/`, replacing the current read-only checkout at `tokscale/`.

**Updated by "Research: tauri-specta type generation":** the fork is of the whole repo, so
it carries `tokscale-core` too, and the GUI must depend on the *fork's* core rather than an
upstream tag. `#[specta(remote)]` is unusable from the GUI crate (orphan rule), so specta
derives have to live in the forked `tokscale-core` behind a cargo feature. Add that feature
gate here; which structs get derives is decided by "Design the Tauri command surface for P1".

Creating a public fork is outward-facing: confirm with the user whether the agent
runs `gh repo fork` or they create it themselves.

Record in the answer: the fork URL, the pinned upstream tag (`v4.15.1` unless newer),
the exact module list `lib.rs` exposes, and any module that could *not* be exported
because of coupling to `main.rs` — later tickets depend on knowing what is reachable.
