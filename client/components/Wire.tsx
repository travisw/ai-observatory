/**
 * The wire: a dense, dark news page. One typeface for headings (Archivo), one for text
 * (IBM Plex Sans), one for numbers (IBM Plex Mono). Plain tables and lists; the stylesheet
 * below is the whole design system, scoped under `.wire`, and these are the few pieces pages
 * build from. Nothing here animates and nothing wraps letters in their own elements.
 */
import type { ComponentChildren } from "preact";
import { Link } from "@spacefast/zero/client";

import type { Story } from "../../shared/stories";
import type { DayState } from "../lib/series";
import { deltaIsGood, storyDelta } from "../lib/stories";
import { dayShort, hm, pct, type PillTone } from "../lib/text";

export const FONT_SANS = "'IBM Plex Sans', system-ui, sans-serif";
export const FONT_HEAD = "'Archivo', 'Helvetica Neue', Arial, sans-serif";
export const FONT_MONO = "'IBM Plex Mono', SFMono-Regular, Menlo, monospace";

const CSS = `
.wire{--bg:#111210;--bg2:#1a1b18;--fg:#ece9e0;--soft:#9a958a;--rule:#2c2d29;--cut:#5fcf8a;--rise:#f08a6a;--accent:#9fb3ff;--warn:#e0b84a;
  font-family:${FONT_SANS};font-size:14px;line-height:1.45;color:var(--fg);background:var(--bg);color-scheme:dark;-webkit-font-smoothing:antialiased}
.wire *{box-sizing:border-box}
.wire a{color:inherit;text-decoration:none}
.wire a.hl:hover,.wire a:hover>.hl,.wire a:focus-visible{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.wire .head{font-family:${FONT_HEAD};font-weight:700}
.wire .mono,.wire .when,.wire .fig .v,.wire .rec .v,.wire .ticker,.wire .pill,.wire td.n,.wire .num{font-family:${FONT_MONO};font-variant-numeric:tabular-nums}
.wire .soft{color:var(--soft)}.wire .cut{color:var(--cut)}.wire .rise{color:var(--rise)}.wire .warn{color:var(--warn)}.wire .acc{color:var(--accent)}
.wire .small{font-size:12px}.wire .tiny{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
.wire .wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.wire .top{display:flex;justify-content:space-between;align-items:center;gap:10px 16px;flex-wrap:wrap;padding:14px 0 10px;border-bottom:2px solid var(--fg)}
.wire .brand{font-family:${FONT_HEAD};font-weight:700;font-size:20px;letter-spacing:.02em;text-transform:uppercase;display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:0 12px}
.wire .brand small{font-family:${FONT_SANS};font-weight:400;font-size:12px;color:var(--soft);text-transform:none;letter-spacing:0}
.wire nav.main{display:flex;gap:4px 16px;font-size:13px;color:var(--soft);font-weight:500;align-items:center;flex-wrap:wrap}
.wire nav.main a,.wire nav.main button{color:var(--soft);background:none;border:0;padding:0;font:inherit;cursor:pointer}
.wire nav.main a.on,.wire nav.main a:hover,.wire nav.main button:hover{color:var(--fg)}
.wire nav.main .menu{position:relative}
.wire nav.main .menu>div{position:absolute;right:0;top:calc(100% + 8px);z-index:40;min-width:180px;background:var(--bg2);border:1px solid var(--rule);display:flex;flex-direction:column;padding:6px 0}
.wire nav.main .menu>div a{padding:6px 14px}
.wire .ticker{display:flex;flex-wrap:wrap;border-bottom:1px solid var(--rule);font-size:12.5px;color:var(--soft)}
.wire .ticker>span{padding:8px 16px 8px 0;margin-right:16px;border-right:1px solid var(--rule)}
.wire .ticker>span:last-child{border-right:0;margin-right:0}
.wire .ticker b{font-weight:500;color:var(--fg)}
.wire h1{font-family:${FONT_HEAD};font-weight:700;font-size:clamp(26px,3.6vw,40px);line-height:1.1;letter-spacing:-.015em;margin:6px 0 10px;text-wrap:balance}
.wire .ph{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px 24px;padding:18px 0 14px;border-bottom:1px solid var(--rule)}
.wire .ph h1{font-size:clamp(22px,3vw,30px);margin:0 0 4px}
.wire .ph .deck{margin:0}
.wire .ph .act{display:flex;flex-wrap:wrap;gap:6px}
.wire .kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
.wire .deck{font-size:14.5px;line-height:1.55;color:var(--soft);margin:0 0 6px;max-width:66ch}
.wire .deck a{color:var(--accent)}
.wire p{font-size:14.5px;line-height:1.55;margin:0 0 10px;max-width:66ch}
.wire .fig{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-end;margin:6px 0 12px}
.wire .fig>div{display:flex;flex-direction:column;gap:3px}
.wire .fig .v{font-size:22px;line-height:1}
.wire .fig .v.old{color:var(--soft);text-decoration:line-through;text-decoration-thickness:1px;margin-right:6px}
.wire .fig .l{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
.wire .box{border:1px solid var(--rule);padding:12px 14px;background:var(--bg2)}
.wire .box h3{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft);margin:0 0 6px;font-weight:600;display:flex;justify-content:space-between;gap:8px}
.wire .box>svg{width:100%;height:150px;display:block}
.wire .leg{display:flex;gap:16px;font-family:${FONT_MONO};font-size:12px;color:var(--soft);margin-top:6px;flex-wrap:wrap}
.wire .leg i{display:inline-block;width:10px;height:2px;vertical-align:middle;margin-right:6px}
.wire .tw{overflow-x:auto;max-width:100%}
.wire table{width:100%;border-collapse:collapse;font-size:13.5px}
.wire th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft);text-align:left;font-weight:600;padding:8px 10px 6px 0;border-bottom:2px solid var(--fg);white-space:nowrap}
.wire td{padding:8px 10px 8px 0;border-bottom:1px solid var(--rule);vertical-align:baseline}
.wire td:last-child,.wire th:last-child{padding-right:0}
.wire td.n,.wire th.n{text-align:right;white-space:nowrap}
.wire tr.day th{border-bottom:1px solid var(--rule);padding-top:16px;color:var(--accent)}
.wire tr.dim td{color:var(--soft)}
.wire .when{font-size:12px;color:var(--soft);white-space:nowrap}
.wire .who{color:var(--soft);font-size:12.5px;display:block}
.wire .tag{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft);margin-left:8px}
.wire .tag.acc{color:var(--accent)}
.wire .lead{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:32px;padding:22px 0;border-bottom:1px solid var(--rule)}
.wire .two{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:32px;padding:22px 0}
.wire .three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px;padding:22px 0}
.wire .side{display:flex;flex-direction:column;gap:22px;min-width:0}
@media (max-width:820px){.wire .lead,.wire .two,.wire .three{grid-template-columns:1fr;gap:24px}}
.wire h2{font-family:${FONT_HEAD};font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.wire h2 a,.wire h2 .hint{font-family:${FONT_SANS};font-size:12px;color:var(--soft);font-weight:500;text-transform:none;letter-spacing:0}
.wire h2 a:hover{color:var(--fg)}
.wire section{min-width:0}
.wire .stack{display:flex;flex-direction:column;gap:28px;padding:18px 0}
.wire .pill{font-size:11.5px;padding:1px 6px;border-radius:3px;border:1px solid var(--rule);white-space:nowrap;color:var(--fg)}
.wire .pill.ok{color:var(--cut);border-color:var(--cut)}.wire .pill.warn{color:var(--warn);border-color:var(--warn)}.wire .pill.bad{color:var(--rise);border-color:var(--rise)}.wire .pill.off{color:var(--soft)}.wire .pill.soon{color:var(--rise);border-color:var(--rise)}
.wire .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.wire .chip{display:inline-flex;align-items:center;gap:6px;font:500 12px ${FONT_SANS};color:var(--soft);border:1px solid var(--rule);border-radius:3px;padding:3px 9px;background:none;cursor:pointer;white-space:nowrap}
.wire .chip:hover{color:var(--fg);border-color:var(--soft)}
.wire .chip.on{color:var(--bg);background:var(--fg);border-color:var(--fg)}
.wire input,.wire select{font:inherit;font-size:13px;color:var(--fg);background:var(--bg2);border:1px solid var(--rule);border-radius:3px;padding:4px 8px;min-width:0}
.wire input::placeholder{color:var(--soft)}
.wire input:focus-visible,.wire select:focus-visible,.wire .chip:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.wire .bar{display:inline-block;height:8px;background:var(--rule);vertical-align:middle;position:relative;width:90px}
.wire .bar i{position:absolute;left:0;top:0;bottom:0;background:var(--accent)}
.wire .records{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;padding:18px 0;border-top:2px solid var(--fg)}
@media (max-width:820px){.wire .records{grid-template-columns:1fr 1fr}}
.wire .rec .v{font-size:26px;line-height:1}
.wire .rec .l{font-size:12px;color:var(--soft);margin-top:6px}
.wire .rec a{color:var(--fg)}
.wire .stats{display:flex;flex-wrap:wrap;gap:14px 32px;padding:14px 0}
.wire .stat{min-width:0;max-width:100%}
.wire .stat .v{font-family:${FONT_MONO};font-size:24px;line-height:1;font-variant-numeric:tabular-nums}
.wire .stat .l{font-size:12px;color:var(--soft);margin-top:5px}
.wire .foot{font-size:12px;color:var(--soft);border-top:1px solid var(--rule);padding:12px 0 32px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:24px}
.wire .foot a:hover,.wire .foot button:hover{color:var(--fg)}
.wire .foot button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.wire .days{display:inline-flex;gap:2px;vertical-align:middle;max-width:100%}
.wire .days i{display:block;flex:0 1 5px;min-width:1px;height:12px;border-radius:1px;background:var(--rule)}
@media (max-width:640px){.wire .days{gap:1px}}
.wire .days i.up{background:var(--cut)}.wire .days i.degraded{background:var(--warn)}.wire .days i.down{background:var(--rise)}
.wire .sk{background:var(--bg2);border-radius:2px}
.wire .note{font-size:12.5px;color:var(--soft);line-height:1.5;max-width:66ch}
.wire .skip{position:absolute;left:-9999px}.wire .skip:focus{left:8px;top:8px;z-index:50;background:var(--fg);color:var(--bg);padding:6px 10px}
.wire .dialog{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:10vh 16px}
.wire .dialog>div{width:100%;max-width:560px;background:var(--bg2);border:1px solid var(--rule);max-height:70vh;display:flex;flex-direction:column}
.wire .dialog input{border:0;border-bottom:1px solid var(--rule);background:none;padding:12px 14px;font-size:15px;border-radius:0}
.wire .dialog ul{list-style:none;margin:0;padding:6px 0;overflow:auto}
.wire .dialog li{padding:7px 14px;display:flex;justify-content:space-between;gap:12px;cursor:pointer}
.wire .dialog li[aria-selected="true"]{background:var(--rule)}
.wire .dialog .grp{padding:8px 14px 2px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft)}
.wire kbd{font-family:${FONT_MONO};font-size:11px;border:1px solid var(--rule);border-radius:3px;padding:0 4px;color:var(--soft)}
.wire ul.plain{list-style:none;margin:0;padding:0}
.wire ul.plain li{padding:6px 0;border-bottom:1px solid var(--rule)}
`;

