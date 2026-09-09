import { useRef, useState } from "react";
import type { Day } from "@/lib/api";
import { calendarYear, monthColumns, stepTo, weeksOf, yearsOf } from "@/lib/calendar";
import { fmtCost, fmtTokens } from "@/lib/format";

/** The Contribution Graph, hand-rolled per the map's standing decision to keep
 *  it out of TanStack Charts' alpha churn — but in HTML rather than SVG.
 *
 *  #29 needs every cell focusable, individually named and activatable by
 *  keyboard. A `<button>` in a CSS grid is all four for free: tab order, focus
 *  ring, accessible name and Enter/Space activation are the platform's, not
 *  ours. An SVG `<rect>` gives none of them, and `<title>` is pointer-only.
 *  Bucketing is not this file's business: #25 settled it in `ramp_level` and
 *  this only reads `d.level`.
 *
 *  The Ramp is `--ramp-1` .. `--ramp-5`; a day with no usage is not a step and
 *  wears `--ramp-0`, which is reachable only because `calendarYear` fills the
 *  gaps `graph_report` does not send.
 */

/** One cell size, everywhere. Overview and Stats drew 10/2/1 and 13/3/2 before
 *  this ticket, which put the same day at two sizes one click apart.
 *
 *  10 is what the minimum window width affords, and the budget is exactly spent.
 *  The content column at the 880px minimum is 880 - 180 sidebar - 48 gutters =
 *  652px. A bounded year is at most 54 columns — `weeksOf` is 54 only for a leap
 *  year starting on a Saturday, 2028 being the next — so the widest year a
 *  corpus can hold is 54 * 10 + 53 * 2 = 646px of grid plus 2 * `RING` for the
 *  focus ring: 652px, the content column to the pixel. 13 overruns it by 40%.
 *
 *  There is no slack left, so the ring is counted here rather than discovered
 *  later: anything that adds width to this block — a wider ring, a weekday
 *  gutter, a non-overlay scrollbar — puts a 54-column year into the callers'
 *  `overflow-x-auto`. That is the panel scrolling, not the page, which is what
 *  the wrapper is for; but it is a regression against this line, not a spare
 *  6px to spend. */
const CELL = 10;
const GAP = 2;
const RADIUS = 1;

/** The grid's height, and the callers' `min-height`. Derived, because it was
 *  hand-computed into two Tailwind arbitrary values that could drift from the
 *  cell size independently of it. */
const GRID_HEIGHT = 7 * (CELL + GAP) - GAP;
const LABELS_HEIGHT = 14;

/** Room around the grid for a focus ring. The callers clip: both wrap the graph
 *  in `overflow-x-auto`, which computes `overflow-y` to `auto` as well, so a
 *  ring on the top row or the last column is cut off without this. */
const RING = 3;
export const GRAPH_HEIGHT = LABELS_HEIGHT + GAP + GRID_HEIGHT + 2 * RING;

