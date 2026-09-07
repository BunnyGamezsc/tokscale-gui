import type { ReactNode } from "react";

/** Shared view furniture in the Ruled register: hairlines separate, nothing
 *  fills, and the view title sits on one line with its Report Filter. */

export function ViewHeader({
  title,
  filter,
  children,
}: {
  title: string;
  filter?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border pb-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-title font-semibold tracking-[-0.01em]">{title}</h1>
        {filter && <span className="font-mono text-small text-muted-foreground">{filter}</span>}
      </div>
      {children && <div className="flex items-center gap-1.5">{children}</div>}
    </header>
  );
}

/** Summary figures across the top. Four is the most that stays readable at the
 *  minimum window width. */
export function Tiles({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <div className="flex border-b border-border">
      {items.map(([label, value], i) => (
        <div
          key={label}
          className={`flex-1 py-2.5 pr-4 ${i > 0 ? "border-l border-border/50 pl-4" : ""}`}
        >
          <div className="text-micro text-muted-foreground">{label}</div>
          <div className="tnum mt-1 font-mono text-figure font-medium">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function SectionHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-2">
      <h2 className="text-micro text-muted-foreground">{title}</h2>
      {aside && <span className="font-mono text-small text-muted-foreground">{aside}</span>}
    </div>
  );
}
