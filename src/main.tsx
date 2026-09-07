import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routes/tree";
import { initTheme } from "./theme";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Scans are expensive and the data is local; refresh is explicit
      // (manual or interval) per the map's standing decisions.
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
// frame; this sets the theme and then shows it. The stored preference lands
// here once `gui.json` is readable (ticket 09's settings command).
void initTheme();
