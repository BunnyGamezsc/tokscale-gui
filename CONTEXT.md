# Context

Glossary for **tokscalegui**, a desktop GUI port of [tokscale](https://github.com/junhoyeo/tokscale).

Vocabulary mirrors upstream tokscale verbatim. Where upstream is ambiguous, this file
records the ambiguity rather than inventing a new term — the GUI must not drift from
the language of the tool it ports.

## Core terms

**Client** — the AI coding tool that produced usage (Claude Code, Codex CLI, OpenCode,
Cursor, …). Roughly 50 are supported. Each is described by a `ClientDef` with a stable
lowercase `id`, a `PathRoot`, and a glob `pattern` locating its transcripts on disk.
A client is *headless* when its usage is captured from piped output rather than read
from its own state, and *parse_local* when its transcripts are read directly from disk.

**Provider** — the vendor actually billed for a request (`anthropic`, `github-copilot`,
`openai`, …). Independent of Client: one Client can route to many Providers, and one
Provider serves many Clients.

**Model** — the model identifier a request ran against. Subject to *canonicalization*
(lowercasing, stripping a `(reasoning-tier)` suffix, stripping a trailing `-YYYYMMDD`)
and then to optional **Model Alias** folding.

**Model Alias** — a user-defined mapping folding several name-strings for one physical
model onto a single canonical name, so usage does not split across rows.

**Session** — a run of an agent CLI, identified by `session_id`. Note the collision:
a session as *reported by the client* (a `session_id` in a transcript) is not the same
as a session derived by **Sessionize**.

**Sessionize** — deriving activity intervals from message timestamps by splitting on an
idle gap (default 3 minutes). Produces `SessionInterval`s used for active-time metrics.
This is a *computed* notion of session, distinct from a client-reported `session_id`.

**Workspace** — the project a message belongs to, carried as an opaque `workspace_key`
(typically a repo path) plus a human-facing `workspace_label`. Git worktrees may
optionally be folded into their parent repository.

**Unified Message** — the normalized record every client parser emits: client, model,
provider, session, workspace, timestamp, token breakdown, cost, and cost source. This
is the single shape all ~50 client-specific parsers converge on.

**Token Breakdown** — the per-message token counts: input, output, cache read,
cache write, and reasoning. "Tokens" unqualified means their total.

**Cost Source** — the provenance of a cost figure: `ProviderReported` (the client
recorded a cost), `Estimated` (tokscale computed it from pricing data), or `Unknown`.
A displayed cost is only as trustworthy as its cost source.

**Pricing** — per-model rates fetched from LiteLLM, with OpenRouter and models.dev
fallbacks and local overrides. Supports tiered rates and discounted cache tokens.

## Aggregation

**Group-By** — the axis a report aggregates on. Six strategies: `model`,
`client,model`, `client,provider,model`, `workspace,model`, `session,model`,
`client,session,model`. Changing the strategy changes what one row *means*, not merely
how rows are sorted.

**Entry** — one row of an aggregated report. Its identity is determined entirely by the
active Group-By and the active Report Filter.

**Bucket Timezone** — the named IANA zone that decides which calendar day a message
falls in. Pinned on first scan, because a fixed UTC offset cannot follow DST and would
re-split usage near the day boundary twice a year.

**Scan** — walking every enabled client's data locations and parsing transcripts into
Unified Messages. **Source** — one such data location.

**Snapshot** — the corpus of Unified Messages produced by one Scan and held for reports to
be aggregated from. A Snapshot is replaced only by another Scan; it does not expire.

**Abandon** — to stop waiting for a Scan's result. Deliberately not "cancel": the Scan
itself continues to completion and still writes its cache, so an abandoned Scan leaves the
next one warm. Nothing partial is left behind, and nothing is undone.

**Report Filter** — the client, date-range and year constraints applied to Unified Messages
*before* aggregation. Not a row filter: narrowing a Report Filter changes what each Entry
means, not which Entries are displayed. Distinct from sorting and from column filtering,
which act on Entries after the fact.

## Two meanings of "usage"

Upstream overloads this term and the GUI keeps both, disambiguated by context:

**Usage** (general) — token consumption computed by tokscale from local transcripts.

**Usage** (the tab) — *vendor-reported subscription quota*: what a provider's own API
says you have consumed against your plan, with reset windows. Not computed by tokscale
and not reconciled against tokscale's own figures. These two numbers can disagree, and
that disagreement is expected rather than a bug.

## Presentation

**View** — one top-level destination. Upstream has eight: Overview, Usage, Models,
Daily, Hourly, Stats, Agents, and a hidden Minutely.

**Agents** — upstream's name for the view breaking usage down by client. Retained
despite the tension with **Client**, because renaming it would diverge from tokscale.

**Contribution Graph** — the GitHub-style calendar heatmap on the Stats view. Its
color **Ramp** is the sequence of discrete intensity steps mapping a day's usage to a
color.

**Replacing** — a View whose data is one question old: a Report Filter edit re-keyed
its query and the answer has not landed yet. The old answer stays on screen, dimmed and
inert, rather than the View emptying (#32). Distinct from **waiting**, which is the
first call, with nothing to keep. GUI-only — upstream's TUI re-renders synchronously and
has no name for either.

**Light mode** — upstream means a light *background* for the terminal. Distinct from
`--light`, a flag meaning *static table output instead of the interactive TUI*. The GUI
inherits the first meaning only; the second has no GUI equivalent.
