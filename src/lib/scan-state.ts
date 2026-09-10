/** Whether the window is doing a first run or a refresh, and when it says so.
 *
 *  The scan-side sibling of `graph-pending.ts`, and deliberately the same shape:
 *  a first run is not a flag anyone sets, it is `!hasSummary && isScanning`.
 *  Nothing has to be remembered for the window to know which one it is in.
 *
 *  The delay is here for the opposite reason it is there. On the graph side the
 *  short wait is a re-run and the long one is the first call; here the short
 *  wait is the *first* call — an unforced `scan` with a Snapshot already held
 *  returns it without parsing, which is what every webview reload does, in
 *  milliseconds. Without a delay that reload would flash the whole first-run
 *  panel. A real first run is 21-40 s, so 120 ms of nothing in front of it is
 *  not a second pop; it is the frame the window was going to spend booting.
 */
export const SETTLE_DELAY_MS = 120;

export type ScanState =
  /** No Scan in flight. Render the View. */
  | "ready"
  /** A Scan is running with nothing held yet, but it may be the millisecond
   *  kind. Render nothing until the delay says otherwise. */
  | "settling"
  /** A cold first run: no Snapshot, and the wait is real. The window owes an
   *  explanation. */
  | "first-run"
  /** A Refresh: a Snapshot is already on screen and is being replaced. */
  | "refreshing";

export function scanState(
  scan: { hasSummary: boolean; isScanning: boolean },
  delayPassed: boolean,
): ScanState {
  if (!scan.isScanning) return "ready";
  if (scan.hasSummary) return "refreshing";
  return delayPassed ? "first-run" : "settling";
}
