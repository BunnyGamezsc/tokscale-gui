//! Finding the vendor CLIs tokscale shells out to, from a `.app` that never saw
//! a shell.
//!
//! A `.app` launched from Finder inherits launchd's environment, not the user's
//! shell. `launchctl getenv PATH` is unset on a stock machine, which means the
//! default `/usr/bin:/bin:/usr/sbin:/sbin` — so `security`, `open` and
//! `crontab`, the three system binaries upstream spawns, resolve fine even
//! though it spells them as bare names (`Command::new("security")`, not
//! `/usr/bin/security`). The six *vendor* CLIs resolve to nothing: Homebrew,
//! nvm, bun, mise, asdf and `~/.local/bin` are all shell-PATH additions.
//!
//! Upstream has no PATH logic to port — every call site is
//! `Command::new("<bare name>")`, which is correct for a CLI launched from a
//! terminal and wrong for this app. See ADR 0006.
//!
//! The split here is the one `settings.rs` uses: a pure inner function that is
//! handed its directories, and a thin impure layer that discovers them.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// The bare names upstream spawns, counted from the fork's call sites: `codex`
/// (5), `gh` (3), `kiro-cli` (2), `gemini` (2), `claude` (2), `grok` (1).
///
/// ROADMAP item 6 listed these as "codex, grok, gh, claude, kiro". Two of those
/// were wrong: the binary is `kiro-cli`, and `gemini` was missing entirely.
///
/// The system binaries are deliberately absent. They already resolve under
/// launchd's default PATH, so putting them here would claim a problem that does
/// not exist.
const VENDOR_CLIS: [&str; 6] = ["claude", "codex", "gemini", "gh", "grok", "kiro-cli"];

/// Where a binary was found, and whether the inherited PATH would have found it.
///
/// Three outcomes rather than a `Result<PathBuf, String>`, because the ticket's
/// whole point is that the two failures are different actions. `NotInstalled`
/// is fixed by the user installing something; `OffPath` is fixed by this app
/// spawning the absolute path it already holds. An error string collapses them
/// back into one.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Resolution {
    /// On the PATH this process inherited. A bare-name spawn would have worked.
    OnPath(PathBuf),
    /// Installed, but only somewhere the inherited PATH does not name. A
    /// bare-name spawn fails here and an absolute one succeeds.
    OffPath(PathBuf),
    /// Not in any directory we know to look in.
    NotInstalled,
}

/// First executable match wins, PATH before the extra candidates.
///
/// PATH is searched first so that a user who has deliberately put a binary
/// ahead of the version-manager copy keeps that choice — this must not
/// second-guess a working environment, only rescue a missing one.
///
/// Pure in the sense the ticket asks for: it spawns nothing, reads no
/// environment, and only touches the directories it was handed, so its tests
/// are temp directories rather than a machine.
fn resolve(name: &str, path_dirs: &[PathBuf], extra_dirs: &[PathBuf]) -> Resolution {
    if let Some(found) = first_executable(name, path_dirs) {
        return Resolution::OnPath(found);
    }
    match first_executable(name, extra_dirs) {
        Some(found) => Resolution::OffPath(found),
        None => Resolution::NotInstalled,
    }
}

fn first_executable(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    dirs.iter().map(|dir| dir.join(name)).find(|p| executable(p))
}

/// Follows symlinks on purpose: Homebrew's `bin` and nvm's shims are both
/// links, and a `symlink_metadata` here would reject every one of them.
///
/// The mode test is "executable by *someone*", where a shell's PATH lookup is
/// `access(X_OK)` — "executable by *me*". They differ for a file like a
/// root-owned `0o700`, which this reports as found and a spawn then fails on.
/// Closing the gap means comparing the file's uid and gid against the process's,
/// and `std` exposes neither `geteuid` nor `access`, so it means a direct `libc`
/// dependency for a case that does not arise in a user's own `~/.local/bin` or
/// in a Homebrew prefix they own. Left open deliberately; add `libc` if a real
/// report shows up.
fn executable(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// The inherited PATH, split.
fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default()
}

/// What `tokscale_cli::spawn` runs for `name`: the resolved path, or the bare
/// name when nothing was found, so the spawn fails the way a shell's would.
/// Installed once, in `run` (ADR 0007).
pub fn for_spawn(name: &str) -> PathBuf {
    match resolve(name, &path_dirs(), &extra_dirs()) {
        Resolution::OnPath(p) | Resolution::OffPath(p) => p,
        Resolution::NotInstalled => name.into(),
    }
}

