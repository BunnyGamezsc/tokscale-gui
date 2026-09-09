import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ContributionGraph, RampLegend, GRAPH_HEIGHT } from "@/components/contribution-graph";
import { ViewHeader, Tiles, SectionHead } from "@/components/view";
import { RowSkeleton } from "@/components/states";
import { useReport, useGraph } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { useDayDialog } from "@/components/detail";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

export function OverviewView() {
  const snap = useSnapshot();
  const report = useReport("model", snap.ready);
  const graph = useGraph(snap.ready);
  const dayDialog = useDayDialog(graph.data ?? []);

  if (snap.gate) return snap.gate;

  const days = graph.data ?? [];
  const active = days.filter((d) => d.level > 0).length;
  const r = report.data;

  return (
    <>
      <ViewHeader title="Overview" filter={snap.rangeLabel}>
        <Button variant="outline" size="sm" onClick={snap.refresh}>
          Refresh
        </Button>
      </ViewHeader>

      <Tiles
        items={[
          ["Total cost", r ? fmtCost(r.totalCost) : "—"],
          ["Tokens", r ? fmtTokens(r.totalInput + r.totalOutput + r.totalCacheRead) : "—"],
          ["Messages", r ? fmtInt(r.totalMessages) : "—"],
          ["Active days", days.length ? `${active}/${days.length}` : "—"],
        ]}
      />

      <section className="mt-5">
        <SectionHead title="Contribution graph" aside={days.length ? `${active} active days` : ""} />
        <div className="mt-3 overflow-x-auto" style={{ minHeight: GRAPH_HEIGHT }}>
          <ContributionGraph days={days} onSelect={dayDialog.open} />
        </div>
        {days.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2 text-micro text-muted-foreground">
            <span>Less</span>
            <RampLegend />
            <span>More</span>
          </div>
        )}
      </section>

      <section className="mt-6">
        <SectionHead title="Top models" aside={r ? `${r.entries.length} entries` : ""} />
        <Table className="text-small">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-[26px] text-micro font-normal">Model</TableHead>
              <TableHead className="h-[26px] text-micro font-normal">Provider</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Messages</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Tokens</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.isPending ? (
              <RowSkeleton />
            ) : (
              [...(r?.entries ?? [])]
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 8)
                .map((e) => (
                  <TableRow key={e.model} className="h-row border-border/50">
                    <TableCell className="py-0 font-mono">{e.model}</TableCell>
                    <TableCell className="py-0 font-mono text-muted-foreground">
                      {e.provider}
                    </TableCell>
                    <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
                      {fmtInt(e.messageCount)}
                    </TableCell>
                    <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
                      {fmtTokens(e.input + e.output + e.cacheRead)}
                    </TableCell>
                    <TableCell className="tnum py-0 text-right font-mono">
                      {fmtCost(e.cost)}
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </section>

      {dayDialog.dialog}
    </>
  );
}
