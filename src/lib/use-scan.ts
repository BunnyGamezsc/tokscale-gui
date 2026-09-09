import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import { asArg, useFilter } from "./filter";

/** The Snapshot's lifecycle, as the views see it.
 *
 *  A Scan cannot be interrupted — core has no yield point in the parse — so the
 *  user's escape is to **Abandon**: stop waiting for the result. The Scan itself
 *  runs to completion and still writes its cache, which is why abandoning a cold
 *  Scan still leaves the next one warm. Nothing partial is left behind.
 */
// Module-level, not a ref: the chrome's Report Filter calls `useScan` too, and a
// per-instance flag would let Refresh's forced rescan be served by whichever
// observer's `queryFn` happened to run.
let force = false;

export function useScan() {
  const qc = useQueryClient();
  const [abandoned, setAbandoned] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const query = useQuery({
    queryKey: ["scan"],
    queryFn: async () => {
      const forced = force;
      force = false;
      return api.scan(undefined, forced);
    },
    staleTime: Infinity,
    retry: false,
  });

  // An elapsed timer is the honest progress indicator: there is no percentage to
  // show, because the parse reports nothing until it finishes.
  useEffect(() => {
    if (!query.isFetching) return;
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - started) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [query.isFetching]);

  return {
    summary: query.data,
    error: query.error instanceof Error ? query.error.message : (query.error as string | null),
    /** True while a Scan is running and the user has not abandoned the wait. */
    scanning: query.isFetching && !abandoned,
    /** True when the user stopped waiting but no result has landed yet. */
    abandoned: abandoned && query.isFetching,
    elapsed,
    // The last run's duration is the only ETA worth showing, and the query keeps
    // it across a refetch.
    etaSeconds: query.data?.elapsedMs ? Math.round(query.data.elapsedMs / 1000) : null,
    abandon: () => setAbandoned(true),
    refresh: () => {
      setAbandoned(false);
      // Refresh is the one path that must actually rescan; a new Snapshot makes
      // every report read from it stale.
      force = true;
      qc.invalidateQueries();
    },
  };
}

/** Reports read from the held Snapshot. They cannot run until a Scan has landed,
 *  hence `enabled`. */
export function useReport(groupBy: api.GroupBy, ready: boolean) {
  const filter = useFilter();
  return useQuery({
    queryKey: ["model_report", groupBy, filter],
    queryFn: () => api.modelReport(groupBy, asArg(filter)),
    enabled: ready,
    staleTime: Infinity,
  });
}

export function useGraph(ready: boolean) {
  const filter = useFilter();
  return useQuery({
    // A narrowed graph is a fresh parse, not a slice of the held one: core folds
    // per-day totals through a private `GraphSink` with no per-Client
    // decomposition to subtract, so `clients` goes in as a parse input. Ticket
    // 27 measured that parse against the cache a Scan just wrote at 0.28-0.76 s,
    // and a narrowed one walks a subset of it.
    queryKey: ["graph_report", filter],
    queryFn: () => api.graphReport(asArg(filter)),
    enabled: ready,
    staleTime: Infinity,
  });
}

export function useClients(ready: boolean) {
  const filter = useFilter();
  return useQuery({
    queryKey: ["clients", filter],
    queryFn: () => api.clients(asArg(filter)),
    enabled: ready,
    staleTime: Infinity,
  });
}

/** Every Client in the corpus, unnarrowed — the Report Filter's own options,
 *  which must not collapse to whatever is already selected. */
export function useAllClients(ready: boolean) {
  return useQuery({
    queryKey: ["clients", {}],
    queryFn: () => api.clients(),
    enabled: ready,
    staleTime: Infinity,
  });
}

export function useUnpriced(ready: boolean) {
  return useQuery({
    queryKey: ["unpriced"],
    queryFn: () => api.unpriced(),
    enabled: ready,
    staleTime: Infinity,
  });
}

export function useCustomPricing() {
  return useQuery({
    queryKey: ["custom_pricing"],
    queryFn: () => api.customPricing(),
    staleTime: Infinity,
  });
}