/// The directories a shell would have added, in the order to try them.
///
/// A flat literal, except for nvm. Homebrew, bun, cargo, volta, deno, pnpm and
/// `~/.local/bin` all install to one fixed directory, and asdf and mise put a
/// single `shims` directory in front of every version they manage — which is
/// exactly why they are one line each here.
///
/// **The order mirrors how a shell builds `PATH`, and it is load-bearing.** A
/// binary can be installed more than once: this machine has `codex` under both
/// nvm and `~/.local/bin`, and `gemini` under both nvm and `/usr/local/bin`. A
/// shell resolves the nvm copy of each, because version managers *prepend* —
/// that is their whole mechanism — while package managers and manual installs
/// append. Listing Homebrew first would have made the packaged app run a
/// different binary than the terminal does, silently, and only for users who
/// happen to have two.
fn extra_dirs() -> Vec<PathBuf> {
    // A missing `HOME` drops the per-user directories and keeps the Homebrew
    // prefix below rather than returning nothing: that prefix does not depend
    // on the variable, so losing it would be a second failure caused by
    // handling the first.
    let mut dirs = match std::env::var_os("HOME") {
        Some(home) => home_dirs(Path::new(&home)),
        None => Vec::new(),
    };

    // `HOMEBREW_PREFIX` is set by `brew shellenv`, so it is usually absent from
    // launchd's environment and the two defaults are what actually answer:
    // `/opt/homebrew` on Apple silicon, `/usr/local` on Intel and for anything
    // else installed by hand.
    match std::env::var_os("HOMEBREW_PREFIX").map(PathBuf::from) {
        Some(prefix) => dirs.extend([prefix.join("bin"), prefix.join("sbin")]),
        None => dirs.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/opt/homebrew/sbin"),
        ]),
    }
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs
}

/// The per-user half of the candidate list, as a function of `$HOME` so it can
/// be tested without touching the environment.
fn home_dirs(home: &Path) -> Vec<PathBuf> {
    // Version managers first: they prepend.
    let mut dirs = nvm_dirs(&home.join(".nvm"));
    dirs.extend([
        // fnm has no shims either, but unlike nvm it keeps a `default` alias
        // symlink, so the alias is the whole answer and no globbing is needed.
        home.join("Library/Application Support/fnm/aliases/default/bin"),
        home.join(".local/share/fnm/aliases/default/bin"),
        home.join(".asdf/shims"),
        home.join(".local/share/mise/shims"),
        // mise's pre-2024 location, still present on machines that never moved.
        home.join(".mise/shims"),
        home.join(".volta/bin"),
        // Then per-tool installers, which also prepend.
        home.join(".bun/bin"),
        home.join(".deno/bin"),
        home.join(".cargo/bin"),
        home.join("Library/pnpm"),
        // Then the appended one.
        home.join(".local/bin"),
    ]);
    dirs
}

