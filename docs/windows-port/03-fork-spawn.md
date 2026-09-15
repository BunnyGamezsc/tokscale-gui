# Phase 3: Fork spawn fixes

**Goal:** vendor CLI spawns from the GUI don't flash a console window, and `codex app-server` is fully cleaned up on Windows. This is a fork change (`vendor/tokscale`), so follow the tag discipline in `README.md`.

## Background

- A GUI-subsystem app (`windows_subsystem = "windows"`) that spawns a console program makes Windows open a console window unless the child is created with `CREATE_NO_WINDOW` (`0x08000000`). Every spawn goes through `crates/tokscale-cli/src/spawn.rs::command` (Grok's fallback and `codex_activity`), so fix it once there.
- On Windows, npm's `codex` is `codex.cmd`, which runs `cmd.exe`, then `node`, then the native `codex.exe`. `Child::kill()` terminates only `cmd.exe`, leaving node and the app-server alive with our pipes open. That's the same hang ADR 0002's lib.5 note fixed on unix with SIGTERM. Windows needs a tree kill.
- Rust std (≥1.77) runs `.cmd`/`.bat` through `cmd.exe` with safe argument escaping, so no shell wrapper is needed. The args here are fixed literals.

## Steps (in `vendor/tokscale`, branch `lib-target`)

1. `crates/tokscale-cli/src/spawn.rs`, inside `command()`, after building the `Command` and only on the resolver path (the CLI's own `Command::new(name)` path stays exactly upstream):
   ```rust
   // FORK NOTE: a GUI-subsystem parent would otherwise open a console window per spawn.
   #[cfg(windows)]
   {
       use std::os::windows::process::CommandExt;
       command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
   }
   ```
   `path_with_dir_of` already uses `split_paths`/`join_paths`, so the PATH prepend works on Windows. Leave it.
2. `crates/tokscale-cli/src/commands/codex_activity.rs`, `impl Drop for AppServerTransport`: next to the existing `#[cfg(unix)]` SIGTERM block, add
   ```rust
   // FORK NOTE: `codex.cmd` -> node -> codex.exe; kill() only reaches cmd.exe.
   #[cfg(windows)]
   {
       use std::os::windows::process::CommandExt;
       let _ = std::process::Command::new("taskkill")
           .args(["/T", "/F", "/PID", &self.child.id().to_string()])
           .creation_flags(0x0800_0000)
           .status();
   }
   ```
   `taskkill` is in `System32`, which is always on `PATH`. Keep the existing `kill()`/`wait()` after it.
3. Commit, push `lib-target`, tag `gui-v4.15.1-lib.6`, push the tag. In the GUI repo, bump both `tag = "gui-v4.15.1-lib.6"` lines in `src-tauri/Cargo.toml` and the submodule pointer, run `cargo update -p tokscale-cli -p tokscale-core --offline` in `src-tauri`, and commit them together. Add an ADR 0002 amendment listing both changes.

No new tests: both changes are one OS call behind `cfg(windows)` and can't be asserted on macOS. Phase 6 verifies them.

## Done when

- [x] macOS: `cargo test --lib` in `src-tauri` passes, and `real_codex_activity` (`cargo test --lib -- --ignored --nocapture real_codex_activity`) still prints `available`.
- [x] Tag `gui-v4.15.1-lib.6` exists on the fork remote, and `Cargo.toml`, `Cargo.lock` and the submodule all point at it.
- [x] 🪟 Opening Settings with a Codex account shows the activity row and no console window flashes. (Owner-reported pass on native Windows, 2026-09-15.)
- [x] 🪟 Afterwards, `tasklist | findstr codex` shows no leftover `codex.exe` or `node.exe` from the app. (Owner-reported pass on native Windows, 2026-09-15.)
