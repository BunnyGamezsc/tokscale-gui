import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RowSkeleton } from "@/components/states";
import * as api from "@/lib/api";
import { asArg, useFilter } from "@/lib/filter";
import type { Day, Entry, GroupBy } from "@/lib/api";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

/** A row's detail: **what this row is made of**, one axis finer.
 *
 *  Both entrances are served by `model_report` off the held Snapshot — 41-100 ms,
 *  never a second `graph_report` and never a rescan — and both are pinned by
 *  tests in `commands.rs`:
 *
 *  - Daily's day is a one-day Report Filter (`since == until == the date`).
 *    `daily_detail_agrees_with_the_daily_row` checks all 69 active days of the
 *    real corpus against `graph_report`; worst delta is 0.0.
 *  - A Models row is the same report read one Group-By finer and filtered to
 *    the row's key. `a_finer_group_by_decomposes_a_coarser_entry_exactly` is
 *    why the parts sum to the row rather than approximately to it.
 *
 *  The contract the dialog exists to keep is that its total **equals** the
 *  figure on the row that opened it, so the header states both.
 */

/** The axis a Models row drills into, and how its parts are recognised.
 *
 *  Only two of the five Group-Bys have hidden composition. `client,provider,model`
 *  is already the finest axis P1 exposes; `workspace,model` and `session,model`
 *  would drill into time, and core has no date Group-By to drill into — see the
 *  ticket 10 answer. A row with no finer axis is not clickable rather than
 *  opening an empty dialog. A null `row` probes whether the axis drills at all. */
export function drillMatch(groupBy: GroupBy, row: Entry | null) {
  switch (groupBy) {
    case "model":
      return (e: Entry) => !!row && e.model === row.model;
    case "client,model":
      return (e: Entry) => !!row && e.model === row.model && e.client === row.client;
    default:
      return null;
  }
}

const FINER: GroupBy = "client,provider,model";

export function useDayDetail(date: string | null) {
  // The active Report Filter still applies — the dialog has to equal the Daily
  // row it opened from, and that row is narrowed. Only the range is replaced.
  const filter = useFilter();
  return useQuery({
    queryKey: ["model_report", FINER, filter, date],
    queryFn: () => api.modelReport(FINER, { ...filter, since: date!, until: date! }),
    enabled: date !== null,
    staleTime: Infinity,
  });
}

/** A day's breakdown, opened from anywhere a day is drawn.
 *
 *  Three Views open the same dialog now: Daily from a table row, and Overview
 *  and Stats from a Contribution Graph cell, by click or by keyboard (#29). One
 *  hook rather than three copies, because the contract they share is the one the
 *  dialog exists to keep — the total equals the figure on what opened it — and
 *  `days` is what carries that figure.
 */
export function useDayDialog(days: Day[]) {
  const [day, setDay] = useState<string | null>(null);
  const detail = useDayDetail(day);
  const opened = days.find((d) => d.date === day);

  return {
    open: setDay,
    dialog: day && (
      <DetailDialog
        title={`Daily detail: ${day}`}
        aside={opened ? fmtCost(opened.cost) : ""}
        entries={detail.data?.entries ?? []}
        pending={detail.isPending}
        onClose={() => setDay(null)}
      />
    ),
  };
}

export function useRowDetail(row: Entry | null, groupBy: GroupBy, ready: boolean) {
  const filter = useFilter();
  const q = useQuery({
    queryKey: ["model_report", FINER, filter],
    queryFn: () => api.modelReport(FINER, asArg(filter)),
    enabled: ready && row !== null,
    staleTime: Infinity,
  });
  const match = row && drillMatch(groupBy, row);
  return { ...q, entries: match ? (q.data?.entries ?? []).filter(match) : [] };
}

export function DetailDialog({
  title,
  aside,
  entries,
  pending,
  onClose,
}: {
  title: string;
  /** The figure on the row this opened from. It must equal the footer. */
  aside: string;
  entries: Entry[];
  pending: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // The native element, not a portal-and-focus-trap of our own: it gives the
  // modal backdrop, focus containment and Esc-to-close for free, and Esc is
  // already the key that closes upstream's Daily Detail.
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const rows = [...entries].sort((a, b) => b.cost - a.cost);
  const total = rows.reduce((s, e) => s + e.cost, 0);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Backdrop clicks land on the dialog itself, never on its content.
        if (e.target === ref.current) ref.current?.close();
      }}
      className="max-h-[70vh] w-[620px] max-w-[90vw] rounded-md border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/25"
    >
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <h2 className="text-small font-semibold">{title}</h2>
        <span className="tnum font-mono text-small text-muted-foreground">{aside}</span>
      </header>

      <div className="max-h-[52vh] overflow-y-auto px-4">
        <Table className="text-small">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-[26px] text-micro font-normal">Model</TableHead>
              <TableHead className="h-[26px] text-micro font-normal">Client</TableHead>
              <TableHead className="h-[26px] text-micro font-normal">Provider</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Msgs</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Tokens</TableHead>
              <TableHead className="h-[26px] text-right text-micro font-normal">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending ? (
              <RowSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Nothing here. Esc to go back.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((e, i) => (
                <TableRow
                  key={`${e.client}-${e.provider}-${e.model}-${i}`}
                  className="h-row border-border/50"
                >
                  <TableCell className="py-0 font-mono">{e.model}</TableCell>
                  <TableCell className="py-0 text-muted-foreground">{e.client}</TableCell>
                  <TableCell className="py-0 font-mono text-muted-foreground">
                    {e.provider}
                  </TableCell>
                  <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
                    {fmtInt(e.messageCount)}
                  </TableCell>
                  <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
                    {fmtTokens(e.input + e.output + e.cacheRead)}
                  </TableCell>
                  <TableCell className="tnum py-0 text-right font-mono">{fmtCost(e.cost)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter className="bg-transparent">
              <TableRow className="h-row border-border">
                <TableCell className="py-0 font-medium">Total</TableCell>
                <TableCell className="py-0" colSpan={4} />
                <TableCell className="tnum py-0 text-right font-mono font-semibold">
                  {fmtCost(total)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </dialog>
  );
}
