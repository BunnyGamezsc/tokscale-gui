import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyAppearance, initTheme } from "./theme";

const native = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: vi.fn(),
  onThemeChanged: vi.fn(),
  show: vi.fn(),
  setFocus: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));

beforeEach(() => {
  vi.resetAllMocks();
  native.theme.mockResolvedValue("light");
  vi.stubGlobal("document", { documentElement: { dataset: { appStyle: "original" } } });
});
afterEach(() => vi.unstubAllGlobals());

test("boot resolves saved appearance before showing the window", async () => {
  await initTheme("system");
  expect(native.setTheme).toHaveBeenCalledWith(null);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(native.setTheme.mock.invocationCallOrder[0]).toBeLessThan(native.theme.mock.invocationCallOrder[0]);
  expect(native.theme.mock.invocationCallOrder[0]).toBeLessThan(native.show.mock.invocationCallOrder[0]);
  expect(native.setFocus).toHaveBeenCalledOnce();
});

test("system events update appearance without overriding explicit choices or style", async () => {
  await initTheme("system");
  const changed = native.onThemeChanged.mock.calls[0][0];
  changed({ payload: "dark" });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await applyAppearance("light");
  changed({ payload: "dark" });
  expect(document.documentElement.dataset.theme).toBe("light");
  await applyAppearance("dark");
  changed({ payload: "light" });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await applyAppearance("system");
  changed({ payload: "dark" });
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.dataset.appStyle).toBe("original");
});
