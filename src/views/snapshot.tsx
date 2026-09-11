import type { ReactNode } from "react";
import { useClientCatalog, useRefresh, useScan, useScanState } from "@/lib/use-scan";
import { useFilter } from "@/lib/filter";
import { Scanning, Abandoned, Failed, FirstRun, NoUsage } from "@/components/states";

/** Every view depends on the same Snapshot, and all four gate on it the same
 *  way: scanning, abandoned, failed, or empty. Returning the gate as an element
 *  keeps that decision in one place instead of four. */
export function useSnapshot(): {
  ready: boolean;
  rangeLabel: string | undefined;
  gate: ReactNode | null;
  banner: ReactNode | null;
  refresh: () => void;
  /** The previous run's duration, for the warning a Refresh owes before it is
   *  taken (#30). Read here rather than in the button, because `useScan` has
   *  one owner and a second call would bring a second elapsed timer. */
  etaSeconds: number | null;
} {
  const scan = useScan();
  const state = useScanState(scan);
  // Const data from core, so it answers during the very Scan it describes.
  const catalog = useClientCatalog();
  // The one Refresh door, shared with the shell's `R` binding. `useScan` does
  // not hand one out: Refresh is window state, not a View's (ADR 0003).
  const refresh = useRefresh();
  const filter = useFilter();

  // The range beside a View title is the question being asked, so the active
  // Report Filter wins; an end the user has not set falls back to the corpus.
  const since = filter.since ?? scan.summary?.firstDay;
  const until = filter.until ?? scan.summary?.lastDay;
  const rangeLabel = since && until ? `${since}..${until}` : undefined;

  let gate: ReactNode | null = null;
  if (scan.error) {
    gate = <Failed message={scan.error} onRetry={refresh} />;
  } else if (scan.abandoned) {
    gate = <Abandoned onRefresh={refresh} />;
  } else if (state === "first-run") {
    gate = (
      <FirstRun
        elapsed={scan.elapsed}
        etaSeconds={scan.etaSeconds}
        clients={catalog.data ?? []}
        onAbandon={scan.abandon}
      />
    );
  } else if (state === "settling") {
    // A Scan is in flight but it is almost certainly the unforced kind — a
    // webview reload handed back the held Snapshot. Draw nothing for the ~120 ms
    // that takes rather than flashing a first-run panel at someone who is not
    // having one. Truthy, so the Views still hold their content back.
    gate = <></>;
  } else if (scan.summary && scan.summary.messages === 0) {
    gate = <NoUsage />;
  }

  return {
    ready: Boolean(scan.summary && scan.summary.messages > 0),
    rangeLabel,
    gate,
    // A Refresh sits *above* the View, not in place of it: the numbers on
    // screen are still the last answer (#28).
    banner:
      state === "refreshing" ? (
        <Scanning elapsed={scan.elapsed} etaSeconds={scan.etaSeconds} onAbandon={scan.abandon} />
      ) : null,
    refresh,
    etaSeconds: scan.etaSeconds,
  };
}
