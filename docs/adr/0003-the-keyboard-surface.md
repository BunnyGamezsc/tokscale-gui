# 3. The keyboard surface

Date: 2026-09-09

## Status

Accepted

## Context

Ticket #31 asks three things to be *decided and recorded*, not only built: whether to
adopt a hotkey library, which of upstream's TUI bindings survive the port, and whether
a command palette is the discovery surface.

The window has five destinations, one Report Filter in the chrome, one Refresh action,
and three surfaces that open a Daily Detail (a Daily row, a Models row, a Contribution
Graph cell). Upstream's TUI carries about thirty bindings across
`crates/tokscale-cli/src/tui/app.rs:798-970`, plus 236 lines in `tui/keymap.rs` that map
Cyrillic and Greek characters back to their US-QWERTY positions.

#29 landed first and spent the four arrows plus `Home`/`End` walking the graph, so this
ticket inherits a keyboard that is already partly allocated.

## Decision

### No hotkey library

The standing "no" holds. `ROADMAP.md`'s Settled section already records that Hotkeys was
considered and never installed, alongside Table and Charts; nothing in this ticket is an
argument to reopen it. Five destinations, Refresh and a help sheet is **seven bindings**.
They are a `window` `keydown` listener in `src/routes/tree.tsx` and one pure resolver in
`src/lib/keys.ts` — about sixty lines, tested without a DOM.

A library earns its place when there are sequences, scopes, or a registry that
components contribute to at runtime. There is one scope here (the window), no sequences,
and the binding set is a literal in one file.

### `event.code` for the letter, `event.key` for the punctuation

Upstream's `normalize_hotkey` exists because a terminal reports the *character* a key
produced, so `r` stops refreshing under a Russian layout. `KeyboardEvent.code` is the
physical key, so the webview gives that behaviour for free. The 236-line table is not
ported; the property is just chosen correctly.

`?` is the exception, and it is not an oversight. The sheet advertises a **character**,
and the key that produces it moves between layouts — Shift+`/` on US, Shift+`ß` on German.
Matching it by position would advertise a key that does not work. So `?` is matched on
`event.key`, which is the honest property for a binding named after what you type. One
binding, one deviation, stated here rather than discovered.

### The bindings that survive

| Kept | What it does | Why |
| --- | --- | --- |
| `⌘1`–`⌘5` | Go to Overview, Models, Daily, Stats, Pricing | Upstream's tab cycling, in the shape macOS already uses for tabs. A modifier, so it cannot collide with the graph or with a text field. |
| `R` | Refresh | Upstream's `r`. The one action with no visible control outside Overview. Shift is not checked: the sheet says `R`, and Shift+R meaning nothing would make the sheet a lie. |
| `?` | Shortcuts sheet | New. There is no TUI equivalent; a terminal has a footer hint line. |
| `Enter` / `Space` | Activate what has focus | Upstream's `Enter` opens the selected Daily/Stats detail. The platform's, once the thing is a `<button>`. |
| `Esc` | Close a dialog | Upstream's, and the native `<dialog>`'s. |

Rejected, with the reason each was rejected:

| Upstream | Rejected because |
| --- | --- |
| `q`, `Ctrl+C` quit | ⌘Q and ⌘W are the platform's, and are in the menu bar where a user can find them. |
| `Tab` / `BackTab` cycle tabs | `Tab` is the web's focus traversal. Taking it would break the tab order this ticket exists to get right. |
| `←` / `→` switch tabs | Spent by #29: in the grid they are the previous and next *week*. |
| `↑` / `↓` move selection | Spent by #29 (previous and next day). Outside the grid there is no selection model to move — the GUI's tables have rows, not a cursor. |
| `Home` / `End` move selection | Spent by #29 inside the grid; outside it, the scroll container's own `Home`/`End` is already the right answer. |
| `PageUp` / `PageDown` | Same: the View scrolls with them already. |
| `c` / `t` / `d` sort | Models' sort is a column header you can see, click, tab to and press `Enter` on. A key for a visible control is a second way to do one thing. |
| `j` jump to today | Daily is sorted newest-first, so today is the **first row**. There is nothing to jump to. (The ticket is right that `j` is not a filter — it is just redundant here, not misunderstood.) |
| `p` cycle theme, `l` light mode | Theme is a *window* state, not a CSS class: `set_theme` and `data-theme` are written together in `applyAppearance` and nowhere else. It belongs to the appearance code and to P2's settings screen, not to a keymap. |
| `R` toggle auto-refresh, `+` / `-` interval | Interval refresh is not built (P2, "Not yet specified"). Refresh therefore answers to Shift+R too; auto-refresh can claim its own key when it arrives. |
| `y` copy row | No selection model, and the text is selectable — ⌘C is the platform's. |
| `e` export JSON | No export in P1. It needs a save panel, not a key. |
| `s` client picker | The Report Filter's Picker **is** that control, visible in the chrome. It is also report-time, where upstream's `s` is scan-time; naming those two things apart is roadmap item 5 and not settled. |
| `g` group-by picker | Models' Group-By tabs are that control, visible and already keyboard-reachable. |
| `h` chart granularity | Hourly is P2. There is one granularity. |
| `v` hourly view mode | Hourly is P2 and does not exist. |
| `a`, `m`, `x` (Usage) | Usage is P2/P3 and does not exist. |
| `w` worktree rollup | `WorktreeRollup` is not exposed by P1's Group-By set. |
| `Backspace` close detail | `Esc` is unambiguous; `Backspace` is the browser's own back-gesture territory. |

