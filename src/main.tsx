import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routes/tree";
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

// Ticket 08: the scan probe runs itself on mount, so the app boots straight
// into it rather than waiting for someone to navigate. Remove this together
// with the /probe route once the real command surface lands.
router.navigate({ to: "/probe" });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
