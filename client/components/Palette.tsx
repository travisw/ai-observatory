/**
 * The ⌘K palette: one box that finds any model, provider, page or command. Opened from the
 * header button, ⌘K / Ctrl+K, or `/`. Pure DOM: a dialog with a listbox the arrow keys drive.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useNavigate, useQuery } from "@spacefast/zero/client";
import { Icon, Kbd } from "@spacefast/zero/kit";

import { BOARD_FONT } from "./Flap";

import { isAlias, modelName, providerName } from "../../shared/providers";
import type { ModelRow } from "../../shared/types";
import { compareHref, copyText, modelHref, providerHref } from "../lib/util";

export type PaletteMode = { kind: "navigate" } | { kind: "pick"; onPick: (modelId: string) => void; title: string };

type Item = { id: string; group: string; label: string; hint?: string; run: () => void };

const PAGES: { path: string; label: string }[] = [
  { path: "/", label: "The hall" },
  { path: "/changes", label: "The log" },
  { path: "/providers", label: "Providers" },
  { path: "/models", label: "Models" },
  { path: "/status", label: "Status" },
  { path: "/retiring", label: "Departures" },
  { path: "/compare", label: "Compare" },
  { path: "/records", label: "Records" },
  { path: "/index", label: "Price index" },
  { path: "/graveyard", label: "Graveyard" },
  { path: "/time-machine", label: "Time machine" },
  { path: "/pulse", label: "Pulse" },
  { path: "/api", label: "API and feeds" },
  { path: "/about", label: "About" },
];

/** Every query term must appear somewhere; order does not matter. */
function matches(query: string, hay: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const h = hay.toLowerCase();
  return terms.every((t) => h.includes(t));
}

export function Palette(props: { open: boolean; onClose: () => void; mode: PaletteMode; currentModelId?: string }) {
  const models = useQuery<ModelRow[]>("activeModels");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (props.open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [props.open]);

  const go = (to: string) => {
    props.onClose();
    navigate(to);
  };

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const q = query.trim();
    const pick = props.mode.kind === "pick" ? props.mode.onPick : null;
    if (!pick && props.currentModelId) {
      const current = props.currentModelId;
      const commands: Item[] = [
        { id: "copy", group: "This model", label: `Copy id ${current}`, run: () => { copyText(current); props.onClose(); } },
        { id: "compare", group: "This model", label: "Compare with another model", run: () => go(compareHref([current])) },
        { id: "card", group: "This model", label: "Open share card", run: () => { window.open(`/og/model.png?id=${encodeURIComponent(current)}`, "_blank"); props.onClose(); } },
      ];
      for (const c of commands) if (!q || matches(q, c.label)) out.push(c);
    }
    const seenProviders = new Set<string>();
    const rows = models ?? [];
    for (const m of rows) {
      const slug = m.provider.replace(/^~/, "");
      if (seenProviders.has(slug)) continue;
      seenProviders.add(slug);
    }
    if (!pick) {
      for (const slug of [...seenProviders].sort()) {
        const name = providerName(slug);
        if (q && !matches(q, `${name} ${slug} provider`)) continue;
        out.push({ id: `p:${slug}`, group: "Providers", label: name, hint: "provider", run: () => go(providerHref(slug)) });
        if (out.length > 60) break;
      }
      for (const p of PAGES) {
        if (q && !matches(q, `${p.label} page go to`)) continue;
        out.push({ id: `g:${p.path}`, group: "Pages", label: p.label, run: () => go(p.path) });
      }
    }
    let count = 0;
    const scored = rows
      .map((m) => ({ m, hay: `${m.modelId} ${m.name} ${providerName(m.provider)}` }))
      .filter(({ hay }) => !q || matches(q, hay))
      .sort((a, b) => (isAlias(a.m.modelId) ? 1 : 0) - (isAlias(b.m.modelId) ? 1 : 0) || a.m.name.localeCompare(b.m.name));
    for (const { m } of scored) {
      if (count++ >= (q ? 40 : 12)) break;
      out.push({
        id: `m:${m.modelId}`,
        group: "Models",
        label: modelName(m.modelId, m.name),
        hint: `${providerName(m.provider)} · ${m.modelId}`,
        run: () => (pick ? (pick(m.modelId), props.onClose()) : go(modelHref(m.modelId))),
      });
    }
    return out;
  }, [models, query, props.mode, props.currentModelId]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    const el = list.current?.querySelector(`[data-index="${index}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!props.open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[index]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); props.onClose(); }
  };

  let lastGroup = "";
  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[12vh]" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="w-full max-w-xl overflow-hidden rounded-md border border-line bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.7)]" role="dialog" aria-modal="true" aria-label={props.mode.kind === "pick" ? props.mode.title : "Search"} style={{ fontFamily: BOARD_FONT }}>
        <div class="flex items-center gap-2 border-b border-line bg-flap px-3">
          <Icon name="search" size="sm" class="text-accent" />
          <input
            ref={input}
            class="w-full bg-transparent py-3 text-base text-ink outline-none placeholder:text-ink-muted"
            placeholder={props.mode.kind === "pick" ? props.mode.title : "Find a model, provider or page…"}
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[index] ? `palette-${index}` : undefined}
            aria-autocomplete="list"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul ref={list} id="palette-list" role="listbox" class="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 ? <li class="px-4 py-6 text-center text-sm text-ink-muted">Nothing matches.</li> : null}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header ? <div class="border-b border-accent/30 px-4 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.3em] text-accent">{header}</div> : null}
                <button
                  type="button"
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  class={`flex w-full items-baseline justify-between gap-3 border-b border-dotted border-line px-4 py-2 text-left text-[15px] ${i === index ? "bg-accent text-canvas" : "text-ink hover:bg-flap"}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => item.run()}
                >
                  <span class="truncate">{item.label}</span>
                  {item.hint ? <span class={`shrink-0 truncate font-mono text-[11px] ${i === index ? "text-canvas/80" : "text-ink-muted"}`}>{item.hint}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div class="flex items-center gap-3 border-t border-line bg-flap px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span>
          <span><Kbd>↵</Kbd> open</span>
          <span><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}
