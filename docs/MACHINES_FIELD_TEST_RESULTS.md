# Machines field-test results

Date: 2026-09-17  
Branch: `ci/main-only-trigger`  
Commit: `fcafb58` with the uncommitted Machines working tree preserved

## Test environment

| Machine | OS | App build | Machine ID | Key fingerprint |
| --- | --- | --- | --- | --- |
| A | macOS 27.0, build 26A428 | Tokscale 1.2.0 development build | `5149e710…` | Not connected |
| B | Unavailable in this environment | Not run | Not available | Not available |

The app stored `gui.json` at `/Users/shridhar/Library/Application Support/dev.bunnygamezsc.tokscale-gui/gui.json`. It contained the expected Machines metadata keys and no `tok_` secret. `machinesKeyId` was empty.

## Result

This run is invalid and must be repeated. The screenshot came from the installed
`/Applications/Tokscale.app`, not the working-tree build. The installed app and development build
share the bundle ID `dev.bunnygamezsc.tokscale-gui`, so app-name automation selected the installed
release while `target/debug/tokscale-gui` ran beside it.

A fresh debug bundle built from this working tree shows both missing controls:

- Report Filter exposes `All machines` and `All clients`.
- Settings exposes the Machines name, key field, local machine row, Export JSON, and Import JSON.

Verified bundle:
`src-tauri/target/debug/bundle/macos/Tokscale.app`

No implementation change was required for this finding. Sections 2 through 6 remain untested.

Evidence: [Settings without Machines controls](machines-field-test-evidence/01-machines-controls-missing.png);
[working-tree Overview with the All machines control](machines-field-test-evidence/02-debug-overview-all-machines.png)

### Reproduction

1. On commit `fcafb58` with the uncommitted Machines changes present, run `pnpm tauri dev`.
2. Wait for the first scan to finish.
3. Open Settings.
4. Observe Appearance, refresh, Minutely, Cursor, and Codex controls. No Machines section or Machines actions appear.
5. Close Settings and inspect the report filter. It contains dates and `All clients`, with no machine selector.

Expected: Settings shows the Machines identity, connection, import, export, update, and removal controls. The report filter shows `All machines` and individual machines.

Actual in the installed release: none of those controls are present. Actual in the freshly built
working-tree bundle: the controls are present.

## Local totals observed

The local corpus changed while this field test generated new Codex transcripts, so adjacent scans differ slightly. These numbers are evidence that the normal local reports rendered, not a fixed comparison baseline.

| View | Machine A | Machine B | All machines |
| --- | --- | --- | --- |
| Overview | $971.44, 1.90B tokens, 17,326 messages | Blocked | Blocked |
| Models | $971.44, 1.90B tokens, 17,326 messages | Blocked | Blocked |
| Daily | $971.47, token and message grand totals are not shown in the summary | Blocked | Blocked |
| Hourly | $971.44, 0 untimed messages | Blocked | Blocked |
| Minutely | Hidden by the current setting; machine test blocked | Blocked | Blocked |
| Stats | 1.92B tokens, $12.78 per active day | Blocked | Blocked |
| Agents | $971.44, 1.90B tokens, 17,326 messages | Blocked | Blocked |

## Numbered test sections

| Section | Result | Notes |
| --- | --- | --- |
| 1. Local identity | Retest | `gui.json` has a stable redacted machine ID and no secret. The working-tree bundle exposes the rename control. |
| 2. Offline merge | Blocked | Export, import, and machine filters are absent. |
| 3. Live encrypted exchange | Blocked | Connection and Update fleet controls are absent. No secret was created or sent. The Worker was not changed. |
| 4. Failure safety | Blocked | There is no fleet to establish as known-good and no Update fleet or import action to exercise. |
| 5. Removal behavior | Blocked | No machine list or removal control is present. |
| 6. Refresh policy | Blocked | Machines cannot be connected, so publish behavior and last-seen timestamps cannot be observed. |

The last-good-fleet invariant could not be tested. No plaintext, ciphertext, keychain contents, or raw transcripts were included in this report.

## Regression checks

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | Pass |
| `pnpm test` | Pass, 59 tests |
| `pnpm build` | Pass |
| `cd src-tauri && cargo test` | Pass, 55 tests and 10 ignored |
