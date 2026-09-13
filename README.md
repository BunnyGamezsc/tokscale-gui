# Tokscale

A native macOS GUI for [tokscale](https://github.com/junhoyeo/tokscale): see the tokens and
money your AI coding clients have used, read locally from their transcripts.

Built with Tauri 2, React 19, TypeScript and Tailwind v4. The Rust backend calls a fork of
`tokscale-core` in-process, so the GUI's numbers match the tokscale TUI's exactly.

## Download

Get the latest build from [Releases](https://github.com/BunnyGamezsc/tokscale-gui/releases):

| Mac | File |
|---|---|
| Apple Silicon (M1 and later) | `Tokscale-<version>-macos-arm64.zip` |
| Intel | `Tokscale-<version>-macos-x86_64.zip` |

Requires macOS 10.15 or later.

**Builds are unsigned.** Right-click the app, choose **Open**, then go to **Settings** > **Privacy and Security** and allow the app to be opened. Alternatively, run:

    xattr -dr com.apple.quarantine /Applications/Tokscale.app

> I don't currently have an Apple Developer Account so you will have to sign it yourself (It will say unidentified developer if you don't)!
> If you don't like the insecure popup, check / build the source code yourself.

## Features

- **Views:** Overview, Usage, Models, Daily, Hourly, Stats, Agents and Pricing, plus an
  optional Minutely view
- **Usage:** each provider's own quota (Claude, Codex, Copilot, Grok and more), read from the
  credentials their tools already stored
- **Sync:** pulls Cursor, Antigravity and Trae usage into the local cache every view reads
- **Accounts:** add, switch and remove Cursor and Codex accounts from Settings (⌘,)
- **Report Filter:** narrow by client and date range, shared across all views
- **Contribution Graph:** one year at a time, with a year picker and full keyboard access
- **Manual pricing:** set rates for models that have usage but no price
- **Cold first run:** the first scan reads every client's transcripts and takes about 21–40 s;
  later scans are much faster
- **Keyboard:** ⌘1–⌘8 switch views, `R` refreshes, ⌘, opens Settings, `?` lists the shortcuts
- **Vendor CLI resolution:** finds CLIs installed outside the default `PATH` (Homebrew, nvm,
  `~/.local/bin` and so on), including when the app is launched from Finder rather than a shell

## Building from source

Prerequisites: Rust via rustup, Node.js and pnpm.

    git clone --recurse-submodules https://github.com/BunnyGamezsc/tokscale-gui.git
    cd tokscale-gui
    pnpm install
    pnpm tauri dev            # run in development
    pnpm tauri build          # release .app for this Mac

To build for Intel from an Apple Silicon Mac (no Rosetta needed):

    pnpm tauri build --target x86_64-apple-darwin

### Toolchain

- `rust-toolchain.toml` pins the toolchain the app is built and tested with (1.98.1). rustup
  picks it up automatically, including from `src-tauri/` and `vendor/tokscale/`.
- `rust-version` in `src-tauri/Cargo.toml` is the minimum supported version (1.88), measured
  by building on it. After a dependency bump, re-check it with `cargo +1.88 check --locked`
  from `src-tauri/`.

### Tests

    pnpm exec tsc --noEmit    # typecheck
    pnpm test                 # frontend (vitest)
    cd src-tauri && cargo test

## Project layout

| Path | Contents |
|---|---|
| `src/` | React frontend: views, components, and the scan and query hooks |
| `src-tauri/` | Tauri backend. `commands.rs` holds the IPC commands, `dto.rs` the hand-written boundary types |
| `vendor/tokscale/` | Git submodule: the tokscale fork (branch `lib-target`) |
| `docs/adr/` | Architecture decision records |
| `ROADMAP.md` | What's settled, built and still open |
| `CONTEXT.md` | Domain glossary |

### The tokscale fork

`src-tauri/Cargo.toml` pins `tokscale-core` to a git tag on the fork (currently
`gui-v4.15.1-lib.2`). A `[patch]` section points it at the `vendor/tokscale` submodule so
day-to-day work edits real files. When the fork moves, bump the tag and the submodule pointer
together. See ADR 0001 and ADR 0002.

## Limitations

- **macOS only.** The window style, theming and shortcuts are built for macOS (ADR 0003).
- **Unsigned and not notarized.**
- **Keychain prompts** can appear the first time the Usage view reads a stored credential.
  `/usr/bin/security` is the reader.
- **A Cursor sync makes the Cursor app's signed-in account active again**, as
  `tokscale cursor sync` does.

## Credits

The usage engine is [tokscale](https://github.com/junhoyeo/tokscale), Copyright (c) 2025
Junho Yeo, used under the MIT License; see `vendor/tokscale/LICENSE`. This app builds on a
fork of it, [BunnyGamezsc/tokscale](https://github.com/BunnyGamezsc/tokscale).

## License

[MIT](LICENSE).
