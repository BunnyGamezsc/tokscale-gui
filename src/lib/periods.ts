import type { DailyTotal, Filter } from "./api";
import { dayKey, periodBounds } from "./spending";

export interface PeriodTotal {
  start: string;
  end: string;
  cost: number;
  tokens: number;
  messageCount: number;
  costIsComplete: boolean;
  partial: boolean;
  previousCost: number | null;
  delta: number | null;
}

function previousStart(start: string, period: "week" | "month") {
  const d = new Date(`${start}T00:00:00Z`);
  if (period === "week") d.setUTCDate(d.getUTCDate() - 7);
  else d.setUTCMonth(d.getUTCMonth() - 1);
  return dayKey(d);
}

function nextStart(start: string, period: "week" | "month") {
  const d = new Date(`${start}T00:00:00Z`);
  if (period === "week") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return dayKey(d);
}

/** Additive recorded totals. Zero periods between observations are real rows;
 *  a missing earlier period is unknown, not a fabricated zero baseline. */
export function rollupPeriods(days: DailyTotal[], period: "week" | "month", today: string, filter: Filter = {}, year?: string): PeriodTotal[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const selected = year ? sorted.filter((d) => d.date.startsWith(`${year}-`)) : sorted;
  if (!selected.length) return [];
  const totals = new Map<string, PeriodTotal>();
  const first = periodBounds(selected[0].date, period).start;
  const last = periodBounds(selected.at(-1)!.date, period).start;
  for (let start = first; start <= last; start = nextStart(start, period)) {
    const { end } = periodBounds(start, period);
    totals.set(start, { start, end, cost: 0, tokens: 0, messageCount: 0, costIsComplete: true, partial: start < sorted[0].date || end > today || !!(filter.since && start < filter.since) || !!(filter.until && end > filter.until) || !!(year && (start < `${year}-01-01` || end > `${year}-12-31`)), previousCost: null, delta: null });
  }
  for (const day of selected) {
    const total = totals.get(periodBounds(day.date, period).start)!;
    total.cost += day.cost;
    total.tokens += day.tokens;
    total.messageCount += day.messageCount;
    total.costIsComplete &&= day.costIsComplete;
  }
  const fullCosts = new Map<string, { cost: number; complete: boolean }>();
  for (const day of sorted) {
    const start = periodBounds(day.date, period).start;
    const total = fullCosts.get(start) ?? { cost: 0, complete: true };
    total.cost += day.cost;
    total.complete &&= day.costIsComplete;
    fullCosts.set(start, total);
  }
  for (const total of totals.values()) {
    const prior = previousStart(total.start, period);
    const end = periodBounds(prior, period).end;
    const comparable = prior >= sorted[0].date && end <= today && (!filter.since || prior >= filter.since) && (!filter.until || end <= filter.until);
    if (comparable && (fullCosts.get(prior)?.complete ?? true) && total.costIsComplete) {
      total.previousCost = fullCosts.get(prior)?.cost ?? 0;
      total.delta = total.cost - total.previousCost;
    }
  }
  return [...totals.values()];
}
