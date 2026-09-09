import { useMemo, useState } from "react";
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
import { drillMatch, DetailDialog, useRowDetail } from "@/components/detail";
import { RowSkeleton, NoUsage, NoMatch } from "@/components/states";
import { GROUP_BY, type Entry, type GroupBy } from "@/lib/api";
import { useReport } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { useFilter, clearFilter, isNarrowed } from "@/lib/filter";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

/** Columns are declared rather than written per-cell, so sorting reads a value
 *  from one place and the header and body cannot drift apart. */
type Col = {
  key: keyof Entry;
  label: string;
  numeric?: boolean;
  render: (e: Entry) => React.ReactNode;
};

const COLS: Col[] = [
  { key: "model", label: "Model", render: (e) => <span className="font-mono">{e.model}</span> },
  { key: "client", label: "Client", render: (e) => e.client },
  { key: "provider", label: "Provider", render: (e) => <span className="font-mono">{e.provider}</span> },
  { key: "messageCount", label: "Messages", numeric: true, render: (e) => fmtInt(e.messageCount) },
  { key: "input", label: "Input", numeric: true, render: (e) => fmtTokens(e.input) },
  { key: "output", label: "Output", numeric: true, render: (e) => fmtTokens(e.output) },
  { key: "cacheRead", label: "Cache read", numeric: true, render: (e) => fmtTokens(e.cacheRead) },
  { key: "cost", label: "Cost", numeric: true, render: (e) => fmtCost(e.cost) },
];

export function ModelsView() {
  const snap = useSnapshot();
  const filter = useFilter();
  const [groupBy, setGroupBy] = useState<GroupBy>("model");
  const [sort, setSort] = useState<{ key: keyof Entry; desc: boolean }>({
    key: "cost",
    desc: true,
  });
  const report = useReport(groupBy, snap.ready);

  // A drill-down explains one row by reading the corpus one Group-By finer and
  // keeping the parts that carry the row's key — free, since that finer report
  // is one cached call, and exact rather than approximate
  // (`a_finer_group_by_decomposes_a_coarser_entry_exactly`). Only `model` and
  // `client,model` have hidden composition; the other three have no finer axis
  // P1 exposes, so their rows do not open.
  const [drill, setDrill] = useState<Entry | null>(null);
  const drillable = drillMatch(groupBy, null) !== null;
  const detail = useRowDetail(drill, groupBy, snap.ready);

  // Sorting is client-side: every Group-By yields 38-198 Entries, so there is
  // nothing here worth a round trip or a virtualized list.
  const rows = useMemo(() => {
    const out = [...(report.data?.entries ?? [])];
    out.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const cmp =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x ?? "").localeCompare(String(y ?? ""));
      return sort.desc ? -cmp : cmp;
    });
    return out;
  }, [report.data, sort]);

  if (snap.gate) return snap.gate;
  if (report.data && report.data.entries.length === 0)
    return isNarrowed(filter) ? <NoMatch onClear={clearFilter} /> : <NoUsage />;

  return (
    <>
      <ViewHeader title="Models" filter={snap.rangeLabel}>
        <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <TabsList>
            {GROUP_BY.map((g) => (
              <TabsTrigger key={g.value} value={g.value}>
                {g.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </ViewHeader>

      <Tiles
        items={[
          ["Entries", report.data ? fmtInt(report.data.entries.length) : "—"],
          ["Messages", report.data ? fmtInt(report.data.totalMessages) : "—"],
          [
            "Tokens",
            report.data
              ? fmtTokens(
                  report.data.totalInput + report.data.totalOutput + report.data.totalCacheRead,
                )
              : "—",
          ],
          ["Total cost", report.data ? fmtCost(report.data.totalCost) : "—"],
        ]}
      />

      <Table className="mt-5 text-small">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLS.map((c) => {
              const active = sort.key === c.key;
              return (
                <TableHead
                  key={c.key}
                  className={`h-[26px] text-micro font-normal ${c.numeric ? "text-right" : ""}`}
                >
                  <button
                    className={`transition-colors duration-150 ease-out hover:text-foreground ${
                      active ? "text-foreground" : ""
                    }`}
                    onClick={() =>
                      setSort((s) =>
                        s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true },
                      )
                    }
                  >
                    {c.label}
                    <span className="ml-1 inline-block w-2 text-primary">
                      {active ? (sort.desc ? "↓" : "↑") : ""}
                    </span>
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.isPending ? (
            <RowSkeleton cols={COLS.length} />
          ) : (
            rows.map((e, i) => (
              <TableRow
                key={`${e.model}-${e.client}-${e.sessionId ?? i}`}
                onClick={drillable ? () => setDrill(e) : undefined}
                className={`h-row border-border/50 ${drillable ? "cursor-pointer" : ""}`}
              >
                {COLS.map((c, col) => (
                  <TableCell
                    key={c.key}
                    className={`py-0 ${
                      c.numeric ? "tnum text-right font-mono" : ""
                    } ${c.numeric && c.key !== "cost" ? "text-muted-foreground" : ""}`}
                  >
                    {/* Same shape as Daily: the whole row takes the click, the
                        first cell carries the control the keyboard can reach and
                        a screen reader can name. A Group-By with no finer axis
                        does not drill, so it gets no button either. */}
                    {col === 0 && drillable ? (
                      <button
                        className="text-left"
                        aria-label={`${e.model}, breakdown`}
                        onClick={() => setDrill(e)}
                      >
                        {c.render(e)}
                      </button>
                    ) : (
                      c.render(e)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
        {report.data && (
          <TableFooter className="bg-transparent">
            <TableRow className="h-row border-border">
              <TableCell className="py-0 font-medium">Total</TableCell>
              <TableCell className="py-0" colSpan={COLS.length - 2} />
              <TableCell className="tnum py-0 text-right font-mono font-semibold">
                {fmtCost(report.data.totalCost)}
              </TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {drill && (
        <DetailDialog
          title={groupBy === "model" ? drill.model : `${drill.client} · ${drill.model}`}
          aside={fmtCost(drill.cost)}
          entries={detail.entries}
          pending={detail.isPending}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}
