import { SlotTable } from "@/components/slot-table";
import { ViewHeader, Tiles } from "@/components/view";
import { Replacing, NoMatch, NoUsage } from "@/components/states";
import { useGraphState, useMinutely } from "@/lib/use-scan";
import { useSnapshot } from "@/views/snapshot";
import { clearFilter, isNarrowed, useFilter } from "@/lib/filter";
import { minuteLabel } from "@/lib/hourly";
import { fmtCost, fmtInt } from "@/lib/format";

/** Hourly's table at a finer key, hidden unless enabled in Settings (#38). */
export function MinutelyView() {
  const snap = useSnapshot();
  const filter = useFilter();
  const minutely = useMinutely(snap.ready);
  const state = useGraphState(minutely);

  if (snap.gate) return snap.gate;
  if (minutely.data && minutely.data.slots.length === 0)
    return isNarrowed(filter) ? <NoMatch onClear={clearFilter} /> : <NoUsage />;

  // ponytail: one row per active minute, unvirtualized; virtualize if a real corpus drags.
  const slots = (minutely.data?.slots ?? []).slice().reverse();
  const busiest = slots.reduce((max, s) => Math.max(max, s.cost), 0);

  return (
    <>
      {snap.banner}
      <ViewHeader title="Minutely" filter={snap.rangeLabel} />

      <Replacing on={state === "replacing"}>
        <Tiles
          items={[
            ["Active minutes", minutely.data ? fmtInt(slots.filter((s) => s.minute !== null).length) : "—"],
            ["Busiest minute", busiest > 0 ? fmtCost(busiest) : "—"],
            ["Messages", minutely.data ? fmtInt(minutely.data.totalMessages) : "—"],
            ["Total cost", minutely.data ? fmtCost(minutely.data.totalCost) : "—"],
          ]}
        />

        <SlotTable
          unit="Minute"
          slots={slots}
          slot={(s) => s.minute}
          label={minuteLabel}
          waiting={state === "waiting"}
          totals={minutely.data}
        />
      </Replacing>
    </>
  );
}
