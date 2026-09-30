# Selected features implemented

Implementation of the 2026-09-30 handoff and `docs/selected-ideas.md`.

## Features

- Overview shows month-end and week-end pace estimates. Calendar-day averages
  include idle days. Weeks start Monday; dates use the scanner's bucket timezone.
  Partial history and unpriced usage are labelled.
- Settings has a global monthly USD cap and provider/model caps. Choose a
  provider, model and positive amount. Setting the same pair updates its cap.
  Clear the global amount or remove a pair to disable that limit.
- Spending notifications are opt-in. The 50/75/90/100 ladder persists in
  `gui.json`, once per limit per month, including across restarts. Failed delivery
  does not consume a rung. Settings saves preserve warning history.
- Overview and Daily show weekly/monthly totals and dollar/percentage changes
  against the previous full calendar period. Missing comparisons, partial
  periods and unpriced costs are identified. The year picker defaults to the
  newest available year, like the contribution graph.
- Overview lists the eight most expensive chats, pooling every model in a
  client-local session. The inspector shows models, providers, projects, time,
  tokens, messages and links to daily detail. Missing session IDs remain in
  daily totals and are accounted for separately.
- Cmd+K on macOS and Ctrl+K on Windows open search. Models, workspaces and
  sessions come from cached Snapshot projections. Arrow keys choose a result;
  Enter opens its inspector; Escape dismisses it. Cold search explains that a
  scan is needed. The existing keyboard resolver and shortcuts sheet agree.
- A read-only tray shows today's local cost and a dated refresh tooltip.
  Clicking opens the main window. Closing the macOS window hides it; Cmd+Q
  still quits. Windows keeps its existing close behavior and uses the tray
  tooltip. No additional scan or tray refresh timer was added.

Limits, pace and tray totals are local and ignore view filters. Insights follow
the active report filter. Search inspects all recorded usage. All new heavy
backend work uses `spawn_blocking`. The CLI's `settings.json` is unchanged.

## Validation

- `pnpm exec tsc --noEmit`: passed.
- `pnpm test`: 68 passed across 15 files.
- `cargo test`: 59 passed, 11 ignored. On this Mac, set
  `DYLD_FRAMEWORK_PATH` to `src-tauri/target/Frameworks` because the existing
  Sparkle dependency is not on the test binary's default framework path.
- `pnpm build`: passed.
- React Doctor: no diagnostics; reported score 79/100.
- Real transcript probe `real_feature_projections_agree`: passed. 22,193
  messages, 85 days, 305 sessions, $1,035.94. Daily, session and local-spending
  projections reconcile with the model report.
- `pnpm tauri dev`: built and launched.
- Browser checks used actual aggregate totals through a temporary IPC mock.
  Cold search, keyboard navigation, model/workspace/session inspectors, cap
  editing, month switching and a 960px layout passed. Monthly total matched
  Overview. Temporary corpus and app-wrapper files were removed.

Native tray clicks and OS notification appearance could not be visually
verified because native UI automation timed out. Notification transitions are
covered by backend tests. Windows runtime behavior was not tested on this Mac.
