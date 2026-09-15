# Task: fully specify the Tokscale Windows port

## Role

You are the architecture owner for a Windows port of this repository. Produce an implementation-ready specification grounded in the current code. Do not implement the port in this task.

The CLI and its Rust crates already support Windows. The GUI is a Tauri 2, React 19, TypeScript, and Rust application designed for macOS. The useful question is not whether Tauri can build an `.exe`. Find every behavior where the GUI assumes macOS, decide how that behavior should work on Windows, and describe the smallest maintainable change set.

## Required output

Create `docs/WINDOWS_PORT_SPEC.md`.

The specification is complete only when an implementer can take each work item without having to rediscover the architecture, choose an unspecified product behavior, or guess how completion will be tested.

Do not edit application code. You may add diagrams or short investigation notes under `docs/` only when they directly support the specification.

## Repository facts to verify first

Treat these as leads, not as a substitute for reading the code:

- `package.json` uses Tauri 2, React 19, Vite, TypeScript, and Vitest.
- `src-tauri/Cargo.toml` links `tokscale-core` and the `tokscale-cli` library from the fork under `vendor/tokscale`.
- The GUI calls the Rust libraries directly. It does not launch the `tokscale` CLI executable for normal scans and reports.
- The six vendor CLIs are external executables. `src-tauri/src/vendor.rs` currently searches macOS shell-manager, Homebrew, and user installation paths.
- `src-tauri/tauri.conf.json` enables macOS private APIs, an overlay title bar, traffic-light positioning, transparency, a sidebar window effect, an `.app` bundle target, and macOS signing.
- `src/theme.ts`, `src/styles.css`, and `src/routes/tree.tsx` couple layout and appearance to macOS window behavior.
- `src/lib/keys.ts` and `docs/adr/0003-the-keyboard-surface.md` define shortcuts around the Command key and macOS conventions.
- The vendored CLI contains Windows-specific credential, process-discovery, scheduler, and executable-handling code. Reuse that support where the GUI reaches it.

## Investigation sequence

### 1. Establish the current execution model

Read `README.md`, `CONTEXT.md`, `ROADMAP.md`, every ADR under `docs/adr/`, the frontend entry and shell, all Rust modules under `src-tauri/src/`, Tauri configuration and capabilities, and the relevant vendored crate code.

Trace these flows from UI event to filesystem, process, network, or credential access:

- initial launch and first scan
- refresh and auto-refresh
- report queries and filters
- vendor quota reads
- account discovery and switching
- Cursor, Antigravity, and Trae sync
- pricing refresh and local pricing overrides
- GUI settings load and save
- vendor CLI discovery and invocation
- theme selection and window reveal

For each flow, name the module, interface, side effects, OS assumptions, error modes, and existing tests. This step is done when every Tauri command and every external process call appears in the trace.

### 2. Build a portability inventory

Search the GUI and vendored crates for OS checks, environment variables, hard-coded paths, executable names, shell use, keychain access, process discovery, path separators, file replacement semantics, window effects, shortcuts, icons, bundle formats, and signing configuration.

Classify every finding as:

- already portable
- portable through the vendored CLI
- needs a Windows adapter
- needs a shared refactor
- product decision required
- verification only

Record the source file and symbol for every finding. This step is done when every macOS-specific search result is classified and every Windows-specific vendored implementation that the GUI depends on is accounted for.

### 3. Define the target architecture

Keep shared report and domain logic platform-neutral. Introduce a seam only where behavior actually varies between macOS and Windows. Each proposed module must have one small interface that states inputs, outputs, invariants, error modes, and side effects. Name the macOS and Windows adapters at each real seam.

At minimum, make explicit decisions for:

- home, config, cache, and data path resolution
- vendor executable discovery, including `.exe`, `.cmd`, and `.bat` behavior when relevant
- safe process spawning without a shell unless a shell is required
- credential storage and account switching
- atomic settings writes and Windows file-lock behavior
- theme synchronization and startup reveal
- native window frame versus custom title bar
- sidebar material or an opaque Windows fallback
- platform shortcut labels and modifier handling
- sync process discovery and permissions
- installer format, install scope, WebView2 handling, upgrades, uninstall, and per-user data retention
- artifact names, CPU architectures, code signing, release automation, and checksums
- crash logs and diagnostics that a Windows user can locate

Apply the deletion test to each proposed module. If deleting it would remove complexity rather than push complexity into multiple callers, it is too shallow and should not exist.