/** Rendered once by the shell. */
export function WireStyles() {
  return <style>{CSS}</style>;
}

/** A page heading with its one-line deck and optional actions on the right. */
export function PageHead(props: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="ph">
      <div style={{ minWidth: 0 }}>
        <h1>{props.title}</h1>
        {props.children ? <p class="deck">{props.children}</p> : null}
      </div>
      {props.action ? <div class="act">{props.action}</div> : null}
    </div>
  );
}

/** A titled block: uppercase heading, a soft hint, and an "All … →" style link on the right. */
export function Section(props: { title: string; hint?: ComponentChildren; action?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <section id={props.id} aria-label={props.title}>
      <h2>
        <span>{props.title}{props.hint ? <span class="hint" style={{ marginLeft: 10 }}>{props.hint}</span> : null}</span>
        {props.action ? <span class="chips">{props.action}</span> : null}
      </h2>
      {props.children}
    </section>
  );
}

/** A small link in a heading's right corner: "All 129 changes →". */
export function More(props: { to?: string; href?: string; children: ComponentChildren }) {
  if (props.href) return <a href={props.href}>{props.children} →</a>;
  return <Link to={props.to ?? "/"}>{props.children} →</Link>;
}

/** A filter or action chip, as a link or a button. */
export function Chip(props: { to?: string; href?: string; onClick?: () => void; active?: boolean; children: ComponentChildren; title?: string; ariaLabel?: string; class?: string }) {
  const cls = `chip${props.active ? " on" : ""}${props.class ? ` ${props.class}` : ""}`;
  if (props.to) return <Link to={props.to} class={cls} title={props.title} aria-current={props.active ? "true" : undefined} aria-label={props.ariaLabel}>{props.children}</Link>;
  if (props.href) return <a href={props.href} class={cls} title={props.title} aria-label={props.ariaLabel}>{props.children}</a>;
  return <button type="button" class={cls} onClick={props.onClick} title={props.title} aria-pressed={props.active === undefined ? undefined : props.active ? "true" : "false"} aria-label={props.ariaLabel}>{props.children}</button>;
}

