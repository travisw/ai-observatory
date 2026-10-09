/**
 * The quieter half of the hall: the logbook. Ruled rows in the board's condensed type, mono
 * numbers, amber rules. Boards shout the few things that matter; the log keeps everything.
 * Also the brass plaque, stencil toggles, readouts, and the blank-flap skeletons.
 */
import type { ComponentChildren } from "preact";
import { Link } from "@spacefast/zero/client";

import type { Story } from "../../shared/stories";
import { boardPct, boardTime } from "../lib/board";
import { deltaIsGood, storyDelta } from "../lib/stories";
import { FlapText, columnWidth, type FlapSize, type FlapTone } from "./Flap";

/** A section of the log: stencil heading, dim hint, optional action, amber rule. */
export function LogSection(props: { title: string; hint?: ComponentChildren; action?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <section id={props.id} class="flex flex-col gap-3" aria-label={props.title}>
      <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-accent/40 pb-2">
        <h2 class="text-sm font-bold uppercase tracking-[0.4em] text-ink">
          {props.title}
          {props.hint ? <span class="ml-3 font-normal normal-case tracking-normal text-ink-muted">{props.hint}</span> : null}
        </h2>
        {props.action ? <div class="flex flex-wrap items-center gap-1.5">{props.action}</div> : null}
      </header>
      {props.children}
    </section>
  );
}

/** A ruled log line: a narrow left cell, the sentence, a right-aligned mono readout. */
export function LogLine(props: { left?: ComponentChildren; children: ComponentChildren; right?: ComponentChildren; dim?: boolean; class?: string }) {
  return (
    <li class={`grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-x-3 border-b border-dotted border-line py-1.5 last:border-0 ${props.dim ? "opacity-60" : ""} ${props.class ?? ""}`} data-feed-row>
      <span class="font-mono text-xs tabular-nums text-ink-muted">{props.left}</span>
      <span class="min-w-0 text-[15px] text-ink">{props.children}</span>
      <span class="font-mono text-xs tabular-nums">{props.right}</span>
    </li>
  );
}

/** A day heading inside a log. */
export function LogDay(props: { children: ComponentChildren }) {
  return <h3 class="sticky top-0 z-10 bg-canvas/95 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-accent backdrop-blur">{props.children}</h3>;
}

const KIND_WORD: Record<string, { word: string; tone: string }> = {
  delisted: { word: "CANCELLED", tone: "text-danger" },
  listed: { word: "ARRIVED", tone: "text-success" },
  relisted: { word: "RETURNED", tone: "text-success" },
  retiring: { word: "DEPARTING", tone: "text-danger" },
  expiring: { word: "DEPARTING", tone: "text-danger" },
  retired: { word: "DEPARTED", tone: "text-danger" },
  repointed: { word: "REROUTED", tone: "text-warning" },
  hosted: { word: "NEW HOST", tone: "text-success" },
  unhosted: { word: "HOST GONE", tone: "text-warning" },
  drift: { word: "SMALL", tone: "text-ink-muted" },
};

/** A story as one log line: time, headline (linked when we track the model), numbers, a status word. */
export function StoryLine(props: { story: Story; href: string | null; showMore?: boolean; date?: boolean }) {
  const s = props.story;
  const delta = storyDelta(s);
  const priced = delta !== null && (s.kind === "repriced" || s.kind === "resized");
  const word = KIND_WORD[s.kind];
  const right = priced ? (
    <span class={deltaIsGood(s, delta) ? "text-success" : "text-warning"}>{boardPct(delta)}</span>
  ) : word ? (
    <span class={word.tone}>{word.word}</span>
  ) : null;
  const extra = props.showMore ? [s.detail, ...s.more].filter(Boolean).join(" · ") : s.detail;
  return (
    <LogLine left={props.date ? s.at.slice(5, 10).replace("-", "/") + " " + boardTime(s.at) : boardTime(s.at)} right={right} dim={s.kind === "drift"}>
      {props.href ? <Link to={props.href} class="hover:text-accent">{s.headline}</Link> : s.headline}
      {s.source && s.source !== "hosts" ? <span class="ml-2 text-xs uppercase tracking-[0.15em] text-ink-muted">notice</span> : null}
      {s.confirmedBy?.length ? <span class="ml-2 text-xs uppercase tracking-[0.15em] text-accent" title={`Also recorded by ${s.confirmedBy.join(", ")}`}>confirmed</span> : null}
      {extra ? <span class="ml-2 font-mono text-xs tabular-nums text-ink-muted">{extra}</span> : null}
      {!props.showMore && s.more.length ? <span class="ml-1 font-mono text-xs text-ink-muted/70">+{s.more.length}</span> : null}
    </LogLine>
  );
}

