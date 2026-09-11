import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri expects a fixed port and needs the dev server reachable from the webview.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/vendor/**"] } },
  build: { target: "safari15", sourcemap: true },
  // Pure functions only: no DOM environment, and the vendored submodule carries
  // its own suite that is not ours to run.
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
