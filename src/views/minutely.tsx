import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ViewHeader, Tiles } from "@/components/view";
import { RowSkeleton, Replacing, NoMatch, NoUsage } from "@/components/states";
import { useGraphState, useMinutely } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { clearFilter, isNarrowed, useFilter } from "@/lib/filter";
import { minuteLabel } from "@/lib/hourly";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

/** Hourly's table at a finer key, hidden unless enabled in Settings (#38). */
export function MinutelyView() {
  const snap = useSnapshot();
  const filter = useFilter();
  const minutely = useMinutely(snap.ready);
  const state = useGraphState(minutely);

  if (snap.gate) return snap.gate;
  if (minutely.data && minutely.data.slots.length === 0)
    return isNarrowed(filter) ? <NoMatch onClear={clearFilter} /> : <NoUsage />;

  // ponytail: one row per active minute, unvirtualized; virtualize if a real corpus drags.
  const slots = (minutely.data?.slots ?? []).slice().reverse();
  const busiest = slots.reduce((max, s) => Math.max(max, s.cost), 0);

  return (
    <>
      {snap.banner}
      <ViewHeader title="Minutely" filter={snap.rangeLabel} />

      <Replacing on={state === "replacing"}>
        <Tiles
          items={[
            ["Active minutes", minutely.data ? fmtInt(slots.filter((s) => s.minute !== null).length) : "—"],
            ["Busiest minute", busiest > 0 ? fmtCost(busiest) : "—"],
            ["Messages", minutely.data ? fmtInt(minutely.data.totalMessages) : "—"],
            ["Total cost", minutely.data ? fmtCost(minutely.data.totalCost) : "—"],
          ]}
        />

        <Table className="mt-5 text-small">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-[26px] text-micro font-normal">Date</TableHead>
              <TableHead className="h-[26px] text-micro font-normal">Minute</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Messages</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Tokens</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Cost</TableHead>
              <TableHead className="h-[26px] pl-6 text-micro font-normal">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state === "waiting" ? (
              <RowSkeleton cols={6} />
            ) : (
              slots.map((s) => (
                <TableRow key={`${s.date}-${s.minute}`} className="h-row border-border/50">
                  <TableCell className="py-0 font-mono">{s.date}</TableCell>
                  <TableCell
                    className={`py-0 font-mono ${s.minute === null ? "text-muted-foreground" : ""}`}
                  >
                    {minuteLabel(s.minute)}
                  </TableCell>
                  <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
                    {fmtInt(s.messageCount)}
                  </TableCell>
                  <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
                    {fmtTokens(s.tokens)}
                  </TableCell>
                  <TableCell className="tnum py-0 text-right font-mono">{fmtCost(s.cost)}</TableCell>
                  <TableCell className="py-0 pl-6">
                    <span
                      className="block h-[6px] rounded-[1px] bg-[var(--ramp-4)]"
                      style={{ width: busiest ? `${(s.cost / busiest) * 100}%` : 0 }}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {minutely.data && (
            <TableFooter className="bg-transparent">
              <TableRow className="h-row border-border">
                <TableCell className="py-0 font-medium">Total</TableCell>
                <TableCell className="py-0" />
                <TableCell className="tnum py-0 text-right font-mono">
                  {fmtInt(minutely.data.totalMessages)}
                </TableCell>
                <TableCell className="py-0" />
                <TableCell className="tnum py-0 text-right font-mono font-semibold">
                  {fmtCost(minutely.data.totalCost)}
                </TableCell>
                <TableCell className="py-0" />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Replacing>
    </>
  );
}
