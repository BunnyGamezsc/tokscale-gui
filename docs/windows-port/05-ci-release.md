# Phase 5: CI and release

**Goal:** a GitHub Actions job builds and tests on native Windows for every push, and produces the installer attached to releases. You can land this early, right after Phase 1, and use it as the Windows compile check for Phases 2–4.

## Steps

1. Create `.github/workflows/windows.yml`:

   ```yaml
   name: windows
   on:
     push:
       branches: [main]
       tags: ["v*"]
     pull_request:
     workflow_dispatch:

   jobs:
     build:
       runs-on: windows-latest
       steps:
         - uses: actions/checkout@v4
           with:
             submodules: recursive
         - uses: pnpm/action-setup@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: pnpm
         - uses: dtolnay/rust-toolchain@stable   # rust-toolchain.toml pins the real version
         - uses: Swatinem/rust-cache@v2
           with:
             workspaces: src-tauri
         - run: pnpm install --frozen-lockfile
         - run: pnpm exec tsc --noEmit
         - run: pnpm test
         - run: cargo test --lib
           working-directory: src-tauri
         - run: pnpm tauri build --bundles nsis
         - uses: actions/upload-artifact@v4
           with:
             name: Tokscale-windows-x64
             path: src-tauri/target/release/bundle/nsis/*.exe
   ```

   Check before relying on it:
   - The submodule URL in `.gitmodules` must be clonable over HTTPS without SSH keys (README says it is).
   - `rust-toolchain.toml` pins a version. `dtolnay/rust-toolchain@stable` is overridden by it once `cargo` runs, which is fine.
   - `pnpm/action-setup` reads the `packageManager` field in `package.json`. If that field is absent, add `with: version: <the version in pnpm-lock.yaml's header>`.
   - `pnpm test` runs vitest. If any test depends on macOS (`TZ`, paths), fix the test, not the workflow.

2. **Release on tag.** Add a second job, gated on tags, that downloads the artifact and attaches it to the existing GitHub release. The macOS zips are still built and uploaded by hand from the Mac, as today.

   ```yaml
     release:
       needs: build
       if: startsWith(github.ref, 'refs/tags/v')
       runs-on: ubuntu-latest
       permissions: { contents: write }
       steps:
         - uses: actions/download-artifact@v4
           with: { name: Tokscale-windows-x64, path: out }
         - run: |
             v="${GITHUB_REF_NAME#v}"
             mv out/*.exe "out/Tokscale-${v}-windows-x64-setup.exe"
             (cd out && sha256sum *.exe > "Tokscale-${v}-windows-x64-setup.exe.sha256")
             gh release upload "$GITHUB_REF_NAME" out/* --clobber --repo "$GITHUB_REPOSITORY"
           env: { GH_TOKEN: "${{ github.token }}" }
   ```

   If the release doesn't exist yet when the tag is pushed, `gh release upload` fails. Order it as: create the release (draft is fine) before pushing the tag, or re-run the job.

3. **Release notes template.** Add a Windows row to the download table used in past releases (`gh release view v1.1.0`):

   | Windows 10/11 (x64) | `Tokscale-<v>-windows-x64-setup.exe` |

   And this paragraph: "The Windows installer isn't code-signed yet, so SmartScreen shows 'Windows protected your PC'. Choose **More info**, then **Run anyway**. It installs for your user only and needs no admin rights."

## Done when

- [ ] 🪟 The `windows` workflow is green on `main`: typecheck, vitest, `cargo test --lib`, and the NSIS build.
- [x] The run's artifact contains exactly one `*-setup.exe`.
- [ ] 🪟 A test tag (e.g. `v1.2.0-rc.1`, as a prerelease) gets the `.exe` and `.sha256` attached by the `release` job.
- [x] Artifact inspection: `7z l Tokscale-*-setup.exe` lists `tokscale-gui.exe` and `licenses\tokscale-LICENSE`, and no `.icns`/`.app` contents. File Properties show the product name "Tokscale", the right version, and the stacked-tokens icon.
