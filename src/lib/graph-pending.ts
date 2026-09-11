/** Whether Daily and Stats admit to waiting on `graph_report`, and when.
 *
 *  The wait this covers is short. Re-running #27's own probe
 *  (`a_scan_warms_the_graph_path`) on this machine, warm, in release: the first
 *  graph call after a Scan took **339 ms** — inside the 0.28-0.76 s band #27
 *  recorded for that same row — and the narrowed call a Report Filter edit
 *  actually makes took **30 ms**, matching #26, because it walks a subset of the
 *  cache the Scan just wrote. The several-second call #27 ruled out is
 *  unreachable from the UI, so nothing here should look like one.
 *
 *  `PENDING_DELAY_MS` sits between those two waits on purpose: a Filter edit
 *  finishes before anything is painted, and the first visit shows a pending
 *  state for long enough to read rather than strobing.
 */
export const PENDING_DELAY_MS = 120;

export type GraphState =
  /** Render the data in hand — either it is current, or the re-run is too short
   *  to be worth admitting to. */
  | "ready"
  /** Nothing to render yet: show the grid's shape, not an empty panel. */
  | "waiting"
  /** A re-run is replacing data that is already on screen. Keep it, dimmed. */
  | "replacing";

/** The rendering decision, split out from the timer so the threshold is pinned
 *  by a test. `delayPassed` is the only impure input.
 *
 *  The delay applies to `replacing` only. There is no short wait to protect
 *  against on the other branch: `waiting` means no data at all, which happens
 *  once, on the first graph call, and that call is the ~340 ms one. Delaying it
 *  too would draw an empty panel first and *then* the grid's shape — the two-pop
 *  sequence #32 exists to remove, rather than the one it names. */
export function graphState(
  query: { hasData: boolean; isFetching: boolean },
  delayPassed: boolean,
): GraphState {
  if (!query.isFetching) return "ready";
  if (!query.hasData) return "waiting";
  return delayPassed ? "replacing" : "ready";
}
