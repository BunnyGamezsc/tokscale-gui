# 2. Fork tokscale-cli to obtain a library target

Date: 2026-09-05

## Status

Accepted

## Context

Scope for this port covers phases P1–P3, where P3 is authentication and provider sync:
OAuth flows for Claude, Codex, Cursor, Grok and Kimi; `cursor`, `antigravity` and
`trae` sync; and Codex multi-account management.

None of that lives in `tokscale-core`. It lives in the `tokscale-cli` crate —
`auth.rs`, `cursor.rs`, `trae.rs`, `warp.rs`, `antigravity.rs`, `hindsight.rs` and the
`commands/` tree, some 12,500 lines for the auth and sync surface alone.

`tokscale-cli` declares only a `[[bin]]` target. It has no `[lib]`. None of that code
is reachable from another crate.

Three options were considered:

1. **Bundle the `tokscale` binary as a Tauri sidecar** and drive it over stdio using
   its existing `--json` output. No fork, upstream updates are a version bump.
2. **Fork `tokscale-cli` and add a `[lib]` target**, then call it in-process.
3. **Reimplement the auth and sync logic natively** in the Tauri backend.

## Decision

Fork the repository, add `crates/tokscale-cli/src/lib.rs` re-exporting the modules the
GUI needs, reduce `main.rs` to a thin shim over that library, and consume the fork as a
git submodule.

The project ships as a single binary with no bundled executable.

Option 1 was rejected because it entails shipping a second executable inside the app
bundle, which was ruled out as a product constraint.

Option 3 was rejected because reimplementing OAuth against five providers, plus
Electron `globalStorage` AES decryption and SQLite token extraction, would be both the
largest single work item in the project and a permanent source of divergence from
upstream.

No upstream pull request will be opened; the fork is maintained privately.

## Consequences

Every upstream update requires a merge into the fork. The conflict surface is small by
construction — one added file plus a reduced `main.rs` — but it is permanent, and it
never gets smaller, because the change is not being upstreamed.

Auth and sync run in-process. There is no subprocess, no stdio protocol, and no
serialization boundary, so errors surface as Rust values rather than parsed text.

The GUI is coupled to `tokscale-cli`'s module-internal API, which is markedly less
stable than `tokscale-core`'s, having never been designed for external callers. Upstream
is free to restructure it at will.

Should this maintenance burden prove unsustainable, the sidecar approach remains
available as a fallback, at the cost of the single-binary constraint.

**Amended 2026-09-05.** The fork's scope is wider than this ADR first assumed. Research
into `tauri-specta` established that `#[specta(remote)]` fails the orphan rule from the GUI
crate, so TypeScript type derives must be added to `tokscale-core` inside the fork as well.
The fork therefore spans both crates, and ADR 0001's dependency resolves to it rather than
to upstream. The merge conflict surface grows accordingly: no longer one added file plus a
reduced `main.rs`, but also every core struct carrying a derive attribute.