export function Pill(props: { tone?: PillTone; children: ComponentChildren; title?: string }) {
  return <span class={`pill${props.tone ? ` ${props.tone}` : ""}`} title={props.title}>{props.children}</span>;
}

/** A signed percentage in the colour of its meaning: green when good for a buyer, coral otherwise. */
export function Delta(props: { value: number; good: boolean }) {
  return <span class={`num ${props.good ? "cut" : "rise"}`}>{pct(props.value)}</span>;
}

/** One figure in a lead: label above, struck-through old value and new value below. */
export function Fig(props: { label: string; old?: string; value: ComponentChildren; tone?: "cut" | "rise" | "" }) {
  return (
    <div>
      <span class="l">{props.label}</span>
      <span>
        {props.old ? <span class="v old">{props.old}</span> : null}
        <span class={`v ${props.tone ?? ""}`}>{props.value}</span>
      </span>
    </div>
  );
}

/** A record on the home page's bottom row. */
export function Rec(props: { value: string; label: string; holder?: string; href?: string | null }) {
  return (
    <div class="rec">
      <div class="v">{props.value}</div>
      <div class="l">
        {props.label}
        {props.holder ? <> · {props.href ? <Link to={props.href} class="hl">{props.holder}</Link> : props.holder}</> : null}
      </div>
    </div>
  );
}

