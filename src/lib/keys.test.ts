import { test, expect } from "vitest";
import { bindings, isTyping, resolve, type KeyLike } from "@/lib/keys";

const press = (e: Partial<KeyLike>): KeyLike => ({
  code: "",
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...e,
});

const DESTINATIONS = ["Overview", "Models", "Daily", "Stats", "Pricing"];

test("the destinations are reachable by their number", () => {
  expect(resolve(press({ code: "Digit1", metaKey: true }), false)).toEqual({ kind: "nav", index: 0 });
  expect(resolve(press({ code: "Digit5", metaKey: true }), false)).toEqual({ kind: "nav", index: 4 });
  // Unmodified digits are free: nothing binds them, so typing a year into a
  // date field cannot navigate.
  expect(resolve(press({ code: "Digit1", key: "1" }), false)).toBeNull();
});

test("an index past the sidebar is the shell's to refuse, not this module's", () => {
  // `keys.ts` does not know how many destinations there are; returning the
  // index and letting the caller bounds-check is what keeps them from having
  // to agree twice.
  expect(resolve(press({ code: "Digit9", metaKey: true }), false)).toEqual({ kind: "nav", index: 8 });
  expect(resolve(press({ code: "Digit0", metaKey: true }), false)).toBeNull();
});

test("no single-key binding fires while a text input has focus", () => {
  expect(resolve(press({ code: "KeyR", key: "r" }), true)).toBeNull();
  expect(resolve(press({ code: "Slash", key: "?", shiftKey: true }), true)).toBeNull();
  // A modified binding still works there: ⌘1 is not a character a rate field
  // or a date input can receive.
  expect(resolve(press({ code: "Digit1", metaKey: true }), true)).toEqual({ kind: "nav", index: 0 });
});

test("a text input is what eats characters — a checkbox does not", () => {
  // The Report Filter's dates live in the chrome and Pricing's rates in a View;
  // one target test covers both. Its Client list is a column of checkboxes, and
  // `R` should still refresh from there.
  expect(isTyping({ tagName: "INPUT", type: "date" })).toBe(true);
  expect(isTyping({ tagName: "INPUT", type: "text" })).toBe(true);
  expect(isTyping({ tagName: "INPUT" })).toBe(true);
  expect(isTyping({ tagName: "TEXTAREA" })).toBe(true);
  expect(isTyping({ tagName: "DIV", isContentEditable: true })).toBe(true);
  expect(isTyping({ tagName: "INPUT", type: "checkbox" })).toBe(false);
  expect(isTyping({ tagName: "BUTTON" })).toBe(false);
  expect(isTyping({ tagName: "SUMMARY" })).toBe(false);
  expect(isTyping(null)).toBe(false);
});

test("the letter is read by position and the punctuation by character", () => {
  // `r` is upstream's binding and `code` is the physical key, so a Russian
  // layout's `к` — same key — still refreshes. `?` is the opposite case: the
  // sheet advertises the character, and the key that produces it moves.
  expect(resolve(press({ code: "KeyR", key: "r" }), false)).toEqual({ kind: "refresh" });
  expect(resolve(press({ code: "KeyR", key: "к" }), false)).toEqual({ kind: "refresh" });
  expect(resolve(press({ code: "Slash", key: "?", shiftKey: true }), false)).toEqual({ kind: "help" });
  // German: the same character off a different physical key.
  expect(resolve(press({ code: "Minus", key: "?", shiftKey: true }), false)).toEqual({ kind: "help" });
});

test("the sheet cannot advertise a Refresh the resolver refuses", () => {
  // Caps Lock, or a hand still on Shift from `?`. The sheet says `R`; Shift+R
  // meaning nothing would make it a lie.
  expect(resolve(press({ code: "KeyR", key: "R", shiftKey: true }), false)).toEqual({
    kind: "refresh",
  });
});

test("the webview's own reload is left alone", () => {
  expect(resolve(press({ code: "KeyR", key: "r", metaKey: true }), false)).toBeNull();
  expect(resolve(press({ code: "KeyR", key: "r", ctrlKey: true }), false)).toBeNull();
});

test("nothing is bound to a key #29 spent on the graph", () => {
  for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Tab"]) {
    const key = code;
    expect(resolve(press({ code, key }), false)).toBeNull();
    expect(resolve(press({ code, key, metaKey: true }), false)).toBeNull();
  }
});

test("Option-modified keys belong to the input method", () => {
  // ⌥R types ®; taking it would make the app eat characters the OS composes.
  expect(resolve(press({ code: "KeyR", key: "®", altKey: true }), false)).toBeNull();
});

test("the sheet's ⌘-digit row counts the destinations it was given", () => {
  expect(bindings(DESTINATIONS)[0]).toEqual({
    keys: "⌘1 – ⌘5",
    label: "Overview, Models, Daily, Stats, Pricing",
  });
  expect(bindings(["Overview", "Models"])[0].keys).toBe("⌘1 – ⌘2");
});

test("every single-key binding the sheet lists is one the resolver answers", () => {
  const single = bindings(DESTINATIONS).filter((b) => /^[A-Z?]$/.test(b.keys));
  expect(single.map((b) => b.keys)).toEqual(["R", "?"]);
  for (const b of single) {
    const e = b.keys === "?" ? { code: "Slash", key: "?", shiftKey: true } : { code: "KeyR", key: "r" };
    expect(resolve(press(e), false)).not.toBeNull();
  }
});
