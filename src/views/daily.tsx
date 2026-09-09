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
import { useDayDialog } from "@/components/detail";
import { RowSkeleton, Replacing } from "@/components/states";
import { useGraph, useGraphState } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { fmtCost, fmtTokens } from "@/lib/format";

export function DailyView() {
  const snap = useSnapshot();
  const graph = useGraph(snap.ready);
  const graphState = useGraphState(graph);

  // Upstream's Daily Detail, which is a day broken down by client/provider/model.
  // Served by `model_report` with `since == until == the date` off the held
  // Snapshot, not by a second `graph_report`: the day totals agree exactly
  // (`daily_detail_agrees_with_the_daily_row`), and this way the dialog costs
  // 41-100 ms instead of re-entering a 1.3-15 s parse.
  const dayDialog = useDayDialog(graph.data ?? []);

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

      <Replacing on={graphState === "replacing"}>
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
            {graphState === "waiting" ? (
              <RowSkeleton cols={4} />
            ) : (
              days.map((d) => (
                <TableRow
                  key={d.date}
                  onClick={() => dayDialog.open(d.date)}
                  className="h-row cursor-pointer border-border/50"
                >
                  <TableCell className="py-0 font-mono">
                    {/* The row stays the pointer's hit target, which is what the
                        click behaviour already implied; the keyboard and the
                        screen reader get a real button in the first cell. The
                        alternative — `tabIndex` and a key handler on the `<tr>`
                        — makes a row that announces as a row and behaves as a
                        control, and costs the tab order one stop per day. */}
                    <button
                      className="text-left"
                      aria-label={`${d.date}, breakdown`}
                      onClick={() => dayDialog.open(d.date)}
                    >
                      {d.date}
                    </button>
                  </TableCell>
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
      </Replacing>

      {dayDialog.dialog}
    </>
  );
}
