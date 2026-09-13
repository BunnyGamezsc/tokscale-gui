import { useState } from "react";
import {
  useIsFetching,
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type MutationState,
} from "@tanstack/react-query";
import { Modal } from "@/components/modal";
import { Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { span } from "@/lib/quota";
import { refreshScan } from "@/lib/use-scan";

const PROVIDERS: { id: api.SyncProvider; name: string }[] = [
  { id: "cursor", name: "Cursor" },
  { id: "antigravity", name: "Antigravity" },
  { id: "trae", name: "Trae" },
];

/** The sidebar's way into Sync. Ungated like Settings: a sync needs no Snapshot,
 *  though it waits for a running Scan. */
export function SyncButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center px-4 py-2 text-micro text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
      >
        Sync
      </button>
      {open && <SyncSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function SyncSheet({ onClose }: { onClose: () => void }) {
  const status = useQuery({ queryKey: ["sync_status"], queryFn: api.syncStatus, staleTime: Infinity });
  const scanning = useIsFetching({ queryKey: ["scan"] }) > 0;

  return (
    <Modal title="Sync" onClose={onClose} className="w-[520px] max-w-[90vw]">
      <div className="px-4 py-2 text-small">
        <p className="pb-2 text-micro text-muted-foreground">
          These three keep usage on their servers or in the running app. A sync copies it into
          tokscale's local cache, and the Refresh after it brings it into every View.
          {scanning && " Syncing waits for the running Scan."}
        </p>
        {PROVIDERS.map((p) => (
          <Row
            key={p.id}
            {...p}
            lastSyncedAt={status.data?.find((s) => s.provider === p.id)?.lastSyncedAt ?? null}
          />
        ))}
      </div>
    </Modal>
  );
}

/** One sync at a time, never during a Scan, and a Refresh after one that
 *  synced (#40). The Refresh goes through `refreshScan`, which refuses while
 *  any sync is pending, so it's called once this one has settled. */
function Row({ id, name, lastSyncedAt }: { id: api.SyncProvider; name: string; lastSyncedAt: number | null }) {
  const qc = useQueryClient();
  const busy = useIsFetching({ queryKey: ["scan"] }) + useIsMutating({ mutationKey: ["sync"] }) > 0;
  const { mutateAsync } = useMutation({
    mutationKey: ["sync", id],
    mutationFn: () => api.sync(id),
    // The result outlives the sheet, so reopening it still says what happened.
    gcTime: Infinity,
  });
  const last = useMutationState({
    filters: { mutationKey: ["sync", id] },
    select: (m) => m.state as MutationState<api.SyncOutcome>,
  }).at(-1);

  const run = async () => {
    if (qc.isFetching({ queryKey: ["scan"] }) || qc.isMutating({ mutationKey: ["sync"] })) return;
    const outcome = await mutateAsync().catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["sync_status"] });
    if (outcome?.state === "synced") refreshScan(qc);
  };

  const pending = last?.status === "pending";
  const age = lastSyncedAt === null ? null : Date.now() - lastSyncedAt * 1000;

  return (
    <div className="border-b border-border/50 py-2.5 last:border-0">
      <div className="flex items-center gap-4">
        <span className="w-[92px] shrink-0">{name}</span>
        <span className="flex-1 text-micro text-muted-foreground">
          {age === null ? "Never synced" : age < 60_000 ? "Synced just now" : `Synced ${span(age)} ago`}
        </span>
        <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
          {pending && <Spinner />}
          {pending ? "Syncing" : "Sync"}
        </Button>
      </div>
      <Result outcome={last?.data} error={last?.error} />
    </div>
  );
}

function Result({ outcome, error }: { outcome?: api.SyncOutcome; error?: unknown }) {
  if (error) return <Line tone="error">{String(error)}</Line>;
  if (!outcome) return null;
  if (outcome.state === "failed") return <Line tone="error">Sync failed: {outcome.message}</Line>;
  if (outcome.state === "notSetUp") return <Line>Not set up. {outcome.message}</Line>;
  return (
    <Line>
      Synced {outcome.count.toLocaleString()} {outcome.unit}.{outcome.message && ` ${outcome.message}`}
    </Line>
  );
}

function Line({ tone, children }: { tone?: "error"; children: React.ReactNode }) {
  return (
    <p className={`mt-1 pl-[108px] text-micro ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>
      {children}
    </p>
  );
}
