import type { HourSlot } from "./api";

export type ProfileHour = { hour: number; cost: number; tokens: number; messages: number };

/** The 24 hours of the day, summed over every day in the slots.
 *
 *  Untimed usage (`hour === null`) has no hour to go in. Core's own fold files
 *  it under 00:00, which draws a midnight spike, so it is counted beside the
 *  profile instead (#36). The table and the totals still include it. */
export function profile(slots: readonly HourSlot[]): { hours: ProfileHour[]; untimed: number } {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, cost: 0, tokens: 0, messages: 0 }));
  let untimed = 0;
  for (const s of slots) {
    if (s.hour === null) {
      untimed += s.messageCount;
      continue;
    }
    const h = hours[s.hour];
    h.cost += s.cost;
    h.tokens += s.tokens;
    h.messages += s.messageCount;
  }
  return { hours, untimed };
}

export const hourLabel = (hour: number | null) =>
  hour === null ? "untimed" : `${String(hour).padStart(2, "0")}:00`;
