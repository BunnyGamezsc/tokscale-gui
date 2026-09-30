import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/modal";
import { DetailDialog, useDayDialog } from "@/components/detail";
import { SessionDetail } from "@/components/insights";
import { useScanLanded } from "@/lib/use-scan";
import { NO_FILTER } from "@/lib/filter";
import { searchIndex, searchItems, type SearchTarget } from "@/lib/search";
import { fmtCost } from "@/lib/format";
import * as api from "@/lib/api";

function useSearchData(enabled: boolean) {
  const insights = useQuery({
    queryKey: ["insights_report", NO_FILTER],
    queryFn: () => api.insightsReport(),
    enabled,
  });
  const models = useQuery({
    queryKey: ["model_report", "client,provider,model", NO_FILTER],
    queryFn: () => api.modelReport("client,provider,model"),
    enabled,
  });
  return { insights, models };
}

export function SearchPalette({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (target: SearchTarget) => void;
}) {
  const ready = useScanLanded();
  const { insights, models } = useSearchData(ready);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const listId = useId();
  const index = useMemo(
    () =>
      insights.data && models.data
        ? searchIndex(insights.data, models.data.entries)
        : [],
    [insights.data, models.data],
  );
  const results = useMemo(() => searchItems(index, query), [index, query]);
  const active = Math.max(
    0,
    results.findIndex((r) => r.id === activeId),
  );
  return (
    <Modal
      title="Quick search"
      aside="↑ ↓ to choose · Enter to open"
      onClose={onClose}
      className="w-[620px] max-w-[90vw]"
    >
      <div className="p-3">
        <input
          autoFocus
          role="combobox"
          aria-label="Search models, workspaces and chats"
          aria-expanded={true}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            results[active] ? `${listId}-${active}` : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveId(null);
          }}
          placeholder="Model, project, session ID or chat title…"
          className="w-full rounded-sm border border-border bg-transparent px-3 py-2 text-small outline-none focus:border-primary"
          onKeyDown={(e) => {
            if (
              (e.key === "ArrowDown" || e.key === "ArrowUp") &&
              results.length
            ) {
              e.preventDefault();
              const next =
                (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) %
                results.length;
              setActiveId(results[next].id);
              document
                .getElementById(`${listId}-${next}`)
                ?.scrollIntoView({ block: "nearest" });
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              onSelect(results[active].target);
            }
          }}
        />
        <p className="my-2 text-micro text-muted-foreground">
          All recorded usage. View filters do not apply. Showing up to 30
          matches.
        </p>
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="max-h-[48vh] overflow-y-auto"
        >
          {!ready ? (
            <p className="px-2 py-5 text-small text-muted-foreground">
              Run a scan first. Search uses the Snapshot already held by the
              app.
            </p>
          ) : insights.error || models.error ? (
            <p role="alert" className="px-2 py-5 text-small">
              Search unavailable: {String(insights.error ?? models.error)}
            </p>
          ) : !insights.data || !models.data ? (
            <p className="px-2 py-5 text-small">Loading search…</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-5 text-small text-muted-foreground">
              No matches. Try a model name, project path or session ID.
            </p>
          ) : (
            results.map((result, i) => (
              <div
                key={result.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={active === i}
                className={`flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 ${active === i ? "bg-muted" : "hover:bg-muted/50"}`}
                onMouseMove={() => setActiveId(result.id)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(result.target)}
              >
                <span className="w-16 shrink-0 text-micro capitalize text-muted-foreground">
                  {result.target.kind === "session"
                    ? "Chat"
                    : result.target.kind}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-small">
                    {result.label}
                  </span>
                  <span className="block truncate font-mono text-micro text-muted-foreground">
                    {result.detail}
                  </span>
                </span>
                {result.target.kind !== "workspace" && (
                  <span className="tnum shrink-0 font-mono text-small">
                    {fmtCost(
                      result.target.kind === "model"
                        ? result.target.cost
                        : result.target.session.cost,
                    )}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export function SearchInspector({
  target,
  onClose,
}: {
  target: SearchTarget;
  onClose: () => void;
}) {
  const { insights, models } = useSearchData(true);
  const [selected, setSelected] = useState<api.SessionSpend | null>(null);
  const [showDay, setShowDay] = useState(false);
  const graphDays: api.Day[] =
    insights.data?.days.map((d) => ({ ...d, level: 1 })) ?? [];
  const dayDialog = useDayDialog(graphDays, NO_FILTER, onClose);
  if (showDay) return dayDialog.dialog;
  const session = target.kind === "session" ? target.session : selected;
  if (session)
    return (
      <SessionDetail
        session={session}
        onClose={onClose}
        onDay={(day) => {
          setShowDay(true);
          dayDialog.open(day);
        }}
      />
    );
  if (target.kind === "model")
    return (
      <DetailDialog
        title={`${target.model} via ${target.provider} · all usage`}
        aside={fmtCost(target.cost)}
        entries={
          models.data?.entries.filter(
            (e) => e.model === target.model && e.provider === target.provider,
          ) ?? []
        }
        pending={models.isPending}
        onClose={onClose}
      />
    );
  if (target.kind !== "workspace") return null;
  const sessions =
    insights.data?.sessions.filter((s) =>
      s.workspaces.some((w) => w.key === target.workspace.key),
    ) ?? [];
  return (
    <Modal
      title={target.workspace.label}
      onClose={onClose}
      className="w-[620px] max-w-[90vw]"
    >
      <div className="max-h-[65vh] overflow-y-auto px-4 py-3">
        <p className="mb-3 break-all font-mono text-micro text-muted-foreground">
          {target.workspace.key}
        </p>
        <p className="mb-2 text-micro text-muted-foreground">
          All recorded chats associated with this workspace. Costs cover each
          whole chat.
        </p>
        {sessions.map((s) => (
          <button
            key={JSON.stringify([s.client, s.sessionId])}
            className="flex w-full items-center justify-between gap-3 border-b border-border/50 py-2 text-left text-small hover:bg-muted/50"
            onClick={() => setSelected(s)}
          >
            <span className="min-w-0 truncate">{s.title ?? s.sessionId}</span>
            <span className="tnum shrink-0 font-mono">{fmtCost(s.cost)}</span>
          </button>
        ))}
        {sessions.length === 0 && (
          <p className="text-small text-muted-foreground">
            No chats with recorded session IDs.
          </p>
        )}
      </div>
    </Modal>
  );
}
