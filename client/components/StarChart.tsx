/**
 * Price vs capability: every scored model as a point. Capability across, input price up (log),
 * size by context window, colour by provider. Click a point to open the model.
 *
 * Drawn as plain SVG, like the site's other small charts, and sized to its container so the axis
 * text stays readable on a phone.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useNavigate } from "@spacefast/zero/client";

import { formatContext } from "../../shared/model";
import { providerName } from "../../shared/providers";
import type { ModelRow } from "../../shared/types";
import { CHART_STROKES } from "../lib/text";
import { modelHref, perM } from "../lib/util";
import { fmtMoney } from "./StepChart";
import { FONT_MONO } from "./Wire";

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

/** Round linear ticks (1, 2 or 5 times a power of ten) covering lo..hi. */
function linearTicks(lo: number, hi: number): number[] {
  const rough = (hi - lo) / 5 || 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= hi + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

/** Log ticks at 1, 2 and 5 times each power of ten between lo and hi. */
function logTicks(lo: number, hi: number): number[] {
  const ticks: number[] = [];
  for (let p = Math.floor(Math.log10(lo)); p <= Math.ceil(Math.log10(hi)); p++) {
    for (const m of [1, 2, 5]) {
      const t = m * 10 ** p;
      if (t >= lo * 0.999 && t <= hi * 1.001) ticks.push(t);
    }
  }
  return ticks;
}

/** Tracks an element's width, so the SVG is drawn at its real size. `shown` re-attaches once the element renders. */
function useWidth(fallback: number, shown: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);
  return { ref, width };
}

export function StarChart(props: { models: StarModel[]; height?: number; title?: string }) {
  const navigate = useNavigate();
  const { stars: list, unscored } = useMemo(() => stars(props.models), [props.models]);
  const hues = useMemo(() => providerHues(list), [list]);
  const { ref, width } = useWidth(900, list.length > 0);
  const title = props.title ?? "Price vs capability";
  if (list.length === 0) return <p class="note">No scored models to chart.</p>;

  const H = props.height ?? 420;
  const W = Math.max(280, width);
  const pad = { left: 58, right: 14, top: 12, bottom: 34 };
  const xs = list.map((s) => s.x);
  const ys = list.map((s) => s.y);
  const xTicks = linearTicks(Math.min(...xs), Math.max(...xs));
  const xLo = xTicks[0];
  const xHi = xTicks[xTicks.length - 1] === xLo ? xLo + 1 : xTicks[xTicks.length - 1];
  const yLo = 10 ** Math.floor(Math.log10(Math.min(...ys)));
  const yHi = 10 ** Math.ceil(Math.log10(Math.max(...ys)));
  const yTicks = logTicks(yLo, yHi);
  const toX = (v: number) => pad.left + ((v - xLo) / (xHi - xLo)) * (W - pad.left - pad.right);
  const toY = (v: number) => H - pad.bottom - ((Math.log10(v) - Math.log10(yLo)) / (Math.log10(yHi) - Math.log10(yLo) || 1)) * (H - pad.top - pad.bottom);
  const zs = list.map((s) => Math.log10(s.z));
  const zLo = Math.min(...zs);
  const zSpan = Math.max(...zs) - zLo || 1;
  const radius = (z: number) => 2.5 + 5.5 * ((Math.log10(z) - zLo) / zSpan);
  // Big points first, so a small model is never hidden under a large one.
  const drawn = list.slice().sort((a, b) => b.z - a.z);
  const legend = [...hues.entries()].slice(0, 8);

  return (
    <div class="box">
      <h3><span>{title}</span><span>capability across · input price up · size is context</span></h3>
      <div ref={ref} style={{ height: `${H}px` }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${list.length} models plotted by capability index and input price per million tokens.`}>
          <g stroke="#2c2d29" stroke-dasharray="2 3">
            {xTicks.map((t) => <line key={`x${t}`} x1={toX(t)} x2={toX(t)} y1={pad.top} y2={H - pad.bottom} />)}
            {yTicks.map((t) => <line key={`y${t}`} x1={pad.left} x2={W - pad.right} y1={toY(t)} y2={toY(t)} />)}
          </g>
          <g font-family={FONT_MONO} font-size="11" fill="#9a958a">
            {xTicks.map((t) => <text key={`xl${t}`} x={toX(t)} y={H - pad.bottom + 14} text-anchor="middle">{t}</text>)}
            {yTicks.map((t) => <text key={`yl${t}`} x={pad.left - 6} y={toY(t) + 4} text-anchor="end">{fmtMoney(t)}</text>)}
            <text x={W - pad.right} y={H - 4} text-anchor="end">capability index →</text>
            <text x={pad.left + 6} y={pad.top + 12}>input $/M ↑</text>
          </g>
          {drawn.map((s) => (
            <circle
              key={s.modelId}
              cx={toX(s.x)}
              cy={toY(s.y)}
              r={radius(s.z)}
              fill={hues.get(s.provider) ?? "#ece9e0"}
              fill-opacity="0.85"
              stroke="#111210"
              stroke-width="0.5"
              style={{ cursor: "pointer" }}
              onClick={() => navigate(modelHref(s.modelId))}
            >
              <title>{`${s.name} · ${providerName(s.provider)}\n${fmtMoney(s.y)} in · ${s.out ? fmtMoney(Number(s.out) * 1e6) : "–"} out · ${s.context} context · index ${s.x}`}</title>
            </circle>
          ))}
        </svg>
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