export function ContributionGraph({
  days,
  pending = false,
  onSelect,
}: {
  days: Day[];
  /** Draw the grid empty instead of drawing nothing, for the first graph call
   *  (#32). Callers with no pending state to show leave this off and still get
   *  `null`. */
  pending?: boolean;
  /** Open what a day was made of. Same contract as a Daily row: the breakdown's
   *  total equals the figure on the cell it opened from. */
  onSelect?: (date: string) => void;
}) {
  const years = yearsOf(days);
  // Newest year first-shown, and held only while it still exists: a Report
  // Filter edit can drop the year the user was on, and a `useEffect` to correct
  // that would render the wrong year once before fixing it.
  //
  // With no days at all — the pending state — it falls back to the current year.
  // #32 could claim no column count because the old grid's width came from the
  // data; a bounded year makes it knowable, and the year the data will land on
  // is the current one unless the corpus stops short of it. When it does, and
  // the two years differ in width, the grid shifts by one column: `weeksOf` is
  // 53 or 54 and never anything else, so that is the whole error.
  const [picked, setPicked] = useState<string | null>(null);
  const year =
    picked && years.includes(picked) ? picked : (years.at(-1) ?? String(new Date().getFullYear()));

  if (days.length === 0 && !pending) return null;

  return (
    <div>
      {years.length > 1 && (
        <div className="mb-2 flex items-center gap-1" role="group" aria-label="Graph year">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setPicked(y)}
              aria-pressed={y === year}
              className={`rounded-[3px] px-1.5 py-0.5 font-mono text-micro transition-colors duration-150 ease-out ${
                y === year
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}
      <Year key={year} year={year} days={days} pending={pending} onSelect={onSelect} />
    </div>
  );
}

/** One bounded year: Jan 1 to Dec 31, absence included.
 *
 *  Keyed on the year so the roving focus index resets with the grid rather than
 *  pointing at a day the new year does not have. */
function Year({
  year,
  days,
  pending,
  onSelect,
}: {
  year: string;
  days: Day[];
  pending: boolean;
  onSelect?: (date: string) => void;
}) {
  const weeks = weeksOf(year);
  const cells = calendarYear(year, days);
  const lead = new Date(`${year}-01-01T00:00:00Z`).getUTCDay();
  const active = cells.filter((d) => d.level > 0).length;

  // A roving tabindex, not 365 tab stops. One Tab reaches the graph; the arrows
  // walk it the way it is drawn — down and up are the next and previous day,
  // right and left are the next and previous week, because the grid runs in
  // columns of seven.
  const grid = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Where focus *is*, read off the cell the key came from, rather than the
    // index in state: state is a render behind, so two keys pressed inside one
    // frame would both step from the same cell.
    const i = stepTo(Number((e.target as HTMLElement).dataset.i), e.key, cells.length);
    if (i === null) return;
    e.preventDefault();
    setFocus(i);
    grid.current?.querySelectorAll("button")[i]?.focus();
  };

  const columns = { gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`, columnGap: GAP };

  return (
    <div style={{ width: weeks * (CELL + GAP) - GAP + 2 * RING, padding: RING }}>
      {/* Month labels. A year of squares with nothing to read a date off fits at
          the minimum width without being legible at it. */}
      <div
        aria-hidden
        className="grid text-micro text-muted-foreground"
        style={{ ...columns, height: LABELS_HEIGHT }}
      >
        {monthColumns(year).map(({ month, start, span }) => (
          <span key={month} style={{ gridColumn: `${start} / span ${span}` }}>
            {month}
          </span>
        ))}
      </div>

      <div
        ref={grid}
        onKeyDown={onKeyDown}
        role="group"
        aria-label={
          pending ? "Contribution graph, loading" : `Contribution graph, ${year}, ${active} active days`
        }
        aria-busy={pending || undefined}
        className={`grid grid-flow-col ${pending ? "motion-safe:animate-pulse" : ""}`}
        style={{
          ...columns,
          gridTemplateRows: `repeat(7, ${CELL}px)`,
          rowGap: GAP,
          marginTop: GAP,
        }}
      >
        {cells.map((d, i) => {
          // Auto-placement fills the rest of the column from wherever the first
          // cell lands, so only January 1st's weekday is placed.
          const style = {
            ...(i === 0 ? { gridRowStart: lead + 1 } : null),
            background: `var(--ramp-${d.level})`,
            borderRadius: RADIUS,
          };

          // Pending draws the shape and says nothing else. These are not days:
          // the graph call has not returned, so naming 365 cells "no usage"
          // would read a fabricated year of absence to a screen reader as data,
          // and make each one a focus target. `aria-busy` on the container
          // removes nothing from the tree, so the cells have to.
          if (pending) return <div key={d.date} aria-hidden style={style} />;

          return (
            <button
              key={d.date}
              type="button"
              style={style}
              className="h-full w-full outline-primary outline-offset-1 focus-visible:outline-2"
              data-i={i}
              tabIndex={i === focus ? 0 : -1}
              onFocus={() => setFocus(i)}
              // Absence has nothing to break down, so it reads and does not open.
              onClick={d.level > 0 ? () => onSelect?.(d.date) : undefined}
              aria-label={label(d)}
              title={label(d)}
              aria-disabled={d.level === 0 || undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A cell's whole content, since it has no text: hover and focus read the same
 *  thing, and absence says so in words rather than only in lightness. */
const label = (d: Day) =>
  d.level === 0 ? `${d.date}, no usage` : `${d.date}, ${fmtCost(d.cost)}, ${fmtTokens(d.tokens)}`;

/** The Ramp legend: five steps, shown after absence at the "less" end without
 *  absence being counted as a step. */
export function RampLegend() {
  return (
    <span className="inline-flex items-center" style={{ gap: GAP }}>
      {[0, 1, 2, 3, 4, 5].map((l) => (
        <span
          key={l}
          style={{
            width: CELL,
            height: CELL,
            borderRadius: RADIUS,
            background: `var(--ramp-${l})`,
          }}
        />
      ))}
    </span>
  );
}
