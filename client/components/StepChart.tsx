/**
 * A step chart for prices and limits. Prices are step functions: a sloped line between two
 * points draws a change that never happened. recharts is served by the platform, no install.
 */
import recharts from "recharts";
import { seriesColor } from "@spacefast/zero/charts";

import type { StepPoint } from "../lib/series";
import { valueAt } from "../lib/series";
import { DAY } from "../lib/util";

// The platform serves recharts as one default export rather than named exports.
const { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } = recharts;

export type StepSeries = { key: string; label: string; points: StepPoint[]; dashed?: boolean; color?: string };

function fmtMoney(v: number): string {
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function fmtDate(t: number, spanDays: number): string {
  const d = new Date(t);
  if (spanDays <= 2) return d.toISOString().slice(11, 16);
  if (spanDays <= 400) return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Merges every series onto one time axis. Each series is sampled at every breakpoint, so the
 * step shape survives the merge.
 */
function merge(series: StepSeries[], from: number, to: number) {
  const times = new Set<number>([from, to]);
  for (const s of series) for (const p of s.points) if (p.t >= from && p.t <= to) times.add(p.t);
  const rows = [...times].sort((a, b) => a - b).map((t) => {
    const row: Record<string, number | null> = { t };
    for (const s of series) row[s.key] = s.points.length ? valueAt(s.points, t) : null;
    return row;
  });
  return rows;
}

export function StepChart(props: {
  series: StepSeries[];
  from: number;
  to?: number;
  height?: number;
  formatValue?: (v: number) => string;
  lowLine?: { value: number; label: string };
  unit?: string;
}) {
  const to = props.to ?? Date.now();
  const rows = merge(props.series, props.from, to);
  const spanDays = (to - props.from) / DAY;
  const fmt = props.formatValue ?? fmtMoney;
  const summary = props.series
    .map((s) => {
      const first = valueAt(s.points, props.from);
      const last = valueAt(s.points, to);
      return first === null || last === null ? "" : `${s.label}: ${fmt(first)} to ${fmt(last)}`;
    })
    .filter(Boolean)
    .join("; ");
  return (
    <div class="w-full" style={{ height: `${props.height ?? 260}px` }} role="img" aria-label={`Chart. ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={[props.from, to]}
            tickFormatter={(t: number) => fmtDate(t, spanDays)}
            stroke="var(--color-ink-muted)"
            tick={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={(v: number) => fmt(v)}
            stroke="var(--color-ink-muted)"
            tick={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={[0, "auto"]}
          />
          <Tooltip
            labelFormatter={(t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC"}
            formatter={(v: number, name: string) => [fmt(v), name]}
            contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: 8, fontSize: 12, fontFamily: "ui-monospace, monospace" }}
            labelStyle={{ color: "var(--color-ink-muted)" }}
            itemStyle={{ color: "var(--color-ink)" }}
          />
          {props.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
          {props.lowLine ? (
            <ReferenceLine y={props.lowLine.value} stroke="var(--color-success)" strokeDasharray="4 4" label={{ value: props.lowLine.label, position: "insideTopRight", fill: "var(--color-success)", fontSize: 11 }} />
          ) : null}
          {props.series.map((s, i) => (
            <Line
              key={s.key}
              type="stepAfter"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? seriesColor(i)}
              strokeWidth={1.5}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              dot={{ r: 2.5, strokeWidth: 0, fill: s.color ?? seriesColor(i) }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The same data as a table, for readers who want numbers or cannot see the chart. */
export function StepTable(props: { series: StepSeries[]; formatValue?: (v: number) => string }) {
  const fmt = props.formatValue ?? fmtMoney;
  const times = new Set<number>();
  for (const s of props.series) for (const p of s.points) times.add(p.t);
  const rows = [...times].sort((a, b) => b - a);
  return (
    <div class="overflow-x-auto">
      <table class="w-full font-mono text-xs tabular-nums">
        <thead>
          <tr class="border-b border-line text-left text-ink-muted">
            <th class="py-1 pr-3 font-normal">when (UTC)</th>
            {props.series.map((s) => <th key={s.key} class="py-1 pr-3 font-normal">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t} class="border-b border-line last:border-0">
              <td class="py-1 pr-3 text-ink-muted">{new Date(t).toISOString().replace("T", " ").slice(0, 16)}</td>
              {props.series.map((s) => {
                const v = valueAt(s.points, t);
                return <td key={s.key} class="py-1 pr-3 text-ink">{v === null ? "–" : fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
