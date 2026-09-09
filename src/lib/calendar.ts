import type { Day } from "./api";

/** The calendar behind the Contribution Graph.
 *
 *  `graph_report` returns the days that had messages and nothing else: core's
 *  `DailyFold` is a HashMap keyed on those dates and `finish()` maps only the
 *  entries it holds, so a 210-day corpus with 71 active days arrives as 71
 *  entries with no gaps in between. Laying that out at index `i` draws a grid
 *  whose columns are not weeks and whose adjacent cells are not adjacent days.
 *
 *  So the calendar is reconstructed here, on the way into the grid, rather than
 *  in the command layer: it is arithmetic over a date string, the backend has
 *  nothing to add to it, and up here it is a pure function this repo's test
 *  runner can hold (#24). The commands keep returning what actually happened.
 *
 *  Dates are `YYYY-MM-DD` already bucketed by core in the Bucket Timezone, so
 *  everything here is UTC arithmetic over that label and never a local-time
 *  reading of a timestamp.
 */

const utc = (date: string) => new Date(date + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Every day from `from` to `to` inclusive, carrying usage where there was any
 *  and absence where there was none.
 *
 *  A day this adds is `level` 0 — absence, which is not a Ramp step. That is the
 *  only way `--ramp-0` becomes reachable from data: the backend never sends a
 *  zero day, because a day with no messages is not in the fold at all. */
export function fillDays(days: Day[], from: string, to: string): Day[] {
  const usage = new Map(days.map((d) => [d.date, d]));
  const out: Day[] = [];
  const end = utc(to);
  for (const cur = utc(from); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const date = iso(cur);
    out.push(usage.get(date) ?? { date, level: 0, cost: 0, tokens: 0 });
  }
  return out;
}

/** The corpus laid back onto its own calendar, first active day to last.
 *
 *  What `longestStreak` has to be counted over: a run through `graph_report`'s
 *  array calls two active days a fortnight apart consecutive, because the days
 *  in between were never in it. */
export const calendarSpan = (days: Day[]) =>
  days.length === 0 ? [] : fillDays(days, days[0].date, days[days.length - 1].date);

/** A year, bounded explicitly: January 1st to December 31st.
 *
 *  The alternative bound is a trailing 52 weeks, which is what upstream's own
 *  graph draws. A calendar year wins here because it is the bound core already
 *  uses — `calculate_years` buckets on `&date[0..4]` — and because a fixed bound
 *  makes the grid's width a constant, which is what lets the pending state draw
 *  the true shape before the data lands and lets one cell size be checked
 *  against the window's minimum width once. */
export const calendarYear = (year: string, days: Day[]) =>
  fillDays(days, `${year}-01-01`, `${year}-12-31`);

/** The calendar years a corpus touches, ascending. The year picker's options:
 *  without one, a corpus spanning more than one year has its older years drawn
 *  off the end of a single strip and no way to reach them. */
export const yearsOf = (days: Day[]) => [...new Set(days.map((d) => d.date.slice(0, 4)))].sort();

/** Which grid column a day of the year falls in, 1-based. Column 1 is the week
 *  January 1st sits in, so it is short by that day's weekday. */
const columnOf = (lead: number, dayOfYear: number) => Math.floor((lead + dayOfYear) / 7) + 1;

const jan1 = (year: string) => utc(`${year}-01-01`);
const lengthOf = (year: string) =>
  Math.round((jan1(String(Number(year) + 1)).getTime() - jan1(year).getTime()) / 86_400_000);

/** Columns a year occupies: 53, or 54 when a long lead meets a leap year. */
export const weeksOf = (year: string) =>
  Math.ceil((jan1(year).getUTCDay() + lengthOf(year)) / 7);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Where each month's label goes above the grid. Without these a year of cells
 *  is 365 squares with nothing to read a date off, which is the difference
 *  between the grid fitting at the minimum width and being legible there. */
export function monthColumns(year: string) {
  const lead = jan1(year).getUTCDay();
  const starts = MONTHS.map((_, m) =>
    columnOf(lead, Math.round((Date.UTC(Number(year), m, 1) - jan1(year).getTime()) / 86_400_000)),
  );
  return MONTHS.map((month, m) => ({
    month,
    start: starts[m],
    span: (starts[m + 1] ?? weeksOf(year) + 1) - starts[m],
  }));
}

/** Where a key press moves focus in the grid, or `null` if it moves nothing.
 *
 *  The grid runs in columns of seven, so down and up are the next and previous
 *  *day* and right and left are the next and previous *week*. Pure and here
 *  rather than in the component because it is #29's headline interaction and
 *  this repo's runner tests pure functions only (#24).
 */
export function stepTo(from: number, key: string, length: number): number | null {
  const by: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7 };
  const to =
    key in by ? from + by[key] : key === "Home" ? 0 : key === "End" ? length - 1 : null;
  if (to === null || Number.isNaN(from)) return null;
  // Clamped, not wrapped: the year is bounded, so its edges are too.
  return Math.min(Math.max(to, 0), length - 1);
}
