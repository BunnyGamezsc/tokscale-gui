import { getCurrentWindow } from "@tauri-apps/api/window";

/** Appearance is a *window* state, not a CSS class.
 *
 *  `windowEffects` materials follow the window's NSAppearance rather than
 *  anything CSS says (ticket 03 found this the hard way: an unset `theme`
 *  rendered a light vibrant sidebar under dark content). So a theme change is
 *  two writes that must not drift apart — `set_theme` on the Tauri window, and
 *  `data-theme` on the document, which is what the palette and shadcn's `dark:`
 *  variant key off. Both happen in `applyAppearance` and nowhere else.
 *
 *  `tuiLightMode` in the shared `settings.json` is deliberately *not* consulted.
 *  It means "my terminal has a light background", which is a different surface
 *  from this window — one machine can reasonably want a dark GUI beside a light
 *  terminal — so the GUI neither reads nor writes it. It belongs on the P2
 *  settings screen as a TUI setting, listed under tokscale's own options.
 */

/** What the user chose. Stored in `gui.json` as `appearance`. */
export type Appearance = "system" | "light" | "dark";

/** What the window is actually wearing right now. */
export type Resolved = "light" | "dark";

export const DEFAULT_APPEARANCE: Appearance = "system";

/** Applies an appearance to both the window and the document.
 *
 *  Order matters, and it is the opposite of the obvious one. Inside a WKWebView
 *  `prefers-color-scheme` reports the *window's* NSAppearance, not the OS's — so
 *  it cannot be used to resolve "system" while the window is pinned. The window
 *  is handed back to macOS first (`setTheme(null)`), and only then is it asked
 *  what it ended up wearing. Asking first reads the value we are about to
 *  replace.
 *
 *  This is also why `tauri.conf.json` no longer pins `theme: "Dark"`: with the
 *  pin, "system" could only ever resolve to dark, whatever the machine was set
 *  to. The pin existed because there was no runtime switch; there is one now. */
export async function applyAppearance(appearance: Appearance): Promise<Resolved> {
  const window = getCurrentWindow();
  await window.setTheme(appearance === "system" ? null : appearance);
  const resolved = appearance === "system" ? ((await window.theme()) ?? "light") : appearance;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/** Keeps the document in step while the appearance is "system" and macOS flips
 *  underneath us — the default appearance, so this is P1 behaviour rather than a
 *  nicety. It writes `data-theme` itself rather than handing a value back, so
 *  the "one place writes the theme" rule above has no exception. Listens to the
 *  *window's* theme rather than a media query, for the same reason
 *  `applyAppearance` does. Returns an unsubscribe. */
export function followSystem(): Promise<() => void> {
  return getCurrentWindow().onThemeChanged(({ payload }) => {
    document.documentElement.dataset.theme = payload;
  });
}

/** Boot sequence. The window is created hidden (`visible: false` in
 *  tauri.conf.json) precisely so the first thing the user sees is already
 *  wearing the right NSAppearance — showing first and correcting after gives a
 *  visible flash of the wrong vibrancy. Rust shows the window anyway after a
 *  timeout, so a failure in here cannot leave the app windowless.
 *
 *  P1 has no stored preference to read yet: `gui.json` arrives with ticket 09's
 *  settings command, and this takes an argument at that point. Until then the
 *  default is the only value, so it is not a parameter. */
export async function initTheme(): Promise<void> {
  await applyAppearance(DEFAULT_APPEARANCE);
  await followSystem();
  const window = getCurrentWindow();
  await window.show();
  // A window shown this late has to ask for focus; it does not get it for free
  // the way a window that was visible at creation does.
  await window.setFocus();
}
