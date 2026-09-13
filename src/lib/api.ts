import { invoke } from "@tauri-apps/api/core";

/** Typed wrappers over the P1 command surface.
 *
 *  These types are hand-kept in step with `src-tauri/src/dto.rs`, which is the
 *  one place the boundary shape is declared. Both sides are camelCase.
 */

/** The client, date-range and year constraints applied *before* aggregation.
 *  Narrowing a Report Filter changes what each Entry means, not which Entries
 *  are displayed. */
export interface Filter {
  clients?: string[];
  since?: string;
  until?: string;
  year?: string;
}

/** The axis a report aggregates on. Changing it changes what one row *means*. */
export const GROUP_BY = [
  { value: "model", label: "Model" },
  { value: "client,model", label: "Client" },
  { value: "client,provider,model", label: "Provider" },
  { value: "workspace,model", label: "Workspace" },
  { value: "session,model", label: "Session" },
] as const;

export type GroupBy = (typeof GROUP_BY)[number]["value"];

/** One row of an aggregated report. */
export interface Entry {
  client: string;
  model: string;
  provider: string;
  sessionId: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messageCount: number;
  cost: number;
}

export interface Report {
  entries: Entry[];
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalMessages: number;
  totalCost: number;
  elapsedMs: number;
}

export interface ScanSummary {
  messages: number;
  firstDay: string | null;
  lastDay: string | null;
  elapsedMs: number;
}

/** One day of the Contribution Graph. `level` 0 means no usage at all —
 *  absence is not a Ramp step. */
export interface Day {
  date: string;
  level: 0 | 1 | 2 | 3 | 4 | 5;
  cost: number;
  tokens: number;
}

/** One agent's usage. `agent` is null for usage with no recorded agent, which
 *  is a row rather than dropped (#37). */
export interface AgentRow {
  agent: string | null;
  clients: string[];
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messageCount: number;
  cost: number;
}

/** Agents by cost, most expensive first. The totals are Overview's. */
export interface AgentsReport {
  agents: AgentRow[];
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalMessages: number;
  totalCost: number;
  elapsedMs: number;
}

export interface Client {
  id: string;
  messages: number;
  cost: number;
}

/** Walks every enabled Client's data locations and parses transcripts into the
 *  Snapshot. 21-40s cold, ~1s warm. Cannot be interrupted — see `Abandon`.
 *
 *  Without `force`, a Snapshot already held by the backend is returned as-is: a
 *  webview reload drops this side's query cache but not the corpus, and should
 *  not cost another Scan. Refresh passes `force`. */
export const scan = (filter?: Filter, force = false) =>
  invoke<ScanSummary>("scan", { filter, force });

/** Re-aggregates the held Snapshot. 41-100ms, so a Group-By switch is instant. */
export const modelReport = (groupBy: GroupBy, filter?: Filter) =>
  invoke<Report>("model_report", { groupBy, filter });

/** Usage by agent, folded from the held Snapshot like `modelReport`. */
export const agentsReport = (filter?: Filter) =>
  invoke<AgentsReport>("agents_report", { filter });

/** Re-enters the parse rather than reading the Snapshot — the one asymmetry in
 *  the surface. 0.28-0.76 s after a Scan (#27), invalidated only by a scan. */
export const graphReport = (filter?: Filter) => invoke<Day[]>("graph_report", { filter });

/** The Clients that produced usage. Takes a Report Filter so Stats' per-Client
 *  figures follow the active one; the Filter control itself asks with none, so
 *  its options stay the whole corpus. */
export const clients = (filter?: Filter) => invoke<Client[]>("clients", { filter });

/** Every Client a Scan reads, by display name, from core's const registry.
 *  Needs no Snapshot and cannot fail, which is what makes it answerable while a
 *  Scan is still running. */
export const clientCatalog = () => invoke<string[]>("client_catalog");

/** A model that spent tokens but produced no cost. */
export interface Unpriced {
  model: string;
  provider: string;
  clients: string[];
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messages: number;
  cost: number;
}

/** Manual rates, in dollars per million tokens — the unit vendors quote and the
 *  unit `custom-pricing.json` stores. */
export interface Rates {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export const unpriced = () => invoke<Unpriced[]>("unpriced");

export const customPricing = () => invoke<Record<string, Rates>>("custom_pricing");

export const setCustomPricing = (model: string, rates: Rates) =>
  invoke<void>("set_custom_pricing", { model, rates });

export const clearCustomPricing = (model: string) =>
  invoke<void>("clear_custom_pricing", { model });

/** Where one vendor CLI was found. `onPath` means a bare-name spawn would have
 *  worked; `offPath` means it is installed somewhere this process's PATH does
 *  not name, which is the app's problem rather than the user's; `missing` means
 *  it is not installed, which is the user's. See ADR 0006. */
export interface VendorCli {
  name: string;
  state: "onPath" | "offPath" | "missing";
  path: string | null;
}

/** What the app would resolve for each vendor CLI, in the environment it was
 *  launched in. A `read_dir` and some dozens of `stat`s, so it needs no Snapshot
 *  and no scan, but it runs on `spawn_blocking` like everything else. */
export const vendorClis = () => invoke<VendorCli[]>("vendor_clis");
