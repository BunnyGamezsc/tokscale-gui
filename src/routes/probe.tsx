import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Mirrors `probe::Timing`. Hand-written on purpose: `tauri-specta` generates
 *  these types from ticket 09 onwards, and this page is scaffolding for
 *  ticket 08's measurements, not part of the command surface. */
type Timing = {
  label: string;
  wallMs: number;
  coreReportedMs: number | null;
  rows: number;
};

type DetectedClient = { id: string; displayName: string; files: number };

type ScanProbe = {
  homeDir: string;
  bucketTimezone: string | null;
  clientsKnown: number;
  clientsDetected: DetectedClient[];
  filesFound: number;
  dbSourcesFound: number;
  timings: Timing[];
  totalMessages: number;
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  clientsWithUsage: { client: string; messages: number; rows: number }[];
  contributionDays: number;
  dateRange: [string, string] | null;
  sampleEntry: unknown;
  sampleContribution: unknown;
};

/** Result of hammering `ping` while the scan runs.
 *
 *  This is the whole point of the page. If the scan starves Tauri's async
 *  runtime, pings stop landing and `maxGapMs` blows up — which is the evidence
 *  that the scan needs its own thread and a progress channel rather than a
 *  plain async command. */
type PingProfile = {
  sent: number;
  landed: number;
  maxGapMs: number;
  medianGapMs: number;
};

const n = new Intl.NumberFormat();

