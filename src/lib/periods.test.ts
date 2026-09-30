import { expect, test } from "vitest";
import { rollupPeriods } from "./periods";
import type { DailyTotal } from "./api";
const day = (date: string, cost: number): DailyTotal => ({ date, cost, tokens: 100, messageCount: 1, costIsComplete: true });

test("weeks and months preserve totals including year-crossing weeks", () => {
  const days = [day("2026-12-31", 10), day("2027-01-01", 20), day("2027-01-10", 5)];
  for (const period of ["week", "month"] as const) {
    const rows = rollupPeriods(days, period, "2027-02-01");
    expect(rows.reduce((s, r) => s + r.cost, 0)).toBe(35);
    expect(rows.reduce((s, r) => s + r.tokens, 0)).toBe(300);
  }
  const year = rollupPeriods(days, "week", "2027-02-01", {}, "2027");
  expect(year.reduce((s, r) => s + r.cost, 0)).toBe(25);
  expect(year[0].partial).toBe(true);
});

test("fills idle periods and compares to the previous calendar period", () => {
  const rows = rollupPeriods([day("2026-01-01", 10), day("2026-03-01", 30)], "month", "2026-04-01");
  expect(rows.map((r) => r.cost)).toEqual([10, 0, 30]);
  expect(rows[0].delta).toBeNull();
  expect(rows[1].delta).toBe(-10);
  expect(rows[2].previousCost).toBe(0);
  expect(rows[2].delta).toBe(30);
});

test("marks current and range-clipped periods; unpriced baseline isn't comparable", () => {
  const rows = rollupPeriods([{ ...day("2026-08-01", 10), costIsComplete: false }, day("2026-09-01", 5)], "month", "2026-09-15");
  expect(rows[0].costIsComplete).toBe(false);
  expect(rows[1].partial).toBe(true);
  expect(rows[1].delta).toBeNull();
  expect(rollupPeriods([day("2026-09-15", 5)], "month", "2026-10-01", { since: "2026-09-15", until: "2026-09-20" })[0].partial).toBe(true);
  expect(rollupPeriods([], "week", "2026-09-15")).toEqual([]);
});
