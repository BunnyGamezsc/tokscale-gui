import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

/** The Snapshot's lifecycle, as the views see it.
 *
 *  A Scan cannot be interrupted — core has no yield point in the parse — so the
 *  user's escape is to **Abandon**: stop waiting for the result. The Scan itself
 *  runs to completion and still writes its cache, which is why abandoning a cold
 *  Scan still leaves the next one warm. Nothing partial is left behind.
 */
export function useScan() {
  const qc = useQueryClient();
  const [abandoned, setAbandoned] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  const force = useRef(false);
  const query = useQuery({
    queryKey: ["scan"],
    queryFn: async () => {
      const forced = force.current;
      force.current = false;
      return api.scan(undefined, forced);
    },
    staleTime: Infinity,
    retry: false,
  });

  // An elapsed timer is the honest progress indicator: there is no percentage to
  // show, because the parse reports nothing until it finishes.
  useEffect(() => {
    if (!query.isFetching) {
      startedAt.current = null;
      return;
    }
    startedAt.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      if (startedAt.current) setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [query.isFetching]);

  // The last run's duration is the only ETA worth showing.
  const [lastMs, setLastMs] = useState<number | null>(null);
  useEffect(() => {
    if (query.data) setLastMs(query.data.elapsedMs);
  }, [query.data]);

  return {
    summary: query.data,
    error: query.error instanceof Error ? query.error.message : (query.error as string | null),
    /** True while a Scan is running and the user has not abandoned the wait. */
    scanning: query.isFetching && !abandoned,
    /** True when the user stopped waiting but no result has landed yet. */
    abandoned: abandoned && query.isFetching,
    elapsed,
    etaSeconds: lastMs ? Math.round(lastMs / 1000) : null,
    abandon: () => setAbandoned(true),
    refresh: () => {
      setAbandoned(false);
      // Refresh is the one path that must actually rescan; a new Snapshot makes
      // every report read from it stale.
      force.current = true;
      qc.invalidateQueries();
    },
  };
}

/** Reports read from the held Snapshot. They cannot run until a Scan has landed,
 *  hence `enabled`. */
export function useReport(groupBy: api.GroupBy, ready: boolean) {
  return useQuery({
    queryKey: ["model_report", groupBy],
    queryFn: () => api.modelReport(groupBy),
    enabled: ready,
    staleTime: Infinity,
  });
}

export function useGraph(ready: boolean) {
  return useQuery({
    queryKey: ["graph_report"],
    queryFn: () => api.graphReport(),
    enabled: ready,
    staleTime: Infinity,
  });
}

export function useClients(ready: boolean) {
  return useQuery({
    queryKey: ["clients"],
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
