/**
 * Split-flap display cells, the way a Solari departures board shows letters. Every cell is a
 * real character in a box; when it changes it rattles through a few intermediate letters,
 * each one flipping the top half down. Text is always present for assistive tech and search;
 * the flaps are decoration on top of it.
 */
import { Component, h, type ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Link } from "@spacefast/zero/client";

import { click } from "../lib/sound";
import { prefersReducedMotion } from "../lib/util";

export const ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-+%$/▲▼";
const TICK_MS = 40;

/** The board face. Set explicitly because the theme's typography does not reach the compiled CSS. */
export const BOARD_FONT = "'Barlow Condensed', 'Arial Narrow', Impact, sans-serif";

export type FlapTone = "ink" | "muted" | "success" | "warning" | "danger" | "accent";
export type FlapSize = "sm" | "md" | "lg";
export type FlapAlign = "left" | "right" | "center";

const SIZE: Record<FlapSize, { w: number; h: number; font: number; gap: number }> = {
  sm: { w: 10, h: 18, font: 14, gap: 1 },
  md: { w: 13, h: 26, font: 20, gap: 2 },
  lg: { w: 20, h: 38, font: 30, gap: 2 },
};

/** Pixel width of `cells` cells at a size, so plain-text headers can line up with flap columns. */
export function columnWidth(cells: number, size: FlapSize = "md"): number {
  const s = SIZE[size];
  return cells * (s.w + s.gap) - s.gap;
}

export function toneClass(tone: FlapTone): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "danger":
      return "text-danger";
    case "accent":
      return "text-accent";
    case "muted":
      return "text-ink-muted";
    default:
      return "text-ink";
  }
}

/** Keyframes the cells animate with. Rendered once by the shell. */
export function FlapStyles() {
  const css = `
@keyframes flapTop { from { transform: rotateX(0deg); } to { transform: rotateX(-90deg); } }
@keyframes flapBottom { from { transform: rotateX(90deg); } to { transform: rotateX(0deg); } }
`;
  return <style>{css}</style>;
}

/** The letters a flap wheel passes on its way from one character to another, ending on the target. */
function path(from: string, to: string): string[] {
  const a = ALPHABET.indexOf(from);
  const b = ALPHABET.indexOf(to);
  if (a === -1 || b === -1) return [to];
  const length = ALPHABET.length;
  const distance = (b - a + length) % length;
  if (distance === 0) return [];
  const steps = Math.min(4, Math.max(2, distance));
  const out: string[] = [];
  for (let k = 1; k <= steps; k++) {
    out.push(ALPHABET[(a + Math.round((distance * k) / steps)) % length]);
  }
  out[out.length - 1] = to;
  return out;
}

/**
 * Animation runs outside Preact. One frame loop owns every cell that is mid-flip, writes the
 * letters into the DOM itself and drives the flips with the Web Animations API, so a board of
 * three thousand cells costs no renders while it rattles. A cell renders once and only re-renders
 * when its target changes, which just retargets its registry entry.
 */
type Entry = {
  top: HTMLElement;
  bottom: HTMLElement;
  flipTop: HTMLElement;
  flipTopGlyph: HTMLElement;
  flipBottom: HTMLElement;
  flipBottomGlyph: HTMLElement;
  target: string;
  shown: string;
  queue: string[];
  startAt: number;
  animTop: Animation | null;
  animBottom: Animation | null;
};

const registry = new Set<Entry>();
let frame = 0;
let lastTick = 0;
/** Above this many cells mid-flip, the rest jump straight to their letter so a boot stays quick. */
const BUSY = 400;
const FLIP_MS = 18;
const TOP_KEYFRAMES = [{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }];
const BOTTOM_KEYFRAMES = [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }];

function advance(entry: Entry) {
  const next = entry.queue.shift();
  if (next === undefined) return;
  const prev = entry.shown;
  entry.shown = next;
  entry.top.textContent = next;
  entry.bottom.textContent = prev;
  entry.flipTopGlyph.textContent = prev;
  entry.flipBottomGlyph.textContent = next;
  entry.flipTop.style.visibility = "visible";
  entry.flipBottom.style.visibility = "visible";
  entry.animTop?.cancel();
  entry.animBottom?.cancel();
  if (typeof entry.flipTop.animate === "function") {
    entry.animTop = entry.flipTop.animate(TOP_KEYFRAMES, { duration: FLIP_MS, fill: "forwards", easing: "ease-in" });
    entry.animBottom = entry.flipBottom.animate(BOTTOM_KEYFRAMES, { duration: FLIP_MS, delay: FLIP_MS, fill: "both", easing: "ease-out" });
  } else {
    entry.bottom.textContent = next;
  }
}

