import { expect, test } from "vitest";
import { resetLabel, span } from "./quota";

test("span drops a zero remainder and steps up at an hour and a day", () => {
  expect(span(42 * 60_000)).toBe("42m");
  expect(span(3 * 3_600_000)).toBe("3h");
  expect(span(3 * 3_600_000 + 5 * 60_000)).toBe("3h 5m");
  expect(span(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
});

test("a reset in the past is now, and one that isn't a date shows as sent", () => {
  const now = Date.parse("2026-09-13T12:00:00Z");
  expect(resetLabel("2026-09-13T12:30:00Z", now)).toBe("resets in 30m");
  expect(resetLabel("2026-09-13T11:00:00Z", now)).toBe("resets now");
  expect(resetLabel("next billing cycle", now)).toBe("next billing cycle");
});
