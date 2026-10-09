/**
 * Turns archive rows into things a chart can draw: step series, sparkline samples, uptime days.
 */
import type { ArchiveEvent, IncidentRow, ModelRow, SourceEventRow, StatusEvent, StatusRow } from "../../shared/types";
import { DAY, perM } from "./util";

export type StepPoint = { t: number; value: number };

/**
 * A price as a step function from the first known value to now. Events carry (old → new) at a time,
 * so walking them in order gives every step; the value before the first event is its old value.
 */
export function stepSeries(
  events: Pick<ArchiveEvent, "at" | "kind" | "field" | "oldValue" | "newValue">[],
  field: string,
  current: string,
  firstSeenAt: string,
): StepPoint[] {
  const changes = events
    .filter((e) => e.kind === "changed" && e.field === field)
    .sort((a, b) => a.at.localeCompare(b.at));
  const now = Date.now();
  const start = Date.parse(firstSeenAt) || now - DAY;
  const points: StepPoint[] = [];
  const currentValue = perM(current);
  if (changes.length === 0) {
    if (currentValue === null) return [];
    return [
      { t: start, value: currentValue },
      { t: now, value: currentValue },
    ];
  }
  const first = perM(changes[0].oldValue);
  if (first !== null) points.push({ t: Math.min(start, Date.parse(changes[0].at) - 1), value: first });
  for (const c of changes) {
    const value = perM(c.newValue);
    if (value !== null) points.push({ t: Date.parse(c.at), value });
  }
  if (currentValue !== null) points.push({ t: now, value: currentValue });
  return points;
}

/** The value of a step series at time t. */
export function valueAt(series: StepPoint[], t: number): number | null {
  let value: number | null = null;
  for (const p of series) {
    if (p.t <= t) value = p.value;
    else break;
  }
  return value ?? (series[0]?.value ?? null);
}

/** N evenly spaced samples over the last `days`, for a sparkline. Flat when nothing moved. */
export function sparkSamples(series: StepPoint[], days: number, n = 30): number[] {
  if (series.length === 0) return [];
  const now = Date.now();
  const from = now - days * DAY;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = from + ((now - from) * i) / (n - 1);
    const v = valueAt(series, t);
    if (v !== null) out.push(v);
  }
  return out;
}

/** Input-price sparkline for one model from a shared pile of recent events. */
export function inputSpark(model: Pick<ModelRow, "modelId" | "promptPrice" | "firstSeenAt">, events: ArchiveEvent[], days = 90): number[] {
  const own = events.filter((e) => e.modelId === model.modelId);
  return sparkSamples(stepSeries(own, "promptPrice", model.promptPrice, model.firstSeenAt), days);
}

/** Series from another catalogue's rows (LiteLLM, models.dev), same shape. */
export function sourceStepSeries(rows: SourceEventRow[], source: string, field: string, current: string, firstSeenAt: string): StepPoint[] {
  const own = rows.filter((r) => r.source === source);
  return stepSeries(own, field, current, firstSeenAt);
}

export type DayState = "up" | "degraded" | "down" | "none";

function worse(a: DayState, b: DayState): DayState {
  const rank: Record<DayState, number> = { none: 0, up: 1, degraded: 2, down: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export function indicatorState(indicator: string): DayState {
  if (indicator === "none") return "up";
  if (indicator === "minor") return "degraded";
  if (indicator === "major" || indicator === "critical") return "down";
  return "none";
}

/**
 * One state per day for the last `days`, oldest first. Built from the provider's indicator
 * transitions walked backwards from its current state, with incidents layered on top. Days
 * before anything was recorded are "none", never assumed up.
 */
export function uptimeDays(
  status: StatusRow | null | undefined,
  transitions: StatusEvent[],
  incidents: IncidentRow[],
  days = 90,
): { day: string; state: DayState }[] {
  const now = Date.now();
  const out: { day: string; state: DayState }[] = [];
  const own = transitions.slice().sort((a, b) => b.at.localeCompare(a.at));
  const earliest = Math.min(
    ...own.map((t) => Date.parse(t.at)),
    ...incidents.map((i) => Date.parse(i.startedAt)).filter(Number.isFinite),
    status?.checkedAt ? Date.parse(status.checkedAt) : Infinity,
  );
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now - i * DAY);
    dayStart.setUTCHours(0, 0, 0, 0);
    const from = dayStart.getTime();
    const to = from + DAY;
    const day = dayStart.toISOString().slice(0, 10);
    if (!Number.isFinite(earliest) || to < earliest) {
      out.push({ day, state: "none" });
      continue;
    }
    // Indicator at the end of the day, then every transition inside the day.
    let state: DayState = "none";
    let indicator = status?.indicator ?? "";
    for (const t of own) {
      if (Date.parse(t.at) > to) indicator = t.oldIndicator;
    }
    if (indicator) state = indicatorState(indicator);
    for (const t of own) {
      const at = Date.parse(t.at);
      if (at >= from && at < to) state = worse(state, worse(indicatorState(t.newIndicator), indicatorState(t.oldIndicator)));
    }
    for (const inc of incidents) {
      const started = Date.parse(inc.startedAt);
      const ended = inc.resolvedAt ? Date.parse(inc.resolvedAt) : now;
      if (started < to && ended >= from) {
        state = worse(state, inc.impact === "major" || inc.impact === "critical" ? "down" : inc.impact === "none" ? "up" : "degraded");
      }
    }
    if (state === "none" && from >= earliest) state = "up";
    out.push({ day, state });
  }
  return out;
}

export function uptimePct(days: { state: DayState }[]): number | null {
  const known = days.filter((d) => d.state !== "none");
  if (known.length === 0) return null;
  const good = known.filter((d) => d.state === "up").length;
  return (good / known.length) * 100;
}
