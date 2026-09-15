import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ViewHeader } from "@/components/view";
import { Placeholder, Spinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { resetLabel, span } from "@/lib/quota";
import { isWindows } from "@/lib/platform";
import { maskEmail, splitEmails } from "@/lib/redact";

/** Said before a fetch can prompt. The Keychain checks the process reading an
 *  item, and that is `/usr/bin/security`, not this app (ADR 0007). */
const CREDENTIAL_MANAGER_NOTE =
  "Quota is read with the credentials each vendor's own tool saved, some of them in Windows Credential Manager.";
const KEYCHAIN_NOTE =
  "Quota is read with the credentials each vendor's own tool saved, some of them in your login Keychain. If macOS asks whether “security” may use an item, that's Apple's command-line tool reading it for this app.";

/** **Usage (the tab)**: subscription quota as each provider's API reports it.
 *  Needs no Snapshot, and nothing here is compared with tokscale's own figures.
 *  The two can disagree, and that's expected (CONTEXT.md). */
export function UsageView() {
  // Five minutes is the fork's own cache lifetime, so a quick revisit doesn't
  // ask every provider again.
  const quota = useQuery({ queryKey: ["quota"], queryFn: api.quota, staleTime: 5 * 60_000 });
  const { data } = quota;
  const now = Date.now();

  const fetchAgain = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void quota.refetch()}
      disabled={quota.isFetching}
    >
      {quota.isFetching && <Spinner />}
      {quota.isFetching ? "Fetching" : "Fetch again"}
    </Button>
  );

  let body: ReactNode;
  if (!data) {
    body = quota.error ? (
      <Placeholder title="Couldn't fetch quota" body={String(quota.error)} action={fetchAgain} />
    ) : (
      <div className="flex items-center gap-2.5 py-16">
        <Spinner />
        <span>Asking each provider for its quota</span>
      </div>
    );
  } else if (data.cards.length === 0) {
    body = (
      <Placeholder
        title="No provider is set up"
        body={`Quota is read from credentials a vendor's own tool already saved, and none were found. Sign in with one of them (${data.notSetUp.join(", ")}), then fetch again.`}
        action={fetchAgain}
      />
    );
  } else {
    body = (
      <>
        {data.staleSince !== null && (
          <p className="border-b border-border py-2 text-small">
            No provider could be reached. These are the figures from{" "}
            {span(now - data.staleSince * 1000)} ago.
          </p>
        )}
        {data.cards.map((card, i) => (
          <Card key={`${card.provider}-${card.account ?? i}`} card={card} now={now} />
        ))}
        {data.notSetUp.length > 0 && (
          <p className="mt-4 text-small text-muted-foreground">
            Not set up: {data.notSetUp.join(", ")}
          </p>
        )}
      </>
    );
  }

  const age = now - quota.dataUpdatedAt;
  return (
    <>
      <ViewHeader title="Usage" filter="as each provider reports it">
        {data && (
          <>
            <span className="text-micro text-muted-foreground">
              {age < 60_000 ? "fetched just now" : `fetched ${span(age)} ago`}
            </span>
            {fetchAgain}
          </>
        )}
      </ViewHeader>
      {body}
      <p className="mt-6 max-w-[62ch] text-micro text-muted-foreground">
        {isWindows() ? CREDENTIAL_MANAGER_NOTE : KEYCHAIN_NOTE}
      </p>
    </>
  );
}

function Card({ card, now }: { card: api.QuotaCard; now: number }) {
  const [revealed, setRevealed] = useState(false);
  const toggle = () => setRevealed((r) => !r);
  const credits = [
    card.balance && `Balance ${card.balance}`,
    card.unlimited && "Unlimited",
    card.overageLimitReached && "Overage limit reached",
    card.resetCredits !== null && `${card.resetCredits} reset credits available`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="border-b border-border/50 py-3">
      <div className="flex items-baseline gap-3">
        <h2 className="font-medium">{card.provider}</h2>
        <span className="truncate text-small text-muted-foreground">
          <Redacted
            text={[card.account, card.plan].filter(Boolean).join(" · ")}
            revealed={revealed}
            onToggle={toggle}
          />
        </span>
        {card.state !== "fresh" && (
          <span
            className={`ml-auto shrink-0 text-micro ${card.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {card.state === "failed" ? "Fetch failed" : "Stale"}
          </span>
        )}
      </div>

      {card.metrics.length > 0 && (
        <div className="mt-2 grid grid-cols-[minmax(0,9rem)_1fr_4.5rem_7rem_8rem] items-center gap-x-4 gap-y-1.5 text-small">
          {card.metrics.map((m, i) => (
            <Metric key={i} metric={m} now={now} />
          ))}
        </div>
      )}

      {credits && <p className="mt-2 text-micro text-muted-foreground">{credits}</p>}
      {card.diagnostics.map((d, i) => (
        <p key={i} className="mt-1.5 text-micro text-muted-foreground">
          <Redacted text={d} revealed={revealed} onToggle={toggle} />
        </p>
      ))}
    </section>
  );
}

/** Emails masked until clicked. One click shows every email on the card, so a
 *  screenshot of the view doesn't carry an address by default. */
function Redacted({ text, revealed, onToggle }: { text: string; revealed: boolean; onToggle: () => void }) {
  return (
    <>
      {splitEmails(text).map((p, i) =>
        p.email ? (
          <button
            key={i}
            type="button"
            onClick={onToggle}
            title={revealed ? "Hide email" : "Show email"}
            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {revealed ? p.text : maskEmail(p.text)}
          </button>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

function Metric({ metric: m, now }: { metric: api.QuotaMetric; now: number }) {
  const used = Math.min(100, Math.max(0, m.usedPercent));
  return (
    <>
      <span className="truncate">{m.label}</span>
      <span className="h-[6px] rounded-[1px] bg-muted">
        <span className="block h-full rounded-[1px] bg-[var(--ramp-4)]" style={{ width: `${used}%` }} />
      </span>
      <span className="tnum text-right font-mono text-muted-foreground">{Math.round(used)}% used</span>
      <span className={`tnum text-right font-mono ${m.remainingPercent <= 10 ? "text-destructive" : ""}`}>
        {m.remainingLabel ?? `${Math.round(m.remainingPercent)}% left`}
      </span>
      <span className="truncate text-micro text-muted-foreground">
        {m.resetsAt ? resetLabel(m.resetsAt, now) : ""}
      </span>
    </>
  );
}