/** A small stencil toggle, as a link or a button. */
export function Stencil(props: { active?: boolean; href?: string; onClick?: () => void; children: ComponentChildren; title?: string }) {
  const cls = `rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] ${props.active ? "border-accent text-accent" : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"}`;
  if (props.href) {
    return <Link to={props.href} class={cls} title={props.title} aria-current={props.active ? "true" : undefined}>{props.children}</Link>;
  }
  return <button type="button" class={cls} onClick={props.onClick} title={props.title} aria-pressed={props.active ? "true" : "false"}>{props.children}</button>;
}

/** The brass plaque: a footnote or a takeaway, lit from behind. */
export function Plaque(props: { children: ComponentChildren; class?: string }) {
  return (
    <div class={`rounded-sm border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink shadow-[inset_0_1px_0_rgba(255,176,0,0.25)] ${props.class ?? ""}`}>
      {props.children}
    </div>
  );
}

/** A label over a flap readout, for headline numbers. */
export function Readout(props: { label: string; value: string; width: number; tone?: FlapTone; size?: FlapSize; href?: string; sub?: ComponentChildren; tag?: string; delay?: number; ariaLabel?: string }) {
  const body = (
    <>
      <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">{props.label}</span>
      <span class="flex flex-wrap items-center gap-2">
        <FlapText text={props.value} width={props.width} size={props.size ?? "lg"} tone={props.tone} delay={props.delay} />
        {props.tag ? <span class="rounded-sm border border-accent/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-accent">{props.tag}</span> : null}
      </span>
      {props.sub ? <span class="text-xs text-ink-muted">{props.sub}</span> : null}
    </>
  );
  if (props.href) return <Link to={props.href} class="flex flex-col gap-1.5" aria-label={props.ariaLabel}>{body}</Link>;
  return <div class="flex flex-col gap-1.5" aria-label={props.ariaLabel}>{body}</div>;
}

/** A sign-styled select, for the few places a dropdown is the right control. */
export function SignSelect(props: { value: string; onChange: (value: string) => void; children: ComponentChildren; label: string }) {
  return (
    <select
      class="rounded-sm border border-line bg-flap px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted hover:border-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      value={props.value}
      onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value)}
      aria-label={props.label}
    >
      {props.children}
    </select>
  );
}

/** A sign-styled text input. */
export function SignInput(props: { value: string; onInput: (value: string) => void; placeholder?: string; label: string; type?: string; max?: string; class?: string }) {
  return (
    <input
      type={props.type ?? "text"}
      class={`rounded-sm border border-line bg-flap px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent ${props.class ?? ""}`}
      value={props.value}
      max={props.max}
      placeholder={props.placeholder}
      onInput={(e) => props.onInput((e.currentTarget as HTMLInputElement).value)}
      aria-label={props.label}
    />
  );
}

/** Blank flap rows while a board loads. */
export function BoardSkeleton(props: { rows?: number; cells?: number; size?: FlapSize }) {
  const rows = props.rows ?? 4;
  const cells = props.cells ?? 48;
  return (
    <div class="flex flex-col" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="border-b border-line/70 px-3 py-1.5 last:border-0">
          <span class="block rounded-[2px] bg-flap" style={{ width: `${columnWidth(cells, props.size ?? "md")}px`, height: props.size === "sm" ? "18px" : props.size === "lg" ? "38px" : "26px" }} />
        </div>
      ))}
    </div>
  );
}

/** A whole-page placeholder: a few blank boards. */
export function PageSkeleton() {
  return (
    <div class="flex flex-col gap-8" aria-busy="true">
      <span class="block h-10 w-2/3 max-w-lg rounded-[2px] bg-flap" />
      {[0, 1].map((i) => (
        <div key={i} class="rounded-md border border-line bg-surface"><BoardSkeleton rows={5} /></div>
      ))}
    </div>
  );
}

/** An empty board: one dim line of letters. */
export function BoardEmpty(props: { children: string }) {
  return (
    <p class="px-3 py-4 text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-muted">{props.children}</p>
  );
}

/** A page heading in the hall's voice. */
export function Marquee(props: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex max-w-3xl flex-col gap-2">
        <h1 class="text-3xl font-bold uppercase tracking-[0.3em] text-ink [text-shadow:0_0_18px_rgba(243,233,207,0.3)]">{props.title}</h1>
        {props.children ? <div class="text-sm text-ink-muted">{props.children}</div> : null}
      </div>
      {props.action ? <div class="flex flex-wrap items-center gap-1.5">{props.action}</div> : null}
    </div>
  );
}
