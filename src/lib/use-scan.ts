import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  keepPreviousData,
  skipToken,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import * as api from "./api";
import { asArg, NO_FILTER, useFilter } from "./filter";
import { graphState, PENDING_DELAY_MS, type GraphState } from "./graph-pending";
import { scanState, SETTLE_DELAY_MS, type ScanState } from "./scan-state";
import { DEFAULT_SETTINGS, type GuiSettings } from "./settings";

/** Refresh has exactly one owner, and it is not a `useScan` call.
 *
 *  `force` and `abandoned` are *window* state: the shell binds a key to Refresh
 *  and no View is guaranteed to be mounted under it, but a second `useScan` to
 *  give the shell a handle would bring a second elapsed timer, its own Abandon
 *  state, and a second `force` flag that could swallow the Refresh the key just
 *  asked for. So the two flags live here, in the module, and every entrance —
 *  Overview's button, the Failed and Abandoned gates, and `R` — goes through
 *  `refreshScan`. Same shape as `lib/filter.ts`, for the same reason: one per
 *  window, read from trees that do not share a parent.
 */
let force = false;
let abandoned = false;
const listeners = new Set<() => void>();

function setAbandoned(next: boolean) {
  abandoned = next;
  for (const l of listeners) l();
}

function useAbandoned() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => abandoned,
  );
}


/** How long the last real Scan took, kept across launches.
 *
 *  The only ETA the window can offer. A `ScanSummary` carries `elapsedMs` for
 *  the run that just happened, but the unforced path returns 0 and a cold first
 *  run has no run in front of it at all, so within one session the estimate was
 *  only ever visible on a Refresh. The webview's own storage survives both a
 *  reload and a relaunch, which is exactly the span the estimate is about;
 *  it stays out of `gui.json` (#38) because it is a hint, not state, and a
 *  machine that has never scanned correctly has none.
 */
const ETA_KEY = "tokscale.lastScanMs";

function rememberDuration(ms: number) {
  try {
    if (ms > 0) localStorage.setItem(ETA_KEY, String(ms));
  } catch {
    // Storage can be unavailable or full. An estimate is not worth a crash.
  }
}

function lastRunSeconds(): number | null {
  try {
    const ms = Number(localStorage.getItem(ETA_KEY));
    return ms > 0 ? Math.round(ms / 1000) : null;
  } catch {
    return null;
  }
}

/** Rescan. The one path that must actually re-parse.
 *
 *  Only `["scan"]` is invalidated here; the reports go when the new Snapshot
 *  lands (see `useScan`), because refetched now they would read the old one and
 *  be cached as current. And one parse at a time: a second forced `scan` does
 *  not stop the first, which runs on in `spawn_blocking`. So during a Scan this
 *  only resumes the wait — which is what "Wait for it" and a held `R` want.
 *
 *  Nor during a sync (#40), which is writing files the Scan would read. A
 *  successful sync Refreshes when it finishes, so that Refresh isn't lost. */
export function refreshScan(qc: QueryClient) {
  setAbandoned(false);
  if (qc.isFetching({ queryKey: ["scan"] }) || qc.isMutating({ mutationKey: ["sync"] })) return;
  force = true;
  void qc.invalidateQueries({ queryKey: ["scan"] });
}

/** Refresh, from anywhere — the shell's `R` binding included. */
export function useRefresh() {
  const qc = useQueryClient();
  // Stable, because the shell hangs its `keydown` listener off it.
  return useCallback(() => refreshScan(qc), [qc]);
}

/** The Snapshot's lifecycle, as the views see it.
 *
 *  A Scan cannot be interrupted — core has no yield point in the parse — so the
 *  user's escape is to **Abandon**: stop waiting for the result. The Scan itself
 *  runs to completion and still writes its cache, which is why abandoning a cold
 *  Scan still leaves the next one warm. Nothing partial is left behind.
 */
export function useScan() {
  const abandoned = useAbandoned();
  const [elapsed, setElapsed] = useState(0);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["scan"],
    queryFn: async () => {
      const forced = force;
      force = false;
      const summary = await api.scan(undefined, forced);
      rememberDuration(summary.elapsedMs);
      // The backend holds the new Snapshot by the time `scan` returns, so every
      // report read from the old one is refetched now, not at Refresh.
      if (forced) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "scan" });
      return summary;
    },
    retry: false,
  });

  // An elapsed timer is the honest progress indicator: there is no percentage to
  // show, because the parse reports nothing until it finishes. Ticket 28 kept it
  // that way — see ADR 0004 for why neither of the other two levers was pulled.
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
    /** The previous run's duration, or `null` on a machine that has never
     *  finished a Scan. Read from storage rather than from `query.data`, which
     *  is 0 on the unforced path and absent entirely on a first run. */
    etaSeconds: lastRunSeconds(),
    abandon: () => setAbandoned(true),
  };
}

/** Which of the two waits the window is in, delay included. Same split as
 *  `useGraphState`: the decision is pure and tested, this owns the timer. */
export function useScanState(scan: { summary: unknown; scanning: boolean }): ScanState {
  const delayPassed = useDelayPassed(scan.scanning, SETTLE_DELAY_MS);
  return scanState({ hasSummary: scan.summary !== undefined, isScanning: scan.scanning }, delayPassed);
}

/** True once `active` has held for `ms`. Resets the moment it drops.
 *
 *  Shared by the two pending decisions because they need the same timer and
 *  disagree only on the threshold and on what to do at each end of it. */
