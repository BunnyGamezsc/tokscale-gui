# Phase 6: Smoke test on native Windows

Run this on a **clean** Windows 11 x64 VM (and, if you have one, Windows 10 22H2), using the installer from the Phase 5 artifact. You can't tick these off from macOS. Record pass/fail and screenshots in the PR or release.

Fixture setup: install Node 22 LTS, then `npm i -g @openai/codex`, and sign in with `codex login`. Optionally install the Cursor app and sign in. Use a throwaway account, never a real one.

| # | Check | Pass when |
|---|---|---|
| 1 | Install | SmartScreen "More info → Run anyway" works; installs without a UAC prompt into `%LOCALAPPDATA%\Tokscale`; Start menu entry has the icon |
| 2 | WebView2 missing | On a VM with WebView2 removed (or Windows 10 without it), the installer fetches it and the app launches |
| 3 | First launch | Window appears with a native title bar, no white/black flash of the wrong theme, first-run scan screen shows |
| 4 | Scan | With Codex transcripts present, Overview shows usage; Refresh (`R`) works |
| 5 | Theme | Settings → Light/Dark/System each apply; switching Windows' app mode while on System follows it |
| 6 | Settings persist | Change interval refresh, quit, relaunch: setting kept (file under `%APPDATA%\dev.bunnygamezsc.tokscale-gui\gui.json`) |
| 7 | Shortcuts | Ctrl+1…8, Ctrl+, , `?`, `R` all behave; `?` sheet shows `Ctrl+` labels |
| 8 | Vendor CLIs | Sheet shows `codex` found under `AppData\Roaming\npm\codex.cmd`; uninstalled ones read "Not installed" |
| 9 | Usage | Codex card fetches; email masked until clicked; note mentions Credential Manager, not macOS |
| 10 | Accounts | Settings → Codex → Add imports the login; activity row appears; **no console window flashes**; `tasklist` shows no leftover `codex.exe`/`node.exe` 15 s later |
| 11 | Sync | Cursor sync: synced rows if Cursor is signed in, or the "Sign in to the Cursor app" message if not, never a crash |
| 12 | Modals | Sync, Settings, Vendor CLIs, day detail open centred |
| 13 | Upgrade | Install the previous release's setup, then this one over it: app launches, `gui.json` settings survive |
| 14 | Uninstall | Apps & features → Uninstall removes the app and Start menu entry; `~/.config/tokscale` (shared with the CLI) is left intact |

Any failure goes back to the phase that owns it (the README table). Fix it there and re-run only the failed rows plus rows 1, 3 and 4.

## Done when

- [x] Every row passes on Windows 11 x64. (Owner-reported pass on native Windows, 2026-09-15.)
- [x] ADR 0009, ROADMAP and README are updated (see `README.md` "Order").
