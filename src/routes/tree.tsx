import { useEffect, useRef, useState } from "react";
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
import { FilterBar } from "@/components/filter-bar";
import { BINDINGS, isTyping, resolve } from "@/lib/keys";
import { useRefresh } from "@/lib/use-scan";

/** Sidebar destinations. P1 ships Overview, Models, Daily and Stats; the rest
 *  arrive in P2. Order mirrors upstream tokscale's tab order. */
const NAV = [
  { path: "/", label: "Overview", component: OverviewView },
  { path: "/models", label: "Models", component: ModelsView },
  { path: "/daily", label: "Daily", component: DailyView },
  { path: "/stats", label: "Stats", component: StatsView },
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

  // One listener on the window, which is what seven bindings are worth. It sits
  // in the shell because the shell is what outlives a View: `R` has to work on
  // Pricing, and `?` has to work before a Scan has landed, when every View is
  // showing a gate instead of itself. `keys.ts` holds the decision; this only
  // dispatches it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = resolve(e, isTyping(e.target as HTMLElement | null));
      if (!action) return;
      e.preventDefault();
      if (action === "refresh") refresh();
      else if (action === "help") setHelp(true);
      else void navigate({ to: NAV[Number(action.slice(4))].path });
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

        {/* `?` is not discoverable on its own, so the sheet has a way in that
            can be seen. It is also the only chrome that works before a Scan
            lands, which is the state a first run spends 21-40 s in. */}
        <button
          onClick={() => setHelp(true)}
          className="mt-auto flex items-center justify-between px-4 py-2 text-micro text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
        >
          Shortcuts
          <kbd className="font-mono">?</kbd>
        </button>
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
    </div>
  );
}

/** What the bindings are, said by the app rather than by the source.
 *
 *  A `<dialog>` and a list, not a ⌘K palette. ADR 0003: a palette is a way to
 *  reach commands you cannot see, and this window's commands are five sidebar
 *  links, a Refresh button and a Report Filter, all of them on screen. The
 *  native element brings the modal backdrop, focus containment, Esc-to-close and
 *  focus restored to whatever opened it — the last of which is an acceptance
 *  criterion here, and free.
 *
 *  It reads `BINDINGS`, which is the same module the resolver is in, so the
 *  sheet cannot describe a binding the app does not have.
 */
function Shortcuts({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      aria-label="Keyboard shortcuts"
      className="w-[440px] max-w-[90vw] rounded-md border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/25"
    >
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-small font-semibold">Keyboard shortcuts</h2>
      </header>
      <dl className="px-4 py-2 text-small">
        {BINDINGS.map((b) => (
          <div key={b.keys} className="flex items-baseline gap-4 border-b border-border/50 py-1.5 last:border-0">
            <dt className="w-[92px] shrink-0 font-mono text-muted-foreground">{b.keys}</dt>
            <dd className="m-0">{b.label}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}

const rootRoute = createRootRoute({ component: Shell });

const routes = NAV.map(({ path, component }) =>
  createRoute({ getParentRoute: () => rootRoute, path, component }),
);

export const routeTree = rootRoute.addChildren(routes);
