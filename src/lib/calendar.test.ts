import { test, expect } from "vitest";
import {
  fillDays,
  calendarSpan,
  calendarYear,
  yearsOf,
  weeksOf,
  monthColumns,
  stepTo,
} from "@/lib/calendar";
import type { Day } from "@/lib/api";

const day = (date: string, level: Day["level"] = 3): Day => ({
  date,
  level,
  cost: 1,
  tokens: 10,
});

test("a gap between two active days becomes absent days", () => {
  const filled = fillDays([day("2026-03-01"), day("2026-03-04")], "2026-03-01", "2026-03-04");
  expect(filled.map((d) => d.date)).toEqual([
    "2026-03-01",
    "2026-03-02",
    "2026-03-03",
    "2026-03-04",
  ]);
  expect(filled.map((d) => d.level)).toEqual([3, 0, 0, 3]);
});

test("a filled day carries no cost and no tokens, not the neighbour's", () => {
  const [, gap] = fillDays([day("2026-03-01")], "2026-03-01", "2026-03-02");
  expect(gap).toEqual({ date: "2026-03-02", level: 0, cost: 0, tokens: 0 });
});

test("filling crosses a month, a year and a leap day", () => {
  expect(fillDays([], "2026-01-31", "2026-02-01").map((d) => d.date)).toEqual([
    "2026-01-31",
    "2026-02-01",
  ]);
  expect(fillDays([], "2026-12-31", "2027-01-01").map((d) => d.date)).toEqual([
    "2026-12-31",
    "2027-01-01",
  ]);
  expect(fillDays([], "2028-02-28", "2028-03-01").map((d) => d.date)).toEqual([
    "2028-02-28",
    "2028-02-29",
    "2028-03-01",
  ]);
});

test("a range that runs backwards is empty, not infinite", () => {
  expect(fillDays([day("2026-03-04")], "2026-03-04", "2026-03-01")).toEqual([]);
});

test("a year is bounded Jan 1 to Dec 31 whatever the data covers", () => {
  const year = calendarYear("2026", [day("2026-06-15")]);
  expect(year).toHaveLength(365);
  expect(year[0].date).toBe("2026-01-01");
  expect(year.at(-1)!.date).toBe("2026-12-31");
  expect(year.filter((d) => d.level > 0)).toHaveLength(1);
});

test("a leap year is 366 days and usage outside the year is dropped", () => {
  const year = calendarYear("2028", [day("2027-12-31"), day("2028-02-29"), day("2029-01-01")]);
  expect(year).toHaveLength(366);
  expect(year.filter((d) => d.level > 0).map((d) => d.date)).toEqual(["2028-02-29"]);
});

test("the years of a corpus are every year it touches, ascending", () => {
  expect(yearsOf([day("2026-02-12"), day("2024-09-09"), day("2026-09-09")])).toEqual([
    "2024",
    "2026",
  ]);
  expect(yearsOf([])).toEqual([]);
});

test("a year's grid is wide enough for its lead and never wider", () => {
  // 2026-01-01 is a Thursday: four leading blanks, 365 days, so 53 columns.
  expect(weeksOf("2026")).toBe(53);
  // 2028-01-01 is a Saturday and 2028 is a leap year: the worst case, 54.
  expect(weeksOf("2028")).toBe(54);
  for (let y = 1999; y <= 2100; y++) {
    const weeks = weeksOf(String(y));
    expect(weeks).toBeGreaterThanOrEqual(53);
    expect(weeks).toBeLessThanOrEqual(54);
  }
});

test("every month gets one label, spanning its own columns and no more", () => {
  const cols = monthColumns("2026");
  expect(cols).toHaveLength(12);
  expect(cols[0]).toEqual({ month: "Jan", start: 1, span: 5 });
  expect(cols.map((c) => c.month)).toEqual([
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ]);
  for (let i = 1; i < cols.length; i++) {
    expect(cols[i].start).toBe(cols[i - 1].start + cols[i - 1].span);
  }
  expect(cols.at(-1)!.start + cols.at(-1)!.span - 1).toBe(weeksOf("2026"));
});

test("a corpus's span runs from its first active day to its last", () => {
  const span = calendarSpan([day("2026-03-01"), day("2026-03-05")]);
  expect(span.map((d) => d.level)).toEqual([3, 0, 0, 0, 3]);
  expect(calendarSpan([])).toEqual([]);
  expect(calendarSpan([day("2026-03-01")]).map((d) => d.date)).toEqual(["2026-03-01"]);
});

test("down and up are days, right and left are weeks", () => {
  expect(stepTo(43, "ArrowDown", 365)).toBe(44);
  expect(stepTo(43, "ArrowUp", 365)).toBe(42);
  expect(stepTo(43, "ArrowRight", 365)).toBe(50);
  expect(stepTo(43, "ArrowLeft", 365)).toBe(36);
});

test("Home and End reach the year's ends, and the ends clamp", () => {
  expect(stepTo(43, "Home", 365)).toBe(0);
  expect(stepTo(43, "End", 365)).toBe(364);
  expect(stepTo(0, "ArrowUp", 365)).toBe(0);
  expect(stepTo(3, "ArrowLeft", 365)).toBe(0);
  expect(stepTo(364, "ArrowDown", 365)).toBe(364);
  expect(stepTo(360, "ArrowRight", 365)).toBe(364);
});

test("a key the grid does not own moves nothing, and neither does no focus", () => {
  expect(stepTo(43, "Enter", 365)).toBeNull();
  expect(stepTo(43, "a", 365)).toBeNull();
  expect(stepTo(43, "Tab", 365)).toBeNull();
  expect(stepTo(NaN, "ArrowDown", 365)).toBeNull();
});
