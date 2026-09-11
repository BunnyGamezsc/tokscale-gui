/** Display formatting. Figures are always rendered with `tnum` so they do not
 *  shift width as they tick. */

export const fmtCost = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export const fmtInt = (n: number) => n.toLocaleString("en-US");

export const fmtTokens = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : fmtInt(n);
