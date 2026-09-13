/** A duration in the shape upstream's reset labels use: `42m`, `3h 5m`, `2d 4h`. */
export function span(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return pair(Math.floor(mins / 60), "h", mins % 60, "m");
  return pair(Math.floor(mins / 1440), "d", Math.floor((mins % 1440) / 60), "h");
}

const pair = (big: number, bigUnit: string, small: number, smallUnit: string) =>
  small ? `${big}${bigUnit} ${small}${smallUnit}` : `${big}${bigUnit}`;

/** When a quota window resets, relative to `now`. A few providers send text
 *  rather than a date, and that shows as sent. */
export function resetLabel(resetsAt: string, now: number): string {
  const at = Date.parse(resetsAt);
  if (Number.isNaN(at)) return resetsAt;
  return at <= now ? "resets now" : `resets in ${span(at - now)}`;
}
