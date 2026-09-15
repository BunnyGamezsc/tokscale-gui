import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routes/tree";
import { initTheme } from "./theme";
import * as api from "./lib/api";
import { DEFAULT_SETTINGS } from "./lib/settings";
import "./styles.css";

document.documentElement.dataset.platform = navigator.userAgent.includes("Windows") ? "windows" : "mac";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Scans are expensive and the data is local; refresh is explicit
      // (manual, or the interval `useAutoRefresh` owns).
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  },
});

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

// The window is created hidden so its NSAppearance is right before the first
// frame; this reads `gui.json`, sets the theme, and only then shows it. A small
// file read, well inside Rust's 1500 ms fallback. The settings seed the query
// cache so the shell never renders with a guess.
void api
  .guiSettings()
  .catch(() => DEFAULT_SETTINGS)
  .then((settings) => {
    queryClient.setQueryData(["gui_settings"], settings);
    return initTheme(settings.appearance);
  });
