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
  expect(resolve(press({ code: "Digit1", metaKey: true }), false, "meta")).toEqual({ kind: "nav", index: 0 });
  expect(resolve(press({ code: "Digit5", metaKey: true }), false, "meta")).toEqual({ kind: "nav", index: 4 });
  // Unmodified digits are free: nothing binds them, so typing a year into a
  // date field cannot navigate.
  expect(resolve(press({ code: "Digit1", key: "1" }), false, "meta")).toBeNull();
});

test("an index past the sidebar is the shell's to refuse, not this module's", () => {
  // `keys.ts` does not know how many destinations there are; returning the
  // index and letting the caller bounds-check is what keeps them from having
  // to agree twice.
  expect(resolve(press({ code: "Digit9", metaKey: true }), false, "meta")).toEqual({ kind: "nav", index: 8 });
  expect(resolve(press({ code: "Digit0", metaKey: true }), false, "meta")).toBeNull();
});

test("no single-key binding fires while a text input has focus", () => {
  expect(resolve(press({ code: "KeyR", key: "r" }), true, "meta")).toBeNull();
  expect(resolve(press({ code: "Slash", key: "?", shiftKey: true }), true, "meta")).toBeNull();
  // A modified binding still works there: ⌘1 is not a character a rate field
  // or a date input can receive.
  expect(resolve(press({ code: "Digit1", metaKey: true }), true, "meta")).toEqual({ kind: "nav", index: 0 });
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
  expect(resolve(press({ code: "KeyR", key: "r" }), false, "meta")).toEqual({ kind: "refresh" });
  expect(resolve(press({ code: "KeyR", key: "к" }), false, "meta")).toEqual({ kind: "refresh" });
  expect(resolve(press({ code: "Slash", key: "?", shiftKey: true }), false, "meta")).toEqual({ kind: "help" });
  // German: the same character off a different physical key.
  expect(resolve(press({ code: "Minus", key: "?", shiftKey: true }), false, "meta")).toEqual({ kind: "help" });
});

test("the sheet cannot advertise a Refresh the resolver refuses", () => {
  // Caps Lock, or a hand still on Shift from `?`. The sheet says `R`; Shift+R
  // meaning nothing would make it a lie.
  expect(resolve(press({ code: "KeyR", key: "R", shiftKey: true }), false, "meta")).toEqual({
    kind: "refresh",
  });
});

test("⌘, opens Settings, even from a text field", () => {
  expect(resolve(press({ code: "Comma", key: ",", metaKey: true }), true, "meta")).toEqual({ kind: "settings" });
  expect(resolve(press({ code: "Comma", key: "," }), false, "meta")).toBeNull();
});

test("the webview's own reload is left alone", () => {
  expect(resolve(press({ code: "KeyR", key: "r", metaKey: true }), false, "meta")).toBeNull();
  expect(resolve(press({ code: "KeyR", key: "r", ctrlKey: true }), false, "meta")).toBeNull();
});

test("nothing is bound to a key #29 spent on the graph", () => {
  for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Tab"]) {
    const key = code;
    expect(resolve(press({ code, key }), false, "meta")).toBeNull();
    expect(resolve(press({ code, key, metaKey: true }), false, "meta")).toBeNull();
  }
});

test("Option-modified keys belong to the input method", () => {
  // ⌥R types ®; taking it would make the app eat characters the OS composes.
  expect(resolve(press({ code: "KeyR", key: "®", altKey: true }), false, "meta")).toBeNull();
});

test("the sheet's ⌘-digit row counts the destinations it was given", () => {
  expect(bindings(DESTINATIONS, "meta")[0]).toEqual({
    keys: "⌘1 – ⌘5",
    label: "Overview, Models, Daily, Stats, Pricing",
  });
  expect(bindings(["Overview", "Models"], "meta")[0].keys).toBe("⌘1 – ⌘2");
});

test("every single-key binding the sheet lists is one the resolver answers", () => {
  const single = bindings(DESTINATIONS, "meta").filter((b) => /^[A-Z?]$/.test(b.keys));
  expect(single.map((b) => b.keys)).toEqual(["R", "?"]);
  for (const b of single) {
    const e = b.keys === "?" ? { code: "Slash", key: "?", shiftKey: true } : { code: "KeyR", key: "r" };
    expect(resolve(press(e), false, "meta")).not.toBeNull();
  }
});

test("on Windows, Ctrl takes ⌘'s place and Meta means nothing", () => {
  expect(resolve(press({ code: "Digit1", ctrlKey: true }), false, "ctrl")).toEqual({ kind: "nav", index: 0 });
  expect(resolve(press({ code: "Comma", key: ",", ctrlKey: true }), true, "ctrl")).toEqual({ kind: "settings" });
  expect(resolve(press({ code: "Digit1", metaKey: true }), false, "ctrl")).toBeNull();
  expect(resolve(press({ code: "KeyR", key: "r", ctrlKey: true }), false, "ctrl")).toBeNull();
});

test("the Windows sheet says Ctrl", () => {
  const eight = ["Overview", "Usage", "Models", "Daily", "Hourly", "Stats", "Agents", "Pricing"];
  const rows = bindings(eight, "ctrl");
  expect(rows[0].keys).toBe("Ctrl+1 – Ctrl+8");
  expect(rows.find((b) => b.label === "Settings")?.keys).toBe("Ctrl+,");
});
