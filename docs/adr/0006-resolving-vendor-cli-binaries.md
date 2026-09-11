# 6. Resolving vendor CLI binaries

Date: 2026-09-10

## Status

Accepted

## Context

A `.app` launched from Finder inherits launchd's environment, not the user's shell.
On this machine `launchctl getenv PATH` prints nothing, which means the built-in
default — `/usr/bin:/bin:/usr/sbin:/sbin`. Nothing a shell adds is there.

Upstream tokscale spawns nine distinct binaries, and they divide cleanly on that PATH:

| Binary | Sites | Under launchd's default PATH |
| --- | --- | --- |
| `codex` | 5 | not found |
| `gh` | 3 | not found |
| `kiro-cli` | 2 | not found |
| `gemini` | 2 | not found |
| `claude` | 2 | not found |
| `grok` | 1 | not found |
| `security` | 1 | found (`/usr/bin`) |
| `open` | 1 | found (`/usr/bin`) |
| `crontab` | 1 | found (`/usr/bin`) |

ROADMAP item 6 listed the vendor half as "codex, grok, gh, claude, kiro". Two of those
were wrong: the binary is `kiro-cli`, and `gemini` was missing. The list above is
counted from the fork's call sites.

The system half is a correction too, though it does not change the conclusion. The
ROADMAP said keychain access "stays a `/usr/bin/security` subprocess"; the code is
`Command::new("security")` — a bare name, like every other call
(`tokscale-cli/src/commands/usage/helpers.rs:28`). It resolves anyway, because
`/usr/bin` is on launchd's default PATH. So the three system binaries need nothing
from this ADR, and putting them in the candidate list would claim a problem that does
not exist.

There is also no upstream PATH logic to port. `grep '"PATH"'` across both crates finds
one CLI flag's `value_name` and nothing else — every spawn is `Command::new("<bare
name>")`, which is correct for a tool launched from a terminal and wrong for this app.
That is the entire defect: a packaged build fails at all six while `tauri dev`,
launched from a shell, succeeds at five of them.

## Decision

`src-tauri/src/vendor.rs`, in the shape `settings.rs` uses: a pure inner function under
a thin impure layer that discovers what to hand it.

### The candidate list is an argument, not a discovery

`resolve(name, path_dirs, extra_dirs)` takes both directory lists and touches nothing
else — no environment, no process, no `which`. Its tests are temp directories, which is
what makes "found on the first candidate, found on a later one, absent from all"
checkable without a machine that has any of these installed. `path_dirs()` and
`extra_dirs()` read `PATH` and `HOME`, and are the only impure part.

The extra list is a flat literal — Homebrew (`$HOMEBREW_PREFIX` when set, else
`/opt/homebrew/{bin,sbin}`, plus `/usr/local/bin`), `~/.local/bin`, bun, cargo, deno,
volta, pnpm, fnm's `default` alias, and the *shims* directories of asdf and mise (both
the current `~/.local/share/mise/shims` and the pre-2024 `~/.mise/shims`). Shims are why
those managers cost one line each: they put a single stable directory in front of every
version they manage, and fnm keeps a `default` alias symlink that serves the same purpose.

The per-user half is split out as `home_dirs(&Path)` so it is a function of `$HOME`
rather than of the environment, which is what lets a test assert its contents and its
order without `set_var` and the cross-test races that come with it.

### nvm is the exception, and the rule is newest-version-wins

nvm has no shims. It works by editing `PATH` in the shell, so there is no fixed
directory to name and no `current` symlink to follow. `~/.nvm/versions/node/*/bin` has
to be enumerated, which leaves the real question: which version is "the" one when a
binary is installed under some and not others? That is the normal case, not an edge —
`npm i -g` installs into whichever version happened to be active. This machine is the
example: two versions installed (v22.20.0, v26.7.0) and `codex` and `gemini` present
only under the newer.

Every version's `bin` goes into the candidate list, sorted descending by parsed version,
and `resolve`'s first-match does the rest. Newest-wins is then a consequence of ordering
rather than a choice made at lookup time, and the case above resolves without the
resolver knowing nvm exists. Version order is numeric: `v9` is older than `v26` and
sorts after it as a string. Unparseable directory names sort last rather than erroring.

### Candidate order mirrors how a shell builds PATH

Not cosmetic. A binary can be installed twice, and this machine has two of them: `codex`
under nvm *and* `~/.local/bin` (a standalone install), `gemini` under nvm *and*
`/usr/local/bin` (an older global npm). A shell resolves the nvm copy of each, because
version managers prepend to `PATH` — that is their entire mechanism — while package
managers and manual installs append.

The first ordering here put Homebrew and `~/.local/bin` first, and the packaged build
duly resolved the *other* copy of both. It still satisfied the letter of "resolves a
binary", and it would have been wrong: a packaged app running a different `codex` than
the terminal does, silently, for exactly those users who have two. Version-manager and
installer directories now come first, appended ones last, and the two environments agree
on all six paths.

`~/.nvm/alias/default` is deliberately not read. It holds an alias name as often as a
version — on this machine it says `node` — so honouring it means implementing nvm's
alias resolution, and `node` resolves to "newest installed" anyway, which is what the
ordering already does.

