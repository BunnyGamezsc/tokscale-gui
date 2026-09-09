import { expect, test } from "vitest";
import { prune, isNarrowed, asArg } from "./filter";

test("an untouched control is not a narrowing", () => {
  expect(prune({ since: "", until: "", clients: [] })).toEqual({});
  expect(isNarrowed(prune({ since: "" }))).toBe(false);
  expect(asArg(prune({}))).toBeUndefined();
});

// No Clients ticked means "no constraint". The backend reads an empty selection
// as "no Clients" and narrows to nothing, so it must never be sent one.
test("an empty client selection is dropped rather than sent", () => {
  expect(prune({ clients: [] }).clients).toBeUndefined();
  expect(prune({ clients: ["codex"] }).clients).toEqual(["codex"]);
});

// The Filter is part of every report's query key, so two equal selections made
// in different orders must not be two cache entries.
test("clients are sorted so the query key is stable", () => {
  expect(prune({ clients: ["codex", "claude-code"] })).toEqual(
    prune({ clients: ["claude-code", "codex"] }),
  );
});
