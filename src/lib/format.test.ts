import { test, expect } from "vitest";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

test("costs always carry two decimals", () => {
  expect(fmtCost(0)).toBe("$0.00");
  expect(fmtCost(1234.5)).toBe("$1,234.50");
  expect(fmtCost(0.004)).toBe("$0.00");
});

test("integers are grouped", () => {
  expect(fmtInt(0)).toBe("0");
  expect(fmtInt(1234567)).toBe("1,234,567");
});

test("token units change at a million and a billion", () => {
  expect(fmtTokens(999_999)).toBe("999,999");
  expect(fmtTokens(1e6)).toBe("1.0M");
  expect(fmtTokens(999_999_999)).toBe("1000.0M");
  expect(fmtTokens(1e9)).toBe("1.00B");
  expect(fmtTokens(2_500_000_000)).toBe("2.50B");
});
