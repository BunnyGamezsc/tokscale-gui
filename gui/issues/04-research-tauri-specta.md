# Research: tauri-specta type generation

Type: research
Status: resolved
Blocked by: —

## Start here

New session? Read these first — they hold decisions already settled; do not relitigate them.

- **[The map](../map.md)** — the `## Notes` section is the binding list of standing decisions,
  and `## Decisions so far` indexes every resolved ticket. Read it before anything else.
- **[CONTEXT.md](../../CONTEXT.md)** — glossary. Mirrors upstream tokscale's vocabulary
  verbatim, including the ambiguities it inherits. Use these terms exactly.
- **[ADR 0001](../../docs/adr/0001-depend-on-tokscale-core.md)** and
  **[ADR 0002](../../docs/adr/0002-fork-tokscale-cli-for-a-library-target.md)** — both carry
  dated amendments; read to the end.
- Resolved research lives in sibling tickets `03`, `04` and `05`. Zoom into them on demand
  rather than re-researching.

Upstream tokscale source is at `tokscale/` in the repo root today; after
"Fork tokscale and vendor it as a submodule" resolves, it lives at `vendor/tokscale/`.

**Skill for this ticket type:** Call the Skill tool with `research`.

## When done

1. Append the answer to this file under `## Answer`.
2. Change `Status:` to `resolved`.
3. Append a one-line gist + link to `## Decisions so far` in [the map](../map.md).
4. Graduate any fog the answer sharpened into new tickets; clear those patches from
   `## Not yet specified`. If the answer puts work past the destination, rule it out of
   scope rather than resolving it.

Resolve **one ticket per session** (research tickets excepted).

## Question

The map commits to `tauri-specta` for the command boundary. Confirm it is viable.

