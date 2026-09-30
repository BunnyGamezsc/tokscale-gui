import { useState } from "react";
import { useGuiSettings, useScanLanded, useSpendingStatus } from "@/lib/use-scan";
import { forecast, LIMIT_THRESHOLDS, crossedThresholds, limitAmount } from "@/lib/spending";
import { fmtCost } from "@/lib/format";
import * as api from "@/lib/api";

const field = "rounded-sm border border-border bg-transparent px-2 py-1 text-small";

function LimitMeter({ label, spent, limit }: { label: string; spent: number; limit: number }) {
  const percent = Math.max(0, spent / limit * 100);
  const crossed = crossedThresholds(spent, limit);
  return (
    <div className="py-2">
      <div className="flex justify-between gap-3 text-small"><span>{label}</span><span className="tnum font-mono">{fmtCost(spent)} / {fmtCost(limit)} · {Math.round(percent)}%</span></div>
      <div className="relative mt-2 h-1.5 rounded-sm bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)} aria-valuetext={`${Math.round(percent)}% of monthly limit`}>
        <div className={`h-full rounded-sm ${crossed.includes(90) ? "bg-amber-600" : "bg-foreground/50"}`} style={{ width: `${Math.min(100, percent)}%` }} />
        {LIMIT_THRESHOLDS.map((rung) => <span key={rung} className="absolute top-0 h-full w-px bg-background/80" style={{ left: `${Math.min(rung, 99.5)}%` }} />)}
      </div>
    </div>
  );
}

export function SpendingOverview({ ready }: { ready: boolean }) {
  const { data, error } = useSpendingStatus(ready);
  const { settings } = useGuiSettings();
  if (error) return <p role="alert" className="mt-4 text-small text-muted-foreground">Local spending unavailable: {String(error)}</p>;
  if (!data) return <p className="mt-4 text-small text-muted-foreground">Loading spending pace…</p>;
  const month = forecast(data.days, data.today, "month", data.firstDay);
  const week = forecast(data.days, data.today, "week", data.firstDay);
  return (
    <section className="mt-4 border-y border-border/50 py-3" aria-label="Local spending pace and limits">
      <p className="text-small">On track for <span className="tnum font-mono font-medium">{fmtCost(month.projected)}</span> by month end · <span className="tnum font-mono">{fmtCost(week.projected)}</span> this week</p>
      <p className="mt-1 text-micro text-muted-foreground">Estimate from local usage through {data.today}. Monday weeks; calendar-day averages.{month.partial || week.partial ? " Partial history or unpriced usage may understate spending." : ""} View filters do not apply.</p>
      {settings.monthlyLimit !== null && <LimitMeter label="Monthly limit" spent={month.spent} limit={settings.monthlyLimit} />}
      {settings.modelLimits.map((limit) => <LimitMeter key={JSON.stringify([limit.provider, limit.model])} label={`${limit.model} via ${limit.provider}`} limit={limit.amount} spent={data.models.find((m) => m.provider === limit.provider && m.model === limit.model)?.cost ?? 0} />)}
      {data.notificationError && <p role="alert" className="mt-2 text-micro text-muted-foreground">Spending notification failed: {data.notificationError}</p>}
    </section>
  );
}

export function SpendingSettings() {
  const { settings, save } = useGuiSettings();
  const ready = useScanLanded();
  const { data } = useSpendingStatus(ready);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = [...new Set(data?.models.map((m) => m.provider).filter(Boolean) ?? [])];
  const models = data?.models.filter((m) => m.provider === provider) ?? [];
  async function persist(patch: Partial<typeof settings>) {
    setBusy(true);
    try { await save(patch); setError(null); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  async function enableNotifications() {
    setBusy(true);
    try {
      const permission = await api.requestSpendingNotifications();
      if (permission !== "granted") { setError("Notifications are blocked. Allow tokscale in system notification settings, then try again."); return; }
      await save({ spendingNotificationsEnabled: true });
      setError(null);
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  return (
    <section className="border-b border-border/50 py-3" aria-label="Spending limits">
      <h3 className="font-medium">Monthly spending limits</h3>
      <p className="mt-1 text-micro text-muted-foreground">Local usage estimates in USD. Alerts at 50, 75, 90 and 100%, once per month. Limits do not stop usage.</p>
      <label className="mt-3 flex items-center justify-between gap-3">Global limit
        <input aria-label="Global monthly limit in dollars" key={settings.monthlyLimit ?? "none"} type="number" min="0.01" step="0.01" placeholder="No limit" disabled={busy} defaultValue={settings.monthlyLimit ?? ""} className={`${field} tnum w-28 font-mono text-right`} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} onBlur={(e) => { const value = e.currentTarget.value; const next = limitAmount(value); if (value && next === null) { setError("Enter a positive dollar amount or clear the field."); return; } if (next !== settings.monthlyLimit) void persist({ monthlyLimit: next }); }} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <select aria-label="Limit provider" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(""); }} className={`${field} min-w-0 flex-1`}><option value="">Provider</option>{providers.map((p) => <option key={p}>{p}</option>)}</select>
        <select aria-label="Limit model" value={model} onChange={(e) => setModel(e.target.value)} disabled={!provider} className={`${field} min-w-0 flex-1`}><option value="">Model</option>{models.map((m) => <option key={m.model}>{m.model}</option>)}</select>
        <input aria-label="Model monthly limit in dollars" type="number" min="0.01" step="0.01" placeholder="$ amount" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} w-24 font-mono`} />
        <button type="button" disabled={busy || !model || limitAmount(amount) === null} className="rounded-sm bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50" onClick={() => { const value = limitAmount(amount); if (value === null) return; void persist({ modelLimits: [...settings.modelLimits.filter((l) => l.provider !== provider || l.model !== model), { provider, model, amount: value }] }); }}>Set limit</button>
      </div>
      {!ready && <p className="mt-2 text-micro text-muted-foreground">Run a scan to choose providers and models.</p>}
      {settings.modelLimits.map((limit) => <div key={JSON.stringify([limit.provider, limit.model])} className="mt-2 flex items-center justify-between gap-2 text-micro"><span>{limit.model} via {limit.provider} · {fmtCost(limit.amount)}</span><button disabled={busy} className="text-muted-foreground hover:text-foreground" onClick={() => void persist({ modelLimits: settings.modelLimits.filter((l) => l !== limit) })} aria-label={`Remove limit for ${limit.model} via ${limit.provider}`}>Remove</button></div>)}
      <label className="mt-3 flex items-center gap-2"><input type="checkbox" disabled={busy} checked={settings.spendingNotificationsEnabled} onChange={(e) => { if (e.target.checked) void enableNotifications(); else void persist({ spendingNotificationsEnabled: false }); }} className="accent-[var(--primary)]" />Spending notifications</label>
      {settings.spendingNotificationsEnabled && data?.notificationPermission !== "granted" && <button disabled={busy} className="mt-2 text-micro underline" onClick={() => void enableNotifications()}>Allow notifications in system settings, then retry</button>}
      {error && <p role="alert" className="mt-2 text-micro text-muted-foreground">{error}</p>}
    </section>
  );
}
