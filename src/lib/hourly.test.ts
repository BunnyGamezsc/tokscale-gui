import { test, expect } from "vitest";
import { hourLabel, profile } from "@/lib/hourly";
import type { HourSlot } from "@/lib/api";

const slot = (date: string, hour: number | null, cost: number, messageCount = 1): HourSlot => ({
  date,
  hour,
  tokens: messageCount * 100,
  messageCount,
  cost,
});

test("the profile folds every day's hour onto one of 24", () => {
  const p = profile([
    slot("2026-08-01", 23, 2),
    slot("2026-08-02", 0, 4),
    slot("2026-08-02", 23, 8, 3),
  ]);
  expect(p.hours).toHaveLength(24);
  expect(p.hours[23]).toEqual({ hour: 23, cost: 10, tokens: 400, messages: 4 });
  expect(p.hours[0].cost).toBe(4);
  expect(p.hours[12]).toEqual({ hour: 12, cost: 0, tokens: 0, messages: 0 });
});

test("untimed usage stays out of the profile and is counted beside it, not at midnight", () => {
  const p = profile([slot("2026-08-02", null, 16, 5), slot("2026-08-02", 0, 4)]);
  expect(p.hours[0].cost).toBe(4);
  expect(p.untimed).toBe(5);
  expect(p.hours.reduce((sum, h) => sum + h.messages, 0)).toBe(1);
});

test("an hour reads as a clock time, and no hour reads as untimed", () => {
  expect(hourLabel(0)).toBe("00:00");
  expect(hourLabel(14)).toBe("14:00");
  expect(hourLabel(null)).toBe("untimed");
});
