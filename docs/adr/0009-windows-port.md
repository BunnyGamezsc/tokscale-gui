# 9. The Windows port

Date: 2026-09-14

## Status

Accepted

## Context

Scanning, reports, pricing, quota, sync and accounts already run in-process through
`tokscale-core` and `tokscale-cli`, and both crates support Windows. What didn't port was
the window config, one Unix-only import and the search path in `vendor.rs`, two vendor CLI
spawn paths in the fork, the ⌘ shortcuts and macOS copy in the frontend, and the absence of
any Windows build. `docs/windows-port/` is the runbook that fixed each one.

## Decision

**Target.** Windows 10 1809 and later and Windows 11, x64 only. arm64 waits until someone
asks for it (owner question Q2).

**Installer.** Tauri's NSIS bundle with `installMode: "currentUser"`, so installing needs no
admin rights. WebView2 comes through `downloadBootstrapper`, Tauri's default. There is no MSI.

**Updates.** None. Users download new releases, as they do on macOS.

**Signing.** Unsigned for now. SmartScreen warns, and the README and release notes say how to
get past it. The `BunnyGamezDev` certificate is a macOS keychain identity and doesn't carry
over. An OV/EV certificate or Azure Trusted Signing is owner question Q1.

**Window.** A native Windows frame: `decorations: true`, no overlay titlebar, not transparent.
The sidebar is opaque. Mica and Acrylic were not used because they're Windows 11 only, and the
sidebar's translucent scrim was designed for macOS vibrancy.

**Shortcuts.** Ctrl replaces ⌘, and the sheet and Settings label read `Ctrl+1 – Ctrl+8` and
`Ctrl+,`. The bindings are otherwise the ones ADR 0003 settled. `keys.ts` takes the modifier as
an argument, so both sets are tested on any machine. Ctrl+R stays the webview's reload.

**Platform detection.** Rust uses `cfg(target_os)` inside the one module that varies. The
frontend reads `navigator.userAgent` in `main.tsx` and sets `data-platform` on the root element
to `"windows"` or `"mac"`. There is no `@tauri-apps/plugin-os` dependency. Components call
`isWindows()` while rendering, not at module load, because ES imports evaluate `tree.tsx` and
`usage.tsx` before `main.tsx`'s body sets the flag.

**Tauri config.** Windows differences live in `tauri.windows.conf.json`, which Tauri 2 merges
over the base config. `tauri.conf.json` stays the macOS source of truth and is unchanged, so the
macOS release is untouched.

**CI and release.** `.github/workflows/windows.yml` typechecks, runs vitest and
`cargo test --lib`, builds the NSIS installer on `windows-latest`, and uploads it as an
artifact. On a `v*` tag a second job renames it to `Tokscale-<v>-windows-x64-setup.exe`, adds a
`.sha256`, and attaches both to the existing GitHub release. The macOS zips are still built and
uploaded by hand.

## Runbook adaptations

- Phase 3's `cargo update ... --offline` failed because Cargo's git cache hadn't fetched the
  new fork tag. The same command without `--offline` fetched `gui-v4.15.1-lib.6` and succeeded.
  It also dropped three unused Windows support crates from `Cargo.lock`, and the Rust suite
  passed afterwards.
- Phase 5's pnpm version comes from the local install (11.22.0), because `package.json` has no
  `packageManager` field and the lockfile header records only `lockfileVersion: '9.0'`.
- Phase 5's test release tag was not created. The owner ruled out release tags for this pass,
  so the `release` job is unproven.

## Consequences

- The macOS build is unchanged: every Windows style rule is scoped under
  `[data-platform="windows"]`, and `tauri.conf.json` has no diff.
- Anything marked 🪟 in the runbook can only be proven by the Windows CI job or on a real
  Windows machine (`docs/windows-port/06-windows-smoke.md`).
- The Windows installer triggers SmartScreen until Q1 is answered.
