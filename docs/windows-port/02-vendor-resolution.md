# Phase 2: Vendor CLI resolution

**Goal:** `src-tauri/src/vendor.rs` compiles on Windows and finds `codex`, `gh`, `claude`, `gemini`, `grok` and `kiro-cli` where Windows installers put them. The macOS behaviour and tests stay unchanged.

Read ADR 0006 first. The shape stays: pure `resolve(name, path_dirs, extra_dirs)`, a thin impure layer, and three outcomes (`OnPath`, `OffPath`, `NotInstalled`).

## Background

Unlike launchd, Explorer does pass the user's `PATH` to apps. So on Windows `OnPath` is the common case, and the extra directories are a fallback for installs that never touched `PATH`. What really differs is:

- **Executable test.** Windows has no mode bits. A name resolves to `name` + each extension in `PATHEXT` (default `.COM;.EXE;.BAT;.CMD`). npm global installs are `codex.cmd`, and winget/scoop use `.exe` shims.
- **Candidate directories.**
- **PATH separator.** `std::env::split_paths` already handles `;`, so nothing to do.

## Steps

1. Replace `executable(path)` with a per-OS pair, with `cfg` only inside these functions:
   - `#[cfg(unix)]`: unchanged (`is_file && mode & 0o111 != 0`). Move `use std::os::unix::fs::PermissionsExt` inside it.
   - `#[cfg(windows)]`: `metadata(path).is_file()`.
2. Make `first_executable(name, dirs)` try candidates. On unix that's just `dir/name`. On Windows it's `dir/name` followed by `dir/name.ext` for each `PATHEXT` extension, taken from an injected `&[String]` so tests control it. Keep the pure function pure: pass `exts` into `resolve`. It's an empty slice on unix, and on Windows the impure layer reads `PATHEXT` (default `[".COM", ".EXE", ".BAT", ".CMD"]`). Return the path **with** the extension, because Rust std's `Command` needs it to run `.cmd`/`.bat` correctly.
3. Split `extra_dirs()` by OS. Keep `home_dirs(home)` for macOS. Add `#[cfg(windows)] fn windows_dirs(user_profile: &Path, appdata: &Path, local_appdata: &Path) -> Vec<PathBuf>`, pure over its inputs, in this order:
   1. `%APPDATA%\npm` (npm global: codex, gemini, claude)
   2. `%LOCALAPPDATA%\Volta\bin`
   3. `%USERPROFILE%\scoop\shims`
   4. `%LOCALAPPDATA%\Microsoft\WinGet\Links`
   5. `%USERPROFILE%\.bun\bin`
   6. `%USERPROFILE%\.cargo\bin`
   7. `%USERPROFILE%\.local\bin` (claude's native installer, grok)
   8. `%LOCALAPPDATA%\Programs\GitHub CLI` and `C:\Program Files\GitHub CLI` (gh MSI)

   Read `USERPROFILE`, `APPDATA` and `LOCALAPPDATA` with `std::env::var_os`, and skip any that are missing.
4. `VENDOR_CLIS` doesn't change. `for_spawn` and `vendor_clis` don't change beyond threading `exts`.
5. Tests, which must compile and run on macOS:
   - Extract the extension-matching core as a `cfg`-free helper so it's testable on macOS. For example, `fn candidates(dir, name, exts) -> Vec<PathBuf>`, where `exts.is_empty()` means the unix behaviour. Test that with `exts = [".EXE", ".CMD"]`, a tempdir holding `codex.cmd` resolves to `codex.cmd` and `gh.exe` beats a later `gh.cmd` in the same directory.
   - Test `windows_dirs` order with fake paths (make the fn non-`cfg` and `#[allow(dead_code)]` on unix, or `cfg(any(windows, test))`).
   - All existing tests stay green unchanged.

## Done when

- [x] `cargo test --lib` passes on macOS with the new tests.
- [x] 🪟 `cargo test --lib` passes on the Windows CI runner.
- [ ] 🪟 On a Windows machine with `npm i -g @openai/codex`, the Vendor CLIs sheet shows `codex` found at `...\AppData\Roaming\npm\codex.cmd`.

## Rollback

Revert the file. The macOS path is unchanged by construction; check that `git diff` shows no edits inside `home_dirs`/`nvm_dirs`.
