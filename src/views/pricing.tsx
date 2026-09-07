import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ViewHeader, Tiles, SectionHead } from "@/components/view";
import { RowSkeleton, Placeholder } from "@/components/states";
import * as api from "@/lib/api";
import { useUnpriced, useCustomPricing, useReport } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { fmtCost, fmtInt, fmtTokens } from "@/lib/format";

const FIELDS = [
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
] as const;

type Draft = Record<(typeof FIELDS)[number]["key"], string>;

function toDraft(rates?: api.Rates): Draft {
  return {
    input: rates?.input != null ? String(rates.input) : "",
    output: rates?.output != null ? String(rates.output) : "",
    cacheRead: rates?.cacheRead != null ? String(rates.cacheRead) : "",
    cacheWrite: rates?.cacheWrite != null ? String(rates.cacheWrite) : "",
  };
}

/** Blank means "no rate", which is different from zero. Zero is a statement —
 *  the model is free — and core accepts it deliberately. */
function toRates(d: Draft): api.Rates {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    input: num(d.input),
    output: num(d.output),
    cacheRead: num(d.cacheRead),
    cacheWrite: num(d.cacheWrite),
  };
}

function invalid(d: Draft) {
  return Object.values(d).some((v) => v.trim() !== "" && !(Number(v) >= 0));
}

