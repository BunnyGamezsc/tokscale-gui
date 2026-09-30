import { useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { SectionHead } from "@/components/view";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInsights, useSpendingStatus } from "@/lib/use-scan";
import { useFilter } from "@/lib/filter";
import { rollupPeriods } from "@/lib/periods";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";
import type { SessionSpend } from "@/lib/api";

export function SessionDetail({ session, onClose, onDay }: { session: SessionSpend; onClose: () => void; onDay: (day: string) => void }) {
  const time = (stamp: number | null) => stamp ? new Date(stamp).toLocaleString() : "Time not recorded";
  return (
    <Modal title={session.title ?? session.sessionId} aside={fmtCost(session.cost)} onClose={onClose} className="w-[620px] max-w-[90vw]">
      <div className="max-h-[65vh] overflow-y-auto px-4 py-4 text-small">
        <dl className="grid grid-cols-[85px_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Session</dt><dd className="break-all font-mono">{session.sessionId}</dd>
          <dt className="text-muted-foreground">Client</dt><dd>{session.client}</dd>
          <dt className="text-muted-foreground">Models</dt><dd className="break-words font-mono">{session.models.join(", ")}</dd>
          <dt className="text-muted-foreground">Providers</dt><dd>{session.providers.join(", ") || "Not recorded"}</dd>
          <dt className="text-muted-foreground">Projects</dt><dd>{session.workspaces.length ? session.workspaces.map((w) => <div key={w.key} className="break-all" title={w.key}>{w.label}</div>) : "Not recorded"}</dd>
          <dt className="text-muted-foreground">Started</dt><dd>{time(session.firstTimestamp)}</dd>
          <dt className="text-muted-foreground">Last activity</dt><dd>{time(session.lastTimestamp)}</dd>
          <dt className="text-muted-foreground">Usage</dt><dd className="tnum font-mono">{fmtTokens(session.tokens)} tokens · {fmtInt(session.messageCount)} messages</dd>
        </dl>
        {!session.costIsComplete && <p className="mt-3 text-micro text-muted-foreground">Known cost subtotal. Some usage has no price.</p>}
        <p className="mt-4 text-micro text-muted-foreground">Open a day's breakdown</p>
        <div className="mt-2 flex flex-wrap gap-2">{session.days.map((day) => <button key={day} className="rounded-sm border border-border px-2 py-1 font-mono text-micro hover:bg-muted" onClick={() => onDay(day)}>{day}</button>)}</div>
      </div>
    </Modal>
  );
}

