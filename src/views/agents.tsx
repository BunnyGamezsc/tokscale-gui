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
import { RowSkeleton, NoMatch, NoUsage } from "@/components/states";
import type { AgentRow } from "@/lib/api";
import { useAgents } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { clearFilter, isNarrowed, useFilter } from "@/lib/filter";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

const tokens = (a: AgentRow) => a.input + a.output + a.cacheRead;

export function AgentsView() {
  const snap = useSnapshot();
  const filter = useFilter();
  const report = useAgents(snap.ready);

  if (snap.gate) return snap.gate;
  if (report.data && report.data.agents.length === 0)
    return isNarrowed(filter) ? <NoMatch onClear={clearFilter} /> : <NoUsage />;

  // Most usage records no agent (#37 measured 92% of cost on the author's
  // corpus). Ranked among the agents it would dwarf them, so it sits apart,
  // above the total it still counts toward, and the bars scale to named agents.
  const all = report.data?.agents ?? [];
  const named = all.filter((a) => a.agent !== null);
  const none = all.find((a) => a.agent === null);
  const busiest = named.reduce((max, a) => Math.max(max, a.cost), 0);
  const total = report.data?.totalCost ?? 0;
  const attributed = total > 0 ? named.reduce((s, a) => s + a.cost, 0) / total : 0;

  const row = (a: AgentRow, share: React.ReactNode) => (
    <TableRow key={a.agent ?? ""} className="h-row border-border/50">
      <TableCell className={`py-0 ${a.agent === null ? "text-muted-foreground" : ""}`}>
        {a.agent ?? "No agent recorded"}
      </TableCell>
      <TableCell className="py-0 text-muted-foreground">{a.clients.join(", ")}</TableCell>
      <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
        {fmtInt(a.messageCount)}
      </TableCell>
      <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
        {fmtTokens(tokens(a))}
      </TableCell>
      <TableCell className="tnum py-0 text-right font-mono">{fmtCost(a.cost)}</TableCell>
      <TableCell className="py-0 pl-6">{share}</TableCell>
    </TableRow>
  );

  return (
    <>
      {snap.banner}
      <ViewHeader title="Agents" filter={snap.rangeLabel} />

      <Tiles
        items={[
          ["Agents", report.data ? fmtInt(named.length) : "—"],
          ["Messages", report.data ? fmtInt(report.data.totalMessages) : "—"],
          ["Cost with an agent", report.data ? `${(attributed * 100).toFixed(1)}%` : "—"],
          ["Total cost", report.data ? fmtCost(total) : "—"],
        ]}
      />

      <Table className="mt-5 text-small">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-[26px] text-micro font-normal">Agent</TableHead>
            <TableHead className="h-[26px] text-micro font-normal">Clients</TableHead>
            <TableHead className="h-[26px] text-right text-micro font-normal">Messages</TableHead>
            <TableHead className="h-[26px] text-right text-micro font-normal">Tokens</TableHead>
            <TableHead className="h-[26px] text-right text-micro font-normal">Cost</TableHead>
            <TableHead className="h-[26px] pl-6 text-micro font-normal">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.isPending ? (
            <RowSkeleton cols={6} />
          ) : (
            named.map((a) =>
              row(
                a,
                <span
                  className="block h-[6px] rounded-[1px] bg-[var(--ramp-4)]"
                  style={{ width: busiest ? `${(a.cost / busiest) * 100}%` : 0 }}
                />,
              ),
            )
          )}
        </TableBody>
        {report.data && (
          <TableFooter className="bg-transparent">
            {none &&
              row(
                none,
                <span className="text-micro text-muted-foreground">
                  {total > 0 ? `${((none.cost / total) * 100).toFixed(1)}% of cost` : ""}
                </span>,
              )}
            <TableRow className="h-row border-border">
              <TableCell className="py-0 font-medium">Total</TableCell>
              <TableCell className="py-0" />
              <TableCell className="tnum py-0 text-right font-mono">
                {fmtInt(report.data.totalMessages)}
              </TableCell>
              <TableCell className="tnum py-0 text-right font-mono">
                {fmtTokens(
                  report.data.totalInput + report.data.totalOutput + report.data.totalCacheRead,
                )}
              </TableCell>
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