export function PricingView() {
  const snap = useSnapshot();
  const unpriced = useUnpriced(snap.ready);
  const custom = useCustomPricing();
  const report = useReport("model", snap.ready);
  const [editing, setEditing] = useState<string | null>(null);

  if (snap.gate) return snap.gate;

  const rows = unpriced.data ?? [];
  const overrides = custom.data ?? {};
  const overrideCount = Object.keys(overrides).length;
  const unpricedTokens = rows.reduce(
    (s, u) => s + u.input + u.output + u.cacheRead + u.cacheWrite,
    0,
  );

  return (
    <>
      <ViewHeader title="Pricing" filter={snap.rangeLabel} />

      <Tiles
        items={[
          ["Priced total", report.data ? fmtCost(report.data.totalCost) : "—"],
          ["Unpriced models", fmtInt(rows.length)],
          ["Unpriced tokens", fmtTokens(unpricedTokens)],
          ["Manual rates", fmtInt(overrideCount)],
        ]}
      />

      <p className="mt-4 max-w-[76ch] text-small text-muted-foreground">
        Rates are dollars per million tokens. They are written to{" "}
        <span className="font-mono">~/.config/tokscale/custom-pricing.json</span>, which tokscale
        itself reads — so a rate set here also applies to the CLI and the TUI, and it is consulted
        before LiteLLM and the other upstream sources. Saving rescans.
      </p>

      <section className="mt-6">
        <SectionHead
          title="Models with no cost"
          aside={rows.length ? `${rows.length} of ${report.data?.entries.length ?? 0}` : ""}
        />
        {unpriced.isPending ? (
          <Table className="text-small">
            <TableBody>
              <RowSkeleton cols={5} />
            </TableBody>
          </Table>
        ) : rows.length === 0 ? (
          <Placeholder
            title="Everything is priced"
            body="Every model that spent tokens produced a cost, either reported by the client or estimated from upstream pricing data. Nothing needs a manual rate."
          />
        ) : (
          <Table className="text-small">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-[26px] text-micro font-normal">Model</TableHead>
                <TableHead className="h-[26px] text-micro font-normal">Seen in</TableHead>
                <TableHead className="h-[26px] text-right text-micro font-normal">Input</TableHead>
                <TableHead className="h-[26px] text-right text-micro font-normal">Output</TableHead>
                <TableHead className="h-[26px] text-right text-micro font-normal">Cache</TableHead>
                <TableHead className="h-[26px] text-right text-micro font-normal" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <ModelRow
                  key={u.model}
                  model={u.model}
                  clients={u.clients.join(", ")}
                  input={u.input}
                  output={u.output}
                  cache={u.cacheRead + u.cacheWrite}
                  rates={overrides[u.model]}
                  open={editing === u.model}
                  onToggle={() => setEditing(editing === u.model ? null : u.model)}
                  onDone={() => setEditing(null)}
                  refresh={snap.refresh}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {overrideCount > 0 && (
        <section className="mt-8">
          <SectionHead title="Manual rates" aside={`${overrideCount} set`} />
          <Table className="text-small">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-[26px] text-micro font-normal">Model</TableHead>
                {FIELDS.map((f) => (
                  <TableHead key={f.key} className="h-[26px] text-right text-micro font-normal">
                    {f.label}
                  </TableHead>
                ))}
                <TableHead className="h-[26px] text-right text-micro font-normal" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(overrides).map(([model, rates]) => (
                <OverrideRow key={model} model={model} rates={rates} refresh={snap.refresh} />
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </>
  );
}

function ModelRow({
  model,
  clients,
  input,
  output,
  cache,
  rates,
  open,
  onToggle,
  onDone,
  refresh,
}: {
  model: string;
  clients: string;
  input: number;
  output: number;
  cache: number;
  rates?: api.Rates;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
  refresh: () => void;
}) {
  return (
    <>
      <TableRow className="h-row border-border/50">
        <TableCell className="py-0 font-mono">{model}</TableCell>
        <TableCell className="py-0 text-muted-foreground">{clients}</TableCell>
        <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
          {fmtTokens(input)}
        </TableCell>
        <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
          {fmtTokens(output)}
        </TableCell>
        <TableCell className="tnum py-0 text-right font-mono text-muted-foreground">
          {fmtTokens(cache)}
        </TableCell>
        <TableCell className="py-0 text-right">
          <Button variant="outline" size="xs" onClick={onToggle}>
            {open ? "Close" : rates ? "Edit rates" : "Set rates"}
          </Button>
        </TableCell>
      </TableRow>
      {open && (
        <tr>
          <td colSpan={6} className="border-b border-border/50 py-0">
            <RateForm model={model} rates={rates} onDone={onDone} refresh={refresh} />
          </td>
        </tr>
      )}
    </>
  );
}

function OverrideRow({
  model,
  rates,
  refresh,
}: {
  model: string;
  rates: api.Rates;
  refresh: () => void;
}) {
  const qc = useQueryClient();
  const clear = useMutation({
    mutationFn: () => api.clearCustomPricing(model),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["custom_pricing"] });
      refresh();
    },
  });

  return (
    <TableRow className="h-row border-border/50">
      <TableCell className="py-0 font-mono">{model}</TableCell>
      {FIELDS.map((f) => (
        <TableCell key={f.key} className="tnum py-0 text-right font-mono">
          {rates[f.key] != null ? `$${rates[f.key]}` : <span className="text-cost-unknown">—</span>}
        </TableCell>
      ))}
      <TableCell className="py-0 text-right">
        <Button
          variant="outline"
          size="xs"
          disabled={clear.isPending}
          onClick={() => clear.mutate()}
        >
          {clear.isPending ? "Removing" : "Remove"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function RateForm({
  model,
  rates,
  onDone,
  refresh,
}: {
  model: string;
  rates?: api.Rates;
  onDone: () => void;
  refresh: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(rates));
  useEffect(() => setDraft(toDraft(rates)), [rates, model]);

  const save = useMutation({
    mutationFn: () => api.setCustomPricing(model, toRates(draft)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["custom_pricing"] });
      onDone();
      // Costs are computed during the parse, so a new rate only shows up after
      // another scan. The message cache still applies, so this is the warm path.
      refresh();
    },
  });

  const blocked = invalid(draft) || Object.values(draft).every((v) => v.trim() === "");

  return (
    <div className="flex flex-wrap items-end gap-4 py-4">
      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-micro text-muted-foreground">{f.label} $/M</span>
          <input
            className="h-7 w-[104px] rounded-md border border-input bg-background px-2 text-right font-mono text-small tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            inputMode="decimal"
            placeholder="—"
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <Button size="sm" disabled={blocked || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving" : "Save and rescan"}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDone}>
        Cancel
      </Button>
      {save.error && (
        <span className="text-small text-destructive">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </span>
      )}
    </div>
  );
}
