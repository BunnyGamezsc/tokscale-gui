# $handoff — Tokscale 1.3.0 release and updaters

Workspace: `/Users/shridhar/Desktop/Coding/jsapps/tokscalegui`, branch `main`. User authorized building, pushing, and publishing a GitHub release. The user also asked for Sparkle on macOS, then suggested Tauri's official updater for Windows/Linux. **No commit, push, tag, or release has happened yet for 1.3.0.** Keep working; do not claim publication until the release URL and assets are verified.

## Current implementation

- Existing dirty changes contain the Nocturne/Terminal style picker and experimental Machines feature. Version is already bumped to `1.3.0` in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Added macOS `tauri-plugin-sparkle-updater =0.3.0`, official Sparkle 2.9.6 framework, `src-tauri/Info.plist` with GitHub `appcast.xml` feed and public key, and `src-tauri/src/updates.rs`.
- Added Windows/Linux official `tauri-plugin-updater =2.12.0`, `latest.json` feed and public key. The Settings panel checks for updates and installs on Windows/Linux; Sparkle presents its native UI on macOS.
- The plugins have **no direct JS capability grants**. The webview only has fixed Rust commands `check_for_updates` and `install_update`.
- `.github/workflows/windows.yml` now also builds Linux AppImage and creates signed `latest.json` when a tag is pushed. CI has **not run** on these changes.
- `scripts/prepare-sparkle.sh` downloads the official framework with `gh release download`, verifies SHA-256, then installs framework and tools. Framework/tools are ignored in git, so run script on any new macOS build machine.
- `npm run build` passed; `cargo check --locked -q` passed on macOS after updater integration. Full tests and bundled app build remain.

## Secrets already provisioned

- Sparkle Ed25519 private key is in this Mac's login Keychain under account `dev.bunnygamezsc.tokscale-gui`. Public key is in `src-tauri/Info.plist`. Sign with `src-tauri/sparkle-bin/sign_update --account dev.bunnygamezsc.tokscale-gui <zip>`; never print or commit the private key.
- Tauri minisign private key is `/Users/shridhar/.tauri/tokscale.key` (mode 600), public key is in `tauri.conf.json`. GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` has been set in `BunnyGamezsc/tokscale-gui`. Do not display or commit the private key. Back up both private keys securely before relying on automatic updates.
- 2026-09-29 rotation: the original key was password-encrypted with an unknown password and the signer prompts even for passwordless keys, so a fresh no-password keypair was generated (`tauri signer generate --ci`), `tauri.conf.json` carries the new pubkey, and the Actions secret was overwritten. The old file is kept at `/Users/shridhar/.tauri/tokscale.key.superseded-2026-09-29.bak`. `windows.yml` sets `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ""` on both bundle builds; without it CI fails with "incorrect updater private key password: Device not configured".

## Safety decision

The third-party Sparkle plugin is acceptable with caution, **not independently audited**. Reviewed its Rust command handlers, build script, bridge, and default capabilities. No obvious malicious fetch/exec path was found. It is small and recently released; native FFI carries normal memory-safety risk. Its default JS permission set is too broad: it includes feed overrides, HTTP headers, and decryption password access. Keep those permissions absent. Pin `=0.3.0`, verify the official framework SHA (`52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192`), and review future updates before bumping. The repository declares MIT in package metadata but lacks a root `LICENSE` file; check the published crate license if this matters for distribution.

## Remaining work, in order

1. Review working tree before staging. `docs/machines-field-test-evidence/` includes screenshots of an unrelated desktop/workspace; do **not** publish those without inspection. `docs/selected-ideas.md` is planning material and may be excluded. Read `docs/MACHINES_FIELD_TEST_RESULTS.md`: the two-machine field test was invalid, so release notes must call Machines experimental.
2. Run `rtk npm test`, `rtk proxy cargo test --lib` in `src-tauri`, `rtk npm run build`, and a macOS bundle build. Confirm `Info.plist` keys, bundled `Sparkle.framework`, code signature, and architecture with `plutil`, `codesign`, and `file`. The Mac framework is already present locally; run `rtk proxy bash scripts/prepare-sparkle.sh` if missing. A universal `.app` would give one Sparkle archive for both Mac architectures; verify `pnpm tauri build --target universal-apple-darwin --bundles app` works. Set `TAURI_SIGNING_PRIVATE_KEY_PATH=/Users/shridhar/.tauri/tokscale.key` for the build because `createUpdaterArtifacts` is enabled globally.
3. Package the macOS `.app` with `ditto -c -k --sequesterRsrc --keepParent`, sign its archive with Sparkle `sign_update --account dev.bunnygamezsc.tokscale-gui`, and generate `appcast.xml` using `generate_appcast --account ... --download-url-prefix https://github.com/BunnyGamezsc/tokscale-gui/releases/download/v1.3.0/`. Ensure enclosure URL, Ed25519 signature, byte length, version, and supported architecture are correct. Prefer one universal archive; check the generated XML. Include SHA-256 file for macOS download.
4. Check `.github/workflows/windows.yml` syntax and release asset names. On tag push, Windows NSIS and Linux AppImage plus `.sig` files should upload; release job builds `latest.json` with embedded signature text. It requires a draft GitHub release to exist by the time `gh release upload` runs. Re-run the release job if tag/release creation races.
5. Commit only intended changes with a concise Conventional Commit, push `main`, create draft `v1.3.0` release, trigger/push tag, wait for CI, upload signed Mac zip, appcast, and checksums, inspect all assets and signatures, then publish. The old release is `v1.2.0`. Ensure the `latest.json` endpoint points to the new release after publishing.
6. Verify a built app's Settings update button and inspect the published `appcast.xml` and `latest.json` from GitHub Releases. A same-version check should show no update. If possible, test upgrade from a prior signed build; the old v1.2.0 did not include updater integration, so the first automatic upgrade test is likely 1.3.0 → later version.

## Known caveats

- Current Settings status for macOS says “Update check started, or you are up to date”; refine it to say Sparkle opened. Windows/Linux `install_update` performs a second check before download and will fail cleanly if release changes between checks.
- `createUpdaterArtifacts: true` applies to macOS too although Sparkle handles Mac updates. It may cause an extra Tauri `.app.tar.gz` artifact or require minisign key during Mac builds. If problematic, move this setting into Windows/Linux config overlays.
- This Mac has no GitHub Actions Linux/Windows result yet. Do not assume the AppImage build or signature upload works until CI passes.
- The local app uses self-signed `BunnyGamezDev`, not Apple notarization; macOS Gatekeeper behavior remains as in previous releases.

Primary docs: [Sparkle publishing](https://sparkle-project.org/documentation/publishing/), [Tauri updater](https://v2.tauri.app/plugin/updater/), [plugin source](https://github.com/ahonn/tauri-plugin-sparkle-updater).
