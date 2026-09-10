# 4. The cold first run

Date: 2026-09-10

## Status

Accepted

## Context

The first thing a new user sees is a spinner over an empty window for 21–40 s while a
cold Scan walks every enabled Client's Sources and parses transcripts into Unified
Messages. Main-thread p99 stayed at 86–241 ms through it, so nothing freezes — but there
is no percentage to show, because the parse reports nothing until it finishes, and the
window had no first-run state distinct from a Refresh.

Ticket #28 asks for a decision, not just a screen: three levers were on the table and the
one taken has to be recorded with the reason the other two were not.

## Decision

### Accept the wait; spend the effort on what the window says

Neither of the other two levers is taken.

**Progressive fill is not blocked by the parse — it is blocked by the Snapshot.** The
lever looked cheap because `scan` already accepts a `Filter` whose `clients` is a genuine
parse input: `Filter::parse_options` feeds `LocalParseOptions.clients`, and
`resolve_local_parse_request` honours it. So scanning one Client at a time is available
today, with no fork change. What is not available is *holding* the result: `scan` ends in
`*state.0.lock()? = Some(messages)`, so every Scan **replaces** the held Snapshot and N
per-Client scans clobber each other until the last one wins. Accumulating instead of
replacing is a backend change the ticket does not name, and it is the real cost of the
lever.

**And N is 52, not a handful.** `define_clients!` declares 53 Clients and all but one are
`parse_local`, which is what `the_catalog_names_every_client_a_scan_reads` now pins. "Scan
one Client at a time" on a cold run means 52 sequential IPC calls, each a `spawn_blocking`
round trip, most of them finding nothing — a machine has a handful of these installed.
Whatever progressive means here, it is not 52 round trips, so the lever would also need a
batching or a fill-only-what-produced-something rule *invented*, on top of the
accumulating Snapshot, on top of the verification the ticket makes a precondition
("results verified identical to a single-call Scan"), which in this repo means a Rust test
against the real corpus in the style of `daily_detail_agrees_with_the_daily_row`.

There is a fourth cost, and it is the one that decided it. **The gate is an early return.**
All five Views open with `if (snap.gate) return snap.gate;`, so during a Scan the whole
View — its `ViewHeader` included — is replaced by the gate, and the chrome is empty too
(`FilterBar` returns `null` until `useScanLanded`). Anything that fills progressively has
to stop the gate being all-or-nothing, which touches every View and the chrome. That is a
structural change to the window, bought for a first run, paid for on every run.

**A sink-driven message count was already measured and rejected**, in the ticket itself:
three `pub` lines in the fork, and it advances in seven very uneven lumps, which reads
worse than an elapsed timer. Nothing in this ticket reopens it.

What is left is the lever the ticket names as a legitimate outcome rather than a failure
to deliver one: accept the wait, and make the window explain itself. Three things came out
of that.

### A first run is a Snapshot that isn't there, not a flag

`src/lib/scan-state.ts` is the scan-side sibling of `#32`'s `graph-pending.ts`, same shape
and for the same reason: `!hasSummary && isScanning` **is** the first-run test, so nothing
needs to be remembered and no `isFirstRun` flag joins `useScan`. A first run gets a full
panel that names what is being read; a Refresh gets the one-line banner, above a window
that already has an answer in it.

The delay is there for the opposite reason it is in `graphState`. On the graph side the
short wait is a re-run and the long one is the first call, so the first call is admitted to
at once; here the short wait *is* the first call — an unforced `scan` with a Snapshot
already held returns it without parsing, which is every webview reload, in milliseconds.
Without the 120 ms settle, a reload would flash the whole first-run panel at someone who is
not having one. A real first run is 21–40 s, so 120 ms of nothing in front of it is not a
second pop; it is the frame the window was going to spend booting anyway.

The two hooks now share one `useDelayPassed(active, ms)`. They needed the same timer and
disagreed only on the threshold and on what to do at each end of it.

### The window names the Clients, and needs a new command to do it

`clients` reads the Snapshot's aggregate, so before a Scan lands the frontend cannot name a
single Client — it can only say that something is happening. But the candidate list is
knowable before a Scan and was simply not exposed: `ClientId::ALL`, `as_str()`,
`display_name()` and `parse_local()` are all `pub` in core. `client_catalog` returns the
display names of the 52 `parse_local` Clients — the same set `resolve_local_parse_request`
walks when no `clients` filter is given, minus core's `synthetic` pseudo-source, which is
not a place on disk to look. It is const data: no Snapshot, no I/O, not `async`, and it
does not go through `blocking`. It answers *during* the Scan it describes, which is the
whole point, and it was the cheapest thing on the acceptance list.

### The estimate is the previous run, kept in the webview's own storage

The ETA was half-broken and the reason was the unforced early return. `etaSeconds` read
`query.data?.elapsedMs`; the unforced path returns `ScanSummary::of(held, 0)`, so after a
reload there was no ETA, and on a true cold run there is no `data` at all while scanning,
so there was none then either. It was only ever visible on a Refresh inside one session.

`localStorage` holds the last real duration instead. It survives a reload *and* a relaunch,
which is exactly the span the estimate is about; there is no `gui.json` yet (P2) and this
does not need one, because it is a hint rather than state and a machine that has never
finished a Scan correctly has none. Its absence is answered in words instead of hidden: the
panel says a first scan usually takes 20–40 seconds.

## Consequences

- The 21–40 s wait is still 21–40 s. This decision buys an explanation, not a shorter Scan,
  and the roadmap item is closed on that basis.
- **Progressive fill stays reopenable, and its price is now written down**: an accumulating
  Snapshot in `commands.rs`, a batching rule, a gate that is not an early return in five
  Views, and a corpus test that a per-Client Scan agrees with a single-call one. Reopen it
  on that list, not on the fact that `clients` is already a parse input — that half was
  never the obstacle.
- Every read and write of `localStorage` is wrapped: storage can be unavailable or full,
  and an estimate is not worth a crash.
- `Scanning` is now the Refresh banner only. Its copy says "Re-reading", which is true in
  the one state it is reachable from.
- The Abandon promise is made twice on purpose — once on the first-run panel, before it is
  needed, and once on the `Abandoned` screen after. Both say the same thing, because the
  thing is not obvious: the Scan cannot be interrupted, so abandoning stops the wait and
  the work still finishes and still warms the cache.
- `NoUsage` and `Failed` were already right and are unchanged. Roughly 50 Clients are
  scanned and most are absent on any machine, so finding nothing is a normal outcome with
  a pointer at `~/.config/tokscale/settings.json`, not an error; a failed Scan states what
  failed and offers a retry. Per-source parse failures stay invisible because core swallows
  them — there is no partial-failure channel to report through, so "what failed" cannot get
  more specific than the whole Scan.
- The catalog is a second place that knows what a Scan reads. `the_catalog_names_every_
  client_a_scan_reads` is what keeps it from drifting from the first.
