import { useEffect, useRef } from "react";
import { useScanLanded, useAllClients } from "@/lib/use-scan";
import { useFilter, setFilter, clearFilter, isNarrowed } from "@/lib/filter";

/** The Report Filter, in the window chrome.
 *
 *  One control for the whole window: it drives Overview, Models, Daily and
 *  Stats, and its state lives outside the router (`lib/filter.ts`) so moving
 *  between Views keeps the question the user was asking.
 *
 *  It carries a date range and a Client selection. Narrowing either changes what
 *  each Entry *means* — both are applied to Unified Messages before they are
 *  aggregated — which is why this is chrome and not a column filter over a
 *  table (CONTEXT.md: **Report Filter**).
 *
 *  Its Client control is *report-time*, and the window has no other kind: the
 *  GUI's **Enabled Clients** are a constant, so nothing here can cost a Scan
 *  (#30, ADR 0005). That is a distinction a checkbox list cannot make on its
 *  own — upstream's identical-looking `s` picker rescans — so the picker says
 *  it in words rather than relying on where it sits.
 *
 *  Hidden until a Scan has landed: with no Snapshot there is nothing to narrow,
 *  and the Client options are read off the corpus.
 */
export function FilterBar() {
  const ready = useScanLanded();
  const filter = useFilter();
  const clients = useAllClients(ready);

  if (!ready) return null;

  const picked = filter.clients ?? [];
  const toggle = (id: string) =>
    setFilter({
      ...filter,
      clients: picked.includes(id) ? picked.filter((c) => c !== id) : [...picked, id],
    });

  return (
    <div role="group" aria-label="Report Filter" className="flex items-center gap-1.5 text-small">
      {/* Native date inputs: the range is two inclusive `YYYY-MM-DD` strings
          compared as strings against an already-bucketed day, so there is no
          timezone arithmetic here to justify a picker component
          (`a_date_range_is_two_inclusive_day_strings`). */}
      <input
        type="date"
        aria-label="From"
        value={filter.since ?? ""}
        max={filter.until}
        onChange={(e) => setFilter({ ...filter, since: e.target.value })}
        className={FIELD}
      />
      <span className="text-muted-foreground">–</span>
      <input
        type="date"
        aria-label="To"
        value={filter.until ?? ""}
        min={filter.since}
        onChange={(e) => setFilter({ ...filter, until: e.target.value })}
        className={FIELD}
      />

      <Picker
        label={picked.length ? `${picked.length} clients` : "All clients"}
        ariaLabel="Clients to report on"
      >
        {/* The whole point of #30. Two Client controls that look like this cost
            21-40 s and 41-100 ms respectively; only one of them exists here,
            and saying which is cheaper than making the user find out. */}
        <p className="px-1.5 py-1 text-micro leading-relaxed text-muted-foreground">
          Narrows the report. Every client is scanned either way, so this costs
          milliseconds — never a rescan.
        </p>
        {(clients.data ?? []).map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-2 rounded-[3px] px-1.5 py-1 hover:bg-muted"
          >
            {/* `accent-color`, so the tick wears the palette's azure rather than the
                OS accent — the Ramp and the primary action are the only two
                places the accent is spent. */}
            <input
              type="checkbox"
              checked={picked.includes(c.id)}
              onChange={() => toggle(c.id)}
              className="accent-[var(--primary)]"
            />
            <span className="font-mono">{c.id}</span>
          </label>
        ))}
      </Picker>

      {isNarrowed(filter) && (
        <button
          onClick={clearFilter}
          className="px-1.5 text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}

const FIELD =
  "h-6 rounded-[3px] border border-border bg-transparent px-1.5 font-mono text-small text-foreground";

/** A `<details>` disclosure, which is the platform's dropdown: it gives the
 *  open/closed state and keyboard toggling for free, and no popover component
 *  is installed. All it lacks is closing on an outside click. */
function Picker({
  label,
  ariaLabel,
  children,
}: {
  label: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={ariaLabel}
        className={`${FIELD} flex cursor-pointer list-none items-center`}
      >
        {label}
      </summary>
      <div className="absolute right-0 z-10 mt-1 max-h-[50vh] w-[190px] overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg">
        {children}
      </div>
    </details>
  );
}