function ms(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`;
}

export function Probe() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<ScanProbe | null>(null);
  const [ping, setPing] = useState<PingProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const stop = useRef(false);

  const run = useCallback(async () => {
    setState("running");
    setResult(null);
    setPing(null);
    setError(null);
    stop.current = false;

    const started = performance.now();
    const tick = setInterval(() => setElapsed(performance.now() - started), 100);

    // Poll `ping` as fast as it will answer, recording the gap between
    // consecutive replies. A blocked runtime shows up as one enormous gap.
    const gaps: number[] = [];
    let sent = 0;
    let landed = 0;
    let last = performance.now();
    const pinger = (async () => {
      while (!stop.current) {
        sent += 1;
        await invoke("ping");
        const now = performance.now();
        gaps.push(now - last);
        last = now;
        landed += 1;
        await new Promise((r) => setTimeout(r, 50));
      }
    })();

    try {
      const probe = await invoke<ScanProbe>("scan_probe");
      setResult(probe);
      setState("done");
    } catch (e) {
      setError(String(e));
      setState("error");
    } finally {
      stop.current = true;
      clearInterval(tick);
      setElapsed(performance.now() - started);
      await pinger;
      const sorted = [...gaps].sort((a, b) => a - b);
      const profile: PingProfile = {
        sent,
        landed,
        maxGapMs: Math.round(sorted.at(-1) ?? 0),
        medianGapMs: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
      };
      setPing(profile);
      await invoke("report_ping_profile", { profile });
    }
  }, []);

  // Runs itself on mount: the measurement should not depend on someone being
  // there to click, and the numbers go to stderr as well as to the window.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[15px] font-semibold">Scan probe</h1>
        <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
          Ticket 08. Calls tokscale-core in-process and reports what it cost.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={state === "running"}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {state === "running" ? "Scanning…" : "Run scan"}
        </button>
        {state !== "idle" && (
          <span className="tabular text-[13px] text-[var(--color-fg-muted)]">
            {ms(Math.round(elapsed))}
          </span>
        )}
        {/* A CSS animation keeps running even if the main thread stalls, so it
            is not evidence on its own — the ping profile below is. */}
        {state === "running" && (
          <span className="h-2 w-2 animate-ping rounded-full bg-[var(--color-accent)]" />
        )}
      </div>

      {error && (
        <pre className="whitespace-pre-wrap rounded-md border border-red-500/40 bg-red-500/10 p-3 text-[12px]">
          {error}
        </pre>
      )}

      {ping && (
        <Section title="IPC responsiveness during the scan">
          <Grid>
            <Stat label="pings landed" value={`${ping.landed} / ${ping.sent}`} />
            <Stat label="median gap" value={ms(ping.medianGapMs)} />
            <Stat label="max gap" value={ms(ping.maxGapMs)} />
          </Grid>
        </Section>
      )}

      {result && (
        <>
          <Section title="Machine">
            <Grid>
              <Stat label="clients known" value={n.format(result.clientsKnown)} />
              <Stat
                label="clients with usage"
                value={n.format(result.clientsWithUsage.length)}
              />
              <Stat
                label="clients detected by file scan"
                value={n.format(result.clientsDetected.length)}
              />
              <Stat label="files found" value={n.format(result.filesFound)} />
              <Stat label="db sources" value={n.format(result.dbSourcesFound)} />
              <Stat label="bucket timezone" value={result.bucketTimezone ?? "unpinned"} />
              <Stat
                label="date range"
                value={result.dateRange ? `${result.dateRange[0]} → ${result.dateRange[1]}` : "—"}
              />
            </Grid>
          </Section>

          <Section title="Totals">
            <Grid>
              <Stat label="messages" value={n.format(result.totalMessages)} />
              <Stat label="cost" value={`$${result.totalCost.toFixed(2)}`} />
              <Stat label="input" value={n.format(result.totalInput)} />
              <Stat label="output" value={n.format(result.totalOutput)} />
              <Stat label="cache read" value={n.format(result.totalCacheRead)} />
              <Stat label="cache write" value={n.format(result.totalCacheWrite)} />
              <Stat label="contribution days" value={n.format(result.contributionDays)} />
            </Grid>
          </Section>

          <Section title="Timings">
            <table className="w-full text-[12px]">
              <thead className="text-left text-[var(--color-fg-muted)]">
                <tr>
                  <th className="py-1 font-medium">call</th>
                  <th className="py-1 text-right font-medium">wall</th>
                  <th className="py-1 text-right font-medium">core</th>
                  <th className="py-1 text-right font-medium">rows</th>
                </tr>
              </thead>
              <tbody>
                {result.timings.map((t) => (
                  <tr key={t.label} className="border-t border-[var(--color-border)]">
                    <td className="py-1 pr-3">{t.label}</td>
                    <td className="tabular py-1 text-right">{ms(t.wallMs)}</td>
                    <td className="tabular py-1 text-right text-[var(--color-fg-muted)]">
                      {t.coreReportedMs === null ? "—" : ms(t.coreReportedMs)}
                    </td>
                    <td className="tabular py-1 text-right">{n.format(t.rows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Clients with usage in the report">
            <table className="w-full text-[12px]">
              <tbody>
                {result.clientsWithUsage.map((c) => (
                  <tr key={c.client} className="border-t border-[var(--color-border)]">
                    <td className="py-1">{c.client}</td>
                    <td className="tabular py-1 text-right">{n.format(c.messages)} messages</td>
                    <td className="tabular py-1 text-right">{n.format(c.rows)} rows</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Clients detected by the file scan">
            <table className="w-full text-[12px]">
              <tbody>
                {result.clientsDetected.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--color-border)]">
                    <td className="py-1">{c.displayName}</td>
                    <td className="py-1 text-[var(--color-fg-muted)]">{c.id}</td>
                    <td className="tabular py-1 text-right">{n.format(c.files)} files</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Aggregate row, as it crosses IPC">
            <pre className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-black/20 p-3 text-[11px]">
              {JSON.stringify(result.sampleEntry, null, 2)}
            </pre>
          </Section>

          <Section title="Daily contribution, as it crosses IPC">
            <pre className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-black/20 p-3 text-[11px]">
              {JSON.stringify(result.sampleContribution, null, 2)}
            </pre>
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] p-2">
      <div className="text-[11px] text-[var(--color-fg-muted)]">{label}</div>
      <div className="tabular text-[13px]">{value}</div>
    </div>
  );
}
