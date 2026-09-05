# Decide how the app resolves external CLI binaries

Type: grilling
Status: open
Blocked by: 02

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

Surfaced by "Research: OAuth loopback and macOS Keychain from Tauri v2", which rates this a
certainty rather than a risk.

A GUI `.app` launched from Finder inherits launchd's minimal environment, not the user's shell
PATH. tokscale shells out to vendor CLIs — `codex`, `grok`, `gh`, `claude`, `kiro` and others —
which for Homebrew, nvm, bun, mise or asdf installs are not on that PATH. Every such call will
fail with `ENOENT` in a way that never reproduces in `tauri dev` from a terminal.

Tools under `/usr/bin` (`security`, `ps`, `lsof`, `open`) are unaffected.

Decide: whether the app resolves binaries by running a login shell to capture the real PATH, by
probing a list of well-known install prefixes, by asking the user to point at binaries once and
persisting that, or some combination. Also decide what the user sees when a binary genuinely
isn't installed versus merely isn't findable — these must not look the same.

Verify against a bundled `.app` launched from Finder, not `tauri dev`.
