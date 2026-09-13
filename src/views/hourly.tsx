import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useGraphState, useHourly } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { clearFilter, isNarrowed, useFilter } from "@/lib/filter";
import { hourLabel, profile } from "@/lib/hourly";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

type Mode = "table" | "profile";

export function HourlyView() {
  const snap = useSnapshot();
  const filter = useFilter();
  // UI state, like Models' Group-By: which picture of the same report.
  const [mode, setMode] = useState<Mode>("table");
  const hourly = useHourly(snap.ready);
  // Not graph-specific: the same waiting/replacing decision over any query.
  const state = useGraphState(hourly);

  if (snap.gate) return snap.gate;
  if (hourly.data && hourly.data.slots.length === 0)
    return isNarrowed(filter) ? <NoMatch onClear={clearFilter} /> : <NoUsage />;

  // Newest first, as Daily is. The backend puts the untimed slot first in its
  // day, so reversed it closes the day, after 00:00.
  // ponytail: every active hour is a row, a few thousand over a year; virtualize if that drags.
  const slots = (hourly.data?.slots ?? []).slice().reverse();
  const busiest = slots.reduce((max, s) => Math.max(max, s.cost), 0);
  const { hours, untimed } = profile(slots);
  const peak = hours.reduce((a, b) => (b.cost > a.cost ? b : a));
  const peakCost = peak.cost;

  return (
    <>
      {snap.banner}
      <ViewHeader title="Hourly" filter={snap.rangeLabel}>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
          </TabsList>
        </Tabs>
      </ViewHeader>

      <Replacing on={state === "replacing"}>
        <Tiles
          items={[
            ["Active hours", hourly.data ? fmtInt(slots.filter((s) => s.hour !== null).length) : "—"],
            ["Peak hour of day", peakCost > 0 ? hourLabel(peak.hour) : "—"],
            ["Untimed messages", hourly.data ? fmtInt(untimed) : "—"],
            ["Total cost", hourly.data ? fmtCost(hourly.data.totalCost) : "—"],
          ]}
        />

        {mode === "table" ? (
          <Table className="mt-5 text-small">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-[26px] text-micro font-normal">Date</TableHead>
                <TableHead className="h-[26px] text-micro font-normal">Hour</TableHead>
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
                  <TableRow key={`${s.date}-${s.hour}`} className="h-row border-border/50">
                    <TableCell className="py-0 font-mono">{s.date}</TableCell>
                    <TableCell
                      className={`py-0 font-mono ${s.hour === null ? "text-muted-foreground" : ""}`}
                    >
                      {hourLabel(s.hour)}
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
            {hourly.data && (
              <TableFooter className="bg-transparent">
                <TableRow className="h-row border-border">
                  <TableCell className="py-0 font-medium">Total</TableCell>
                  <TableCell className="py-0" />
                  <TableCell className="tnum py-0 text-right font-mono">
                    {fmtInt(hourly.data.totalMessages)}
                  </TableCell>
                  <TableCell className="py-0" />
                  <TableCell className="tnum py-0 text-right font-mono font-semibold">
                    {fmtCost(hourly.data.totalCost)}
                  </TableCell>
                  <TableCell className="py-0" />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        ) : (
          <section className="mt-5" aria-label="Cost by hour of day">
            {/* 24 flexible columns: ~27 px each at the 652 px minimum content
                column, so no responsive branch. A label every third hour. */}
            <ol
              className="grid h-[180px] items-end gap-[3px] border-b border-border"
              style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
            >
              {hours.map((h) => {
                const label = `${hourLabel(h.hour)}: ${fmtCost(h.cost)}, ${fmtInt(h.messages)} messages, ${fmtTokens(h.tokens)} tokens`;
                return (
                  <li key={h.hour} className="flex h-full items-end" title={label} aria-label={label}>
                    <span
                      className="block w-full rounded-t-[1px] bg-[var(--ramp-4)]"
                      style={{ height: peakCost ? `${(h.cost / peakCost) * 100}%` : 0 }}
                    />
                  </li>
                );
              })}
            </ol>
            <div
              className="mt-1 grid gap-[3px] font-mono text-micro text-muted-foreground"
              style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
              aria-hidden
            >
              {hours.map((h) => (
                <span key={h.hour}>{h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}</span>
              ))}
            </div>
            {untimed > 0 && (
              <p className="mt-3 max-w-[62ch] text-small text-muted-foreground">
                {fmtInt(untimed)} {untimed === 1 ? "message has" : "messages have"} no recorded
                time, so {untimed === 1 ? "it is" : "they are"} left out of this profile. The table
                and the totals still count {untimed === 1 ? "it" : "them"}.
              </p>
            )}
          </section>
        )}
      </Replacing>
    </>
  );
}
