/** The window's keyboard surface: what the bindings are, and what a key press
 *  resolves to.
 *
 *  No hotkey library. ROADMAP.md's Settled section already says Hotkeys was
 *  considered and never installed, and five destinations plus Refresh plus a
 *  help sheet is seven bindings — one `keydown` listener on the window, and this
 *  pure resolver under it. ADR 0003 records the decision and the reason each of
 *  upstream's ~30 TUI bindings was kept or rejected.
 */

export type KeyLike = {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type Action =
  | { kind: "refresh" }
  | { kind: "help" }
  /** Zero-based, into the sidebar's destinations in the order it draws them.
   *  Unbounded here: the caller owns the list, so it owns the bounds check. */
  | { kind: "nav"; index: number };

/** Whether focus is somewhere that eats characters.
 *
 *  Guarded on the *target*, not on which View is showing: the Report Filter's
 *  two date inputs live in the window chrome, so no View flag could see them,
 *  and Pricing's rate fields would need a second one. Duck-typed rather than
 *  taking an `HTMLElement` so it is testable without a DOM.
 *
 *  A checkbox is not a text input — the Filter's Client list is a column of
 *  them, and `R` should still refresh from there.
 */
const TOGGLES = ["checkbox", "radio", "button", "submit", "reset", "range", "color"];

export function isTyping(
  el: { tagName?: string; type?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !TOGGLES.includes(el.type ?? "text");
}

/** What a key press means, or `null` if it means nothing here.
 *
 *  Single-key bindings are refused while typing; ⌘-digit is not, because it is
 *  not a character any field can receive. Nothing here is bound to an arrow,
 *  `Home`, `End` or `Tab`: #29 spends the arrows and Home/End walking the
 *  Contribution Graph, and `Tab` is the web's own focus traversal.
 *
 *  **`code` for the letter, `key` for the punctuation.** Upstream spends 236
 *  lines in `tui/keymap.rs` mapping Cyrillic and Greek characters back to their
 *  US-QWERTY positions so `r` keeps working; `KeyboardEvent.code` is that
 *  physical position, so the table is not ported. But the same property is
 *  *wrong* for `?`: the key that produces it moves between layouts (Shift+/ on
 *  US, Shift+ß on German), and the sheet advertises the character, not a
 *  position. So `?` is matched on what was typed.
 */
export function resolve(e: KeyLike, typing: boolean): Action | null {
  // ⌥R types ®. Taking Option would eat characters the OS composes.
  if (e.altKey) return null;

  if (e.metaKey) {
    // ⌘R stays the webview's reload: only the digits are claimed under ⌘.
    const n = e.code.startsWith("Digit") ? Number(e.code.slice(5)) : NaN;
    return n >= 1 && n <= 9 ? { kind: "nav", index: n - 1 } : null;
  }
  if (e.ctrlKey) return null;

  if (typing) return null;
  if (e.key === "?") return { kind: "help" };
  // Shift is not checked: the sheet says `R`, and Shift+R meaning something
  // else would make the sheet a lie. Upstream spends Shift+R on auto-refresh,
  // which is P2 and unbuilt — it can claim its own key when it arrives.
  if (e.code === "KeyR") return { kind: "refresh" };
  return null;
}

/** What the Shortcuts sheet lists — the same set the resolver implements, plus
 *  the platform behaviours a user cannot otherwise discover.
 *
 *  A function of the destinations rather than a literal, so the ⌘-digit row
 *  cannot come to name a sidebar the sidebar does not have. The ticket asks
 *  that the app state its own bindings without reading source, and a list
 *  maintained twice stops being true the first time a destination moves.
 */
export function bindings(destinations: readonly string[]): { keys: string; label: string }[] {
  return [
    { keys: `⌘1 – ⌘${destinations.length}`, label: destinations.join(", ") },
    { keys: "R", label: "Refresh — rescan the corpus" },
    { keys: "?", label: "Show this list" },
    { keys: "Tab", label: "Move focus. Enter or Space activates what it lands on" },
    { keys: "↓ ↑", label: "Contribution graph: next and previous day" },
    { keys: "→ ←", label: "Contribution graph: next and previous week" },
    { keys: "Home / End", label: "Contribution graph: first and last day of the year" },
    { keys: "Esc", label: "Close a dialog" },
  ];
}
