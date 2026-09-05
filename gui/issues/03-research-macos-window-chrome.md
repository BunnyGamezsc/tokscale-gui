# Research: Tauri v2 macOS window chrome

Type: research
Status: resolved
Blocked by: —

## Start here

New session? Read these first — they hold decisions already settled; do not relitigate them.

- **[The map](../map.md)** — the `## Notes` section is the binding list of standing decisions,
  and `## Decisions so far` indexes every resolved ticket. Read it before anything else.
- **[CONTEXT.md](../../CONTEXT.md)** — glossary. Mirrors upstream tokscale's vocabulary
  verbatim, including the ambiguities it inherits. Use these terms exactly.
- **[ADR 0001](../../docs/adr/0001-depend-on-tokscale-core.md)** and
  **[ADR 0002](../../docs/adr/0002-fork-tokscale-cli-for-a-library-target.md)** — both carry
  dated amendments; read to the end.
- Resolved research lives in sibling tickets `03`, `04` and `05`. Zoom into them on demand
  rather than re-researching.

Upstream tokscale source is at `tokscale/` in the repo root today; after
"Fork tokscale and vendor it as a submodule" resolves, it lives at `vendor/tokscale/`.

**Skill for this ticket type:** Call the Skill tool with `research`.

## When done

1. Append the answer to this file under `## Answer`.
2. Change `Status:` to `resolved`.
3. Append a one-line gist + link to `## Decisions so far` in [the map](../map.md).
4. Graduate any fog the answer sharpened into new tickets; clear those patches from
   `## Not yet specified`. If the answer puts work past the destination, rule it out of
   scope rather than resolving it.

Resolve **one ticket per session** (research tickets excepted).

## Question

The map commits to a hidden titlebar with overlaid traffic lights and a vibrant
sidebar. What does Tauri v2 actually support today?

Specifically: the current API for hiding the titlebar while keeping traffic lights
(`titleBarStyle: "Overlay"` and friends), how traffic-light inset is controlled, how
NSVisualEffectView vibrancy is enabled and which materials are exposed, how custom
drag regions are declared, and what breaks when the window is resized or full-screened.

Also: what the graceful degradation is on Windows and Linux, since the code stays
cross-platform-clean.

## Answer

Researched 2026-09-05 against the `dev` branch of `tauri-apps/tauri` (latest release
**tauri v2.11.5**, published 2026-07-01) and the generated config schema.

### 1. Hiding the titlebar, keeping traffic lights

`titleBarStyle` (macOS only, `WindowConfig.titleBarStyle`, default `"Visible"`) has exactly
three values, verbatim from the config schema:

- `"Visible"` — normal title bar.
- `"Transparent"` — "Makes the title bar transparent, so the window background color is shown
  instead. Useful if you don't need to have actual HTML under the title bar. This lets you avoid
  the caveats of using `TitleBarStyle::Overlay`."
