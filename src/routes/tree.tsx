import {
  createRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@tanstack/react-router";

/** Sidebar destinations. P1 ships Overview, Models, Daily and Stats; the rest
 *  arrive in P2. Order mirrors upstream tokscale's tab order. */
const NAV = [
  { path: "/", label: "Overview" },
  { path: "/models", label: "Models" },
  { path: "/daily", label: "Daily" },
  { path: "/stats", label: "Stats" },
] as const;

function Shell() {
  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--color-border)]">
        {/* Reserves space for the overlaid traffic lights. See ticket 03:
            trafficLightPosition is creation-time only, so this must stay in
            sync with tauri.conf.json. */}
        <div className="h-11 shrink-0" data-tauri-drag-region />
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              activeOptions={{ exact: path === "/" }}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-[var(--color-fg-muted)] hover:bg-black/5 dark:hover:bg-white/5"
              activeProps={{
                className:
                  "rounded-md px-2.5 py-1.5 text-[13px] bg-black/6 text-[var(--color-fg)] dark:bg-white/10",
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto bg-[var(--color-surface)]">
        <div className="h-11 w-full" data-tauri-drag-region />
        <div className="px-6 pb-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Shell });

function Placeholder({ name }: { name: string }) {
  return (
    <div>
      <h1 className="text-[15px] font-semibold">{name}</h1>
      <p className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
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
