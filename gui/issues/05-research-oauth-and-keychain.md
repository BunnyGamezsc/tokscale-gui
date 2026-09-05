# Research: OAuth loopback and macOS Keychain from Tauri v2

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

P3 is the riskiest phase. Establish what it actually requires before it is designed.

Read upstream's `crates/tokscale-cli/src/auth.rs` and the provider-specific paths in
`cursor.rs` and `trae.rs`, then determine: how the browser-plus-loopback flow behaves
inside a Tauri app (opening the system browser, binding a localhost listener, and
whether macOS sandboxing or hardened runtime interferes), how Keychain reads work from
a Tauri binary and what entitlements they need, and what Cursor's `state.vscdb` and
Trae's AES-decrypted `iCubeAuthInfo` require at runtime.

Report facts and constraints only. How the flow is *presented* is a later decision.

## Answer

### 0. Headline correction to the ticket's premise

**Upstream tokscale implements no OAuth loopback flow at all.** There is no browser-plus-loopback
callback anywhere in the CLI. Every `TcpListener::bind("127.0.0.1:0")` in the tree is a `#[cfg(test)]`
mock HTTP server (`cursor.rs:2127`, `cursor.rs:2426`, `antigravity.rs:3974/3997/4088/4142`, and the
`tokscale-core::pricing` test modules). Nothing in production binds a listening socket.

The only device/browser flow tokscale owns is its **own account login** in `auth.rs`, and it is a
**device-code poll**, not a redirect flow. For the five providers in P3, tokscale is a *credential
reader*, not an OAuth client — except for Codex, where it shells out to the vendor CLI and lets
*that* process own the loopback listener.

This substantially reduces P3's risk surface: the port-binding question is largely moot, and the
real constraints are (a) Keychain reads, (b) reading other apps' files, (c) spawning child
processes, (d) local-process probing (`ps`/`lsof`).

---

### 1. Upstream mechanics (primary evidence)

#### 1.1 `auth.rs` — tokscale's own login (device code, no listener)

- `open_browser` (`auth.rs:189-217`): on macOS it is literally
  `std::process::Command::new("open").arg(url).spawn()` (`auth.rs:196`). Fire-and-forget; the return
  value is only used to print a fallback message. On Linux it first checks `DISPLAY`/`WAYLAND_DISPLAY`
  (`auth.rs:179-187`).
- `login()` (`auth.rs:219-347`): `POST {base}/api/auth/device` → `{deviceCode, userCode,
  verificationUrl, expiresIn, interval}` (`auth.rs:243-255`), prints the URL + user code, opens the
  browser, then **polls** `POST {base}/api/auth/device/poll` every `interval` seconds, max 180
  attempts (`auth.rs:284-343`). No callback, no port.
- Base URL: `TOKSCALE_API_URL` else `https://tokscale.ai` (`auth.rs:162-164`).
- Alternate path `login_with_token` (`auth.rs:349-400`) validates a pasted `tt_`-prefixed token via
  `GET /api/auth/token`.
- **Persistence:** `~/.config/tokscale/credentials.json` (`auth.rs:72-74`), written with
  `mode(0o600)` inside a `0o700` dir (`auth.rs:76-114`). Plaintext JSON on disk — **not** the Keychain.
- `resolve_api_token` prefers env `TOKSCALE_API_TOKEN` over the file (`auth.rs:126-150`).
- `device.rs` is unrelated to auth: a stable `dev_<uuid>` in `device.json` in the config dir
  (`device.rs:28-75`), overridable via `TOKSCALE_DEVICE_ID`/`TOKSCALE_DEVICE_NAME`.

#### 1.2 Keychain access — the `security` binary, not a crate, not FFI

Single entry point, `commands/usage/helpers.rs:25-49`:

```rust
let out = std::process::Command::new("security")
    .args(["find-generic-password", "-s", service, "-w"])
    .output()?;
```

