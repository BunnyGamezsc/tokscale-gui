import { expect, test } from "vitest";
import { maskEmail, splitEmails } from "./redact";

test("splitEmails cuts emails out of the text around them", () => {
  expect(splitEmails("me@work.co.uk · Pro")).toEqual([
    { text: "me@work.co.uk", email: true },
    { text: " · Pro", email: false },
  ]);
  expect(splitEmails("token for (a.b@x.io) expired")).toEqual([
    { text: "token for (", email: false },
    { text: "a.b@x.io", email: true },
    { text: ") expired", email: false },
  ]);
  expect(splitEmails("Account 1a2b")).toEqual([{ text: "Account 1a2b", email: false }]);
});

test("maskEmail keeps the first letters and the top-level domain", () => {
  expect(maskEmail("someone@gmail.com")).toBe("s•••@g•••.com");
  expect(maskEmail("me@work.co.uk")).toBe("m•••@w•••.uk");
});