function tick(now: number) {
  frame = registry.size ? requestAnimationFrame(tick) : 0;
  if (now - lastTick < TICK_MS) return;
  lastTick = now;
  const busy = registry.size > BUSY;
  let clicked = false;
  for (const entry of registry) {
    if (now < entry.startAt) continue;
    if (entry.queue.length === 0) {
      if (entry.shown === entry.target) {
        registry.delete(entry);
        continue;
      }
      entry.queue = busy ? [entry.target] : path(entry.shown, entry.target);
    }
    advance(entry);
    if (!clicked) {
      click();
      clicked = true;
    }
    if (entry.shown === entry.target && entry.queue.length === 0) registry.delete(entry);
  }
}

function schedule(entry: Entry) {
  registry.add(entry);
  if (!frame) frame = requestAnimationFrame(tick);
}

/** Writes a letter with no animation, for reduced motion and for unmounted cells. */
function settle(entry: Entry, ch: string) {
  entry.queue = [];
  entry.shown = ch;
  entry.animTop?.cancel();
  entry.animBottom?.cancel();
  entry.animTop = null;
  entry.animBottom = null;
  entry.flipTop.style.visibility = "hidden";
  entry.flipBottom.style.visibility = "hidden";
  entry.top.textContent = ch;
  entry.bottom.textContent = ch;
}

const FACE = "linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 48%, #151515 52%, #1b1b1b 100%)";

function FlapCellInner(props: { target: string; size: FlapSize; delay: number }) {
  const s = SIZE[props.size];
  const half = s.h / 2;
  const top = useRef<HTMLSpanElement>(null);
  const bottom = useRef<HTMLSpanElement>(null);
  const flipTop = useRef<HTMLSpanElement>(null);
  const flipTopGlyph = useRef<HTMLSpanElement>(null);
  const flipBottom = useRef<HTMLSpanElement>(null);
  const flipBottomGlyph = useRef<HTMLSpanElement>(null);
  const entry = useRef<Entry | null>(null);

  useEffect(() => {
    if (!top.current || !bottom.current || !flipTop.current || !flipTopGlyph.current || !flipBottom.current || !flipBottomGlyph.current) return;
    if (!entry.current) {
      entry.current = {
        top: top.current, bottom: bottom.current, flipTop: flipTop.current, flipTopGlyph: flipTopGlyph.current,
        flipBottom: flipBottom.current, flipBottomGlyph: flipBottomGlyph.current,
        target: " ", shown: " ", queue: [], startAt: 0, animTop: null, animBottom: null,
      };
    }
    const e = entry.current;
    e.target = props.target;
    if (e.shown === e.target) {
      registry.delete(e);
      return;
    }
    if (prefersReducedMotion()) {
      settle(e, props.target);
      registry.delete(e);
      return;
    }
    // A retarget mid-flip keeps the letter on show and plans a fresh path from it.
    e.queue = [];
    if (!registry.has(e)) e.startAt = performance.now() + props.delay;
    schedule(e);
  }, [props.target, props.delay]);

  useEffect(() => () => { if (entry.current) registry.delete(entry.current); }, []);

  const glyphStyle = (isTop: boolean) => ({ height: `${s.h}px`, lineHeight: `${s.h}px`, marginTop: isTop ? 0 : `-${half}px` });
  return (
    <span
      class="relative inline-block shrink-0 overflow-hidden rounded-[2px] font-semibold uppercase tabular-nums"
      style={{ width: `${s.w}px`, height: `${s.h}px`, fontSize: `${s.font}px`, perspective: "160px", background: FACE, fontFamily: BOARD_FONT }}
    >
      <span class="absolute inset-x-0 top-0 overflow-hidden" style={{ height: `${half}px` }}>
        <span ref={top} class="block text-center" style={glyphStyle(true)}>{" "}</span>
      </span>
      <span class="absolute inset-x-0 bottom-0 overflow-hidden" style={{ height: `${half}px` }}>
        <span ref={bottom} class="block text-center" style={glyphStyle(false)}>{" "}</span>
      </span>
      <span ref={flipTop} class="absolute inset-x-0 top-0 overflow-hidden" style={{ height: `${half}px`, background: FACE, transformOrigin: "bottom", backfaceVisibility: "hidden", visibility: "hidden" }}>
        <span ref={flipTopGlyph} class="block text-center" style={glyphStyle(true)}>{" "}</span>
      </span>
      <span ref={flipBottom} class="absolute inset-x-0 bottom-0 overflow-hidden" style={{ height: `${half}px`, background: FACE, transformOrigin: "top", backfaceVisibility: "hidden", visibility: "hidden" }}>
        <span ref={flipBottomGlyph} class="block text-center" style={glyphStyle(false)}>{" "}</span>
      </span>
      <span class="absolute inset-x-0 bg-canvas/90" style={{ top: `${half}px`, height: "1px" }} />
    </span>
  );
}

