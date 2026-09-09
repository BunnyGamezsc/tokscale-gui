import { test, expect } from "vitest";
import { graphState, PENDING_DELAY_MS } from "@/lib/graph-pending";

test("a settled query renders its data", () => {
  expect(graphState({ hasData: true, isFetching: false }, true)).toBe("ready");
  expect(graphState({ hasData: false, isFetching: false }, true)).toBe("ready");
});

test("a re-run shorter than the delay is never admitted to", () => {
  // The ~30 ms a Report Filter change costs: it lands before the delay does, so
  // the grid on screen is neither dimmed nor unmounted, and nothing strobes.
  expect(graphState({ hasData: true, isFetching: true }, false)).toBe("ready");
});

test("past the delay, data on screen is kept rather than replaced", () => {
  expect(graphState({ hasData: true, isFetching: true }, true)).toBe("replacing");
});

test("the first call shows the grid's shape at once, delay or not", () => {
  // Delaying this one would paint an empty panel and *then* the shape: two pops
  // where the ticket asks for none. There is no short wait to protect here —
  // having no data at all only happens on the first call, which is the slow one.
  expect(graphState({ hasData: false, isFetching: true }, false)).toBe("waiting");
  expect(graphState({ hasData: false, isFetching: true }, true)).toBe("waiting");
});

test("the delay sits between a Filter change and a first visit", () => {
  // #26's narrowed graph call and the low end of #27's band for the first call
  // after a Scan. Anything inside these bounds satisfies both halves of the
  // ticket: a Filter edit paints nothing, a first visit paints something.
  expect(PENDING_DELAY_MS).toBeGreaterThan(36);
  expect(PENDING_DELAY_MS).toBeLessThan(280);
});
