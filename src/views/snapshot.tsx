import type { ReactNode } from "react";
import { useRefresh, useScan } from "@/lib/use-scan";
import { useFilter } from "@/lib/filter";
import { Scanning, Abandoned, Failed, NoUsage } from "@/components/states";

/** Every view depends on the same Snapshot, and all four gate on it the same
 *  way: scanning, abandoned, failed, or empty. Returning the gate as an element
 *  keeps that decision in one place instead of four. */
export function useSnapshot(): {
  ready: boolean;
  rangeLabel: string | undefined;
  gate: ReactNode | null;
  refresh: () => void;
} {
  const scan = useScan();
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
  } else if (scan.scanning) {
    gate = (
      <Scanning elapsed={scan.elapsed} etaSeconds={scan.etaSeconds} onAbandon={scan.abandon} />
    );
  } else if (scan.summary && scan.summary.messages === 0) {
    gate = <NoUsage />;
  }

  return {
    ready: Boolean(scan.summary && scan.summary.messages > 0),
    rangeLabel,
    gate,
    refresh,
  };
}
