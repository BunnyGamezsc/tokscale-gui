import { ContributionGraph, RampLegend } from "@/components/contribution-graph";
import { ViewHeader, Tiles, SectionHead } from "@/components/view";
import { useGraph, useClients } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

/** Longest run of consecutive days carrying usage. */
function longestStreak(levels: number[]) {
  let best = 0;
  let run = 0;
  for (const l of levels) {
    run = l > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

export function StatsView() {
  const snap = useSnapshot();
  const graph = useGraph(snap.ready);
  const clients = useClients(snap.ready);

  if (snap.gate) return snap.gate;

  const days = graph.data ?? [];
  const active = days.filter((d) => d.level > 0);
  const totalCost = days.reduce((s, d) => s + d.cost, 0);
  const totalTokens = days.reduce((s, d) => s + d.tokens, 0);
  const rows = clients.data ?? [];
  const top = rows[0]?.cost ?? 0;

  return (
    <>
      <ViewHeader title="Stats" filter={snap.rangeLabel} />

      <Tiles
        items={[
          ["Active days", days.length ? `${active.length}/${days.length}` : "—"],
          ["Longest streak", days.length ? `${longestStreak(days.map((d) => d.level))}d` : "—"],
          ["Cost per active day", active.length ? fmtCost(totalCost / active.length) : "—"],
          ["Tokens", days.length ? fmtTokens(totalTokens) : "—"],
        ]}
      />

      {/* The graph leads: at the minimum window height anything below a table is
          off-screen, and the Ramp is the only place the accent is spent. */}
      <section className="mt-5">
        <SectionHead
          title="Contribution graph"
          aside={days.length ? `${active.length} active days` : ""}
        />
        <div className="mt-3 min-h-[110px] overflow-x-auto">
          <ContributionGraph days={days} cell={13} gap={3} radius={2} />
        </div>
        {days.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-micro text-muted-foreground">
            <span>Less</span>
            <RampLegend cell={13} gap={3} radius={2} />
            <span>More</span>
          </div>
        )}
      </section>

      <section className="mt-6">
        <SectionHead title="By client" aside={rows.length ? `${rows.length} with usage` : ""} />
        <div className="mt-2">
          {rows.map((c) => (
            <div key={c.id} className="flex h-row items-center gap-3 border-b border-border/50">
              <span className="w-[140px] shrink-0 font-mono text-small">{c.id}</span>
              <span
                className="h-[6px] rounded-[1px] bg-primary"
                style={{ width: top ? `${(c.cost / top) * 55}%` : 0 }}
              />
              <span className="tnum ml-auto font-mono text-small text-muted-foreground">
                {fmtInt(c.messages)}
              </span>
              <span className="tnum w-[80px] text-right font-mono text-small">
                {fmtCost(c.cost)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