The pattern in that column is the ticket's own point: most of the TUI's bindings exist
because a terminal has no sidebar and no popovers — `client_ui.rs` exhausts the lowercase
Latin alphabet assigning one character per Client. Porting them wholesale would port the
constraint, not the feature.

### The discovery surface is a Shortcuts sheet, not a ⌘K palette

A palette is a way to reach commands you **cannot see**. This window's commands are five
sidebar links, a Refresh button and a Report Filter, all on screen at all times. A palette
over them would be a second, worse sidebar.

The other half of the question — a palette as *search* over Models, Workspaces and
Sessions — is rejected for P1 for a different reason: it needs a Snapshot, so it is empty
or lying on a first run (21–40 s of scanning), and searching Models is what Models with a
Group-By already is. It stays open for P2, where Agents and Sessions arrive and the
corpus has more in it than five destinations.

What ships instead is a `<dialog>` listing the bindings, on `?` and on a "Shortcuts"
button at the foot of the sidebar. It renders `BINDINGS` from `src/lib/keys.ts` — the same
module the resolver lives in — so the app cannot describe a binding it does not have.
It needs no Snapshot, which makes it the one piece of chrome that is fully working during
a first scan.

### An interactive row keeps its click and gains a button

Daily's and Models' rows were `<tr onClick>` with no tab stop, no key handler and no role
(noted as a known gap in `eb76163`). Both keep the row as the pointer's hit target — that
is what the click behaviour already implied — and gain a real `<button>` in the first
cell carrying the accessible name (`"2026-03-04, breakdown"`). A Models Group-By with no
finer axis gets no button, matching the rows that already do not open.

The alternative, `tabIndex` and a key handler on the `<tr>`, makes an element that
announces as a row and behaves as a control, and costs the tab order one stop per row —
198 of them on the widest Group-By. The graph solved the same problem with a roving
tabindex; a table has no equivalent, so the button is the cheaper honest answer.

### Refresh has one owner

`useScan`'s `force` and `abandoned` moved from `useRef`/`useState` to module state in
`src/lib/use-scan.ts`, behind `refreshScan` and `useRefresh`. The shell binds `R` and no
View is guaranteed to be mounted under it, and a second `useScan` to give the shell a
handle would bring a second elapsed timer, its own Abandon state, and a second `force`
flag that could swallow the Refresh the key just asked for — the reason `useScanLanded`
exists. Same shape as `lib/filter.ts`, for the same reason: one per window, read from
trees that do not share a parent.

## Consequences

- Single-key bindings are refused while focus is in a `<textarea>`, a `<select>`, anything
  `contenteditable`, or an `<input>` that is not a toggle — guarded on the **event target**
  rather than a View flag, because the Report Filter's two date inputs live in the chrome
  where no View flag can see them. A checkbox is not a text input, so `R` still refreshes
  from the Filter's Client list. `⌘`-digit is never refused: it is not a character a field
  can receive.
- `⌘R` is left to the webview's reload; plain `R` is Refresh. `⌃`-digit is not bound —
  this is a macOS-only app (`macOSPrivateApi`, overlaid traffic lights), so ⌘ is the one
  modifier.
- **While a modal is open, the window's bindings are inert.** A dialog owns the window
  while it is up: navigating out from under one would unmount it without `close()`, so no
  focus would be restored and the top layer would be torn down, and Refresh would rescan
  behind a dialog that is reading the query being invalidated. `Esc` is the way out, and
  that is the platform's.
- Focus is visible everywhere from one `:focus-visible` rule in `styles.css`. Controls
  that paint their own ring — shadcn's `Button`, the graph's cells — declare it in the
  utilities layer, which wins over base.
- A dialog returns focus to what opened it. This is the native `<dialog>`'s, not ours, and
  it survives the conditional rendering the dialogs use: `close()` restores focus *before*
  it dispatches `close`, so React unmounts afterwards. Verified in the running app —
  focus the sidebar's Shortcuts button, `Enter`, `Esc`, and `document.activeElement` is
  the button again with the dialog gone from the DOM. Both dialogs now share one
  `components/modal.tsx`, so the Daily Detail and the Shortcuts sheet cannot drift apart
  on it. `showModal()` focuses the dialog element itself when nothing inside autofocuses;
  that is containment rather than a control taking focus, so it is exempted from the
  focus-ring rule.
- The sheet is a function of the sidebar, not a literal beside it: `bindings(NAV)` builds
  the `⌘1 – ⌘n` row from the destinations, and `resolve` returns an index the shell
  bounds-checks. Adding a destination is one edit, and the sheet follows it.
- The binding set is small enough that adding one is editing two lines in one file. If
  that stops being true — P2 brings Agents, Hourly, Usage and a settings screen — this
  decision is worth re-reading, but the library question should be reopened on a count,
  not on a feeling.