export function ExpensiveSessions({ ready, onSelect }: { ready: boolean; onSelect: (session: SessionSpend) => void }) {
  const { data, error } = useInsights(ready);
  return (
    <section className="mt-6">
      <SectionHead title="Most expensive chats" aside={data ? `Top ${Math.min(8, data.sessions.length)} of ${data.sessions.length}` : ""} />
      {error ? <p role="alert" className="mt-3 text-small text-muted-foreground">Chat costs unavailable: {String(error)}</p> : !data ? <p className="mt-3 text-small text-muted-foreground">Loading chats…</p> : data.sessions.length === 0 ? <p className="mt-3 text-small text-muted-foreground">No session IDs recorded in this range.</p> : (
        <Table className="mt-2 text-small">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Chat / project</TableHead><TableHead>Models</TableHead><TableHead>Last day</TableHead><TableHead className="text-right">Tokens</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
          <TableBody>{data.sessions.slice(0, 8).map((session) => <TableRow key={JSON.stringify([session.client, session.sessionId])} className="border-border/50">
            <TableCell className="max-w-[240px]"><button className="block w-full truncate text-left hover:underline" onClick={() => onSelect(session)} title={session.sessionId}>{session.title ?? session.sessionId}</button><span className="block truncate text-micro text-muted-foreground">{session.workspaces.map((w) => w.label).join(", ") || session.client}</span></TableCell>
            <TableCell className="max-w-[160px] truncate font-mono text-micro text-muted-foreground" title={session.models.join(", ")}>{session.models.join(", ")}</TableCell>
            <TableCell className="whitespace-nowrap font-mono text-micro text-muted-foreground">{session.lastDay}</TableCell>
            <TableCell className="tnum text-right font-mono text-muted-foreground">{fmtTokens(session.tokens)}</TableCell>
            <TableCell className="tnum text-right font-mono">{fmtCost(session.cost)}{!session.costIsComplete ? "*" : ""}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      )}
      {data && data.unassignedCost > 0 && <p className="mt-2 text-micro text-muted-foreground">{fmtCost(data.unassignedCost)} has no session ID and is included in daily totals.</p>}
    </section>
  );
}

export function PeriodSummaries({ ready }: { ready: boolean }) {
  const { data, error } = useInsights(ready);
  const { data: local } = useSpendingStatus(ready);
  const filter = useFilter();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [picked, setPicked] = useState<string | null>(null);
  const years = [...new Set(data?.days.map((d) => d.date.slice(0, 4)) ?? [])].sort();
  const year = picked && years.includes(picked) ? picked : years.at(-1);
  const rows = useMemo(() => data && local ? rollupPeriods(data.days, period, local.today, filter, year).reverse() : [], [data, local, period, filter, year]);
  const total = rows.reduce((s, r) => s + r.cost, 0);
  return (
    <section className="mt-6" aria-label="Weekly and monthly summaries">
      <div className="flex items-center justify-between gap-3"><SectionHead title="Spending summaries" /><Tabs value={period} onValueChange={(v) => setPeriod(v as "week" | "month")}><TabsList><TabsTrigger value="week">Weeks</TabsTrigger><TabsTrigger value="month">Months</TabsTrigger></TabsList></Tabs></div>
      {years.length > 1 && <div className="mt-2 flex gap-1" role="group" aria-label="Summary year">{years.map((y) => <button key={y} aria-pressed={y === year} className={`rounded-sm px-2 py-1 font-mono text-micro ${y === year ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setPicked(y)}>{y}</button>)}</div>}
      <p className="mt-2 text-micro text-muted-foreground">{year ?? ""} recorded totals. Monday weeks. Deltas compare with the previous full calendar period; partial periods are marked. * means unpriced usage.</p>
      {error ? <p role="alert" className="mt-3 text-small">Summaries unavailable: {String(error)}</p> : (
        <div className="mt-2 max-h-[360px] overflow-y-auto"><Table className="text-small">
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Period</TableHead><TableHead className="text-right">Messages</TableHead><TableHead className="text-right">Tokens</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Change</TableHead></TableRow></TableHeader>
          <TableBody>{!data || !local ? <TableRow><TableCell colSpan={5}>Loading summaries…</TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={5}>No daily usage in this range.</TableCell></TableRow> : rows.map((r) => <TableRow key={r.start} className="border-border/50">
            <TableCell className="font-mono text-micro">{period === "month" ? r.start.slice(0, 7) : `${r.start} – ${r.end}`} {r.partial && <span className="font-sans text-muted-foreground">partial</span>}</TableCell>
            <TableCell className="tnum text-right font-mono text-muted-foreground">{fmtInt(r.messageCount)}</TableCell>
            <TableCell className="tnum text-right font-mono text-muted-foreground">{fmtTokens(r.tokens)}</TableCell>
            <TableCell className="tnum text-right font-mono">{fmtCost(r.cost)}{!r.costIsComplete ? "*" : ""}</TableCell>
            <TableCell className="tnum text-right font-mono text-muted-foreground" title={r.previousCost !== null ? `Previous period: ${fmtCost(r.previousCost)}` : "Previous period unavailable or unpriced"}>{r.delta === null ? "—" : `${r.delta > 0 ? "↑" : r.delta < 0 ? "↓" : "="} ${fmtCost(Math.abs(r.delta))}${r.previousCost ? ` · ${Math.round(Math.abs(r.delta) / r.previousCost * 100)}%` : r.delta > 0 ? " · new" : ""}`}</TableCell>
          </TableRow>)}</TableBody>
          {rows.length > 0 && <TableFooter className="bg-transparent"><TableRow><TableCell>{year} total</TableCell><TableCell colSpan={2} /><TableCell className="tnum text-right font-mono">{fmtCost(total)}</TableCell><TableCell /></TableRow></TableFooter>}
        </Table></div>
      )}
    </section>
  );
}
