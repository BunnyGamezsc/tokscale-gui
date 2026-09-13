import type { Appearance } from "@/theme";

/** What `gui.json` holds, as `gui_settings` returns it (`src-tauri/src/gui.rs`). */
export interface GuiSettings {
  appearance: Appearance;
  autoRefreshEnabled: boolean;
  autoRefreshMs: number;
  minutelyViewEnabled: boolean;
}

/** Interval refresh bounds, in step with `gui.rs`. A tick is a forced Scan;
 *  #38 measured a warm one at ~214 ms, so the TUI's 30 s to 1 h holds. */
export const MIN_REFRESH_MS = 30_000;
export const MAX_REFRESH_MS = 3_600_000;

export const DEFAULT_SETTINGS: GuiSettings = {
  appearance: "system",
  autoRefreshEnabled: false,
  autoRefreshMs: 60_000,
  minutelyViewEnabled: false,
};

/** An interval typed in minutes, as milliseconds within the bounds. Anything
 *  that is not a number keeps the current value. */
export function intervalFromMinutes(minutes: number, current: number): number {
  if (!Number.isFinite(minutes)) return current;
  return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, Math.round(minutes * 60_000)));
}