No `security-framework`, no `keyring` crate, no `SecItemCopyMatching` — confirmed absent from
`crates/tokscale-cli/Cargo.toml`. Windows uses `CredReadW` via `windows-sys`
(`helpers.rs:58-100`); Linux bails (`helpers.rs:45-48`). Doc comment at `helpers.rs:12-24` notes
macOS matches on the **service attribute alone**, ignoring account.

Services read:

| Provider | Keychain service | Call site |
|---|---|---|
| Claude Code | `Claude Code-credentials` | `commands/usage/claude.rs:175-177` |
| Codex | `Codex Auth` | `commands/usage/codex.rs:549` |
| GitHub Copilot (`gh`) | `gh:github.com` | `commands/usage/copilot.rs:38,143` |

In every case the Keychain is a **fallback after the file**: `claude.rs:188-199` tries
`~/.claude/.credentials.json` (`claude.rs:169-172`) first; `codex.rs:537-562` tries the `auth.json`
candidates first, Keychain second, tagging the result `CredentialSource::Keychain`
(`codex.rs:191`, `codex.rs:227`). Codex deliberately **no-ops writes** when the source is the
Keychain (`codex.rs:237`, and tests at `codex.rs:3661-3690`).

#### 1.3 Per-provider credential sources for P3

| Provider | Source | Location |
|---|---|---|
| Claude | file → Keychain | `~/.claude/.credentials.json`, `claudeAiOauth.accessToken` (`claude.rs:74-81`) |
| Codex | file → Keychain; login = spawn `codex login` | `~/.codex/auth.json`; `tui/codex_login.rs:72-78` |
| Cursor | SQLite read of Cursor desktop, else pasted cookie | `state.vscdb` (below) |
| Grok | plain JSON file; optional local JSON-RPC probe | `$GROK_HOME` or `~/.grok/auth.json` (`grok.rs:31-50`); `grok agent --no-leader stdio` (`grok.rs:146`) |
| Kimi | plain JSON file + HTTPS refresh | `$KIMI_CODE_HOME`/`~/.kimi-code/credentials/kimi-code.json`, then `~/.kimi/credentials/kimi-code.json` (`kimi.rs:60-89`); refresh `POST https://auth.kimi.com/api/oauth/token` (`kimi.rs:137-150`) |

Kimi is the only provider tokscale refreshes itself, and it **rewrites the vendor's credential file**
(`kimi.rs:92-124`, via `helpers::atomic_write_secret`).

#### 1.4 Codex login — the one real loopback flow, owned by the child process

`tui/codex_login.rs:63-140`: tokscale spawns `codex login` with `CODEX_HOME` pointed at a throwaway
temp dir (`codex_login.rs:52-56`, `72-78`), pipes stdout/stderr, waits on the child, then imports
`<temp>/auth.json` (`codex_login.rs:130-138`). The child is killable and is killed on TUI exit
precisely so a dangling login "can't keep holding the OAuth port" (`tui/app.rs:1233`,
`tui/mod.rs:235`).

The port belongs to Codex, and it is fixed, not ephemeral. From
[openai/codex `codex-rs/login/src/server.rs`](https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs):
`DEFAULT_PORT = 1455`, `FALLBACK_PORT = 1457` (lines 60/62), bound as `127.0.0.1:{port}` (line
637-684), redirect `http://localhost:{port}/auth/callback` (line 176), browser opened with
`webbrowser::open` (line 187). So if a GUI drives `codex login`, the *child* needs to bind 1455 —
and only one `codex login` can run at a time machine-wide.

#### 1.5 Cursor `state.vscdb`

- Candidate paths (`cursor.rs:337-369`); macOS:
  `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (`cursor.rs:347`).
- `read_access_token_from_state_vscdb` (`cursor.rs:377-404`) opens it via **rusqlite** with a URI and
  read-only flags — `format!("file:{}?mode=ro", …)` plus
  `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_URI` (`cursor.rs:386-392`) — then
  `SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'` (`cursor.rs:394`).
  It is a plain VS Code `ItemTable(key TEXT PRIMARY KEY, value TEXT)` — **no encryption, no Keychain**.