function useDelayPassed(active: boolean, ms: number) {
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    if (!active) {
      setPassed(false);
      return;
    }
    const id = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);

  return passed;
}

/** Whether a Scan has landed, without owning its lifecycle.
 *
 *  `skipToken` makes this a read-only observer of the same query: chrome that
 *  lives outside a View needs to know a Snapshot exists, but a second `useScan`
 *  would bring a second elapsed timer, its own Abandon state, and a second
 *  `force` flag that could swallow a Refresh. */
export function useScanLanded() {
  const { data } = useQuery<api.ScanSummary>({ queryKey: ["scan"], queryFn: skipToken });
  return Boolean(data && data.messages > 0);
}

/** Reports read from the held Snapshot. They cannot run until a Scan has landed,
 *  hence `enabled`. */
export function useReport(groupBy: api.GroupBy, ready: boolean) {
  const filter = useFilter();
  return useQuery({
    queryKey: ["model_report", groupBy, filter],
    queryFn: () => api.modelReport(groupBy, asArg(filter)),
    enabled: ready,
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
    // The Filter is in the key, so editing it is a *new* query: without this,
    // `data` would go `undefined` for the ~30 ms the narrowed call takes and the
    // grid would unmount mid-edit. Ticket 32: the stale grid stays.
    placeholderData: keepPreviousData,
  });
}

export function useHourly(ready: boolean) {
  const filter = useFilter();
  return useQuery({
    queryKey: ["hourly_report", filter],
    queryFn: () => api.hourlyReport(asArg(filter)),
    enabled: ready,
    // Same as the graph (#32): a Filter edit keeps the old hours on screen,
    // dimmed, instead of emptying the View.
    placeholderData: keepPreviousData,
  });
}

export function useMinutely(ready: boolean) {
  const filter = useFilter();
  return useQuery({
    queryKey: ["minutely_report", filter],
    queryFn: () => api.minutelyReport(asArg(filter)),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
}

/** `gui.json`. Seeded by `main.tsx` before the window shows, so this is never
 *  pending in practice; the query is here so a save has a cache to update. */
export function useGuiSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["gui_settings"],
    queryFn: api.guiSettings,
  });
  const save = useCallback(
    async (patch: Partial<GuiSettings>) => {
      const current = qc.getQueryData<GuiSettings>(["gui_settings"]) ?? DEFAULT_SETTINGS;
      qc.setQueryData(["gui_settings"], await api.setGuiSettings({ ...current, ...patch }));
    },
    [qc],
  );
  return { settings: data ?? DEFAULT_SETTINGS, save };
}

/** Interval refresh: a `refreshScan` on a timer, so a tick while a Scan is in
 *  flight does nothing, exactly as a held `R` does (#33).
 *
 *  It rescans rather than refetching reports: every report but the graph reads
 *  the held Snapshot, so refetching them without a Scan returns what is already
 *  on screen. A hidden window skips its tick; a Scan nobody can see is the
 *  laptop-battery cost #38 warned about. */
export function useAutoRefresh() {
  const qc = useQueryClient();
  const { settings } = useGuiSettings();
  const { autoRefreshEnabled: enabled, autoRefreshMs: ms } = settings;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (!document.hidden) refreshScan(qc);
    }, ms);
    return () => clearInterval(id);
  }, [qc, enabled, ms]);
}

export function useAgents(ready: boolean) {
  const filter = useFilter();
  return useQuery({
    queryKey: ["agents_report", filter],
    queryFn: () => api.agentsReport(asArg(filter)),
    enabled: ready,
  });
}

export function useClients(ready: boolean) {
  const filter = useFilter();
  return useQuery({
    queryKey: ["clients", filter],
    queryFn: () => api.clients(asArg(filter)),
    enabled: ready,
    // Stats' only other query. It re-keys on the same Filter edit as the graph,
    // so without this the By-client list would empty underneath a grid that
    // held — half the View holding and half of it blank.
    placeholderData: keepPreviousData,
  });
}

/** Every Client in the corpus, unnarrowed — the Report Filter's own options,
 *  which must not collapse to whatever is already selected. */
export function useAllClients(ready: boolean) {
  return useQuery({
    queryKey: ["clients", NO_FILTER],
    queryFn: () => api.clients(),
    enabled: ready,
  });
}

/** Every Client a Scan reads, whether or not it is installed.
 *
 *  Not gated on anything: it is core's const registry, so it answers while the
 *  Scan that would fill `useAllClients` is still running. That is the whole
 *  point — it is what lets the first-run window name what is being read.
 */
export function useClientCatalog() {
  return useQuery({
    queryKey: ["client_catalog"],
    queryFn: api.clientCatalog,
  });
}

export function useUnpriced(ready: boolean) {
  return useQuery({
    queryKey: ["unpriced"],
    queryFn: () => api.unpriced(),
    enabled: ready,
  });
}

export function useCustomPricing() {
  return useQuery({
    queryKey: ["custom_pricing"],
    queryFn: () => api.customPricing(),
  });
}

/** What Daily and Stats should render for the graph call, delay included.
 *
 *  Lives here rather than in either View because the two have to agree: before
 *  #32 they disagreed by accident — Daily had a skeleton on `isPending`, Stats
 *  had no pending state at all. The decision itself is `graphState`, kept pure
 *  and tested; this only owns the timer. */
export function useGraphState(query: { data: unknown; isFetching: boolean }): GraphState {
  const delayPassed = useDelayPassed(query.isFetching, PENDING_DELAY_MS);
  return graphState(
    { hasData: query.data !== undefined, isFetching: query.isFetching },
    delayPassed,
  );
}
