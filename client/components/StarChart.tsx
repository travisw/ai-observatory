/**
 * Price vs capability: every scored model as a point. Capability across, input price up (log),
 * size by context window, colour by provider. Click a point to open the model.
 */
import { useMemo } from "preact/hooks";
import { useNavigate } from "@spacefast/zero/client";
import recharts from "recharts";

import { formatContext } from "../../shared/model";
import { providerName } from "../../shared/providers";
import type { ModelRow } from "../../shared/types";
import { CHART_STROKES } from "../lib/text";
import { modelHref, perM } from "../lib/util";
import { AXIS_TICK, TOOLTIP_STYLE, fmtMoney } from "./StepChart";
import { FONT_MONO } from "./Wire";

const { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } = recharts;

/** Point colours, cycling by provider; the two extra hues keep eight providers apart. */
const POINT_COLOURS = [...CHART_STROKES, "#5ee7df", "#ff8bd1"];

type Star = { modelId: string; name: string; provider: string; x: number; y: number; z: number; context: string; out: string };

type StarModel = Pick<ModelRow, "modelId" | "name" | "provider" | "promptPrice" | "completionPrice" | "contextLength" | "aaIntelligence">;

/** Scored, priced, non-alias models become points; the rest are counted for the footnote. */
export function stars(models: StarModel[]): { stars: Star[]; unscored: number } {
  const out: Star[] = [];
  let unscored = 0;
  for (const m of models) {
    if (m.modelId.startsWith("~") || m.modelId.includes(":")) continue;
    const x = Number(m.aaIntelligence);
    const y = perM(m.promptPrice);
    if (!m.aaIntelligence || !Number.isFinite(x) || y === null || y <= 0) {
      unscored++;
      continue;
    }
    out.push({ modelId: m.modelId, name: m.name, provider: m.provider.replace(/^~/, ""), x, y, z: Math.max(1, Number(m.contextLength) || 1), context: formatContext(m.contextLength), out: m.completionPrice });
  }
  return { stars: out, unscored };
}

/** Provider → hue, in order of how many points each provider has, so the busiest get the clearest colours. */
export function providerHues(list: Star[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  return new Map(ordered.map((p, i) => [p, POINT_COLOURS[i % POINT_COLOURS.length]]));
}

function StarTip(props: { active?: boolean; payload?: { payload: Star }[] }) {
  const star = props.payload?.[0]?.payload;
  if (!props.active || !star) return null;
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: "8px 12px" }}>
      <div style={{ fontWeight: 500 }}>{star.name}</div>
      <div style={{ color: "#9a958a" }}>{providerName(star.provider)}</div>
      <div>{fmtMoney(star.y)} in · {star.out ? fmtMoney(Number(star.out) * 1e6) : "–"} out · {star.context} ctx · index {star.x}</div>
    </div>
  );
}

export function StarChart(props: { models: StarModel[]; height?: number; title?: string }) {
  const navigate = useNavigate();
  const { stars: list, unscored } = useMemo(() => stars(props.models), [props.models]);
  const hues = useMemo(() => providerHues(list), [list]);
  if (list.length === 0) return <p class="note">No scored models to chart.</p>;
  const ys = list.map((s) => s.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const legend = [...hues.entries()].slice(0, 8);
  const title = props.title ?? "Price vs capability";
  return (
    <div class="box">
      <h3><span>{title}</span><span>capability across · input price up · size is context</span></h3>
      <div style={{ height: `${props.height ?? 420}px` }} role="img" aria-label={`${title}: ${list.length} models plotted by capability index and input price per million tokens.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 24, left: 4, bottom: 8 }}>
            <CartesianGrid stroke="#2c2d29" strokeDasharray="2 3" />
            <XAxis type="number" dataKey="x" name="capability" domain={["auto", "auto"]} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "#2c2d29" }} label={{ value: "capability index →", position: "insideBottomRight", offset: -2, fill: "#9a958a", fontSize: 11, fontFamily: FONT_MONO }} />
            <YAxis type="number" dataKey="y" name="input $/M" scale="log" domain={[yMin, yMax]} tickFormatter={(v: number) => fmtMoney(v)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} label={{ value: "input $/M ↑", angle: -90, position: "insideLeft", fill: "#9a958a", fontSize: 11, fontFamily: FONT_MONO }} />
            <ZAxis type="number" dataKey="z" range={[20, 320]} name="context" />
            <Tooltip content={<StarTip />} cursor={{ stroke: "#9fb3ff", strokeDasharray: "2 3" }} />
            <Scatter data={list} isAnimationActive={false} onClick={(point: { payload?: Star }) => { if (point?.payload) navigate(modelHref(point.payload.modelId)); }} cursor="pointer">
              {list.map((s) => (
                <Cell key={s.modelId} fill={hues.get(s.provider) ?? "#ece9e0"} fillOpacity={0.85} stroke="#111210" strokeWidth={0.5} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div class="leg">
        {legend.map(([provider, hue]) => (
          <span key={provider}><i style={{ background: hue, height: 8, width: 8, borderRadius: 4 }} />{providerName(provider)}</span>
        ))}
        {hues.size > 8 ? <span>+{hues.size - 8} more, colours repeat</span> : null}
        {unscored ? <span style={{ marginLeft: "auto" }}>{unscored} unscored models not shown</span> : null}
      </div>
    </div>
  );
}