/** Re-renders a function component only when `equal` says its props changed. */
function memo<P extends object>(Inner: (props: P) => ComponentChildren, equal: (a: P, b: P) => boolean) {
  return class Memo extends Component<P> {
    shouldComponentUpdate(next: P) {
      return !equal(this.props, next);
    }
    render() {
      return h(Inner as any, this.props as any);
    }
  };
}

const FlapCell = memo(FlapCellInner, (a, b) => a.target === b.target && a.size === b.size && a.delay === b.delay);

/** Uppercases, truncates and pads text to a fixed number of cells. */
export function fit(text: string, width: number, align: FlapAlign = "left"): string[] {
  const upper = (text ?? "").toUpperCase().replace(/[−–—]/g, "-").replace(/\s+/g, " ").trim();
  const cut = upper.length > width ? upper.slice(0, width) : upper;
  const pad = width - cut.length;
  const left = align === "right" ? pad : align === "center" ? Math.floor(pad / 2) : 0;
  const right = pad - left;
  return [...(" ".repeat(left) + cut + " ".repeat(right))];
}

export type FlapTextProps = {
  text: string;
  width: number;
  align?: FlapAlign;
  tone?: FlapTone;
  size?: FlapSize;
  /** Milliseconds before the first cell starts; cells ripple left to right from there. */
  delay?: number;
  stagger?: number;
  class?: string;
};

/** A run of cells spelling `text`, with the plain text kept for screen readers. */
function FlapTextInner(props: FlapTextProps) {
  const size = props.size ?? "md";
  const chars = fit(props.text, props.width, props.align);
  const stagger = props.stagger ?? 8;
  return (
    <span class={`inline-flex items-center ${toneClass(props.tone ?? "ink")} ${props.class ?? ""}`} style={{ gap: `${SIZE[size].gap}px` }}>
      <span aria-hidden="true" class="inline-flex items-center" style={{ gap: `${SIZE[size].gap}px` }}>
        {chars.map((ch, i) => (
          <FlapCell key={i} target={ch} size={size} delay={(props.delay ?? 0) + i * stagger} />
        ))}
      </span>
      <span class="sr-only">{props.text}</span>
    </span>
  );
}

export const FlapText = memo(
  FlapTextInner,
  (a, b) => a.text === b.text && a.width === b.width && a.tone === b.tone && a.size === b.size && a.align === b.align && a.delay === b.delay && a.stagger === b.stagger && a.class === b.class,
);

export type FlapColumn = {
  text: string;
  width: number;
  align?: FlapAlign;
  tone?: FlapTone;
  /** Stays visible while the row scrolls sideways on a narrow screen. */
  sticky?: boolean;
  /** Something other than flaps in this column, such as an uptime strip. */
  render?: ComponentChildren;
};

export type FlapRowProps = {
  columns: FlapColumn[];
  /** Where the row goes on click; without it the row is static. */
  href?: string | null;
  /** The plain sentence a screen reader gets for the whole row. */
  label: string;
  tone?: FlapTone;
  size?: FlapSize;
  delay?: number;
  class?: string;
};

const ROW = "flex w-max min-w-full items-center gap-4 border-b border-line/70 px-3 py-1.5 last:border-0 outline-none focus-visible:outline-2 focus-visible:outline-accent";

