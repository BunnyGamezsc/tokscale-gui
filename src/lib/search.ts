import type { Entry, InsightsReport, SessionSpend, Workspace } from "./api";

export type SearchTarget =
  | { kind: "model"; model: string; provider: string; cost: number }
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "session"; session: SessionSpend };

export interface SearchItem {
  id: string;
  label: string;
  detail: string;
  text: string;
  target: SearchTarget;
}

/** Compact projections already held by Query; no transcripts or text contents. */
export function searchIndex(
  report: InsightsReport,
  entries: Entry[],
): SearchItem[] {
  const models = new Map<
    string,
    { model: string; provider: string; cost: number }
  >();
  for (const e of entries) {
    const id = JSON.stringify([e.provider, e.model]);
    const model = models.get(id) ?? {
      model: e.model,
      provider: e.provider,
      cost: 0,
    };
    model.cost += e.cost;
    models.set(id, model);
  }
  const items: SearchItem[] = [
    ...[...models.entries()].map(([id, model]) => ({
      id: `model:${id}`,
      label: model.model,
      detail: model.provider,
      text: `${model.model} ${model.provider}`,
      target: { kind: "model" as const, ...model },
    })),
    ...report.workspaces.map((workspace) => ({
      id: `workspace:${workspace.key}`,
      label: workspace.label,
      detail: workspace.key,
      text: `${workspace.label} ${workspace.key}`,
      target: { kind: "workspace" as const, workspace },
    })),
    ...report.sessions.map((session) => ({
      id: `session:${JSON.stringify([session.client, session.sessionId])}`,
      label: session.title ?? session.sessionId,
      detail: `${session.client} · ${session.lastDay} · ${session.workspaces.map((w) => w.label).join(", ")}`,
      text: `${session.title ?? ""} ${session.sessionId} ${session.client} ${session.models.join(" ")} ${session.workspaces.map((w) => `${w.key} ${w.label}`).join(" ")}`,
      target: { kind: "session" as const, session },
    })),
  ];
  return items.map((item) => ({
    ...item,
    text: item.text.toLocaleLowerCase(),
  }));
}

export function searchItems(items: SearchItem[], query: string, limit = 30) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items
    .filter((item) => terms.every((term) => item.text.includes(term)))
    .sort((a, b) => {
      const q = query.trim().toLocaleLowerCase();
      const rank = (item: SearchItem) =>
        item.label.toLocaleLowerCase() === q
          ? 0
          : item.label.toLocaleLowerCase().startsWith(q)
            ? 1
            : 2;
      return rank(a) - rank(b);
    })
    .slice(0, limit);
}
