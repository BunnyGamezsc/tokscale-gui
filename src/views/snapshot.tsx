import type { ReactNode } from "react";
import { useScan } from "@/lib/use-scan";
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

  const rangeLabel =
    scan.summary?.firstDay && scan.summary?.lastDay
      ? `${scan.summary.firstDay}..${scan.summary.lastDay}`
      : undefined;

  let gate: ReactNode | null = null;
  if (scan.error) {
    gate = <Failed message={scan.error} onRetry={scan.refresh} />;
  } else if (scan.abandoned) {
    gate = <Abandoned onRefresh={scan.refresh} />;
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
    refresh: scan.refresh,
  };
}
