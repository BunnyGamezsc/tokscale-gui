import { test, expect } from "vitest";
import { intervalFromMinutes, MAX_REFRESH_MS, MIN_REFRESH_MS } from "@/lib/settings";

test("an interval is clamped to the bounds a Scan can afford", () => {
  expect(intervalFromMinutes(5, 0)).toBe(300_000);
  expect(intervalFromMinutes(0.1, 0)).toBe(MIN_REFRESH_MS);
  expect(intervalFromMinutes(600, 0)).toBe(MAX_REFRESH_MS);
});

test("an empty or junk field keeps the current interval", () => {
  expect(intervalFromMinutes(Number.NaN, 120_000)).toBe(120_000);
});
