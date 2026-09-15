# Test results — native Windows run, 2026-09-15

Machine: Windows x64, Node v22.20.0, pnpm 10.12.4 (CI pins 11.22.0),
Rust 1.98.1 (matches `rust-toolchain.toml`; floor is 1.88).
Fresh clone state: no `node_modules/`, no `src-tauri/target/`, no `dist/`.
Submodule `vendor/tokscale` checked out at `gui-v4.15.1-lib.6`.

Companion document: `docs/WINDOWS_PORT_SPEC.md` (the port specification this
run verifies). Both files ship on branch `docs/windows-test-results`.

## 1. `pnpm install --frozen-lockfile` — PASS

449 packages, done in ~15 s. Lockfile up to date, no resolution changes.

## 2. `pnpm exec tsc --noEmit` — PASS

No output, exit 0. No type errors.

## 3. `pnpm test` (vitest) — PASS

```
Test Files  12 passed (12)
     Tests  59 passed (59)
Duration 713ms
```

All 59 frontend tests pass, including the Windows `keys.test.ts` cases
(Ctrl modifier resolution, `Ctrl+1 – Ctrl+8` / `Ctrl+,` labels).

## 4. `pnpm build` (`tsc --noEmit && vite build`) — PASS

Built in 1.73 s, 303 modules. `dist/` produced
(`index.html`, `index-*.css` 50 kB, `index-*.js` 441 kB / 137 kB gzip).

## 5. `cargo test --locked` (in `src-tauri`) — PASS, with one ordering lesson

**First attempt FAILED to compile** — not a code failure:

```
error: proc macro panicked
  --> src\lib.rs:92:14
   = help: message: The `frontendDist` configuration is set to `"../dist"`
     but this path doesn't exist
```

`tauri::generate_context!()` needs `dist/` at compile time, and a fresh
clone has none. Running `pnpm build` first (exactly the order CI uses:
`vite build` before `cargo test --lib`) fixed it. Second attempt:

```
test result: ok. 51 passed; 0 failed; 10 ignored; 0 measured
```

Plus bin-target and doc-test suites: 0 tests each, ok. Breakdown:

- `commands` (scan/report/narrowing/bucketing/agents/hourly): all pass,
  including `a_client_narrowing_is_inert_against_the_held_snapshot` and the
  Windows-path-independent client-narrowing pins.
- `vendor` (CLI resolution): all pass on native Windows, including
  `windows_extensions_resolve_in_pathext_order` and
  `windows_candidate_directories_follow_installer_precedence`.
- `pricing` / `gui` / `settings` / `sync` / `usage`: all pass.
- The 10 `ignored` tests are the real-machine probes (require credentials,
  network, or provider logins): `real_codex_activity`,
  `switching_reaches_usage_and_sync`, `a_scan_warms_the_graph_path`,
  `a_warm_scan_and_the_minutely_fold`, `daily_detail_agrees_with_the_daily_row`,
  `graph_report_cost`, `no_agent_share`, `real_sync_reaches_the_scan`,
  `real_quota_fetch`, `what_this_machine_resolves`. Skipped by default, as
  designed — none was run.

Pre-existing warnings (not failures, present on macOS too unless noted):

- fork `tokscale-cli`: unused import `std::io::Write` (`trae.rs:58`),
  never-used `gh_wincred_targets_display` (`copilot.rs:63`).
- GUI crate on Windows: `home_dirs`, `nvm_dirs`, `version_key` reported as
  never used — expected, they are the unix branch of `extra_dirs()` while
  `windows_dirs()` serves Windows (the unix tests still exercise them).

## 6. App run smoke (`pnpm tauri dev`, 5 minutes) — PASS

- Vite dev server up in 501 ms on `http://localhost:1420/`.
- Debug backend compiled in 32.47 s and launched:
  `Running target\debug\tokscale-gui.exe`.
- The process stayed alive for the full 5-minute window with **no panics,
  no errors, no console-window or spawn failures** in the log, then was
  stopped at the timeout. A startup crash (e.g. missing WebView2) would have
  exited immediately with an error; the event loop staying alive means the
  window was created and the first scan ran.
- Caveat: headless run — the window itself was not visually inspected.
  Interactive checks (first-run panel, Ctrl shortcuts, opaque sidebar,
  Vendor CLIs sheet) remain Phase 6 VM items in the spec.

## Verdict

Everything that can pass on this machine passes: typecheck, all 59 frontend
tests, all 51 Rust tests (10 credential-gated probes skipped by design),
production frontend build, and a 5-minute live run with a clean log.
The one fresh-clone gotcha (build `dist/` before `cargo test`) matches CI
ordering and needs no code change.
