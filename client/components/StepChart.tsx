/**
 * A step chart for prices and limits. Prices are step functions: a sloped line between two
 * points draws a change that never happened. recharts is served by the platform, no install.
 */
import recharts from "recharts";

import { FONT_MONO } from "./Wire";
import type { StepPoint } from "../lib/series";
import { valueAt } from "../lib/series";
import { CHART_STROKES } from "../lib/text";
import { DAY } from "../lib/util";

// The platform serves recharts as one default export rather than named exports.
const { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } = recharts;

export type StepSeries = { key: string; label: string; points: StepPoint[]; dashed?: boolean; color?: string };

export const AXIS_TICK = { fontSize: 11, fontFamily: FONT_MONO, fill: "#9a958a" };
export const TOOLTIP_STYLE = { background: "#1a1b18", border: "1px solid #2c2d29", borderRadius: 3, fontSize: 12, fontFamily: FONT_MONO, color: "#ece9e0" };

export function fmtMoney(v: number): string {
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(t: number, spanDays: number): string {
  const d = new Date(t);
  if (spanDays <= 2) return d.toISOString().slice(11, 16);
  if (spanDays <= 400) return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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
    <div class="box" style={{ height: `${props.height ?? 260}px`, padding: "8px 4px 4px" }} role="img" aria-label={`Chart. ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="#2c2d29" strokeDasharray="2 3" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={[props.from, to]}
            tickFormatter={(t: number) => fmtDate(t, spanDays)}
            stroke="#2c2d29"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "#2c2d29" }}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={(v: number) => fmt(v)}
            stroke="#2c2d29"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={[0, "auto"]}
          />
          <Tooltip
            labelFormatter={(t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC"}
            formatter={(v: number, name: string) => [fmt(v), name]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#9a958a" }}
            itemStyle={{ color: "#ece9e0" }}
            cursor={{ stroke: "#9fb3ff", strokeDasharray: "2 3" }}
          />
          {props.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12, fontFamily: FONT_MONO, color: "#9a958a" }} /> : null}
          {props.lowLine ? (
            <ReferenceLine y={props.lowLine.value} stroke="#5fcf8a" strokeDasharray="4 4" label={{ value: props.lowLine.label, position: "insideTopRight", fill: "#5fcf8a", fontSize: 11, fontFamily: FONT_MONO }} />
          ) : null}
          {props.series.map((s, i) => (
            <Line
              key={s.key}
              type="stepAfter"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? CHART_STROKES[i % CHART_STROKES.length]}
              strokeWidth={1.5}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              dot={{ r: 2.5, strokeWidth: 0, fill: s.color ?? CHART_STROKES[i % CHART_STROKES.length] }}
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
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>When (UTC)</th>
            {props.series.map((s) => <th key={s.key} class="n">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t}>
              <td class="when">{new Date(t).toISOString().replace("T", " ").slice(0, 16)}</td>
              {props.series.map((s) => {
                const v = valueAt(s.points, t);
                return <td key={s.key} class="n">{v === null ? "–" : fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
