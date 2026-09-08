/** Pricing draft: the string form the rate inputs hold, and its conversion to
 *  and from the `Rates` DTO. Lives here so it is testable without a DOM. */

import type * as api from "@/lib/api";

export const FIELDS = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
] as const;

export type Draft = Record<(typeof FIELDS)[number]["key"], string>;

export function toDraft(rates?: api.Rates): Draft {
  return {
    input: rates?.input != null ? String(rates.input) : "",
    output: rates?.output != null ? String(rates.output) : "",
    cacheRead: rates?.cacheRead != null ? String(rates.cacheRead) : "",
    cacheWrite: rates?.cacheWrite != null ? String(rates.cacheWrite) : "",
  };
}

/** Blank means "no rate", which is different from zero. Zero is a statement —
 *  the model is free — and core accepts it deliberately. */
export function toRates(d: Draft): api.Rates {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    input: num(d.input),
    output: num(d.output),
    cacheRead: num(d.cacheRead),
    cacheWrite: num(d.cacheWrite),
  };
}

/** A rate must be a finite number at or above zero. `Number(v) >= 0` alone lets
 *  `Infinity` through, and an infinite rate serialises to `null` in JSON. */
export function invalid(d: Draft) {
  return Object.values(d).some((v) => {
    if (v.trim() === "") return false;
    const n = Number(v);
    return !Number.isFinite(n) || n < 0;
  });
}
