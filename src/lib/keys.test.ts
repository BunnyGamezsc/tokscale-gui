import { test, expect } from "vitest";
import { BINDINGS, isTyping, resolve, type KeyLike } from "@/lib/keys";

const press = (e: Partial<KeyLike>): KeyLike => ({
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...e,
});

test("the five destinations are reachable by their number", () => {
  expect(resolve(press({ code: "Digit1", metaKey: true }), false)).toBe("nav:0");
  expect(resolve(press({ code: "Digit5", metaKey: true }), false)).toBe("nav:4");
  expect(resolve(press({ code: "Digit6", metaKey: true }), false)).toBeNull();
  // Unmodified digits are free: nothing binds them, so typing a year into a
  // date field cannot navigate.
  expect(resolve(press({ code: "Digit1" }), false)).toBeNull();
});

test("no single-key binding fires while a text input has focus", () => {
  expect(resolve(press({ code: "KeyR" }), true)).toBeNull();
  expect(resolve(press({ code: "Slash", shiftKey: true }), true)).toBeNull();
  // A modified binding still works there: ⌘1 is not a character a rate field
  // or a date input can receive.
  expect(resolve(press({ code: "Digit1", metaKey: true }), true)).toBe("nav:0");
});

test("the fields that eat characters are recognised by target, not by View", () => {
  // The Report Filter's dates live in the chrome and Pricing's rates in a View;
  // one target test covers both.
  expect(isTyping({ tagName: "INPUT" })).toBe(true);
  expect(isTyping({ tagName: "TEXTAREA" })).toBe(true);
  expect(isTyping({ tagName: "DIV", isContentEditable: true })).toBe(true);
  expect(isTyping({ tagName: "BUTTON" })).toBe(false);
  expect(isTyping(null)).toBe(false);
});

test("a key is read by its physical position, not the character it produced", () => {
  // Upstream normalizes Cyrillic and Greek back to US-QWERTY by hand. `code` is
  // already the physical key, so a Russian layout's `к` — same key as `r` —
  // still refreshes, and this is the whole of that feature.
  expect(resolve(press({ code: "KeyR" }), false)).toBe("refresh");
});

test("the webview's own reload is left alone", () => {
  expect(resolve(press({ code: "KeyR", metaKey: true }), false)).toBeNull();
  expect(resolve(press({ code: "KeyR", ctrlKey: true }), false)).toBeNull();
});

test("nothing is bound to a key #29 spent on the graph", () => {
  for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Tab"]) {
    expect(resolve(press({ code }), false)).toBeNull();
    expect(resolve(press({ code, metaKey: true }), false)).toBeNull();
  }
});

test("Option-modified keys belong to the input method", () => {
  // ⌥R types ®; taking it would make the app eat characters the OS composes.
  expect(resolve(press({ code: "KeyR", altKey: true }), false)).toBeNull();
});

test("every binding the resolver implements is one the sheet lists", () => {
  const listed = BINDINGS.map((b) => b.keys).join(" ");
  expect(listed).toContain("⌘1");
  expect(listed).toContain("R");
  expect(listed).toContain("?");
});
