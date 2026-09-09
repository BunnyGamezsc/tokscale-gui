import { useId } from "react";
import type { Day } from "@/lib/api";

/** The Contribution Graph, hand-rolled in SVG per the map's standing decision to
 *  keep it out of TanStack Charts' alpha churn. Roadmap item 3 owns the
 *  remaining rendering and interaction questions — cell sizing, year bounding
 *  and hover. Bucketing is not one of them: #25 settled it in `ramp_level`, and
 *  this component only reads `d.level`.
 *
 *  The Ramp comes from `--ramp-1` .. `--ramp-5`; a day with no usage is not a
 *  step and uses `--ramp-0`. */
export function ContributionGraph({
  days,
  pending = false,
  cell = 10,
  gap = 2,
  radius = 1,
}: {
  days: Day[];
  /** Draw the grid empty instead of drawing nothing, for the first graph call
   *  (#32). Callers with no pending state to show leave this off and still get
   *  `null`. */
  pending?: boolean;
  cell?: number;
  gap?: number;
  radius?: number;
}) {
  if (days.length === 0) return pending ? <PendingGraph {...{ cell, gap, radius }} /> : null;

  const step = cell + gap;
  const lead = new Date(days[0].date + "T00:00:00Z").getUTCDay();
  const weeks = Math.ceil((lead + days.length) / 7);
  const width = weeks * step - gap;
  const height = 7 * step - gap;
  const active = days.filter((d) => d.level > 0).length;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Contribution graph, ${active} active days`}
    >
      {days.map((d, i) => {
        const n = lead + i;
        return (
          <rect
            key={d?.date ?? i}
            x={Math.floor(n / 7) * step}
            y={(n % 7) * step}
            width={cell}
            height={cell}
            rx={radius}
            fill={`var(--ramp-${d.level})`}
          >
            <title>
              {d.date} — {d.level === 0 ? "no usage" : `$${d.cost.toFixed(2)}`}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

/** The grid before its data, for the ~340 ms of the first `graph_report` call.
 *
 *  What is knowable in advance is the cell geometry and the seven-row height —
 *  not the column count, because `graph_report` returns the *active* days rather
 *  than the calendar range, so a 210-day corpus can be eleven columns or thirty.
 *  Guessing one and collapsing to the real width when the data lands would be a
 *  second pop, and inside the callers' `overflow-x-auto` it would raise a
 *  horizontal scrollbar that then vanished.
 *
 *  So this claims no width: an SVG `<pattern>` tiles the real cell over whatever
 *  the panel is, at the exact height the grid will occupy. The shape is honest
 *  and nothing below it moves when the days arrive. */
function PendingGraph({ cell, gap, radius }: { cell: number; gap: number; radius: number }) {
  const id = useId();
  const step = cell + gap;
  const height = 7 * step - gap;

  return (
    <svg
      width="100%"
      height={height}
      role="img"
      aria-label="Contribution graph, loading"
      aria-busy="true"
      className="motion-safe:animate-pulse"
    >
      <defs>
        <pattern id={id} width={step} height={step} patternUnits="userSpaceOnUse">
          <rect width={cell} height={cell} rx={radius} fill="var(--ramp-0)" />
        </pattern>
      </defs>
      <rect width="100%" height={height} fill={`url(#${id})`} />
    </svg>
  );
}

/** The Ramp legend: five steps, shown after absence at the "less" end without
 *  absence being counted as a step. */
export function RampLegend({ cell = 10, gap = 2, radius = 1 }) {
  return (
    <span className="inline-flex items-center" style={{ gap }}>
      {[0, 1, 2, 3, 4, 5].map((l) => (
        <span
          key={l}
          style={{
            width: cell,
            height: cell,
            borderRadius: radius,
            background: `var(--ramp-${l})`,
          }}
        />
      ))}
    </span>
  );
}
