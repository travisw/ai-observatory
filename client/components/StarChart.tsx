/**
 * The sky tonight: every scored model as a star. Capability across, input price up (log), size
 * by context window, colour by provider. Click a star to open the model.
 */
import { useMemo } from "preact/hooks";
import { useNavigate } from "@spacefast/zero/client";
import recharts from "recharts";

import { formatContext } from "../../shared/model";
import { providerName } from "../../shared/providers";
import type { ModelRow } from "../../shared/types";
import { SKY_PALETTE } from "../lib/board";
import { modelHref, perM } from "../lib/util";
import { BOARD_FONT } from "./Flap";
import { AXIS_TICK, TOOLTIP_STYLE, fmtMoney } from "./StepChart";

const { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } = recharts;

type Star = { modelId: string; name: string; provider: string; x: number; y: number; z: number; context: string; out: string };

type StarModel = Pick<ModelRow, "modelId" | "name" | "provider" | "promptPrice" | "completionPrice" | "contextLength" | "aaIntelligence">;

/** Scored, priced, non-alias models become stars; the rest are counted for the footnote. */
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

/** Provider → hue, in order of how many stars each provider has, so the busiest get the clearest colours. */
export function providerHues(list: Star[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s.provider, (counts.get(s.provider) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  return new Map(ordered.map((p, i) => [p, SKY_PALETTE[i % SKY_PALETTE.length]]));
}

function StarTip(props: { active?: boolean; payload?: { payload: Star }[] }) {
  const star = props.payload?.[0]?.payload;
  if (!props.active || !star) return null;
  return (
    <div style={TOOLTIP_STYLE} class="px-3 py-2 text-ink">
      <div class="text-sm font-bold">{star.name}</div>
      <div class="text-ink-muted">{providerName(star.provider)}</div>
      <div class="font-mono tracking-normal normal-case">{fmtMoney(star.y)} in · {star.out ? fmtMoney(Number(star.out) * 1e6) : "–"} out · {star.context} ctx · index {star.x}</div>
    </div>
  );
}

export function StarChart(props: { models: StarModel[]; height?: number; title?: string }) {
  const navigate = useNavigate();
  const { stars: list, unscored } = useMemo(() => stars(props.models), [props.models]);
  const hues = useMemo(() => providerHues(list), [list]);
  if (list.length === 0) return <p class="px-3 py-4 text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-muted">No scored models to chart.</p>;
  const ys = list.map((s) => s.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const legend = [...hues.entries()].slice(0, 8);
  return (
    <div class="flex flex-col gap-2">
      <div class="w-full rounded-sm bg-canvas p-2" style={{ height: `${props.height ?? 420}px` }} role="img" aria-label={`${props.title ?? "Sky chart"}: ${list.length} models plotted by capability index and input price per million tokens.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 24, left: 4, bottom: 8 }}>
            <CartesianGrid stroke="#2a2a2a" strokeDasharray="1 5" />
            <XAxis type="number" dataKey="x" name="capability" domain={["auto", "auto"]} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "#2a2a2a" }} label={{ value: "CAPABILITY INDEX →", position: "insideBottomRight", offset: -2, fill: "#8f8a7a", fontSize: 11, fontFamily: BOARD_FONT, letterSpacing: "0.1em" }} />
            <YAxis type="number" dataKey="y" name="input $/M" scale="log" domain={[yMin, yMax]} tickFormatter={(v: number) => fmtMoney(v)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} label={{ value: "INPUT $/M ↑", angle: -90, position: "insideLeft", fill: "#8f8a7a", fontSize: 11, fontFamily: BOARD_FONT, letterSpacing: "0.1em" }} />
            <ZAxis type="number" dataKey="z" range={[20, 320]} name="context" />
            <Tooltip content={<StarTip />} cursor={{ stroke: "#ffb000", strokeDasharray: "2 3" }} />
            <Scatter data={list} isAnimationActive={false} onClick={(point: { payload?: Star }) => { if (point?.payload) navigate(modelHref(point.payload.modelId)); }} cursor="pointer">
              {list.map((s) => (
                <Cell key={s.modelId} fill={hues.get(s.provider) ?? "#f3e9cf"} fillOpacity={0.85} stroke="#090909" strokeWidth={0.5} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
        {legend.map(([provider, hue]) => (
          <span key={provider} class="inline-flex items-center gap-1.5"><span class="inline-block size-2 rounded-full" style={{ background: hue }} aria-hidden="true" />{providerName(provider)}</span>
        ))}
        {hues.size > 8 ? <span>+{hues.size - 8} more, colours repeat</span> : null}
        <span class="ml-auto">size = context window{unscored ? ` · ${unscored} unscored models not shown` : ""}</span>
      </div>
    </div>
  );
}
