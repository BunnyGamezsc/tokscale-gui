import { test, expect } from "vitest";
import { scanState, SETTLE_DELAY_MS, rescanNotice } from "@/lib/scan-state";

test("no Scan in flight is not a state the window explains", () => {
  expect(scanState({ hasSummary: true, isScanning: false }, true)).toBe("ready");
  expect(scanState({ hasSummary: false, isScanning: false }, true)).toBe("ready");
});

test("a first run and a refresh are told apart by the Snapshot, not a flag", () => {
  expect(scanState({ hasSummary: false, isScanning: true }, true)).toBe("first-run");
  expect(scanState({ hasSummary: true, isScanning: true }, true)).toBe("refreshing");
});

test("a refresh is admitted to at once", () => {
  // There is nothing to protect against: a Refresh forces a parse, so it is
  // never the millisecond kind, and the banner sits above data that stays put.
  expect(scanState({ hasSummary: true, isScanning: true }, false)).toBe("refreshing");
});

test("a reload that returns the held Snapshot never shows the first-run panel", () => {
  // The unforced path parses nothing, so this resolves well inside the delay.
  expect(scanState({ hasSummary: false, isScanning: true }, false)).toBe("settling");
});

test("the delay is shorter than anything a person would call a wait", () => {
  expect(SETTLE_DELAY_MS).toBeLessThan(250);
});

test("the rescan warning names a cost either way", () => {
  // The previous run when there is one, the honest range when there is not: a
  // first-run machine has no basis for a figure, and must not invent one.
  expect(rescanNotice(22)).toContain("about 22s");
  expect(rescanNotice(null)).toContain("20-40 seconds");
  // 0 is what the unforced path reports, and it is not a duration.
  expect(rescanNotice(0)).toContain("20-40 seconds");
});