### The inherited PATH is searched first

A user who put their own copy ahead of the version-manager one keeps it. This rescues a
missing environment; it does not second-guess a working one.

### What "executable" means here, and where it stops

The test is `metadata().is_file() && mode & 0o111 != 0` — executable by *someone*. A
shell's PATH lookup is `access(X_OK)` — executable by *me*. They part company on a file
like a root-owned `0o700`, which this reports as found and a later spawn then fails on.
Closing the gap means comparing the file's uid and gid against the process's, and `std`
exposes neither `geteuid` nor `access`, so it means taking a direct `libc` dependency for
a case that does not arise in a user's own `~/.local/bin` or in a Homebrew prefix they
own. Left open deliberately, and named here so the next person does not have to rediscover
it.

### Three outcomes, in the type

```rust
pub enum Resolution { OnPath(PathBuf), OffPath(PathBuf), NotInstalled }
```

`Result<PathBuf, String>` was the alternative and it collapses exactly what the ticket
asks to separate. The two failures are different *actions*: `NotInstalled` is fixed by
the user installing something, `OffPath` is fixed by this app spawning the absolute path
it is already holding. An error string makes the caller re-derive that by reading prose.

`OnPath` and `OffPath` both carry a path and both mean "runnable", so a caller that only
wants to spawn can ignore the distinction; it exists for what the window says and for
what a future sync does about it.

### There is a caller, and it is the window

Nothing in the GUI spawns a process today — `tokscale-cli`, which owns every spawn
above, is a dormant P3 dependency. This module could therefore have shipped with no
production caller at all, and the ticket does not force the question, so it is answered
here rather than left to default: a `vendor_clis` command and a **Vendor CLIs** sheet in
the sidebar footer.

`vendor_clis` runs on `spawn_blocking` like every other command. An earlier draft argued
it was small enough to skip it; the ROADMAP's "Everything runs on `spawn_blocking`" is
settled and this is not worth being the exception to, particularly as `extra_dirs` does a
`read_dir` and the resolution is dozens of `stat`s against directories that may sit on a
slow or absent volume.

Two of the ticket's criteria require it. The two outcomes must "read differently to the
user", which needs a user; and "a packaged app launched from Finder resolves a binary
that a terminal-launched build resolves" cannot be checked at all unless the packaged
app says what it resolved. A release build has no devtools and `open` swallows stdout,
so the surface *is* the test instrument. It gets no keyboard binding — ADR 0003 defends
a count of seven, and a sheet read once after an install does not earn the eighth.

When P3 lands it stops being only a diagnostic and becomes what tells sync why it cannot
run.

### What this is not

A resolver, not a sync. Nothing here spawns anything, no PATH is mutated for child
processes, and no vendor CLI is invoked. The ticket says so in its own words: "This
removes the environment hazard that blocks the later provider-sync and authentication
work. It does not begin that work."

## Consequences

Six vendor CLIs resolve from a Finder-launched build, where all six previously failed.

The environment was measured on the packaged `.app` rather than assumed. `ps eww` on a
Finder-launched `Tokscale.app` shows `PATH=/usr/bin:/bin:/usr/sbin:/sbin` — launchd's
built-in default, since `launchctl getenv PATH` is unset here — against 50 directories
for a terminal-launched one. Note that `open(1)` from a terminal does **not** reproduce
this: it hands the app the calling shell's environment, so it reports the terminal's
answer and hides the bug completely. Finder has to do the launching
(`osascript -e 'tell application "Finder" to open POSIX file "…"'`).

Under each of those two environments the resolver returns the same path for every one of
the six — `claude` and `grok` from `~/.local/bin`, `gh` from `/opt/homebrew/bin`, `codex`
and `gemini` from `~/.nvm/versions/node/v26.7.0/bin`, and `kiro-cli` genuinely not
installed. They differ only in the explanation: `OnPath` from a terminal, `OffPath` from
Finder, `NotInstalled` either way. `what_this_machine_resolves` is the `#[ignore]`d probe
that prints the table; it reads only `PATH` and `HOME`, which is all `vendor_clis` reads,
so running it under `env -i` reproduces what each build reports.

One gap in that evidence, stated plainly: the packaged app's own **Vendor CLIs** sheet
was not read on screen. The shell this was implemented from holds neither Accessibility
nor Screen Recording permission, so the window could be launched and its environment
inspected but not clicked or captured. What is verified is the pair of inputs the sheet's
answer is a pure function of. Opening it by hand is a second's work and worth doing once.

The candidate list is a literal and will go stale. A manager it does not name reads as
"Not installed" for a binary the user can see in their shell, which is the one wrong
answer this design can give. `the_candidate_list_covers_the_managers_and_orders_them_like_a_shell`
pins the managers the ROADMAP names and the prepend-before-append order, so a careless
edit cannot quietly drop either. No user override was added — the ticket left it open. Add a directory here when one is missed;
a settings key is P2's business, and there is no settings surface to hang it on
(`settings.json` keeps a single writer, ADR 0005).

Whoever writes P3's spawn path must use the returned `PathBuf`. A bare `Command::new`
anywhere downstream re-opens this, silently, and only in a packaged build.