- `"Overlay"` — "Shows the title bar as a transparent overlay over the window's content." The
  schema itself lists the caveats: titlebar height varies by OS version; you must define a custom
  drag region; you can't drag the window when it's not focused
  (<https://github.com/tauri-apps/tauri/issues/4316>); title color follows the system theme.

Companion keys: `hiddenTitle: bool` (default false, "sets the window title to be hidden on
macOS"), `decorations: bool` (default true — keep it **true** for Overlay; `false` removes the
traffic lights entirely), `trafficLightPosition`.

Recommended shape for this design: `decorations: true`, `titleBarStyle: "Overlay"`,
`hiddenTitle: true`, plus `trafficLightPosition`.

APIs:
- Rust builder (macOS-gated): `WebviewWindowBuilder::title_bar_style(TitleBarStyle)`,
  `.hidden_title(bool)`, `.traffic_light_position(impl Into<Position>)` —
  <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/webview/webview_window.rs>
- Rust runtime setter: `Window::set_title_bar_style(tauri_utils::TitleBarStyle)`
  (crates/tauri/src/window/mod.rs:2321).
- JS: `Window.setTitleBarStyle(style)` ("**macOS only**", since 2.0.0) →
  `invoke('plugin:window|set_title_bar_style')`; and `titleBarStyle` / `hiddenTitle` /
  `trafficLightPosition` in `WindowOptions` at creation time
  (<https://github.com/tauri-apps/tauri/blob/dev/packages/api/src/window.ts>).
- Config reference: <https://v2.tauri.app/reference/config/#windowconfig>

### 2. Traffic-light position / inset

**First-party, but creation-time only.**

- Config: `"trafficLightPosition": { "x": 19, "y": 24 }` (a `LogicalPosition`). Schema doc:
  "The position of the window controls on macOS. **Requires titleBarStyle: Overlay and
  decorations: true.**"
- Rust: `WebviewWindowBuilder::traffic_light_position(...)` — same requirement in its doc comment.
- JS: `trafficLightPosition?: LogicalPosition` in `WindowOptions`, `@since 2.4.0`
  (feature request <https://github.com/tauri-apps/tauri/issues/13790>, closed by PR #13810).

**There is no public runtime setter.** `set_traffic_light_position(Position)` exists only on the
internal `Dispatch` trait (crates/tauri-runtime/src/lib.rs:995, implemented in
tauri-runtime-wry:2345 as tao's `set_traffic_light_inset`) and is not re-exported on
`Window`/`WebviewWindow`, nor exposed as an IPC command (GitHub code search for
`set_traffic_light_position` hits only tauri-runtime, tauri-runtime-wry and mock_runtime).
Changing the inset after creation therefore needs either objc2 interop via
`window.ns_window()`, or a third-party plugin.

Underlying primitive: tao `WindowExtMacOS::set_traffic_light_inset` /
`WindowBuilderExtMacOS::with_traffic_light_inset`
(<https://github.com/tauri-apps/tao/blob/dev/src/platform/macos.rs>); tauri-runtime-wry 2.11.4
pins tao 0.37.0, wry 0.56.0.

Third-party options (both suspect):
- `tauri-plugin-decorum` (clearlysid) — 322 stars, crates.io max 1.1.1, crate metadata updated
  2024-09-22, repo last pushed 2025-08-08. Usable but ~1 year stale.
- `tauri-plugin-trafficlights-positioner` (ItsEeleeya) — **archived** since 2025-03; do not use.

### 3. Vibrancy / NSVisualEffectView

First-party support exists and is literally window-vibrancy under the hood:
`crates/tauri/src/vibrancy/macos.rs` maps `Effect::*` onto
`window_vibrancy::apply_vibrancy(window, NSVisualEffectMaterial, Option<NSVisualEffectState>, Option<radius>)`.

Config: `WindowConfig.windowEffects` → `WindowEffectsConfig { effects: [WindowEffect], state?,
radius?, color? }`. Docs: "Requires the window to be transparent. Windows: if using decorations or
shadows see <https://github.com/tauri-apps/tao/issues/72#issuecomment-975607891>. **Linux:
Unsupported.**"

macOS materials exposed (schema `WindowEffect`, all camelCase strings):
`appearanceBased`, `light`, `dark`, `mediumLight`, `ultraDark` (all five **deprecated**, macOS
10.14-); `titlebar`, `selection` (10.10+); `menu`, `popover`, `sidebar` (10.11+); `headerView`,
`sheet`, `windowBackground`, `hudWindow`, `fullScreenUI`, `tooltip`, `contentBackground`,
`underWindowBackground`, `underPageBackground` (10.14+). Windows-only: `mica`, `micaDark`,
`micaLight`, `tabbed`, `tabbedDark`, `tabbedLight`, `blur`, `acrylic`.
For a vibrant left sidebar the material you want is `"sidebar"`; `state` is
`followsWindowActiveState` | `active` | `inactive` (maps to NSVisualEffectView.state).

Runtime JS: `Window.setEffects(effects)` and `Window.clearEffects()`
(`plugin:window|set_effects`). Rust: `Window::set_effects(impl Into<Option<WindowEffectsConfig>>)`.

Prerequisites (window-vibrancy README): `"transparent": true` on the window, `"macOSPrivateApi":
true` in `tauri.conf.json`, and `html, body { background: transparent }`. Note the schema warning
on `transparent`: on macOS it needs the `macos-private-api` feature, and **using private APIs on
macOS prevents App Store acceptance**. The effect view sits behind the whole webview, so
"vibrancy only in the sidebar" is achieved by making everything except the sidebar opaque in CSS.

Version state (flag this):
- `window-vibrancy` latest is **0.8.0, published 2026-07-16** (repo actively maintained, last push
  2026-09-04; 1036 stars). 0.8 adds `apply_liquid_glass` / `NSGlassEffectViewStyle` for macOS 26+
  (styles include `Sidebar = 16`, `AbuttedSidebar = 17`) and depends on objc2 0.6 / objc2-app-kit
  0.3.2.
- **tauri 2.11.5 still depends on `window-vibrancy = "0.6"`** (crates/tauri/Cargo.toml), so the
  built-in `windowEffects` path gives you classic NSVisualEffectView only. If you want liquid
  glass or the newest materials on macOS 26+, add `window-vibrancy 0.8` directly and call
  `apply_vibrancy` / `apply_liquid_glass` yourself.
- Open upstream issue: "maintain compatibility with updated materials in MacOS 26"
  (<https://github.com/tauri-apps/window-vibrancy/issues/182>, open since 2025-06-12).
- Sources: <https://github.com/tauri-apps/window-vibrancy>,
  <https://crates.io/crates/window-vibrancy>

### 4. Drag regions

`data-tauri-drag-region` is implemented by an injected script,
`crates/tauri/src/window/scripts/drag.js` (shipped in 2.11.5). Current semantics:

- bare attribute or `="true"` → only **direct** clicks on that exact element drag.
- `="deep"` → clicks anywhere in the subtree drag (added in **tauri 2.11.0**, PR #15062).
- `="false"` → explicitly blocks dragging for that element and its ancestors (PR #13269) —
  useful when binding the attribute to React state.
- Clickable elements (`A, BUTTON, INPUT, SELECT, TEXTAREA, LABEL, SUMMARY`, `contenteditable`,
  `tabindex != -1`, or roles button/link/menuitem/tab/checkbox/radio/switch/option) block dragging
  unless they themselves carry the attribute.
- Single click → `plugin:window|start_dragging`; double click → `internal_toggle_maximize`. On
  macOS maximize fires on `mouseup` and is cancelled if the pointer moved (matches native
  behaviour, issue #8306).
- Permissions required: `core:window:allow-start-dragging` (and `core:window:default`, which
  includes `allow-internal-toggle-maximize`).
- Manual alternative: `getCurrentWindow().startDragging()` on `mousedown`.
- Docs: <https://v2.tauri.app/learn/window-customization/>

Pitfalls (open issues):
- #4316 — can't drag an **unfocused** window; needs per-element `acceptsFirstMouse`. There is a
  window-wide `acceptFirstMouse: bool` config key ("Whether clicking an inactive window also
  clicks through to the webview on macOS", default false) but it is all-or-nothing.
- #9503 (open, 2024-04) "Cannot drag tauri app window on MacOS when titleBarStyle is set to
  Overlay" — with Overlay you must supply your own drag region.
- #15623 (open, 2026-06) drag works when the transparent+overlay window is unfocused but not once
  focused.
- #6988 double-click on macOS freeze; #5868 drag region broken in isolation mode;
  #3811 mouseup events swallowed on drag-region elements; #13323 `resized` event reports stale
  size after drag-region toggle_maximize.
- `app-region: drag` was tried and reverted on Windows (#9860) because it steals clicks from
  buttons; docs still suggest it as an opt-in for touch/pen on Windows.

### 5. Resize / fullscreen / theme with Overlay

- **Traffic-light inset is not reapplied after window-state changes.** #13044 (open, 2025-03)
  "Setting window title resets traffic light position". #15451 "[macOS] Custom traffic light
  position reset after quitting fullscreen of maximized window" was **closed 2026-07-30**; the fix
  is tao PR <https://github.com/tauri-apps/tao/pull/1254> and a maintainer states it "will be part
  of tauri v2.12" — i.e. **not in 2.11.5**. Workaround today: resize the window, or reapply the
  inset via objc2/plugin.
- #14072 (open, 2025-08) `traffic_light_position` does nothing (stuck at 0,0) when the tauri
  **`unstable` feature flag** is enabled. Avoid `features = ["unstable"]` if you set the inset.
- #14253 (open, 2025-10) on macOS Tahoe the disabled maximize button renders black instead of gray
  under `titleBarStyle: overlay`.
- #14487 (open, 2025-11) visual glitch at the top of the window on fullscreen with
  `decorations:false` + `transparent` + `hiddenTitle` + Overlay.
- Overlay title text color follows the system theme (schema note), so design the sidebar to work
  in both appearances. Theme control: `WindowConfig.theme` (Windows + macOS 10.14+ only) and
  JS `Window.setTheme(theme | null)` — note "**Linux / macOS**: Theme is app-wide and not specific
  to this window."
- #12854 (open) window `visibility` changes the applied background material.
- #8255 transparent-window glitch on focus change (Sonoma-era, still open).

### 6. Windows / Linux degradation

- `titleBarStyle`, `trafficLightPosition`, `hiddenTitle`, `acceptFirstMouse`, and
  `WindowEffectsConfig.state`/`radius` are macOS-only; they are ignored (not errors) elsewhere, so
  a single `tauri.conf.json` is safe. In Rust the builder methods are `#[cfg(target_os = "macos")]`,
  so guard them with `#[cfg(target_os = "macos")]` blocks.
- Windows: no traffic lights — hidden chrome means `decorations: false` plus your own
  minimize/maximize/close buttons (`minimize()`, `toggleMaximize()`, `close()`), the standard
  Tauri custom-titlebar recipe. Vibrancy substitutes: `mica` / `micaLight` / `micaDark` (Win 11),
  `tabbed*` (Win 11), `acrylic` (Win 10/11), `blur` (Win 7/10/11 22H1) — schema warns `blur` and
  `acrylic` have "bad performance when resizing/dragging". `shadow: true` on an undecorated window
  gives a 1px white border and rounded corners on Win 11.
- Linux: `windowEffects` **unsupported** (blur is compositor-controlled); `shadow` unsupported.
  Fall back to a flat opaque sidebar color.
- Undecorated windows get synthetic resize borders on Windows and Linux only
  (`crates/tauri-runtime-wry/src/undecorated_resizing.rs` is `#[cfg(any(windows, linux, *bsd))]`);
  on macOS the `Overlay` + `decorations: true` route keeps native resizing, which is another
  reason to prefer it over `decorations: false`.
- Practical pattern: keep `Overlay`/inset in a macOS-only config block or `#[cfg]` setup code, and
  drive frontend padding (the ~78px traffic-light gutter) from `platform()` in
  `@tauri-apps/plugin-os` rather than hard-coding it.

### Staleness flags

- tauri 2.11.5 is current (2026-07-01); the traffic-light-reset fix lands in **2.12**.
- tauri bundles window-vibrancy **0.6** while 0.8.0 (2026-07-16) is current — built-in effects lag
  the crate by two minor versions and have no liquid-glass support.
- `tauri-plugin-trafficlights-positioner` is archived; `tauri-plugin-decorum` is ~1 year without a
  release. Prefer first-party config + a small objc2 shim over either.
