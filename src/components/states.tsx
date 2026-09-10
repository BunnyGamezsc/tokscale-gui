import { Button } from "@/components/ui/button";

/** What a **Refresh** looks like while it runs: a banner, because a Snapshot is
 *  already held and the numbers on screen are still the last answer. A first run
 *  has nothing to sit above and gets `FirstRun` instead — that difference is the
 *  one ticket 28 asked for.
 *
 *  An elapsed timer and the previous run's duration, and no percentage, because
 *  the parse reports nothing until it finishes. */
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

/** A cold first run: no Snapshot, and 21-40 s before there is one.
 *
 *  Ticket 28 chose to spend the effort here rather than on progressive fill or a
 *  sink-driven count (ADR 0004), so this panel carries what the wait can honestly
 *  say: *what* is being read, how long it has taken, and how long it took last
 *  time. Naming the Clients is the part that needed a new command — `clients`
 *  reads the Snapshot and so cannot answer until the very wait this explains is
 *  over, while `client_catalog` is core's const registry.
 */
export function FirstRun({
  elapsed,
  etaSeconds,
  clients,
  onAbandon,
}: {
  elapsed: number;
  etaSeconds: number | null;
  clients: string[];
  onAbandon: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <div className="flex items-center gap-2.5">
        <Spinner />
        <h2 className="text-title font-semibold tracking-[-0.01em]">Reading your transcripts</h2>
      </div>

      <p className="max-w-[62ch] text-muted-foreground">
        This is the first scan, so every supported client is checked and its transcripts are
        parsed from scratch. Most machines have a handful; the rest are absent and are skipped.
        Later runs read a cache and are much faster.
      </p>

      <p className="tnum font-mono text-small">
        {elapsed}s
        {etaSeconds ? (
          <span className="text-muted-foreground"> / ~{etaSeconds}s last time</span>
        ) : (
          <span className="font-sans text-muted-foreground">
            {" "}
            — no previous run to estimate from; a first scan usually takes 20-40 seconds
          </span>
        )}
      </p>

      {clients.length > 0 && (
        <details className="max-w-[62ch] text-small">
          <summary className="cursor-pointer text-muted-foreground">
            Looking for {clients.length} clients
          </summary>
          <p className="mt-2 font-mono text-micro leading-relaxed text-muted-foreground">
            {clients.join(" · ")}
          </p>
        </details>
      )}

      {/* Same promise as the Abandoned screen, made before it is needed: this
          button stops the wait, not the work. */}
      <Button variant="outline" size="sm" onClick={onAbandon}>
        Abandon
      </Button>
      <p className="text-micro text-muted-foreground">
        Abandoning stops the wait. The scan finishes on its own and the next one starts warm.
      </p>
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

/** Content that a re-run is replacing, kept on screen rather than unmounted.
 *
 *  Ticket 32: a Report Filter change re-keys `graph_report`, so without this the
 *  grid would unmount and the tiles fall back to "—" for the ~30 ms the narrowed
 *  call takes. Dimming what is already there says "this answer is one question
 *  old" without the layout ever emptying, and goes inert so a click cannot open
 *  a row that is about to be replaced. Only engages once the wait outruns
 *  `PENDING_DELAY_MS` — the ~30 ms fast path is replaced before this is reached,
 *  which is the point.
 *
 *  Daily and Stats both wrap their whole graph-derived body in this, which is
 *  what makes their Filter-change behaviour identical. Overview and Models are
 *  Snapshot-served and out of #32's scope; they still empty and refill.
 */
export function Replacing({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-busy={on || undefined}
      className={
        "transition-opacity duration-150" + (on ? " pointer-events-none opacity-45" : "")
      }
    >
      {children}
    </div>
  );
}
