import { describe, expect, it } from "vitest";
import { forecast, periodBounds, crossedThresholds, limitAmount } from "./spending";

describe("local spending", () => {
  it("includes idle days in the average and excludes future data", () => {
    const pace = forecast([{ date: "2026-09-01", cost: 10, costIsComplete: true }, { date: "2026-09-30", cost: 500, costIsComplete: true }], "2026-09-10", "month", "2026-08-01");
    expect(pace.projected).toBe(30);
    expect(pace.partial).toBe(false);
  });
  it("uses Monday weeks across years and leap months", () => {
    expect(periodBounds("2027-01-01", "week")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(periodBounds("2028-02-20", "month").end).toBe("2028-02-29");
  });
  it("labels late history and unknown pricing as partial", () => {
    expect(forecast([], "2026-09-01", "month", null).partial).toBe(true);
    expect(forecast([], "2026-09-10", "month", "2026-09-05").partial).toBe(true);
    expect(forecast([{ date: "2026-09-01", cost: 5, costIsComplete: false }], "2026-09-10", "month", "2026-08-01").partial).toBe(true);
  });
  it("fires exact boundaries once and rejects invalid limits", () => {
    expect(crossedThresholds(75, 100, [50])).toEqual([75]);
    expect(crossedThresholds(101, 100)).toEqual([50, 75, 90, 100]);
    expect(crossedThresholds(100, 0)).toEqual([]);
    expect(limitAmount("Infinity")).toBeNull();
    expect(limitAmount("-1")).toBeNull();
    expect(limitAmount("50.50")).toBe(50.5);
  });
});