- The value is a JWT; the `sub` claim (`auth0|user_…`) yields the user id (`cursor.rs:406-444`), and
  the session cookie is `{user_id}%3A%3A{access_token}` (`cursor.rs:446-454`).
- `cursor login` (`cursor.rs:1637-1670`) prefers this desktop read and falls back to
  `rpassword::read_password()` for a manually pasted `WorkosCursorSessionToken`. **No browser, no
  listener.**
- `cursor sync` is just authenticated HTTPS to `cursor.com/api/dashboard/get-filtered-usage-events`
  and `/api/usage-summary` (`cursor.rs:84-85`) writing a local cache; `main.rs:1691-1780` auto-runs it
  before the TUI. Note `cursor.rs:34` — cursor.com sits behind Vercel bot protection that fingerprints
  TLS, which is why reqwest is built with `native-tls` on macOS (`Cargo.toml:104`).

Read-only SQLite on a live DB is the usual WAL caveat: a `-wal` sidecar may hold committed data, and
opening read-only cannot checkpoint it. Upstream accepts that.

#### 1.6 Trae `iCubeAuthInfo` AES-128-CBC

`trae.rs:334-810`. Source file is `~/Library/Application Support/<Trae variant>/User/globalStorage/storage.json`
(`trae.rs:331-336`); the value is the base64 string under key `iCubeAuthInfo://icube.cloudide`, with a
fallback that takes the longest value among keys prefixed `iCubeAuthInfo` (`trae.rs:346-360`).

The `safestorage` module (`trae.rs:334-810`) is a hand port of Trae's `byteCrypto.js` `V8e()` path.
It is **entirely offline — no Keychain, no `safeStorage`, no OS API**:

- Blob layout: `[magic 6B "tc\x05\x10\x00\x00"][salt 32B][AES-128-CBC PKCS7 ciphertext]` (`trae.rs:346-352` in the module doc, constants at `trae.rs:701-706`).
- Key derivation (`derive_key_iv`, `trae.rs:733-750`): `pw = JG XOR KG` where `JG`/`KG` are two
  hardcoded 64-byte arrays lifted from the client bundle (`trae.rs:709-722`); then
  `kdf_out = SHA512(SHA512(salt) || pw)`, `key = kdf_out[0..16]`, `iv = kdf_out[16..32]`.
- Decrypt + integrity: plaintext is `[SHA512 hash 64B][data]` and the hash is verified
  (`trae.rs:765-800`).
- Result parsed for `token`, `refreshToken`, `expiredAt`, `refreshExpiredAt`, `host`, `userId`
  (`trae.rs:365-397`).

Because the key material is a static constant in the binary, this works from *any* process with read
access to the file. It is also brittle by design — the module doc warns any change must be
re-validated against byte offsets, and a Trae client update that rotates `JG`/`KG` breaks it silently.
Fallback is `tokscale trae login --manual` (paste a JWT, `trae.rs:516-540`).

#### 1.7 Antigravity — not credentials at all, but process probing

`antigravity.rs` never reads a token file. It enumerates processes with
`ps -ww -eo pid,ppid,args` (`antigravity.rs:980`), scrapes `--csrf_token` and
`--extension_server_port` out of the Antigravity language-server command line
(`antigravity.rs:1185-1213`), discovers listening ports with
`lsof -Pan -p <pid> -iTCP -sTCP:LISTEN` (`antigravity.rs:1226-1245`), and then makes **outbound**
loopback calls to `127.0.0.1:<port>` with `X-Codeium-Csrf-Token` (`antigravity.rs:1382-1400`,
`2342-2360`). It resolves the app path with `lsof -p <pid> -Fn` (`antigravity.rs:1165-1177`).

