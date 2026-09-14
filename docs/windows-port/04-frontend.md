# Phase 4: Frontend platform

**Goal:** on Windows, shortcuts use Ctrl and say so, the sidebar is opaque with no traffic-light gap, and no copy mentions macOS. macOS rendering doesn't change.

## Steps

1. **Platform flag.** In `src/main.tsx`, before rendering:
   ```ts
   document.documentElement.dataset.platform = navigator.userAgent.includes("Windows") ? "windows" : "mac";
   ```
   Export a tiny helper from a new `src/lib/platform.ts`:
   ```ts
   export const isWindows = () => document.documentElement.dataset.platform === "windows";
   ```
   Don't add `@tauri-apps/plugin-os`.

2. **Shortcuts, `src/lib/keys.ts`.**
   - `resolve(e, typing)` becomes `resolve(e, typing, mod: "meta" | "ctrl")`. Check the modifier through `mod`: `const modDown = mod === "meta" ? e.metaKey : e.ctrlKey`. Then `if (modDown)` handles `,` and digits exactly as today, and the "other modifier held" branch returns `null`. Keep `altKey` refused. Ctrl+R stays the webview reload on Windows, as ⌘R does on macOS.
   - `bindings(destinations, mod)` builds labels from `const k = mod === "meta" ? "⌘" : "Ctrl+"`, giving `${k}1 – ${k}${n}` and `${k},`.
   - Update the caller in `src/routes/tree.tsx` (the `keydown` listener) to pass `isWindows() ? "ctrl" : "meta"`. Also change the hard-coded `<kbd>⌘,</kbd>` next to Settings to use the same label.
   - Tests in `src/lib/keys.test.ts`: add cases where `mod: "ctrl"` resolves Ctrl+1 to nav 0, Ctrl+`,` to settings, and ignores Meta+1, plus labels that read `Ctrl+1 – Ctrl+8`. Existing tests pass `"meta"`.

3. **Sidebar, `src/routes/tree.tsx` and `src/styles.css`.**
   - The `<div className="h-11 shrink-0" data-tauri-drag-region />` spacer at the top of `<aside>` reserves room for traffic lights. Hide it on Windows with a CSS rule, not a React branch: add `[data-platform="windows"] .traffic-spacer { display: none; }` and give the div `className="traffic-spacer h-11 shrink-0"`. The main column's `h-11` filter row stays; its drag region is harmless under a native frame.
   - `--sidebar` and `--sidebar-accent`/`--sidebar-border` are translucent scrims over macOS vibrancy. With an opaque window they'd sit over the window background, which is fine visually but muddy. Add opaque overrides:
     ```css
     [data-platform="windows"] { --sidebar: oklch(0.975 0.004 80); }
     [data-platform="windows"][data-theme="dark"] { --sidebar: /* the dark theme's --background, slightly lifted */; }
     ```
     Pick the dark value from the existing dark palette in `styles.css`. Match the stone palette and add no new hues.
   - Font: `styles.css` leads with SF. Make sure the stack falls back to `"Segoe UI Variable", "Segoe UI"` before generic `system-ui` (check the existing `font-family` declaration and append if missing).

4. **Copy.**
   - `src/views/usage.tsx` `KEYCHAIN_NOTE` names macOS and `security`. On Windows, use: "Quota is read with the credentials each vendor's own tool saved, some of them in Windows Credential Manager." Choose with `isWindows()`.
   - `grep -rn 'macOS\|Finder\|Keychain\|⌘' src --include='*.tsx'` and handle every user-visible string the same way. Comments can stay.

5. **Theme.** `src/theme.ts` works on Windows as is: `setTheme`, `theme()` and `onThemeChanged` are cross-platform in Tauri 2. Don't change it.

## Done when

- [ ] `pnpm exec tsc --noEmit && pnpm test` pass, including the new `keys` cases.
- [ ] macOS dev build looks identical to before: traffic-light gap present, vibrant sidebar, ⌘ labels.
- [ ] 🪟 Ctrl+1…8 switch views, Ctrl+, opens Settings, `?` shows `Ctrl+` labels, and the sidebar is opaque in light and dark with no empty strip at the top.
