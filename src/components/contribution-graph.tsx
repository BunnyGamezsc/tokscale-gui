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
  cell = 10,
  gap = 2,
  radius = 1,
}: {
  days: Day[];
  cell?: number;
  gap?: number;
  radius?: number;
}) {
  if (days.length === 0) return null;

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
            key={d.date}
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
