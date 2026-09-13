import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  Link,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { OverviewView } from "@/views/overview";
import { ModelsView } from "@/views/models";
import { DailyView } from "@/views/daily";
import { StatsView } from "@/views/stats";
import { PricingView } from "@/views/pricing";
import { AgentsView } from "@/views/agents";
import { FilterBar } from "@/components/filter-bar";
import { bindings, isTyping, resolve } from "@/lib/keys";
import { Modal } from "@/components/modal";
import { useRefresh } from "@/lib/use-scan";
import * as api from "@/lib/api";

/** Sidebar destinations, and the `⌘`-digit each one answers to. Order mirrors
 *  upstream tokscale's tab order. */
const NAV = [
  { path: "/", label: "Overview", component: OverviewView },
  { path: "/models", label: "Models", component: ModelsView },
  { path: "/daily", label: "Daily", component: DailyView },
  { path: "/stats", label: "Stats", component: StatsView },
  { path: "/agents", label: "Agents", component: AgentsView },
  { path: "/pricing", label: "Pricing", component: PricingView },
] as const;

/** The shell in the register ticket 07 settled: one flat plane, hairlines doing
 *  the separating, the active destination marked by an accent rule rather than a
 *  fill. The sidebar paints `--sidebar`, which is a translucent scrim so the
 *  NSVisualEffectView shows through it. */
function Shell() {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [help, setHelp] = useState(false);
  const [clis, setClis] = useState(false);

  // One listener on the window, which is what seven bindings are worth. It sits
  // in the shell because the shell is what outlives a View: `R` has to work on
  // Pricing, and `?` has to work before a Scan has landed, when every View is
  // showing a gate instead of itself. `keys.ts` holds the decision; this only
  // dispatches it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A modal owns the window while it is up. Navigating out from under one
      // would unmount it without `close()` — no focus restored, and the top
      // layer torn down — and Refresh would rescan behind it, invalidating the
      // query it is reading. Esc is the way out, and that is the platform's.
      if (document.querySelector("dialog[open]")) return;

      const action = resolve(e, isTyping(e.target as HTMLElement | null));
      if (!action) return;

      if (action.kind === "refresh") refresh();
      else if (action.kind === "help") setHelp(true);
      else {
        // Bounds-checked here because `keys.ts` does not know the sidebar.
        const destination = NAV[action.index];
        if (!destination) return;
        void navigate({ to: destination.path });
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, refresh]);

  return (
    <div className="flex h-full bg-background text-foreground">
      <aside className="flex w-[180px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        {/* Reserves space for the overlaid traffic lights. See ticket 03:
            trafficLightPosition is creation-time only, so this must stay in
            sync with tauri.conf.json. */}
        <div className="h-11 shrink-0" data-tauri-drag-region />
        <nav className="flex flex-col">
          {NAV.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              activeOptions={{ exact: path === "/" }}
              className="px-4 py-[6px] text-muted-foreground transition-colors duration-150 ease-out"
              activeProps={{
                className:
                  "px-4 py-[6px] font-medium text-foreground shadow-[inset_2px_0_0_var(--primary)]",
              }}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto">
          {/* No binding: seven is the count ADR 0003 defends, and a sheet that
              is read once after an install does not earn the eighth. */}
          <button
            onClick={() => setClis(true)}
            className="flex w-full items-center px-4 py-2 text-micro text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          >
            Vendor CLIs
          </button>

          {/* `?` is not discoverable on its own, so the sheet has a way in that
              can be seen. It is also the only chrome that works before a Scan
              lands, which is the state a first run spends 21-40 s in. */}
          <button
            onClick={() => setHelp(true)}
            className="flex w-full items-center justify-between px-4 py-2 text-micro text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          >
            Shortcuts
            <kbd className="font-mono">?</kbd>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {/* The Report Filter sits in the chrome, above every View. The drag
            region is its own element rather than the row: a titlebar drag
            swallows clicks on the controls otherwise. */}
        <div className="flex h-11 w-full items-center gap-2 px-gutter">
          <div className="h-full flex-1" data-tauri-drag-region />
          <FilterBar />
        </div>
        <div className="px-gutter pb-8">
          <Outlet />
        </div>
      </main>

      {help && <Shortcuts onClose={() => setHelp(false)} />}
      {clis && <VendorClis onClose={() => setClis(false)} />}
    </div>
  );
}

