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
import { RowSkeleton } from "@/components/states";
import { useGraph } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { fmtCost, fmtTokens } from "@/lib/format";

export function DailyView() {
  const snap = useSnapshot();
  const graph = useGraph(snap.ready);

  if (snap.gate) return snap.gate;

  // Days with no usage are omitted rather than listed as zero rows: on a typical
  // machine two thirds of the range is empty, and those rows would bury the days
  // that carry anything. Newest first — recent spend is what gets checked.
  const days = (graph.data ?? []).filter((d) => d.level > 0).slice().reverse();
  const busiest = days.reduce((a, b) => (b.cost > a.cost ? b : a), days[0]);
  const total = days.reduce((sum, d) => sum + d.cost, 0);

  return (
    <>
      <ViewHeader title="Daily" filter={snap.rangeLabel} />

      <Tiles
        items={[
          ["Active days", graph.data ? `${days.length}/${graph.data.length}` : "—"],
          ["Busiest day", busiest?.date ?? "—"],
          ["Busiest day cost", busiest ? fmtCost(busiest.cost) : "—"],
          ["Total cost", days.length ? fmtCost(total) : "—"],
        ]}
      />

      <Table className="mt-5 text-small">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-[26px] text-micro font-normal">Date</TableHead>
            <TableHead className="h-[26px] text-right text-micro font-normal">Tokens</TableHead>
            <TableHead className="h-[26px] text-right text-micro font-normal">Cost</TableHead>
            <TableHead className="h-[26px] pl-6 text-micro font-normal">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {graph.isPending ? (
            <RowSkeleton cols={4} />
          ) : (
            days.map((d) => (
              <TableRow key={d.date} className="h-row border-border/50">
                <TableCell className="py-0 font-mono">{d.date}</TableCell>
                <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
                  {fmtTokens(d.tokens)}
                </TableCell>
                <TableCell className="tnum py-0 text-right font-mono">{fmtCost(d.cost)}</TableCell>
                <TableCell className="py-0 pl-6">
                  {/* The bar takes the day's Ramp step, so a row here and its
                      cell in the Contribution Graph read as the same day. */}
                  <span
                    className="block h-[6px] rounded-[1px]"
                    style={{
                      width: busiest?.cost ? `${(d.cost / busiest.cost) * 100}%` : 0,
                      background: `var(--ramp-${d.level})`,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {days.length > 0 && (
          <TableFooter className="bg-transparent">
            <TableRow className="h-row border-border">
              <TableCell className="py-0 font-medium">Total</TableCell>
              <TableCell className="py-0" />
              <TableCell className="tnum py-0 text-right font-mono font-semibold">
                {fmtCost(total)}
              </TableCell>
              <TableCell className="py-0" />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </>
  );
}
