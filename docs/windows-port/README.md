# Windows port: runbook

You are porting the Tokscale GUI (Tauri 2 + React 19 + Rust) to Windows. This folder is the whole plan. Work the phases in order. Each phase is small, merges on its own, and must leave the macOS build working.

This replaces the spec-first approach in `../WINDOWS_PORT_OPUS_TASK.md`. The architecture decisions are already made below, so don't write a spec. Build.

## Why this is small

- Scanning, reports, pricing, quota, sync and accounts all run in-process through `tokscale-core` and `tokscale-cli`. Those crates already support Windows, including Credential Manager reads (`commands/usage/helpers.rs::read_keychain`) and Cursor's `state.vscdb` path (`cursor.rs`).
- Config paths come from core's `paths.rs`, and GUI settings from Tauri's app config dir. Both are already portable.
- `src-tauri/src/main.rs` already sets `windows_subsystem = "windows"`.

What actually breaks on Windows is short:

| # | Problem | Where | Phase |
|---|---|---|---|
| 1 | Window config is macOS-only (overlay titlebar, traffic lights, vibrancy, transparency, `.app` bundle) | `src-tauri/tauri.conf.json` | 1 |
| 2 | `std::os::unix::fs::PermissionsExt`, so the crate won't compile | `src-tauri/src/vendor.rs` | 2 |
| 3 | Vendor CLI search knows Homebrew and nvm, not npm/scoop/winget or `PATHEXT` | `src-tauri/src/vendor.rs` | 2 |
| 4 | Spawning `codex`/`grok` flashes a console window; killing the `codex.cmd` wrapper orphans node | fork `spawn.rs`, `commands/codex_activity.rs` | 3 |
| 5 | Shortcuts use ⌘/`metaKey`; sidebar has a traffic-light spacer and a translucent scrim; copy mentions macOS | `src/lib/keys.ts`, `src/routes/tree.tsx`, `src/styles.css`, `src/views/usage.tsx` | 4 |
| 6 | No Windows build, installer or release job | new `.github/workflows/`, release | 5 |

## Decisions (don't relitigate)

- **Target:** Windows 10 1809+ and Windows 11, **x64 only**. arm64 later if anyone asks.
- **Installer:** Tauri's **NSIS** bundle, `installMode: "currentUser"` (no admin), WebView2 via `downloadBootstrapper` (Tauri's default). No MSI.
- **Updates:** none. Users download new releases, as on macOS.
- **Signing:** **unsigned** for now. SmartScreen will warn, and the release notes say how to get past it. The `BunnyGamezDev` cert is a macOS keychain identity and doesn't carry over. Owner question Q1.
- **Window:** native Windows frame (`decorations: true`, no overlay, not transparent). **Opaque sidebar.** No Mica/Acrylic: it's Windows-11-only, and the scrim was designed for macOS vibrancy.
- **Shortcuts:** Ctrl replaces ⌘. Labels read `Ctrl+1 – Ctrl+8` and `Ctrl+,`. Bindings are otherwise identical (ADR 0003).
- **Platform detection:** Rust uses `cfg(target_os)` inside the one module that varies. The frontend reads `navigator.userAgent` once in `main.tsx` and sets `document.documentElement.dataset.platform` to `"windows"` or `"mac"`. No `@tauri-apps/plugin-os` dependency.
- **Tauri config:** platform differences go in a `tauri.windows.conf.json` merge file (Tauri 2 merges `tauri.<platform>.conf.json` over the base with JSON Merge Patch). `tauri.conf.json` stays the macOS source of truth, so the mac release is untouched.

## Rules

- Keep each phase's diff small. No new abstractions beyond what a phase names. Don't refactor portable code for symmetry.
- `vendor/tokscale` is a fork. Fork changes follow the tag discipline in ROADMAP "Settled": commit on branch `lib-target`, push, tag the next `gui-v4.15.1-lib.N`, then bump **both** the `tag =` lines in `src-tauri/Cargo.toml` and the submodule pointer in the same GUI commit. List every fork change in ADR 0002. Mark fork edits with a `// FORK NOTE:` comment, as existing ones are.
- A phase is done when its **Done when** boxes are all true. Anything marked 🪟 can only be proven on native Windows (the CI runner or a Windows VM), never on macOS.
- After each phase, run the mac checks:
  ```sh
  pnpm exec tsc --noEmit && pnpm test
  cd src-tauri && CARGO_BUILD_JOBS=4 cargo test --lib
  ```
- Don't cross-compile from macOS (`cargo check --target x86_64-pc-windows-msvc` fails on C deps like rusqlite). The Windows CI job from Phase 5 is the compile check. You can pull Phase 5's CI job forward and run it from Phase 1 onward.
- Never put real tokens, emails or credential values in fixtures, logs or docs.

## Order

1. [Phase 1: Tauri config](01-tauri-config.md)
2. [Phase 2: Vendor CLI resolution](02-vendor-resolution.md)
3. [Phase 3: Fork spawn fixes](03-fork-spawn.md)
4. [Phase 4: Frontend platform](04-frontend.md)
5. [Phase 5: CI and release](05-ci-release.md)
6. [Smoke test on Windows](06-windows-smoke.md)

At the end, write `docs/adr/0009-windows-port.md`: the decisions above, one paragraph each. Add a "Windows port" line under ROADMAP "Built", and a Windows section to README's download/limitations.

## Owner questions (don't block on these)

- **Q1:** Buy an OV/EV code-signing cert or use Azure Trusted Signing? Blocks only removing the SmartScreen warning. Ship unsigned until answered.
- **Q2:** Is a Windows arm64 build wanted? Blocks nothing in this plan.