/** A headline number with a caption, for a row of them under a page heading. */
export function Stat(props: { value: string; label: string; href?: string; tone?: string }) {
  const body = (
    <>
      <div class={`v ${props.tone ?? ""}`}>{props.value}</div>
      <div class="l">{props.label}</div>
    </>
  );
  return props.href ? <Link to={props.href} class="stat">{body}</Link> : <div class="stat">{body}</div>;
}

export function Empty(props: { children: ComponentChildren }) {
  return <p class="soft" style={{ padding: "10px 0" }}>{props.children}</p>;
}

export function Skeleton(props: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "18px 0" }}>
      <span class="sk" style={{ height: 30, width: "40%" }} />
      {Array.from({ length: props.rows ?? 6 }, (_, i) => <span key={i} class="sk" style={{ height: 16, width: `${90 - (i % 3) * 12}%` }} />)}
    </div>
  );
}

export function TextInput(props: { value: string; onInput: (value: string) => void; placeholder?: string; label: string; type?: string; max?: string; style?: Record<string, string | number> }) {
  return (
    <input
      type={props.type ?? "text"}
      value={props.value}
      max={props.max}
      placeholder={props.placeholder}
      onInput={(e) => props.onInput((e.currentTarget as HTMLInputElement).value)}
      aria-label={props.label}
      style={props.style}
    />
  );
}

export function Select(props: { value: string; onChange: (value: string) => void; children: ComponentChildren; label: string }) {
  return (
    <select value={props.value} onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value)} aria-label={props.label}>
      {props.children}
    </select>
  );
}

/** Ninety small marks, one per day, in the day's colour; dim when nothing was recorded. */
export function UptimeStrip(props: { days: { day: string; state: DayState }[]; label: string }) {
  return (
    <span class="days" role="img" aria-label={props.label}>
      {props.days.map((d) => <i key={d.day} class={d.state} title={`${d.day}: ${d.state === "none" ? "no record" : d.state}`} />)}
    </span>
  );
}

const KIND_WORD: Record<string, { word: string; tone: PillTone }> = {
  listed: { word: "new", tone: "ok" },
  delisted: { word: "removed", tone: "bad" },
  relisted: { word: "back", tone: "ok" },
  retiring: { word: "retiring", tone: "bad" },
  expiring: { word: "expiring", tone: "bad" },
  retired: { word: "retired", tone: "off" },
  repointed: { word: "alias moved", tone: "warn" },
  hosted: { word: "new host", tone: "ok" },
  unhosted: { word: "host gone", tone: "warn" },
  renamed: { word: "renamed", tone: undefined },
  capabilities: { word: "capabilities", tone: undefined },
  drift: { word: "small", tone: "off" },
};

