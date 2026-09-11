import { useSyncExternalStore } from "react";
import type { Filter } from "./api";

/** The active Report Filter — one per window, shared by every View.
 *
 *  Module state rather than context or a query: the Filter has to survive
 *  navigation between Views (the user's question should not reset when they
 *  move from Overview to Daily), and the hooks that need it live in
 *  `use-scan.ts`, not under any one View's tree. `useSyncExternalStore` is what
 *  React ships for exactly this, so there is no provider to thread.
 *
 *  Empty fields are pruned on the way in, so an untouched control is
 *  indistinguishable from no Filter at all: the query keys stay stable and the
 *  backend is sent `None`.
 */
let active: Filter = {};
const listeners = new Set<() => void>();

export function prune(next: Filter): Filter {
  const out: Filter = {};
  if (next.since) out.since = next.since;
  if (next.until) out.until = next.until;
  if (next.year) out.year = next.year;
  // No Clients ticked means no constraint, not "no Clients" — the backend reads
  // an empty selection as the latter, so it must never be sent one.
  if (next.clients?.length) out.clients = [...next.clients].sort();
  return out;
}

export function setFilter(next: Filter) {
  active = prune(next);
  for (const l of listeners) l();
}

export const clearFilter = () => setFilter({});

export function useFilter(): Filter {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
  );
}

/** The unnarrowed Filter. A named constant because it is also a query key —
 *  `useAllClients` must land on the same cache entry as `useClients` before the
 *  user has narrowed anything. */
export const NO_FILTER: Filter = {};

export const isNarrowed = (f: Filter) => Object.keys(f).length > 0;

/** The Filter as a command argument: `undefined` when it narrows nothing. */
export const asArg = (f: Filter) => (isNarrowed(f) ? f : undefined);
