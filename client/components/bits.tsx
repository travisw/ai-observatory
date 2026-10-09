/**
 * Small visual atoms used everywhere: sections, glyph squares, delta chips, chips, links.
 * Tone classes are spelled out in full so the compiler can see every class it must ship.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Link } from "@spacefast/zero/client";
import { Icon } from "@spacefast/zero/kit";

import { modelName, providerName } from "../../shared/providers";
import type { Tone } from "../lib/stories";
import { copyText, modelHref, providerHref, signedPct } from "../lib/util";

export function Section(props: { title: string; hint?: ComponentChildren; action?: ComponentChildren; id?: string; children: ComponentChildren; class?: string }) {
  return (
    <section id={props.id} class={`flex flex-col gap-3 ${props.class ?? ""}`}>
      <header class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="text-xl font-semibold tracking-tight text-ink">{props.title}</h2>
          {props.hint ? <span class="text-sm text-ink-muted">{props.hint}</span> : null}
        </div>
        {props.action ? <div class="text-sm">{props.action}</div> : null}
      </header>
      {props.children}
    </section>
  );
}

export function Card(props: { children: ComponentChildren; class?: string; padded?: boolean }) {
  return <div class={`rounded-xl border border-line bg-surface ${props.padded === false ? "" : "p-4"} ${props.class ?? ""}`}>{props.children}</div>;
}

export function toneText(tone: Tone): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "danger":
      return "text-danger";
    case "accent":
      return "text-accent";
    default:
      return "text-ink-muted";
  }
}

function toneSquare(tone: Tone): string {
  switch (tone) {
    case "success":
      return "bg-success/15 text-success";
    case "warning":
      return "bg-warning/15 text-warning";
    case "danger":
      return "bg-danger/15 text-danger";
    case "accent":
      return "bg-accent/15 text-accent";
    default:
      return "bg-ink/10 text-ink-muted";
  }
}

/** A glyph on a tinted square, so the kind of change reads without relying on hue. */
export function Glyph(props: { glyph: string; tone: Tone; label?: string; size?: "sm" | "md" }) {
  const size = props.size === "sm" ? "size-5 text-[11px]" : "size-6 text-xs";
  return (
    <span class={`inline-flex shrink-0 items-center justify-center rounded-md font-mono font-semibold ${size} ${toneSquare(props.tone)}`} aria-label={props.label} role={props.label ? "img" : undefined} aria-hidden={props.label ? undefined : "true"}>
      {props.glyph}
    </span>
  );
}

/** "▼ −56%" in the buyer's colour. Always carries the sign and arrow. */
export function DeltaChip(props: { value: number; good: boolean; title?: string; size?: "sm" | "md" }) {
  const tone = props.good ? "bg-success/15 text-success" : "bg-warning/15 text-warning";
  const pad = props.size === "sm" ? "px-1.5 py-0 text-[11px]" : "px-2 py-0.5 text-xs";
  return (
    <span class={`inline-flex items-center gap-1 rounded-md font-mono font-medium tabular-nums ${pad} ${tone}`} title={props.title}>
      <span aria-hidden="true">{props.value < 0 ? "▼" : "▲"}</span>
      {signedPct(props.value)}
    </span>
  );
}

/** A filter chip: a link when `href` is set, a button otherwise. */
export function Chip(props: { active?: boolean; href?: string; onClick?: () => void; children: ComponentChildren; title?: string }) {
  const look = props.active
    ? "border-accent bg-accent/15 text-accent"
    : "border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink";
  const cls = `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${look}`;
  if (props.href) {
    return (
      <Link to={props.href} class={cls} title={props.title} aria-current={props.active ? "true" : undefined}>
        {props.children}
      </Link>
    );
  }
  return (
    <button type="button" class={cls} onClick={props.onClick} title={props.title} aria-pressed={props.active ? "true" : "false"}>
      {props.children}
    </button>
  );
}

export function CopyButton(props: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-xs text-ink-muted hover:border-ink-muted hover:text-ink"
      onClick={() => copyText(props.text).then((ok) => { setDone(ok); setTimeout(() => setDone(false), 1500); })}
      aria-label={props.label ?? `Copy ${props.text}`}
    >
      <Icon name={done ? "check" : "copy"} size="sm" />
      {done ? "copied" : props.label ?? "copy"}
    </button>
  );
}

export function ModelLink(props: { modelId: string; name?: string; withProvider?: boolean; class?: string }) {
  return (
    <Link to={modelHref(props.modelId)} class={`hover:text-accent hover:underline ${props.class ?? "text-ink"}`}>
      {props.withProvider ? <span class="text-ink-muted">{providerName(props.modelId.split("/")[0])} </span> : null}
      {modelName(props.modelId, props.name)}
    </Link>
  );
}

export function ProviderLink(props: { slug: string; class?: string }) {
  return (
    <Link to={providerHref(props.slug)} class={`hover:text-accent hover:underline ${props.class ?? "text-ink"}`}>
      {providerName(props.slug)}
    </Link>
  );
}

export function Muted(props: { children: ComponentChildren; class?: string }) {
  return <span class={`text-ink-muted ${props.class ?? ""}`}>{props.children}</span>;
}

export function Mono(props: { children: ComponentChildren; class?: string }) {
  return <span class={`font-mono tabular-nums ${props.class ?? ""}`}>{props.children}</span>;
}

/** Visually hidden text, for chart summaries a screen reader should still get. */
export function Hidden(props: { children: ComponentChildren }) {
  return <span class="sr-only">{props.children}</span>;
}

export function Prose(props: { children: ComponentChildren; class?: string }) {
  return <div class={`flex max-w-3xl flex-col gap-3 text-sm leading-relaxed text-ink ${props.class ?? ""}`}>{props.children}</div>;
}

export function ExternalLink(props: { href: string; children: ComponentChildren }) {
  return (
    <a href={props.href} target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-accent hover:underline">
      {props.children}
      <Icon name="external-link" size="sm" />
    </a>
  );
}
