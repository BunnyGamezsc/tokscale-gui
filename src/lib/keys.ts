/** The window's keyboard surface: what the bindings are, and what a key press
 *  resolves to.
 *
 *  No hotkey library. ROADMAP.md's Settled section already says Hotkeys was
 *  considered and never installed, and five destinations plus Refresh plus a
 *  help sheet is seven bindings — one `keydown` listener on the window, and this
 *  pure resolver under it. ADR 0003 records the decision and the reason each of
 *  upstream's ~30 TUI bindings was kept or rejected.
 *
 *  `code`, not `key`. Upstream spends 236 lines in `tui/keymap.rs` mapping
 *  Cyrillic and Greek characters back to their US-QWERTY positions so `r` works
 *  on a non-Latin layout. A webview gets that for free from `KeyboardEvent.code`,
 *  which is the physical key. So: no table, just the right property.
 */

export type KeyLike = {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** `nav:0`..`nav:4` index the sidebar's destinations in the order it draws them. */
export type Action = "refresh" | "help" | `nav:${number}`;

const NAV = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"];

/** Whether focus is somewhere that eats characters.
 *
 *  Guarded on the *target*, not on which View is showing: the Report Filter's
 *  two date inputs live in the window chrome, so no View flag could see them,
 *  and Pricing's rate fields would need a second flag. Duck-typed rather than
 *  taking an `HTMLElement` so it is testable without a DOM.
 */
export function isTyping(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** What a key press means, or `null` if it means nothing here.
 *
 *  Single-key bindings are refused while typing; modified ones are not, because
 *  ⌘1 is not a character any field can receive. Nothing here is bound to an
 *  arrow, Home, End or Tab: #29 spends the arrows and Home/End walking the
 *  Contribution Graph, and Tab is the web's own focus traversal.
 */
export function resolve(e: KeyLike, typing: boolean): Action | null {
  if (e.altKey) return null;

  if (e.metaKey || e.ctrlKey) {
    // ⌘R is the webview's reload and stays that way; plain `r` is Refresh.
    if (e.shiftKey) return null;
    const i = NAV.indexOf(e.code);
    return i === -1 ? null : `nav:${i}`;
  }

  if (typing) return null;
  if (e.code === "Slash" && e.shiftKey) return "help";
  if (e.code === "KeyR" && !e.shiftKey) return "refresh";
  return null;
}

/** What the Shortcuts sheet lists — the same set the resolver implements, plus
 *  the platform behaviours a user cannot otherwise discover.
 *
 *  One list, here, rather than a second one written into the sheet: the ticket
 *  asks that the app can state its own bindings without reading source, and a
 *  list maintained twice stops being true the first time a binding moves.
 */
export const BINDINGS: readonly { keys: string; label: string }[] = [
  { keys: "⌘1 – ⌘5", label: "Overview, Models, Daily, Stats, Pricing" },
  { keys: "R", label: "Refresh — rescan the corpus" },
  { keys: "?", label: "Show this list" },
  { keys: "Tab", label: "Move focus. Enter or Space activates what it lands on" },
  { keys: "↓ ↑", label: "Contribution graph: next and previous day" },
  { keys: "→ ←", label: "Contribution graph: next and previous week" },
  { keys: "Home / End", label: "Contribution graph: first and last day of the year" },
  { keys: "Esc", label: "Close a dialog" },
];
