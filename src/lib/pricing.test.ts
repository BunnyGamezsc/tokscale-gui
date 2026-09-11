import { test, expect } from "vitest";
import { toDraft, toRates, invalid, type Draft } from "@/lib/pricing";

const draft = (over: Partial<Draft> = {}): Draft => ({
  input: "",
  output: "",
  cacheRead: "",
  cacheWrite: "",
  ...over,
});

test("an absent rate is a blank field, and zero survives the round trip", () => {
  expect(toDraft(undefined)).toEqual(draft());
  expect(toDraft({ input: 3, output: 0, cacheRead: null, cacheWrite: 0.3 })).toEqual(
    draft({ input: "3", output: "0", cacheWrite: "0.3" }),
  );
});

test("blank means absent, zero means free", () => {
  expect(toRates(draft())).toEqual({
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
  });
  expect(toRates(draft({ input: "0", output: " 1.5 " }))).toEqual({
    input: 0,
    output: 1.5,
    cacheRead: null,
    cacheWrite: null,
  });
});

test("blank and non-negative finite numbers are accepted", () => {
  expect(invalid(draft())).toBe(false);
  expect(invalid(draft({ input: "0", cacheWrite: "12.5" }))).toBe(false);
});

test("negative and non-finite input is rejected", () => {
  expect(invalid(draft({ input: "-1" }))).toBe(true);
  expect(invalid(draft({ input: "Infinity" }))).toBe(true);
  expect(invalid(draft({ input: "-Infinity" }))).toBe(true);
  expect(invalid(draft({ input: "1e999" }))).toBe(true);
  expect(invalid(draft({ input: "abc" }))).toBe(true);
});
