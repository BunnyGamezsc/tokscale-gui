import { test, expect } from "vitest";
import { longestStreak } from "@/lib/streak";

test("no days and no usage are both zero", () => {
  expect(longestStreak([])).toBe(0);
  expect(longestStreak([0, 0, 0])).toBe(0);
});

test("the longest run wins, not the last one", () => {
  expect(longestStreak([1, 1, 1, 0, 1])).toBe(3);
  expect(longestStreak([0, 2, 3, 0, 4, 4, 4, 4])).toBe(4);
  expect(longestStreak([1, 1])).toBe(2);
});
