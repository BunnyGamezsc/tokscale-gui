# Phase 1: Tauri config

**Goal:** Windows gets a normal framed, opaque window and an NSIS installer. The macOS config stays byte-for-byte identical.

## Steps

1. Create `src-tauri/tauri.windows.conf.json`. Tauri 2 merges it over `tauri.conf.json` when building for Windows (JSON Merge Patch: `null` deletes a key, objects merge, **arrays replace wholesale**).

   ```json
   {
     "app": {
       "windows": [
         {
           "title": "Tokscale",
           "label": "main",
           "width": 1180,
           "height": 760,
           "minWidth": 880,
           "minHeight": 560,
           "decorations": true,
           "transparent": false,
           "visible": false
         }
       ]
     },
     "bundle": {
       "targets": ["nsis"],
       "windows": {
         "nsis": { "installMode": "currentUser" },
         "webviewInstallMode": { "type": "downloadBootstrapper" }
       }
     }
   }
   ```

   `app.windows` is an array, so the whole window entry is replaced. That is what drops `titleBarStyle`, `hiddenTitle`, `trafficLightPosition`, `windowEffects` and `transparent: true`. Copy every other field from the base entry so nothing else is lost. `visible: false` must stay: the frontend shows the window after applying the theme, and `lib.rs` has a 1500 ms fallback.

2. Leave `app.macOSPrivateApi: true` and the `macos-private-api` Cargo feature alone. They're ignored off macOS, and `tauri-build` checks that the feature matches the config.

3. Verify the merge rather than trusting it. Search the installed `@tauri-apps/cli` / `tauri-utils` for how platform config files are named and loaded (`tauri.windows.conf.json`). If this Tauri version differs, adapt the filename and note it in ADR 0009.

## Done when

- [x] `git diff src-tauri/tauri.conf.json` is empty.
- [x] macOS `pnpm tauri build --bundles app` still produces a signed `Tokscale.app` with the overlay titlebar (open it once).
- [x] 🪟 Windows build produces `Tokscale_<version>_x64-setup.exe`. The window has a native title bar and no transparent or black regions. (Proven in Phase 5 CI plus Phase 6 smoke.) (Owner-reported pass on native Windows, 2026-09-15.)

## Rollback

Delete `tauri.windows.conf.json`. Nothing else references it.