/** A story as one table row: time, headline with its numbers under it, and the change on the right. */
export function StoryRow(props: { story: Story; href: string | null; date?: boolean; showMore?: boolean }) {
  const s = props.story;
  const delta = storyDelta(s);
  const priced = delta !== null && (s.kind === "repriced" || s.kind === "resized");
  const word = KIND_WORD[s.kind];
  const extra = props.showMore ? [s.detail, ...s.more].filter(Boolean).join(" · ") : s.detail;
  return (
    <tr data-feed-row class={s.kind === "drift" ? "dim" : undefined}>
      <td class="when">{props.date ? `${dayShort(s.at)} ${hm(s.at)}` : hm(s.at)}</td>
      <td>
        {props.href ? <Link to={props.href} class="hl">{s.headline}</Link> : s.headline}
        {s.source && s.source !== "hosts" ? <span class="tag">notice</span> : null}
        {s.confirmedBy?.length ? <span class="tag acc" title={`Also recorded by ${s.confirmedBy.join(", ")}`}>confirmed</span> : null}
        {extra || (!props.showMore && s.more.length) ? (
          <span class="who num">{extra}{!props.showMore && s.more.length ? (extra ? ` +${s.more.length}` : `+${s.more.length} more`) : ""}</span>
        ) : null}
      </td>
      <td class="n">{priced ? <Delta value={delta} good={deltaIsGood(s, delta)} /> : word ? <Pill tone={word.tone}>{word.word}</Pill> : null}</td>
    </tr>
  );
}

/** The three-column table stories sit in. Rows come from `StoryRow`; day headings from `DayRow`. */
export function StoryTable(props: { children: ComponentChildren; label?: string }) {
  return (
    <div class="tw">
      <table aria-label={props.label}>
        <thead><tr><th>Time</th><th>Change</th><th class="n">Δ</th></tr></thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

export function DayRow(props: { children: ComponentChildren; span?: number }) {
  return <tr class="day"><th colSpan={props.span ?? 3}>{props.children}</th></tr>;
}

export type LineSeries = { label: string; color: string; values: number[] };

/** A small line chart in a box: a few series over the same x positions, with three y ticks. */
export function LineChart(props: { title: string; hint?: string; series: LineSeries[]; left?: string; right?: string; format: (v: number) => string; height?: number }) {
  const W = 520;
  const H = props.height ?? 150;
  const all = props.series.flatMap((s) => s.values).filter(Number.isFinite);
  if (all.length === 0) return <div class="box"><h3><span>{props.title}</span></h3><p class="note">Not enough days recorded yet.</p></div>;
  const max = Math.max(...all) * 1.08 || 1;
  const min = 0;
  const toY = (v: number) => H - 18 - ((v - min) / (max - min)) * (H - 30);
  const n = Math.max(...props.series.map((s) => s.values.length));
  const toX = (i: number) => 40 + (n > 1 ? i * ((W - 50) / (n - 1)) : 0);
  // Round tick steps: 1, 2 or 5 times a power of ten, so the axis reads $0.50, $1.00, $2.00.
  const rough = max / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const ticks = [1, 2, 3, 4].map((i) => i * step).filter((t) => t <= max);
  return (
    <div class="box">
      <h3><span>{props.title}</span>{props.hint ? <span>{props.hint}</span> : null}</h3>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.title}>
        <g font-family={FONT_MONO} font-size="10" fill="#9a958a">
          {ticks.map((t) => <text key={t} x="0" y={toY(t) + 3}>{props.format(t)}</text>)}
          {props.left ? <text x="40" y={H - 4}>{props.left}</text> : null}
          {props.right ? <text x={W - 10} y={H - 4} text-anchor="end">{props.right}</text> : null}
        </g>
        <g stroke="#2c2d29" stroke-dasharray="2 3">
          {ticks.map((t) => <line key={t} x1="40" x2={W - 10} y1={toY(t)} y2={toY(t)} />)}
        </g>
        {props.series.map((s) => (
          <path
            key={s.label}
            // A day with no figure (NaN) leaves a gap; the line picks up again at the next figure.
            d={s.values.map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(s.values[i - 1]) ? "L" : "M"}${toX(i).toFixed(1)} ${toY(v).toFixed(1)}` : "")).filter(Boolean).join(" ")}
            fill="none"
            stroke={s.color}
            stroke-width="1.6"
          />
        ))}
      </svg>
      <div class="leg">
        {props.series.map((s) => {
          const last = s.values[s.values.length - 1];
          return <span key={s.label}><i style={{ background: s.color }} />{s.label} {s.values.length ? (Number.isFinite(last) ? props.format(last) : "–") : ""}</span>;
        })}
      </div>
    </div>
  );
}
