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
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

type Slot = { date: string; tokens: number; messageCount: number; cost: number };

/** Hourly's and Minutely's table: one row per `(date, slot)`, newest first.
 *  A `null` slot is untimed usage, labelled and muted. */
export function SlotTable<S extends Slot>({
  unit,
  slots,
  slot,
  label,
  waiting,
  totals,
}: {
  unit: string;
  slots: S[];
  slot: (s: S) => number | null;
  label: (n: number | null) => string;
  waiting: boolean;
  totals?: { totalMessages: number; totalCost: number };
}) {
  const busiest = slots.reduce((max, s) => Math.max(max, s.cost), 0);
  return (
    <Table className="mt-5 text-small">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-[26px] text-micro font-normal">Date</TableHead>
          <TableHead className="h-[26px] text-micro font-normal">{unit}</TableHead>
          <TableHead className="h-[26px] text-right text-micro font-normal">Messages</TableHead>
          <TableHead className="h-[26px] text-right text-micro font-normal">Tokens</TableHead>
          <TableHead className="h-[26px] text-right text-micro font-normal">Cost</TableHead>
          <TableHead className="h-[26px] pl-6 text-micro font-normal">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {waiting ? (
          <RowSkeleton cols={6} />
        ) : (
          slots.map((s) => (
            <TableRow key={`${s.date}-${slot(s)}`} className="h-row border-border/50">
              <TableCell className="py-0 font-mono">{s.date}</TableCell>
              <TableCell className={`py-0 font-mono ${slot(s) === null ? "text-muted-foreground" : ""}`}>
                {label(slot(s))}
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
      {totals && (
        <TableFooter className="bg-transparent">
          <TableRow className="h-row border-border">
            <TableCell className="py-0 font-medium">Total</TableCell>
            <TableCell className="py-0" />
            <TableCell className="tnum py-0 text-right font-mono">{fmtInt(totals.totalMessages)}</TableCell>
            <TableCell className="py-0" />
            <TableCell className="tnum py-0 text-right font-mono font-semibold">
              {fmtCost(totals.totalCost)}
            </TableCell>
            <TableCell className="py-0" />
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
