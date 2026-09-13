import { useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { fmtTokens } from "@/lib/format";

const PROVIDERS: { id: api.AccountProvider; name: string; note: string }[] = [
  {
    id: "cursor",
    name: "Cursor",
    note: "Add reads the account the Cursor app is signed in to. A sync makes that account active again.",
  },
  {
    id: "codex",
    name: "Codex",
    note: "Add imports the codex CLI's current login. Switching also signs the codex CLI into that account.",
  },
];

type Action =
  | { kind: "add"; provider: api.AccountProvider }
  | { kind: "switch" | "remove"; provider: api.AccountProvider; id: string };

/** Cursor and Codex accounts, in Settings (#41). Credentials stay in the fork's
 *  stores; this only ever sees ids and labels. */
export function AccountsSettings() {
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  return (
    <>
      {PROVIDERS.map((p) => (
        <ProviderRow key={p.id} {...p} accounts={accounts.data?.[p.id]} loadError={accounts.error} />
      ))}
    </>
  );
}

function ProviderRow({
  id,
  name,
  note,
  accounts,
  loadError,
}: {
  id: api.AccountProvider;
  name: string;
  note: string;
  accounts?: api.Account[];
  loadError: unknown;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  // A Cursor switch or remove moves cache files a running sync is writing.
  const syncing = useIsMutating({ mutationKey: ["sync"] }) > 0 && id === "cursor";
  const action = useMutation({
    mutationKey: ["account", id],
    mutationFn: async (a: Action): Promise<api.AccountAdded | null> => {
      if (a.kind === "add") return api.addAccount(a.provider);
      await (a.kind === "switch" ? api.switchAccount(a.provider, a.id) : api.removeAccount(a.provider, a.id));
      return null;
    },
    onSettled: () => {
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      // The Usage View's next visit fetches again rather than reusing its five minutes.
      void qc.invalidateQueries({ queryKey: ["quota"] });
      if (id === "codex") void qc.invalidateQueries({ queryKey: ["codex_activity"] });
    },
  });
  const busy = action.isPending || syncing;
  const outcome = action.data;

  return (
    <div className="border-b border-border/50 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <span>{name}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => action.mutate({ kind: "add", provider: id })}>
          {action.isPending && action.variables?.kind === "add" && <Spinner />}
          Add
        </Button>
      </div>

      {accounts?.length === 0 && <p className="mt-1 text-micro text-muted-foreground">No saved accounts.</p>}
      {accounts?.map((a) =>
        confirming === a.id ? (
          <div key={a.id} className="mt-1.5 flex items-center justify-between gap-3 text-micro">
            <span className="min-w-0">
              Remove <span className="font-mono">{a.label ?? a.id}</span> from {name}? Its stored credentials are
              deleted.
            </span>
            <span className="flex shrink-0 gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => action.mutate({ kind: "remove", provider: id, id: a.id })}
              >
                Remove
              </Button>
            </span>
          </div>
        ) : (
          <div key={a.id} className="mt-1.5">
            <div className="flex items-center gap-3 text-micro">
              <span className="min-w-0 flex-1 truncate font-mono" title={a.id}>
                {a.label ?? a.id}
              </span>
              {a.active ? (
                <span className="text-muted-foreground">Active</span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => action.mutate({ kind: "switch", provider: id, id: a.id })}
                >
                  Switch
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(a.id)}>
                Remove
              </Button>
            </div>
            {id === "codex" && a.active && <Activity />}
          </div>
        ),
      )}

      <p className="mt-1.5 text-micro text-muted-foreground">{note}</p>
      {loadError != null && <Line error>{String(loadError)}</Line>}
      {action.error && <Line error>{String(action.error)}</Line>}
      {outcome && outcome.state !== "added" && <Line error={outcome.state === "failed"}>{outcome.message}</Line>}
    </div>
  );
}

/** Only the active account has activity: `codex app-server` reads the codex
 *  CLI's current login, and pointing it at another account's tokens could
 *  rotate a refresh token the store still holds. */
function Activity() {
  const activity = useQuery({ queryKey: ["codex_activity"], queryFn: api.codexActivity, staleTime: 5 * 60_000 });
  const a = activity.data;
  let text: string;
  if (activity.isPending) text = "Reading activity…";
  else if (!a) text = `Activity unavailable: ${String(activity.error)}`;
  else if (a.status !== "available") text = a.message ?? "Activity unavailable.";
  else
    text = [
      a.lifetimeTokens != null && `${fmtTokens(a.lifetimeTokens)} lifetime tokens`,
      a.currentStreakDays != null && `${a.currentStreakDays}-day streak`,
    ]
      .filter(Boolean)
      .join(", ") || "No activity reported.";
  return <p className="text-micro text-muted-foreground">{text}</p>;
}

function Line({ error, children }: { error?: boolean; children: React.ReactNode }) {
  return <p className={`mt-1 text-micro ${error ? "text-destructive" : "text-muted-foreground"}`}>{children}</p>;
}
