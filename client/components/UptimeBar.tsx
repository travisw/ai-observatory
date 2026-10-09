/**
 * Ninety little bars, one per day, the way status pages draw them. Days without a record are
 * drawn hollow rather than green, so missing data never passes for uptime.
 */
import type { DayState } from "../lib/series";
import { uptimeSummary } from "../lib/series";
import { longDate } from "../lib/util";

const STATE_CLASS: Record<DayState, string> = {
  up: "bg-success",
  degraded: "bg-warning",
  down: "bg-danger",
  none: "bg-line",
};

const STATE_WORD: Record<DayState, string> = {
  up: "up",
  degraded: "degraded",
  down: "down",
  none: "no record",
};

export function UptimeBar(props: { days: { day: string; state: DayState }[]; label: string; height?: number }) {
  const sum = uptimeSummary(props.days);
  const words = sum.recorded === 0 ? "no record yet" : sum.incidentDays === 0 ? `no incidents in ${sum.recorded} recorded days` : `${sum.incidentDays} incident ${sum.incidentDays === 1 ? "day" : "days"} of ${sum.recorded} recorded`;
  const h = props.height ?? 24;
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-end gap-px" style={{ height: `${h}px` }} role="img" aria-label={`${props.label}: ${words} over the last ${props.days.length} days`}>
        {props.days.map((d) => (
          <span
            key={d.day}
            class={`block min-w-px flex-1 rounded-sm ${STATE_CLASS[d.state]}`}
            style={{ height: d.state === "none" ? "40%" : "100%" }}
            title={`${longDate(d.day)}: ${STATE_WORD[d.state]}`}
          />
        ))}
      </div>
      <div class="flex justify-between font-mono text-[11px] tabular-nums text-ink-muted">
        <span>{props.days.length} days ago</span>
        <span>{words}</span>
        <span>today</span>
      </div>
    </div>
  );
}
