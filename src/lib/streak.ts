/** Longest run of consecutive days carrying usage. */
export function longestStreak(levels: number[]) {
  let best = 0;
  let run = 0;
  for (const l of levels) {
    run = l > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}