### 4. Resolve product and release choices

Recommend one default for each unresolved choice. Include rejected alternatives and the evidence that decided the choice. Do not leave a menu of options for the implementer.

Define:

- supported Windows editions and minimum version
- initial CPU architecture and later expansion, if any
- installer and update policy
- signed versus unsigned development, preview, and stable artifacts
- expected behavior when WebView2 or a vendor CLI is absent
- Windows visual treatment, including whether macOS vibrancy has a platform-specific counterpart or a deliberate opaque design
- shortcut behavior and visible shortcut notation

Use primary sources for facts that may change, especially Tauri configuration and bundling, Microsoft signing and WebView2 requirements, and GitHub Actions runner behavior. Link each source beside the decision it supports and record the version or access date when useful.

### 5. Design verification before implementation

Specify tests at the same seams callers use. Include:

- Rust unit tests that run on macOS and validate Windows path and executable cases with injected inputs
- target-gated Rust tests for Windows-only OS calls
- frontend tests for modifier keys, labels, layout state, and theme behavior
- `cargo check` and tests for Windows targets where cross-compilation is meaningful
- a native Windows CI build and test job
- clean Windows VM smoke tests for first launch, scan, settings persistence, vendor CLI states, credentials, sync, upgrade, and uninstall
- an artifact inspection checklist for executable metadata, icons, signatures, installer contents, and accidental macOS resources

Every test must name its layer, fixture or environment, assertion, and failure it prevents.

### 6. Produce the implementation plan

Break the work into reviewable phases. Start with platform-neutral refactors that preserve the macOS build, then add Windows adapters, frontend behavior, packaging, CI, and native smoke verification.

For every work item provide:

- goal
- exact files or symbols expected to change
- interface or configuration change
- dependencies on earlier work
- tests to add or update
- acceptance criteria that a reviewer can observe
- rollback or containment note when the change can affect the existing macOS release

Call out work that must run on a Windows machine. A macOS-only check cannot close a Windows behavior item.

## Required structure for `docs/WINDOWS_PORT_SPEC.md`

1. Executive decision summary
2. Current architecture and traced flows
3. Portability inventory table
4. Target module map and platform seams
5. Detailed Windows behavior decisions
6. Packaging, signing, and release design
7. Security and privacy review
8. Test and CI matrix
9. Ordered implementation plan
10. Risks, mitigations, and rollback points
11. Open questions for the repository owner
12. Sources

Use a Mermaid diagram for the target module map and a table for the test matrix. Keep open questions to choices that require owner authority, such as certificate ownership or release policy. Technical questions belong in the investigation and must be answered in the specification.

## Non-goals

- Linux support
- redesigning reports or domain terminology
- replacing Tauri, React, or the vendored Rust crates without evidence that the current stack blocks a requirement
- rewriting portable modules merely to create symmetry
- implementing an updater if the repository has no approved update policy, though the specification must decide how updates will work
- changing the CLI's user-facing behavior unless the GUI exposes a concrete Windows defect that cannot be fixed at the GUI seam

## Constraints

- Preserve current macOS behavior and release output throughout the migration.
- Keep `tokscale-core` and `tokscale-cli` as the source of scanning, aggregation, auth, usage, and sync behavior.
- Keep CLI settings and GUI settings as separate files with the ownership rules in ADR 0005 and ADR 0008.
- Preserve the meanings recorded in `CONTEXT.md`.
- Prefer dependency injection for OS behavior so tests can pass paths, environments, command runners, and credential adapters without mutating the developer machine.
- Use platform conditionals inside adapters or build configuration, not scattered through callers.
- Describe secrets and tokens by location and lifecycle. Never copy real credential values into notes or fixtures.
- Preserve unrelated working-tree changes.

## Final self-review

Before handing off the specification, verify all of the following:

- Every Tauri command and external process call is represented in the flow trace.
- Every known macOS assumption has a disposition.
- Every proposed seam has at least two adapters or a documented testing reason.
- The selected installer, signing path, Windows baseline, and architecture are unambiguous.
- Each phase can merge without knowingly breaking the macOS build.
- Windows-only acceptance criteria name the native environment that proves them.
- No implementation item says "investigate," "decide," or "TBD."
- Remaining owner questions are few, explicit, and block a named downstream item.

End the document with a short `Ready to implement when` checklist. The handoff is done when every box can be answered from the specification or is tied to one owner decision.