This is the single most Tauri-hostile path in the whole port: it depends on **process enumeration of
other users' processes' full argv** and on **`lsof`**, both of which are impossible under App Sandbox
and awkward from a GUI app.

---

### 2. Tauri v2 on macOS: what actually applies

#### 2.1 Opening the system browser

`tauri-plugin-opener`: `app.opener().open_url(url, None::<&str>)` from Rust,
`openUrl()` from JS ([docs](https://v2.tauri.app/plugin/opener/)). Commands are blocked by default;
the JS side needs `opener:allow-open-url` (or the default permission set, which allows
`http://`/`https://`/`mailto:`/`tel:`) in `src-tauri/capabilities/default.json`. **Rust-side calls do
not go through the capability system**, so a Rust command that opens the URL itself needs no
capability entry. Upstream's `Command::new("open")` also works unchanged from a Tauri app — there is
no macOS restriction on invoking `/usr/bin/open`.

#### 2.2 Binding a loopback listener from the app process

Only relevant if the GUI ever implements its own redirect flow (it does not need one today).

- **Unsandboxed** (the Tauri default, see 2.3): no entitlement, no permission, nothing. A plain
  `std::net::TcpListener::bind("127.0.0.1:0")` or an axum/tiny_http server in the Tauri process just
  works.
- **Sandboxed**: `com.apple.security.network.server` is required — "Network socket for listening for
  incoming connections initiated by other machines"
  ([Apple, Entitlement Key Reference](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)).
  Outbound calls need `com.apple.security.network.client`.
- **Hardened Runtime** does not touch sockets. It targets "code injection, dynamically linked library
  hijacking, and process memory space tampering" — W^X memory, DYLD env vars, third-party plug-in
  loading, in-memory code modification, task-port attachment
  ([Oakley, *Notarization: the hardened runtime*](https://eclecticlight.co/2021/01/07/notarization-the-hardened-runtime/)).
  Its separate "Resource Access" entitlements cover camera/mic/location/contacts/calendars/photos/
  Apple Events — not networking, not files, not the Keychain.
- **Notarization** does not inspect or restrict runtime network behaviour.
- **Local Network Privacy** (the macOS 15+ prompt) does not apply. Apple defines a local network
  address as one "on an IP network associated with a broadcast-capable network interface" (Wi-Fi,
  Ethernet), plus multicast and 255.255.255.255
  ([Local Network Privacy FAQ-1](https://developer.apple.com/forums/thread/663848), superseded by
  [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)).
  Loopback is not broadcast-capable, so 127.0.0.1 traffic — inbound listener *or* the outbound
  Antigravity probes — is outside the policy.
- Practical constraint that *does* bite: fixed ports. Codex's 1455/1457 are single-instance. If the
  GUI is running and the user also runs `codex login` in a terminal, one of them fails with
  "address in use".

#### 2.3 Does Tauri sandbox or harden by default?

From Tauri's own source:

- `bundle.macOS.hardenedRuntime` defaults to **`true`**
  ([`tauri-utils/src/config.rs`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs), `hardened_runtime: true` in the `Default` impl).
- `bundle.macOS.entitlements` defaults to **`None`**, and `tauri-bundler` only passes `--entitlements`
  when that field is set
  ([`tauri-bundler/src/bundle/macos/sign.rs`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/sign.rs), lines 53-70).

**So a stock Tauri v2 macOS build is Hardened-Runtime-signed and *not* sandboxed.** App Sandbox is
opt-in and only reachable by authoring an entitlements plist. That is the configuration this port
needs, and it must stay that way:

> **App Sandbox is incompatible with tokscale's entire model.** Every provider path reads another
> application's private data — `~/.claude/.credentials.json`, `~/.codex/auth.json`,
> `~/.grok/auth.json`, `~/.kimi*/credentials/*.json`, Cursor's `state.vscdb`, Trae's `storage.json`,
> plus Keychain items created by other apps, plus `ps`/`lsof`. A sandboxed app gets none of it.
> Corollary: **the Mac App Store is off the table**; Developer ID + notarization is the only channel.

Also note: Tauri's WebView is WKWebView, whose JIT lives in system-provided XPC processes, so
`com.apple.security.cs.allow-jit` is commonly *not* needed for a plain Tauri app. Treat any
entitlement addition as something to prove empirically on a notarized build rather than copy from a
blog post.

#### 2.4 Keychain from a signed `.app` — the load-bearing part

Two mechanisms exist on macOS and they behave completely differently:

1. **File-based login keychain** (`login.keychain-db`), what `/usr/bin/security` and
   `SecKeychain*` use. Each item carries an **ACL** listing trusted applications plus a **partition
   list** keyed on code-signature identity. Access by a process not on that list produces the
   "wants to use your confidential information stored in … in your keychain" prompt, requiring the
   user's *login password* — and clicking "Always Allow" edits the ACL but not the partition list.
2. **Data-protection keychain** (iOS-style), governed by
   `com.apple.security.keychain-access-groups` / team ID. Items are only shareable between apps from
   the **same team**; a third-party app reading another team's item is
   [explicitly unsupported](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps).

**tokscale is squarely in mechanism 1, and that is what saves it.** Because it shells out to
`/usr/bin/security` rather than calling `SecItemCopyMatching` in-process, the *requesting binary* is
Apple's `security` tool — not the Tauri app. And the items it reads were themselves created by
`/usr/bin/security`: an item created by the tool "is set to allow unfettered access by that tool"
(Apple DTS, [forums thread 116579](https://developer.apple.com/forums/thread/116579)). Silverfort's
teardown of Claude Code confirms the concrete case: the CLI runs `security add-generic-password`
without access-control parameters, so the `Claude Code-credentials` item's ACL trusts only
`/usr/bin/security` in Apple's `apple-tool` partition, and *any* user-mode process can read it with
`security find-generic-password -s "Claude Code-credentials" -w` — "no Touch ID prompt, password
requirement, or elevation barrier"
([Silverfort](https://www.silverfort.com/blog/skipping-the-lock-a-claude-code-cli-weakness-lets-any-macos-process-read-stored-credentials/)).

Consequences for the port, in order of importance:

- **Keep the subprocess.** Reusing `helpers::read_keychain` verbatim means the Tauri app's own signing
  identity is irrelevant to Keychain access, and reads stay silent. This is the single most important
  "do not refactor" constraint in P3.
- **Do not "modernize" to `security-framework` / the `keyring` crate.** Calling `SecItemCopyMatching`
  in-process makes the Tauri binary the requesting app. It is not on those items' ACLs, so macOS
  prompts for the login password on every provider refresh — and every rebuild changes the CDHash, so
  even "Always Allow" would not stick (partition lists bind to code hashes, and
  `security set-generic-password-partition-list` requires the keychain password and fails headless).
- **Signing identity does not grant access to other apps' items.** There is no entitlement, team ID,
  or Developer ID that lets app A read app B's login-keychain item. Access comes only from being on
  the item's ACL. Anything Anthropic or OpenAI later tightens (e.g. Electron `safeStorage`-style
  items bound to their own code signature, which is what Claude *Desktop* already does per Silverfort)
  becomes unreadable to tokscale by any means, GUI or CLI.
- **Terminal vs `.app` makes no difference here**, because the requesting binary is `/usr/bin/security`
  either way. (It *would* matter for in-process Security-framework calls.)
- **`security` prints the secret on stdout.** Keep the `Stdio::piped()` capture and never let it reach
  a log or the WebView console.

#### 2.5 Reading other apps' files from a GUI app

Unsandboxed, `~/.claude`, `~/.codex`, `~/.grok`, `~/.kimi*` and
`~/Library/Application Support/{Cursor,Trae}` are all plain reads with no TCC gate today — TCC's
classic protected set is Desktop/Documents/Downloads/removable volumes plus contacts/calendars/photos.

One thing to watch: recent macOS extends the `com.apple.macl` protection that has always covered
sandboxed apps' `~/Library/Containers/<bundle-id>/Data` to a **hardcoded allowlist** of non-sandboxed
apps' `~/Library/Application Support/<app>` folders, enforced by `/usr/libexec/sandboxd` and
updatable via XProtect without an OS update
([Regula, *Crossing the Golden Gate*](https://wojciechregula.blog/post/golden-gate-appdata-protection/)).
The current list is browsers, Discord and crypto wallets — **Cursor and Trae are not on it** — but the
list is data, not code, so Cursor's or Trae's directory could be added at any time, and the failure
mode is `Operation not permitted` on a read that worked yesterday. Both Cursor and Trae reads must
degrade gracefully to their manual-paste fallbacks (which upstream already has:
`cursor.rs:1659` and `trae.rs:516`).

`~/.claude` etc. are dotfiles in the home directory and are not affected by that mechanism.

#### 2.6 Spawning child processes and probing local processes

- Spawning `codex login`, `grok agent … stdio`, `security`, `ps`, `lsof`, `open` from a Tauri app is
  fine **only because the app is unsandboxed**. Under App Sandbox, children inherit the sandbox
  (`com.apple.security.inherit`) and none of these would work.
- **PATH is the trap.** A GUI `.app` launched from Finder/Dock inherits `launchd`'s minimal
  environment, *not* the user's shell PATH. `Command::new("codex")` / `"grok"` / `"gh"` will fail with
  `ENOENT` for anything installed via Homebrew, nvm, bun, mise, asdf, cargo, etc. — which is most of
  these tools. `security`, `ps`, `lsof`, `open` are in `/usr/bin` and are safe. Any port of
  `tui/codex_login.rs`, `commands/usage/grok.rs:146`, or `commands/report.rs` needs explicit binary
  resolution (probe well-known install roots, or read the user's login shell PATH via
  `$SHELL -l -c 'echo $PATH'`). This is a certainty, not a risk.
- `ps -ww -eo pid,ppid,args` from an unsandboxed app returns full argv for the user's own processes,
  which is all Antigravity needs. `lsof` on another PID owned by the same user likewise works
  unsandboxed and unprivileged.

---

### 3. Net constraints for P3

1. Ship **unsandboxed**, Developer ID + Hardened Runtime (Tauri's default) + notarized. No Mac App
   Store. Do not add an entitlements plist unless something concrete demands it.
2. Reuse `helpers::read_keychain`'s `/usr/bin/security` subprocess **as-is**. Do not switch to an
   in-process Keychain API — that is the difference between silent reads and a password prompt per
   refresh.
3. No loopback listener is needed for Claude, Cursor, Grok, Kimi or Trae. Only Codex has one, it lives
   in the spawned `codex login` child, and it is fixed at 127.0.0.1:1455 (fallback 1457) — so it is
   single-instance and can collide with a terminal `codex login`. Keep upstream's kill-the-child-on-exit
   discipline (`tui/app.rs:1233`).
4. Browser opening: `tauri-plugin-opener` from Rust needs no capability; the JS path needs
   `opener:allow-open-url`. Upstream's `open(1)` also still works.
5. Solve PATH resolution for spawned vendor CLIs before P3 code is written; a GUI app does not inherit
   the shell PATH.
6. Cursor needs `rusqlite` read-only-URI access to a live VS Code DB (WAL caveat); Trae needs the
   offline AES-128-CBC port with its hardcoded key material (brittle across Trae updates). Both must
   fall back to manual paste.
7. Antigravity's `ps` + `lsof` + loopback-probe path is the riskiest to port and is the one that App
   Sandbox would kill outright.
8. tokscale's own account token stays a `0600` plaintext file at
   `~/.config/tokscale/credentials.json` — shared with the CLI, so GUI and CLI stay logged in
   together. Worth an explicit decision rather than an accident.