/** One line of a board. Sticky columns are wrapped together so the model name survives a sideways scroll. */
function FlapRowInner(props: FlapRowProps) {
  const size = props.size ?? "md";
  const sticky = props.columns.filter((c) => c.sticky);
  const rest = props.columns.filter((c) => !c.sticky);
  const cell = (c: FlapColumn, i: number) => (
    <span key={i} class="shrink-0" style={{ width: `${columnWidth(c.width, size)}px` }}>
      {c.render ?? <FlapText text={c.text} width={c.width} align={c.align} tone={c.tone ?? props.tone} size={size} delay={props.delay} />}
    </span>
  );
  const body = (
    <>
      {sticky.length ? (
        <span class="sticky left-0 z-10 flex shrink-0 items-center gap-4 bg-surface pr-2">{sticky.map(cell)}</span>
      ) : null}
      {rest.map(cell)}
    </>
  );
  const cls = `${ROW} ${props.href ? "hover:bg-flap/40" : ""} ${props.class ?? ""}`;
  if (props.href) {
    return (
      <Link to={props.href} class={cls} aria-label={props.label} data-feed-row>
        {body}
      </Link>
    );
  }
  return (
    <div class={cls} role="row" aria-label={props.label} tabIndex={0} data-feed-row>
      {body}
    </div>
  );
}

function sameColumns(a: FlapColumn[], b: FlapColumn[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.text !== y.text || x.width !== y.width || x.tone !== y.tone || x.align !== y.align || x.sticky !== y.sticky || (x.render === undefined) !== (y.render === undefined)) return false;
    // A custom render (the uptime strip) is re-rendered whenever the row is; its parent decides.
    if (x.render !== undefined && x.render !== y.render) return false;
  }
  return true;
}

export const FlapRow = memo(
  FlapRowInner,
  (a, b) => a.href === b.href && a.label === b.label && a.tone === b.tone && a.size === b.size && a.delay === b.delay && a.class === b.class && sameColumns(a.columns, b.columns),
);

/** Dim column captions that line up with the flap columns beneath them. */
export function ColumnHeads(props: { columns: { label: string; width: number; align?: FlapAlign; sticky?: boolean }[]; size?: FlapSize }) {
  const size = props.size ?? "md";
  const sticky = props.columns.filter((c) => c.sticky);
  const rest = props.columns.filter((c) => !c.sticky);
  const head = (c: { label: string; width: number; align?: FlapAlign }, i: number) => (
    <span key={i} class={`shrink-0 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}`} style={{ width: `${columnWidth(c.width, size)}px` }}>
      {c.label}
    </span>
  );
  return (
    <div class="flex w-max min-w-full items-center gap-4 border-b border-line bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.25em] text-ink-muted" aria-hidden="true">
      {sticky.length ? <span class="sticky left-0 z-10 flex shrink-0 items-center gap-4 bg-surface pr-2">{sticky.map(head)}</span> : null}
      {rest.map(head)}
    </div>
  );
}

/** A board: a dark panel with a stencil label on its rail, column captions, and flap rows. */
export function Board(props: { label: string; hint?: string; action?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <section id={props.id} class="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.5)]" aria-label={props.label}>
      <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-flap px-3 py-2">
        <div class="flex items-baseline gap-3">
          <h2 class="text-sm font-bold uppercase tracking-[0.4em] text-accent [text-shadow:0_0_14px_rgba(255,176,0,0.45)]">{props.label}</h2>
          {props.hint ? <span class="text-[11px] uppercase tracking-[0.2em] text-ink-muted">{props.hint}</span> : null}
        </div>
        {props.action ? <div class="text-[11px] uppercase tracking-[0.2em]">{props.action}</div> : null}
      </header>
      <div class="max-w-full overflow-x-auto">{props.children}</div>
    </section>
  );
}

/** A link styled as a small backlit sign, for board actions and navigation. */
export function Sign(props: { to?: string; href?: string; onClick?: () => void; active?: boolean; children: ComponentChildren; class?: string; title?: string; ariaLabel?: string }) {
  const look = props.active
    ? "border-accent bg-accent text-canvas"
    : "border-line bg-flap text-ink-muted hover:border-ink-muted hover:text-ink";
  const cls = `inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors ${look} ${props.class ?? ""}`;
  const font = { fontFamily: BOARD_FONT };
  if (props.to) {
    return <Link to={props.to} class={cls} style={font} title={props.title} aria-current={props.active ? "page" : undefined}>{props.children}</Link>;
  }
  if (props.href) {
    return <a href={props.href} class={cls} style={font} title={props.title}>{props.children}</a>;
  }
  return (
    <button type="button" class={cls} style={font} onClick={props.onClick} title={props.title} aria-pressed={props.active === undefined ? undefined : props.active ? "true" : "false"} aria-label={props.ariaLabel}>
      {props.children}
    </button>
  );
}
