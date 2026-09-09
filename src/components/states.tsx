import { Button } from "@/components/ui/button";

/** What a Scan looks like while it runs. Discovery-first text, an elapsed timer
 *  and an ETA from the previous run — there is no percentage, because the parse
 *  reports nothing until it finishes. */
export function Scanning({
  elapsed,
  etaSeconds,
  onAbandon,
}: {
  elapsed: number;
  etaSeconds: number | null;
  onAbandon: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border py-2">
      <Spinner />
      <span className="text-small">Reading transcripts across your clients</span>
      <span className="tnum font-mono text-small text-muted-foreground">
        {elapsed}s{etaSeconds ? ` / ~${etaSeconds}s` : ""}
      </span>
      {/* Not "Cancel": a Scan cannot be interrupted. Abandoning stops the wait,
          and the Scan still finishes and warms the cache for the next one. */}
      <Button variant="outline" size="xs" className="ml-auto" onClick={onAbandon}>
        Abandon
      </Button>
    </div>
  );
}

export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      className="block shrink-0 rounded-full motion-safe:animate-spin"
      style={{
        width: size,
        height: size,
        border: "1.5px solid var(--border)",
        borderTopColor: "var(--primary)",
        animationDuration: "700ms",
      }}
    />
  );
}

/** A Scan is still running but the user stopped waiting for it. */
export function Abandoned({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Placeholder
      title="Waiting stopped"
      body="The scan is still running and will finish on its own, so the next one starts warm. Nothing was undone."
      action={<Button variant="outline" size="sm" onClick={onRefresh}>Wait for it</Button>}
    />
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Placeholder
      title="Scan failed"
      body={message}
      action={<Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    />
  );
}

/** Nothing was found. ~50 clients are scanned and most are absent on any given
 *  machine, so this is a normal outcome rather than an error. */
export function NoUsage() {
  return (
    <Placeholder
      title="No usage found"
      body="No transcripts were found for any supported client. If your tools store data somewhere non-standard, add those paths to ~/.config/tokscale/settings.json."
    />
  );
}

/** A Report Filter that matches nothing. Distinct from `NoUsage`: the corpus
 *  has usage, the question just excluded all of it, so the way out is the
 *  Filter and not `settings.json`. */
export function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <Placeholder
      title="Nothing matches the filter"
      body="The corpus has usage, but none of it survives the active Report Filter."
      action={<Button variant="outline" size="sm" onClick={onClear}>Clear the filter</Button>}
    />
  );
}

export function Placeholder({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <h2 className="text-title font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="max-w-[62ch] text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

/** Rows that are still loading. Sized to the real row height so the table does
 *  not jump when they are replaced. */
export function RowSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="h-row border-b border-border/50">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="py-0">
              <span
                className="block h-[8px] rounded-[2px] bg-muted"
                style={{ width: c === 0 ? "60%" : "40%", marginLeft: c === 0 ? 0 : "auto" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
