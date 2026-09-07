import {
  createRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Sidebar destinations. P1 ships Overview, Models, Daily and Stats; the rest
 *  arrive in P2. Order mirrors upstream tokscale's tab order. */
const NAV = [
  { path: "/", label: "Overview" },
  { path: "/models", label: "Models" },
  { path: "/daily", label: "Daily" },
  { path: "/stats", label: "Stats" },
] as const;

/** The shell in the register ticket 07 settled: one flat plane, hairlines doing
 *  the separating, the active destination marked by an accent rule rather than a
 *  fill. The sidebar paints `--sidebar`, which is a translucent scrim so the
 *  NSVisualEffectView shows through it. */
function Shell() {
  return (
    <TooltipProvider delayDuration={200}>
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
        </aside>

        <main className="flex-1 overflow-auto">
          <div className="h-11 w-full" data-tauri-drag-region />
          <div className="px-gutter pb-8">
            <Outlet />
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

const rootRoute = createRootRoute({ component: Shell });

function Placeholder({ name }: { name: string }) {
  return (
    <div>
      <h1 className="text-title font-semibold tracking-[-0.01em]">{name}</h1>
      <p className="mt-2 max-w-[60ch] text-muted-foreground">
        Not built yet. The command surface behind these views is decided by
        ticket 09; this route exists so the shell is navigable.
      </p>
    </div>
  );
}

const routes = NAV.map(({ path, label }) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <Placeholder name={label} />,
  }),
);

export const routeTree = rootRoute.addChildren(routes);
