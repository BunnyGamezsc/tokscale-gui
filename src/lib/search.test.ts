import { expect, test } from "vitest";
import { searchItems, type SearchItem } from "./search";
const item = (id: string, label: string, text: string): SearchItem => ({
  id,
  label,
  detail: "",
  text,
  target: { kind: "model", model: label, provider: "openai", cost: 0 },
});

test("matches all terms across metadata and ranks exact labels first", () => {
  const items = [
    item("1", "gpt-5-pro", "gpt-5-pro openai"),
    item("2", "gpt-5", "gpt-5 openai"),
    item("3", "opus", "opus anthropic"),
  ];
  expect(searchItems(items, "GPT-5").map((i) => i.id)).toEqual(["2", "1"]);
  expect(searchItems(items, "openai pro").map((i) => i.id)).toEqual(["1"]);
  expect(searchItems(items, "openai opus")).toEqual([]);
  expect(searchItems(items, "", 2)).toHaveLength(2);
});