/// nvm's installed node versions' `bin` directories, newest version first.
///
/// nvm is the one manager that has no shims: it works by *editing PATH* in the
/// shell, so there is no single directory to name and no `current` symlink to
/// follow. That leaves the question of which version is "the" one when a binary
/// is installed under some versions and not others — the usual case, since
/// `npm i -g` installs into whichever version was active at the time.
///
/// The rule is newest version wins, and it falls out of ordering rather than
/// choosing: every version's `bin` goes into the candidate list sorted
/// descending, and `resolve`'s first-match then picks the newest version that
/// actually has the binary. `~/.nvm/alias/default` was the alternative and is
/// not read — it holds an alias name (`node`, `lts/*`) as often as a version,
/// so following it means implementing nvm's alias resolution for a file that,
/// when it does say `node`, means "newest installed" anyway.
fn nvm_dirs(nvm: &Path) -> Vec<PathBuf> {
    let mut versions: Vec<PathBuf> = std::fs::read_dir(nvm.join("versions/node"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .collect();
    // Descending by version, then by name so a tie or an unparseable directory
    // still orders the same way on every run.
    versions.sort_by(|a, b| version_key(b).cmp(&version_key(a)).then_with(|| a.cmp(b)));
    versions.into_iter().map(|v| v.join("bin")).collect()
}

/// `v26.7.0` as `(26, 7, 0)`. Anything unparseable sorts last rather than
/// erroring — a stray file in `versions/node` should cost nothing.
fn version_key(dir: &Path) -> (u64, u64, u64) {
    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let mut parts = name.trim_start_matches('v').split('.');
    let mut next = || parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    (next(), next(), next())
}

/// What the app would resolve, right now, in the environment it was launched
/// in — one row per vendor CLI.
///
/// This is the ticket's fourth and fifth acceptance criteria, and it is what
/// keeps the module above from being a tested thing nobody calls. Nothing in
/// the GUI spawns a process yet; the sync and auth work that will is P3. But
/// "not installed" and "installed but not on this PATH" are required to read
/// differently *to the user*, and "a packaged app launched from Finder resolves
/// a binary that a terminal-launched build resolves" cannot be checked at all
/// unless the packaged app says what it resolved. Both need a surface, so there
/// is one: the sidebar's Vendor CLIs sheet. When P3 arrives it stops being only
/// a diagnostic and starts being the thing that tells sync why it cannot run.
///
/// On `spawn_blocking` like every other command, which is a settled rule and
/// not one this is worth being an exception to: `extra_dirs` does a `read_dir`
/// and the resolution is some dozens of `stat`s, all of them against
/// directories that may be on a slow or absent volume.
#[tauri::command]
pub async fn vendor_clis() -> Result<Vec<crate::dto::VendorCli>, String> {
    crate::commands::blocking(|| {
        let (path, extra) = (path_dirs(), extra_dirs());
        Ok(VENDOR_CLIS
            .iter()
            .map(|name| {
                let (state, found) = match resolve(name, &path, &extra) {
                    Resolution::OnPath(p) => ("onPath", Some(p)),
                    Resolution::OffPath(p) => ("offPath", Some(p)),
                    Resolution::NotInstalled => ("missing", None),
                };
                crate::dto::VendorCli {
                    name: (*name).to_string(),
                    state,
                    path: found.map(|p| p.to_string_lossy().into_owned()),
                }
            })
            .collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a directory tree under a unique temp root: `dirs` are created,
    /// and each `bins` entry is written as an executable file.
    fn fixture(name: &str, bins: &[&str]) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "tokscale-gui-vendor-{}-{name}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&root).ok();
        for bin in bins {
            let path = root.join(bin);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        root
    }

    /// The three cases the ticket names, in one pass over one tree: found on the
    /// first candidate, found on a later one, and absent from all — the last
    /// being its own outcome, not an error.
    #[test]
    fn a_binary_is_found_on_the_first_candidate_a_later_one_or_nowhere() {
        let root = fixture("three", &["one/gh", "two/codex"]);
        let dirs = vec![root.join("one"), root.join("two"), root.join("three")];

        assert_eq!(
            resolve("gh", &[], &dirs),
            Resolution::OffPath(root.join("one/gh"))
        );
        assert_eq!(
            resolve("codex", &[], &dirs),
            Resolution::OffPath(root.join("two/codex"))
        );
        assert_eq!(resolve("kiro-cli", &[], &dirs), Resolution::NotInstalled);

        std::fs::remove_dir_all(&root).ok();
    }

    /// The distinction the ticket exists for. The same installed binary reads
    /// one way when the inherited PATH already names its directory and another
    /// when only the candidate list does — and "absent" is neither.
    #[test]
    fn on_path_off_path_and_not_installed_are_three_different_answers() {
        let root = fixture("split", &["shell/claude", "elsewhere/grok"]);
        let path = vec![root.join("shell")];
        let extra = vec![root.join("shell"), root.join("elsewhere")];

        assert_eq!(
            resolve("claude", &path, &extra),
            Resolution::OnPath(root.join("shell/claude"))
        );
        assert_eq!(
            resolve("grok", &path, &extra),
            Resolution::OffPath(root.join("elsewhere/grok"))
        );
        assert_eq!(resolve("gemini", &path, &extra), Resolution::NotInstalled);

        std::fs::remove_dir_all(&root).ok();
    }

    /// A user who put their own copy first keeps it. The rescue only applies
    /// where the inherited environment has nothing to say.
    #[test]
    fn the_inherited_path_wins_over_the_candidates() {
        let root = fixture("precedence", &["shell/codex", "nvm/codex"]);
        assert_eq!(
            resolve("codex", &[root.join("shell")], &[root.join("nvm")]),
            Resolution::OnPath(root.join("shell/codex"))
        );
        std::fs::remove_dir_all(&root).ok();
    }

    /// A directory of the right name is not a binary, and neither is a file
    /// with no executable bit — an `npm` install that failed part-way leaves
    /// exactly the second one behind.
    #[test]
    fn a_directory_or_a_non_executable_file_is_not_a_match() {
        let root = fixture("shapes", &["bin/real"]);
        std::fs::create_dir_all(root.join("bin/codex")).unwrap();
        std::fs::write(root.join("bin/gh"), "").unwrap();
        std::fs::set_permissions(root.join("bin/gh"), std::fs::Permissions::from_mode(0o644))
            .unwrap();

        let dirs = vec![root.join("bin")];
        assert_eq!(resolve("codex", &[], &dirs), Resolution::NotInstalled);
        assert_eq!(resolve("gh", &[], &dirs), Resolution::NotInstalled);
        assert_eq!(
            resolve("real", &[], &dirs),
            Resolution::OffPath(root.join("bin/real"))
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// The candidate list is a literal, and a literal's failure mode is going
    /// stale silently — a manager it forgets reads as "Not installed" for a
    /// binary the user can see in their shell. This does not assert the whole
    /// list (that would be the list, written twice); it pins the two properties
    /// that are load-bearing: every manager the ROADMAP names is present, and
    /// version managers come before the appended directories, which is what
    /// makes the packaged app resolve the same copy the shell does when a
    /// binary is installed twice.
    #[test]
    fn the_candidate_list_covers_the_managers_and_orders_them_like_a_shell() {
        let home = PathBuf::from("/home/someone");
        let dirs = home_dirs(&home);
        let has = |suffix: &str| dirs.iter().position(|d| d.ends_with(suffix));

        for manager in [
            ".asdf/shims",
            ".local/share/mise/shims",
            "fnm/aliases/default/bin",
            ".volta/bin",
            ".bun/bin",
            ".cargo/bin",
            "Library/pnpm",
            ".local/bin",
        ] {
            assert!(has(manager).is_some(), "{manager} is not a candidate");
        }

        assert!(
            has(".asdf/shims") < has(".local/bin"),
            "version managers prepend to PATH and must be searched first"
        );
    }

    /// The nvm rule, on the shape this machine actually has: two node versions,
    /// and a binary installed under only the newer one. Ordering alone has to
    /// find it — a candidate list that named one version would miss it half the
    /// time, and which half depends on when the user last ran `npm i -g`.
    #[test]
    fn nvm_versions_are_ordered_newest_first() {
        let root = fixture(
            "nvm",
            &[
                "versions/node/v22.20.0/bin/gh",
                "versions/node/v26.7.0/bin/gh",
                "versions/node/v26.7.0/bin/codex",
            ],
        );
        let dirs = nvm_dirs(&root);

        assert_eq!(
            dirs,
            vec![
                root.join("versions/node/v26.7.0/bin"),
                root.join("versions/node/v22.20.0/bin"),
            ]
        );
        // Present in both: the newer version answers.
        assert_eq!(
            resolve("gh", &[], &dirs),
            Resolution::OffPath(root.join("versions/node/v26.7.0/bin/gh"))
        );
        // Present in only one, and not the one a naive "first directory" pick
        // would have used.
        assert_eq!(
            resolve("codex", &[], &dirs),
            Resolution::OffPath(root.join("versions/node/v26.7.0/bin/codex"))
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// Version order is numeric, not lexical: `v9` is older than `v26` but
    /// sorts after it as a string, and nvm keeps old majors around for years.
    #[test]
    fn version_order_is_numeric_and_survives_junk() {
        let root = fixture(
            "nvm-sort",
            &["versions/node/v9.11.2/bin/x", "versions/node/v26.7.0/bin/x"],
        );
        std::fs::create_dir_all(root.join("versions/node/not-a-version")).unwrap();

        assert_eq!(
            nvm_dirs(&root),
            vec![
                root.join("versions/node/v26.7.0/bin"),
                root.join("versions/node/v9.11.2/bin"),
                root.join("versions/node/not-a-version/bin"),
            ]
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// What this machine resolves, in whatever environment the test runs in.
    ///
    /// The fifth acceptance criterion — a packaged app launched from Finder
    /// resolving what a terminal-launched build resolves — is the one thing
    /// here that cannot be desk-checked, and it is a property of an
    /// environment rather than of a corpus. `vendor_clis` reads exactly two
    /// variables, `PATH` and `HOME`, so running this under each of the two
    /// environments reproduces what each build reports:
    ///
    /// ```text
    /// cargo test --lib -- --ignored --nocapture what_this_machine_resolves
    /// env -i HOME=$HOME PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    ///   cargo test --lib -- --ignored --nocapture what_this_machine_resolves
    /// ```
    ///
    /// The second PATH is not a guess. `ps eww` on a Finder-launched
    /// `Tokscale.app` shows exactly that string — launchd's built-in default,
    /// since `launchctl getenv PATH` is unset here. Note that `open(1)` from a
    /// terminal is *not* a substitute for Finder: it hands the app the calling
    /// shell's environment, so it reports the terminal's answer and hides the
    /// bug entirely.
    ///
    /// Prints; never asserts. The answers belong to the machine that produced
    /// them and are recorded on the ticket and in ADR 0006.
    #[test]
    #[ignore]
    fn what_this_machine_resolves() {
        let (path, extra) = (path_dirs(), extra_dirs());
        println!("PATH has {} directories", path.len());
        for name in VENDOR_CLIS {
            println!("{name:>9}  {:?}", resolve(name, &path, &extra));
        }
    }

    /// No nvm at all is the common case, not a failure.
    #[test]
    fn a_machine_without_nvm_contributes_no_directories() {
        assert!(nvm_dirs(&std::env::temp_dir().join("tokscale-gui-no-nvm-here")).is_empty());
    }
}
