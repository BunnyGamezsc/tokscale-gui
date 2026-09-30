import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/states";
import { useGuiSettings, useMachinesStatus } from "@/lib/use-scan";
import * as api from "@/lib/api";

function lastSeen(value: number | null) {
  if (value == null) return "This device";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000));
}

/** Encrypted multi-machine usage, configured inside Settings. */
export function MachinesSettings() {
  const qc = useQueryClient();
  const status = useMachinesStatus();
  const { settings, save } = useGuiSettings();
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const connect = useMutation({
    mutationFn: () => api.connectMachines(secret),
    onSuccess: async () => {
      setSecret("");
      setNote("Key saved in the OS keychain.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["machines_status"] }),
        qc.invalidateQueries({ queryKey: ["gui_settings"] }),
      ]);
    },
  });

  const update = useMutation({
    mutationFn: api.refreshMachines,
    onSuccess: async (result) => {
      setNote(`Loaded ${result.machines} other machine${result.machines === 1 ? "" : "s"}.`);
      await qc.invalidateQueries();
    },
  });

  const doExport = async () => {
    try {
      const text = await api.exportBuckets();
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `tokscale-${settings.machineLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNote("Export created. Keep it private; offline exports are not encrypted.");
    } catch (error) {
      setNote(`Export failed: ${String(error)}`);
    }
  };

  const doImport = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const result = await api.importBuckets(await Promise.all([...files].map((item) => item.text())));
      await qc.invalidateQueries();
      setNote(`Imported ${result.machines} machine${result.machines === 1 ? "" : "s"}.`);
    } catch (error) {
      setNote(`Import failed: ${String(error)}`);
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const error = connect.error ?? update.error ?? status.error;
  const connected = status.data?.connected ?? Boolean(settings.machinesKeyId);

  return (
    <section className="border-b border-border/50 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div>Machines</div>
          <p className="mt-0.5 text-micro text-muted-foreground">
            Daily totals are encrypted before they leave this device.
          </p>
        </div>
        {connected && (
          <Button variant="outline" size="sm" disabled={update.isPending} onClick={() => update.mutate()}>
            {update.isPending && <Spinner />}
            Update fleet
          </Button>
        )}
      </div>

      <label className="mt-2 flex items-center justify-between gap-3 text-micro">
        <span>Machine name</span>
        <input
          key={settings.machineLabel}
          defaultValue={settings.machineLabel}
          onBlur={(event) => {
            const machineLabel = event.currentTarget.value.trim();
            if (machineLabel && machineLabel !== settings.machineLabel) void save({ machineLabel });
          }}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          className="w-52 rounded-sm border border-border bg-transparent px-1.5 py-1 font-mono text-foreground"
        />
      </label>

      {!connected ? (
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            value={secret}
            autoComplete="off"
            placeholder="tok_…"
            aria-label="Machines key"
            onChange={(event) => setSecret(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && secret && connect.mutate()}
            className="min-w-0 flex-1 rounded-sm border border-border bg-transparent px-2 py-1 font-mono text-small text-foreground"
          />
          <Button size="sm" disabled={!secret || connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending && <Spinner />}
            Connect
          </Button>
        </div>
      ) : (
        <p className="mt-2 font-mono text-micro text-muted-foreground">
          Fingerprint {status.data?.keyId?.slice(0, 12) ?? settings.machinesKeyId?.slice(0, 12)}
        </p>
      )}

      <div className="mt-2">
        {(status.data?.machines ?? []).map((machine) => (
          <div key={machine.id} className="flex min-h-7 items-center gap-2 border-t border-border/40 text-micro">
            <span className="min-w-0 flex-1 truncate font-mono">{machine.label}</span>
            <span className="text-muted-foreground">{lastSeen(machine.lastSeen)}</span>
            {!machine.local && (
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  await api.removeMachine(machine.id);
                  await qc.invalidateQueries();
                }}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void doExport()}>
          Export JSON
        </Button>
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
          Import JSON
        </Button>
        <input
          ref={file}
          hidden
          multiple
          type="file"
          accept="application/json,.json"
          onChange={(event) => void doImport(event.currentTarget.files)}
        />
      </div>

      {note && <p className="mt-1.5 text-micro text-muted-foreground">{note}</p>}
      {error != null && <p className="mt-1 text-micro text-destructive">{String(error)}</p>}
    </section>
  );
}
