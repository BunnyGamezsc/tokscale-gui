# Original style restored

Original is available in Settings alongside Nocturne and Terminal. Both the
frontend type and Rust settings enum accept `original`. Nocturne remains the
default, and existing saved styles keep their values.

The design comes from `d6fa2f9^`, before the redesign. The base stylesheet's
palette, typography, density, graph ramp and component utilities are unchanged
from that revision. Original restores its unbranded traffic-light spacer,
180px sidebar, flat summary tiles and normal block flow in the main pane.
Spending, insights and search use the shared historical tokens and components.

Appearance has its own System, Light and Dark selector again. Switching styles
only saves `appStyle`. Startup honors the saved appearance before showing the
native window, and System follows native theme events. Explicit Light and Dark
choices ignore later system events. Original uses the historical light and
dark palettes. Nocturne and Terminal retain their existing dark visual palettes;
the independent appearance setting controls the native window appearance.

## Validation

- Production build and TypeScript check passed.
- Frontend tests passed: 70 tests across 16 files. New theme tests cover startup
  ordering, System events and explicit appearance choices.
- Rust settings tests passed: 7 tests, including all nine style/appearance
  combinations saved to disk and loaded again. Unknown warning history survives.
- The historical base stylesheet matches `d6fa2f9^` exactly, excluding the later
  font imports and style overrides.
- T3 browser checks used a temporary synthetic IPC fixture. Original Light and
  Dark used the historical palette, 180px sidebar and square flat tiles. Style
  changes preserved appearance, System events updated the theme, and Original
  persisted after reloading the fixture. Search and its model inspector worked.
  Spending pace, limits, chat insights and period summaries rendered through
  shared components. The fixture was removed after verification.
- The native binary compiled and launched. Native automation selected the
  installed app and could not bind the development executable, so native visual
  verification and a real native restart remain unverified. Browser persistence
  and backend disk round trips were verified separately.
- React Doctor reported 78/100 with one existing warning for autofocus in the
  search dialog. Autofocus puts the cursor in search when the dialog opens.
- `git diff --check` and formatting of the changed Rust file passed. Whole-repo
  `cargo fmt --check` reports existing formatting differences in unrelated files.

No Windows runtime validation was performed. The three pre-existing untracked
handoff/ideas documents were preserved.
