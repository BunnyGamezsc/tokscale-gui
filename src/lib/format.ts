/** Display formatting. Figures are always rendered with `tnum` so they do not
 *  shift width as they tick. */

export const fmtCost = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export const fmtInt = (n: number) => n.toLocaleString("en-US");

export const fmtTokens = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : fmtInt(n);

/** Cost Source rides on the figure's own color rather than a badge: a displayed
 *  cost is only as trustworthy as its provenance (CONTEXT.md). A Reported cost is
 *  plain, an Estimated one is warm, an Unknown one recedes. */
export function costClass(source: "ProviderReported" | "Estimated" | "Unknown") {
  return source === "Estimated"
    ? "text-cost-estimated"
    : source === "Unknown"
      ? "text-cost-unknown"
      : "";
}
