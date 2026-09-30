import type { SpendingDay } from "./api";

const DAY_MS = 86_400_000;
const date = (key: string) => new Date(`${key}T00:00:00Z`);
export const dayKey = (value: Date) => value.toISOString().slice(0, 10);

/** Calendar arithmetic uses UTC solely to avoid DST; keys are already bucketed. */
export function periodBounds(today: string, period: "week" | "month") {
  const start = date(today);
  const end = date(today);
  if (period === "month") {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  } else {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    end.setTime(start.getTime() + 6 * DAY_MS);
  }
  return { start: dayKey(start), end: dayKey(end) };
}

export function forecast(days: SpendingDay[], today: string, period: "week" | "month", firstDay: string | null) {
  const { start, end } = periodBounds(today, period);
  const elapsedDays = Math.round((date(today).getTime() - date(start).getTime()) / DAY_MS) + 1;
  const periodDays = Math.round((date(end).getTime() - date(start).getTime()) / DAY_MS) + 1;
  const observed = days.filter((d) => d.date >= start && d.date <= today);
  const spent = observed.reduce((sum, d) => sum + d.cost, 0);
  return {
    spent,
    projected: spent / elapsedDays * periodDays,
    elapsedDays,
    periodDays,
    partial: firstDay === null || firstDay > start || observed.some((d) => !d.costIsComplete),
  };
}

export const LIMIT_THRESHOLDS = [50, 75, 90, 100] as const;

export function crossedThresholds(spent: number, limit: number, fired: readonly number[] = []) {
  if (!Number.isFinite(spent) || !Number.isFinite(limit) || limit <= 0) return [];
  return LIMIT_THRESHOLDS.filter((rung) => spent >= limit * rung / 100 && !fired.includes(rung));
}

export function limitAmount(value: string): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