Specifically: the current version and its Tauri v2 compatibility, how the TypeScript
emit is wired into the build, whether types can be derived for structs the crate does
not own (`tokscale-core`'s aggregate types) or whether local wrapper structs are
required, how enums and `Option`/`f64`/`i64` map into TypeScript, and how generated
types are kept fresh — build script, CLI step, or manual.

If it turns out not to be viable on Tauri v2, report what `ts-rs` would cost instead.


## Answer

Researched 2026-09-05 against crates.io, the published `.crate` sources (specta
2.0.0-rc.25, specta-macros 2.0.0-rc.25, specta-typescript 0.0.9 + 0.0.12,
specta-serde 0.0.12, tauri-specta 2.0.0-rc.25), the GitHub repos, and the
tokscale-core source in `tokscale/crates/tokscale-core/`.

**Verdict: viable, and clearly better than `ts-rs` — but only if we own the crate
that defines the types.** Deriving `specta::Type` for `tokscale-core` structs from
the GUI crate is blocked by the orphan rule (details in §3). Since ticket 01 forks
and vendors tokscale, the recommended path is a feature-gated `specta` dep inside
the vendored `tokscale-core`, not wrappers in the GUI crate.

### 1. Versions, dates, Tauri v2 compatibility, maintenance

| Crate | Latest | Released | Notes |
|---|---|---|---|
| `tauri-specta` | `2.0.0-rc.25` | 2026-05-08 | max *stable* is `1.0.2` (2023-05-18, Tauri v1 only) |
| `specta` | `2.0.0-rc.25` | 2026-05-07 | max stable `1.0.5` (2023-07-17) |
| `specta-typescript` | `0.0.12` | 2026-05-07 | `0.0.9` (2025-01-12) is the older widely-used one |
| `specta-serde` / `specta-util` | `0.0.12` | 2026-05-07 | pulled in transitively |

- Sources: <https://crates.io/api/v1/crates/tauri-specta>, <https://crates.io/api/v1/crates/specta>, <https://crates.io/api/v1/crates/specta-typescript>
- **Tauri v2 is the supported target.** `tauri-specta` 2.x depends on `tauri = "2"`
  with `features = ["specta"], default-features = false` (`tauri-specta-2.0.0-rc.25/Cargo.toml`).
  v1 of tauri-specta is for Tauri v1 + specta v1.
- **Tauri itself ships a first-party `specta` feature**, depending on
  `specta ^2.0.0-rc.16` — see `crates/tauri/Cargo.toml` in tauri-apps/tauri
  (`specta = ["dep:specta"]`). This is what makes `tauri::State` / `AppHandle` /
  `Window` args transparently skipped in generated signatures. Strong signal the
  integration is not going to be orphaned.
- **Still release-candidate, indefinitely.** Crate docs (`tauri-specta-2.0.0-rc.25/src/lib.rs`)
  carry a standing warning: *"Tauri Specta v2 is still in beta, and requires using
  Specta v2 beta until it lands as stable. During the beta period, it is really
  important you use `=` before your Specta version to ensure your project will not
  break after future updates!"* Specta v2 has been in RC since 2023-10. An explicit
  question about production readiness — <https://github.com/specta-rs/tauri-specta/issues/247>
  (2026-07-22) — is still unanswered by maintainers as of today.
- **Actively maintained.** tauri-specta: 791 stars, 28 open issues, last push
  2026-07-26. specta: 637 stars, 11 open issues, last push 2026-09-01. rc.24
  (2026-03-30) and rc.25 (2026-05-08) were substantial feature releases
  (serde serialize/deserialize phases; semantic types Date/Uint8Array/URL).
  Sources: <https://github.com/specta-rs/tauri-specta/releases>, GitHub API.
- **Pin with `=`.** `cargo add tauri@2.0 specta@=2.0.0-rc.25 specta-typescript@0.0.12`
  and `cargo add tauri-specta@=2.0.0-rc.25 --features derive,typescript`.
  `tauri-specta` itself pins `specta = "=2.0.0-rc.25"`, so mixing rc versions fails
  to resolve.

### 2. How TypeScript emit is wired

There is **no build script and no CLI**. Emit happens by *running the Rust binary*,
because the command signatures only exist after `collect_commands!` links them.
The documented pattern (`tauri-specta-2.0.0-rc.25/src/lib.rs`, "Setup"):

```rust
let mut builder = Builder::new().commands(collect_commands![hello_world]);

#[cfg(debug_assertions)] // <- Only export on non-release builds
builder.export(Typescript::default(), "../src/bindings.ts")
    .expect("Failed to export typescript bindings");

tauri::Builder::default()
    .invoke_handler(builder.invoke_handler())
    .setup(move |app| { builder.mount_events(app); Ok(()) })
```

- `Builder` API surface (`src/builder.rs`): `new`, `plugin_name`, `commands`,
  `events`, `typ::<T>`, `types`, `constant`, `error_handling`, `typed_error_impl`,
  `semantic_types`, `dangerously_cast_bigints_to_number`, `disable_serde_phases`,
  `invoke_handler`, `mount_events`, `export`.
- Practical consequence: **bindings only regenerate when you run `tauri dev` /
  `cargo run` in debug.** A release-only CI build never refreshes them. The common
  mitigation is to *also* (or instead) call the same `builder.export(...)` from a
  `#[test]`, so `cargo test` regenerates and `git diff --exit-code src/bindings.ts`
  in CI catches staleness. Nothing in the crate does this for you.
- `bindings.ts` is a generated artifact — commit it (the frontend imports it) and
  guard it with a CI freshness check.

### 3. CRITICAL — can we derive `Type` for `tokscale-core` structs?

**`#[specta(remote = path::To::Type)]` exists, but it does NOT solve the
foreign-crate case.** Verified by reading the macro source.

- Documented as: *"`#[specta(remote = path::ToType)]` implements `Type` for a
  remote type instead of the local derive input name."*
  (<https://docs.rs/specta/2.0.0-rc.25/specta/derive.Type.html>)
- In `specta-macros-2.0.0-rc.25/src/type/mod.rs` the attribute simply substitutes
  the impl target:
  ```rust
  let ident = container_attrs.remote.clone()
      .unwrap_or_else(|| raw_ident.to_token_stream());
  ...
  impl #bounds #crate_ref::Type for #ident #type_args #where_bound { ... }
  ```
- So it emits `impl specta::Type for tokscale_core::TokenBreakdown`. From the GUI
  crate, **both the trait and the type are foreign → E0117 orphan-rule violation.
  It will not compile.** `#[specta(remote)]` is only usable from inside the crate
  that defines the type (or the crate that defines `Type`).
- Two further gotchas even where it *is* legal:
  - **No field-compatibility check.** Unlike `serde(remote)`, nothing verifies the
    mirror struct's fields against the real type. Upstream adds/renames a field and
    the bindings silently lie. Drift is undetectable at compile time.
  - **The exported TS name comes from the local mirror's ident** (`raw_ident`, not
    the remote path), so the mirror must be named identically (put it in a private
    module) or renamed via serde/specta `rename`.

**Therefore the three real options:**

1. **(Recommended) Derive in the vendored fork.** Ticket 01 already forks and
   vendors tokscale. Add `specta = { version = "=2.0.0-rc.25", optional = true }`
   to `tokscale-core`, gate a `specta` feature, and add
   `#[cfg_attr(feature = "specta", derive(specta::Type))]` next to the existing
   `serde::Serialize` derives. ~25 lines of diff, no duplicated field lists, no
   drift risk. Cost is a permanent (small, mechanical) fork diff to carry across
   upstream rebases.
2. **Local DTO structs in the GUI crate** with `From<tokscale_core::X>` impls.
   Fully legal, zero fork diff, but duplicates ~153 fields (see §7) plus the
   conversions, and drift is caught only if you write exhaustive `From` impls
   (struct-literal construction *does* error on new upstream fields, so this is
   safer than `remote` — the compiler is on your side).
3. **`#[specta(remote)]` mirrors** — only viable inside the fork, and strictly
   worse than option 1 there.

### 4. Rust → TypeScript mapping

Mapping is serde-JSON-equivalent (`specta-serde` resolves the serde attrs first,
`specta-typescript` renders). All verified in
`specta-typescript-0.0.12/src/primitives.rs` unless noted.

| Rust | TypeScript (specta-typescript 0.0.12) |
|---|---|
| `i8/i16/i32/u8/u16/u32` | `number` |
| **`f32`/`f64`** | **`number \| null`** — *changed in 0.0.12*; in 0.0.9 it was plain `number`. Comment in source: *"`null` comes from `NaN`, `Infinity` and `-Infinity`. Is done by JS APIs and Serde JSON."* |
| **`i64`/`u64`/`usize`/`isize`/`i128`/`u128`/`f128`** | **hard export error** — `Error::bigint_forbidden`. Not a warning; `builder.export(...)` returns `Err`. |
| `bool` | `boolean` |
| `String`/`&str`/`char`/`PathBuf` | `string` |
| `Option<T>` | `T \| null` (`push_nullable`, collapses double-nulls). `#[specta(optional)]` on the field gives `{ a?: T \| null }` instead. |
| `Vec<T>` / `BTreeSet<T>` | `T[]` |
| `HashMap<K,V>` / `BTreeMap<K,V>` | `Partial<{ [key in K]: V }>` (deliberately not `Record<>`, "to avoid circular reference issues"). Non-string keys go through `map_keys.rs`. |
| `chrono::DateTime<Tz>`, `NaiveDateTime`, `NaiveDate`, `NaiveTime`, `Duration`, `Weekday`, `Month`, … | `string` — requires `specta`'s `chrono` feature (`specta-2.0.0-rc.25/src/type/legacy_impls.rs:355-370`). Without the feature the types simply don't impl `Type`. |
| `()` | `null` |
| `Result<T, E>` | typed error wrapper, see §5 |

**Enums** follow serde repr (`specta-serde-0.0.12/src/repr.rs` maps
`External` / `Internal{tag}` / `Adjacent{tag,content}` / `Untagged` from the serde
attrs). Default externally tagged: unit variant → `"Model"`, newtype/tuple variant
→ `{ B: T }`, struct variant → `{ C: { … } }` — i.e. a discriminated union that
matches what `serde_json` actually emits. Adjacently-tagged example from the
project's own generated bindings:
`export type MyError2 = { type: "IoError"; data: string };`

**Serde attributes honoured** (`specta-macros-2.0.0-rc.25/src/lib.rs:110-160`):
`rename`, `rename_all`, `rename_all(serialize/deserialize)`, `rename_all_fields`,
`tag`, `content`, `untagged`, `flatten`, `skip`, `skip_serializing`,
`skip_deserializing`, `skip_serializing_if`, `default`, `transparent`.

**Serialize/deserialize phases (new in rc.24).** When a type's serialize and
deserialize shapes differ, tauri-specta emits `MyType_Serialize`,
`MyType_Deserialize`, and `MyType = MyType_Serialize | MyType_Deserialize`; command
args use the deserialize shape and results the serialize shape. `skip_serializing_if`,
`skip_serializing`, and split `rename` all trigger this. Disable via
`Builder::disable_serde_phases()` if the split names are noise. This matters here:
`DailyContribution.active_time_ms` and `GraphResult.time_metrics` both use
`skip_serializing_if = "Option::is_none"`, so both will split into `_Serialize` /
`_Deserialize` aliases unless phases are disabled.

**BigInt is the single biggest practical issue for this codebase.** Options, per
<https://docs.rs/specta-typescript/latest/specta_typescript/struct.Error.html#bigint-forbidden>:
1. narrow the Rust type to `i32`/`u32`/`f64` (not viable — token counts and
   `*_time_ms` genuinely need `i64`);
2. `#[specta(type = String)]` + serde `with = "..."` → lossless `BigInt(str)` on the
   JS side, but glue on both sides;
3. `#[specta(type = specta_typescript::Number)]` per field → renders plain `number`,
   explicitly opting into precision loss (>2^53), marked field-by-field like an
   `unsafe` block;
4. `Builder::dangerously_cast_bigints_to_number()` → global escape hatch, one line
   (`tauri-specta-2.0.0-rc.25/src/builder.rs:308`).

For tokscale, (4) is defensible: every `i64` here is a token count, a millisecond
duration, or a unix timestamp — all comfortably under 2^53. It is one line and it
is honest about being a blanket decision. (3) is the more disciplined variant.

### 5. Typed `invoke` wrappers and typed events — yes, both

Verbatim from the project's own generated example
(<https://github.com/specta-rs/tauri-specta/blob/main/examples/app/src/bindings.ts>):

```ts
import { invoke as __TAURI_INVOKE, Channel } from "@tauri-apps/api/core";
import * as __TAURI_EVENT from "@tauri-apps/api/event";

export const commands = {
  /** doc comments are carried through */
  helloWorld: (myName: string) => __TAURI_INVOKE<string>("hello_world", { myName }),
  someStruct: () => __TAURI_INVOKE<MyStruct>("some_struct"),
  /** @deprecated This is a deprecated function */
  deprecated: () => __TAURI_INVOKE<void>("deprecated"),
  hasError: () => typedError<string, number>(__TAURI_INVOKE("has_error")),
  withChannel: (channel: Channel<number>) => __TAURI_INVOKE<void>("with_channel", { channel }),
};

export const events = {
  myDemoEvent: makeEvent<DemoEvent, DemoEvent>("myDemoEvent"),
};
```

- `snake_case` Rust fn → `camelCase` TS method; the string command name stays snake.
- Rustdoc becomes TSDoc; `#[deprecated]` becomes `@deprecated`.
- `Result<T, E>` becomes `typedError<T, E>(...)` — a `Result`-style return rather
  than a throw — controlled by `Builder::error_handling(ErrorHandlingMode)`.
  Note open issue #135: bindings reportedly still `throw` in some cases even with
  `ErrorHandlingMode::Result`.
- Events: `events.myDemoEvent.listen(cb)`, `.emit(payload)`, and
  `events.myDemoEvent(someWindow).listen(...)` for a single window. Requires
  `#[derive(tauri_specta::Event)]` + `collect_events![]` + `builder.mount_events(app)`.
- Constants: `builder.constant("universalConstant", 42)` → `export const universalConstant = 42 as const;`

### 6. Practical gotchas people report

- **Beta pinning.** Must use `=` on `specta` and `tauri-specta`; they pin each other
  exactly. A stray `cargo update` across rc boundaries breaks the build.
- **Export only runs when the binary runs**, under `#[cfg(debug_assertions)]`. Easy
  to ship stale `bindings.ts`. Add a test + CI diff check.
- **`docs.rs failed to build tauri-specta-2.0.0-rc.25`** — the rendered docs on
  docs.rs are stuck at rc.21; read the crate source or GitHub for current docs.
- **`tauri::State<SomePrivateType>` as a command arg fails** — the macro's generated
  nested module can't see the private type. Open since 2024-10:
  <https://github.com/specta-rs/tauri-specta/issues/142>. Make state types `pub`.
- **Generics can't be used on `collect_commands!`** — <https://github.com/specta-rs/tauri-specta/issues/162>.
- **`f64 → number | null` in 0.0.12** surprises people upgrading from 0.0.9. Every
  cost field becomes nullable in TS; either accept the null checks or override with
  `#[specta(type = specta_typescript::Number)]`.
- **`_Serialize`/`_Deserialize` alias explosion** from the rc.24 phases feature, if
  you use `skip_serializing_if` widely. `disable_serde_phases()` reverts it.
- **`serde_json::Value` can't be overridden** — it contains bigints internally and
  you don't control its impl; needs `specta_util::Remapper` or the global cast.
- **No stable release and no answer on when.** Accept that upgrading rc→rc may be a
  breaking change every ~6 months.

### 7. Concrete wrapper cost against the real tokscale-core types

Counted directly from `tokscale/crates/tokscale-core/src/{lib.rs,sessions/mod.rs,sessionize.rs}`:

| Type | fields | 64-bit ints | f64 |
|---|---|---|---|
| `TokenBreakdown` | 5 | 5 | 0 |
| `ModelPerformance` | 5 | 2 | 2 |
| `DailyTotals` | 3 | 1 | 1 |
| `ClientContribution` | 6 | 0 | 1 |
| `DailyContribution` | 6 | 1 | 0 |
| `SessionContribution` | 9 | 2 | 0 |
| `YearSummary` | 5 | 1 | 1 |
| `DataSummary` | 8 | 1 | 3 |
| `GraphMeta` | 5 | 0 | 0 |
| `GraphResult` | 7 | 0 | 0 |
| `ModelUsage` | 15 | 5 | 1 |
| `MonthlyUsage` / `MonthlyUsageV2` | 8 / 9 | 4 / 5 | 1 / 1 |
| `ModelReport` | 8 | 4 | 1 |
| `MonthlyReport` / `MonthlyReportV2` | 3 / 3 | 0 | 1 / 1 |
| `HourlyUsage` | 11 | 5 | 1 |
| `HourlyReport` | 3 | 0 | 1 |
| `TimeMetrics` | 5 | 3 | 0 |
| `TimeMetricsReport` | 2 | 0 | 0 |
| `UnifiedMessage` | 18 | 2 | 1 |
| `ReportOptions` (input) | 9 | 0 | 0 |
| **Total** | **~153** | **41** | **~17** |

Plus 3 enums — `GroupBy` (6 unit variants), `WorktreeRollup` (2 unit variants),
`sessions::CostSource` (3 unit variants, `rename_all = "camelCase"`) — and two
input structs, `scanner::ScannerSettings` (contains `Vec<PathBuf>` and
`BTreeMap<String, Vec<PathBuf>>`, both of which specta handles) and
`LocalParseOptions`.

Specific observations:
- **41 `i64` fields all hit the bigint wall.** This is the dominant cost whichever
  route we take. One `dangerously_cast_bigints_to_number()` handles all 41.
- **`GroupBy` derives `Serialize` but not `Deserialize`** and has hand-written
  `Display`/`FromStr`. If the GUI sends a group-by choice down, the command should
  take a `String` (matching `FromStr`) or the fork must add `Deserialize`.
- **`ReportOptions` / `LocalParseOptions` derive neither `Serialize` nor
  `Deserialize`** — they are constructed in Rust. A GUI command that accepts filter
  options needs a *new* serde-able input type regardless of the typegen library.
  This is unavoidable work.
- **`GraphResult` has two `#[serde(skip)]` fields** (`unpriced_submission_usage`,
  `incomplete_cost_dates`) — specta honours `skip`, so they vanish from TS
  correctly. Its `time_metrics: Option<TimeMetrics>` with `skip_serializing_if`
  triggers the phase split.
- **`ModelPerformance` uses `rename_all = "camelCase"` plus an explicit
  `#[serde(rename = "msPer1KTokens")]`** — both honoured; a hand-written DTO would
  have to reproduce them exactly.
- No `chrono` types appear in the report/aggregate surface — dates are already
  `String` (`"2026-03-23"`, `"2026-03-23 14:00"`) and timestamps are `i64` unix
  seconds/millis. So the `chrono` feature is not needed for the command boundary.

Rough effort: **option 1 (derive in the fork) ≈ 25 added attribute lines + one
Cargo feature.** Option 2 (DTOs in the GUI crate) ≈ 150+ duplicated field
declarations plus ~20 `From` impls, i.e. several hundred lines that must be
maintained against upstream forever.

### 8. `ts-rs` as the fallback — strictly more expensive

Current: **`ts-rs` 12.0.1**, released 2026-06-22 (<https://docs.rs/ts-rs/latest/ts_rs/>).

- **Foreign types are worse, not better.** ts-rs has no `remote`-style impl
  redirection at all. The docs' answer for types you don't control is *"either
  `#[ts(as = "..")]` or `#[ts(type = "..")]`, enable the appropriate cargo feature,
  or open a PR."* Those are *field-level* overrides on structs you own — meaning
  either hand-written TS type strings, or full local DTO structs. So ts-rs lands
  you in option 2 above with no option 1 available (unless you likewise patch the
  fork, at which point specta is the better fork patch).
- **Export is test-based**: `#[ts(export)]` generates a `#[test]` that writes the
  file; run `cargo test export_bindings`. Configured via env vars in
  `.cargo/config.toml` — `TS_RS_EXPORT_DIR` (default `./bindings`),
  `TS_RS_IMPORT_EXTENSION`, `TS_RS_LARGE_INT`. Also programmatic
  `TS::export_all` / `export` / `export_to_string`. This is arguably a *better*
  freshness story than specta's run-the-binary approach.
- **`TS_RS_LARGE_INT` defaults to `bigint`** for 64/128-bit ints — no hard error, so
  the 41 `i64` fields "just work", but the frontend then deals with `bigint` (which
  `JSON.parse` over Tauri's IPC will not actually produce — you get `number`, so the
  types would lie unless you set `TS_RS_LARGE_INT=number`).
- **It generates types only.** No `commands` object, no typed `invoke`, no typed
  event listeners, no doc-comment/`@deprecated` passthrough, no `Result` handling.
  You hand-write and hand-maintain every `invoke<T>("command_name", args)` call and
  every `listen<T>(...)`, and the command-name↔type correspondence is unchecked —
  which is most of the value we wanted.
- It also emits one file per type by default and generates `import` statements
  between them, which is more frontend plumbing than specta's single `bindings.ts`.

**Recommendation:** `tauri-specta` `=2.0.0-rc.25` + `specta` `=2.0.0-rc.25` +
`specta-typescript` `0.0.12`, with `Type` derives added behind a `specta` feature in
the vendored `tokscale-core` fork, `dangerously_cast_bigints_to_number()` (or
per-field `specta_typescript::Number`) for the 41 `i64` fields, a `#[test]`-based
export in addition to the `main()` export, and a CI `git diff --exit-code` on
`bindings.ts`. Accept the permanent RC status and pin exactly.