/** What the bindings are, said by the app rather than by the source.
 *
 *  A list in a dialog, not a ⌘K palette. ADR 0003: a palette is a way to reach
 *  commands you cannot see, and this window's commands are five sidebar links,
 *  a Refresh button and a Report Filter, all of them on screen. It needs no
 *  Snapshot either, which makes it the one piece of chrome that fully works
 *  during a first scan.
 *
 *  It reads `bindings(NAV)`, so the ⌘-digit row cannot name a sidebar the
 *  sidebar does not have.
 */
function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} className="w-[440px] max-w-[90vw]">
      <dl className="px-4 py-2 text-small">
        {bindings(NAV.map((n) => n.label)).map((b) => (
          <div
            key={b.keys}
            className="flex items-baseline gap-4 border-b border-border/50 py-1.5 last:border-0"
          >
            <dt className="w-[92px] shrink-0 font-mono text-muted-foreground">{b.keys}</dt>
            <dd className="m-0">{b.label}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

/** What the three outcomes mean, said to the user rather than to the caller.
 *
 *  The wording is the whole point of #23's fourth criterion: `missing` is
 *  something only the user can fix, and `offPath` is something the app fixes
 *  itself by spawning the absolute path it found, so they must not read as the
 *  same failure. `onPath` is not a state worth explaining — it is what the user
 *  already assumed — so it says the least.
 */
const CLI_STATE = {
  onPath: { label: "Found", note: "on this app's PATH" },
  offPath: { label: "Found", note: "off this app's PATH — the app will use the full path" },
  missing: { label: "Not installed", note: "found nowhere this app looks — install it to use it" },
} as const;

/** Where the app would find each vendor CLI, from the environment it was
 *  launched in — which is launchd's, not the shell's, when it was opened from
 *  Finder. Nothing in P1 spawns these; this is the surface that makes ADR
 *  0006's resolution visible, and the only way to check a packaged build
 *  resolves what a terminal-launched one does.
 */
function VendorClis({ onClose }: { onClose: () => void }) {
  const { data, error } = useQuery({ queryKey: ["vendor_clis"], queryFn: api.vendorClis });

  // A blank sheet would read as "six missing", which is the one answer this
  // sheet exists to distinguish from the others. Waiting and failing each say
  // so instead.
  if (!data) {
    return (
      <Modal title="Vendor CLIs" onClose={onClose} className="w-[520px] max-w-[90vw]">
        <p className="px-4 py-3 text-small text-muted-foreground">
          {error ? `Could not look: ${String(error)}` : "Looking…"}
        </p>
      </Modal>
    );
  }

  return (
    <Modal title="Vendor CLIs" onClose={onClose} className="w-[520px] max-w-[90vw]">
      <div className="px-4 py-2 text-small">
        {data.map((cli) => {
          const state = CLI_STATE[cli.state];
          return (
            <div key={cli.name} className="border-b border-border/50 py-1.5 last:border-0">
              <div className="flex items-baseline gap-4">
                <span className="w-[92px] shrink-0 font-mono">{cli.name}</span>
                <span className={cli.state === "missing" ? "text-muted-foreground" : ""}>
                  {state.label}
                </span>
                <span className="text-micro text-muted-foreground">{state.note}</span>
              </div>
              {cli.path && (
                <div className="pl-[108px] font-mono text-micro text-muted-foreground">
                  {cli.path}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

const rootRoute = createRootRoute({ component: Shell });

const routes = NAV.map(({ path, component }) =>
  createRoute({ getParentRoute: () => rootRoute, path, component }),
);

export const routeTree = rootRoute.addChildren(routes);
