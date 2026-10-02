import { Link, Route, Router, Routes, useQuery } from "@spacefast/zero/client";
import { LineChart, Sparkline } from "@spacefast/zero/charts";
import { EmptyState } from "@spacefast/zero/kit";
import { useState } from "preact/hooks";

import { formatContext, perMillion, shortTime } from "../shared/model";
import { isAlias, modelName, providerName } from "../shared/providers";
import { SOURCE_LABEL, canonicalKey } from "../shared/sources";
import { corroborate, foldDrift, groupStories, headlines, tally, type ArchiveEvent, type Story } from "../shared/stories";

type ModelRow = {
  id: string;
  modelId: string;
  provider: string;
  name: string;
  contextLength: string;
  maxCompletion: string;
  promptPrice: string;
  completionPrice: string;
  cacheReadPrice: string;
  modality: string;
  supportedParams: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
};

type StatusRow = { id: string; provider: string; indicator: string; description: string; checkedAt: string };
type PollRow = { id: string; at: string; source: string; ok: boolean; note: string; ms: string };
type TrendRow = { id: string; at: string; rank: string; modelId: string; likes: string; downloads: string };
type PkgRow = { id: string; at: string; pkg: string; downloads: string };
type PypiRow = { id: string; at: string; pkg: string; lastDay: string; lastWeek: string; lastMonth: string };
type RepoRow = { id: string; at: string; repo: string; stars: string; forks: string; openIssues: string };
type EventsPage = { page: ArchiveEvent[]; continueCursor: string | null; isDone: boolean };
type SweepSize = { at: string; listed: number };
type SourceEventRow = { id: string; at: string; source: string; kind: string; key: string; sourceId: string; provider: string; field: string; oldValue: string; newValue: string };
type SourceListing = {
  id: string; source: string; key: string; sourceId: string; provider: string; name: string; contextLength: string;
  maxCompletion: string; promptPrice: string; completionPrice: string; cacheReadPrice: string; releaseDate: string;
  lastSeenAt: string; active: boolean;
};

/** Rows from the other catalogues, in the archive's shape. The canonical key stands in for the model id. */
function asArchive(rows: SourceEventRow[] | undefined): ArchiveEvent[] {
  return (rows ?? []).map((r) => ({
    id: r.id, at: r.at, kind: r.kind, modelId: r.key, provider: r.provider, field: r.field,
    oldValue: r.oldValue, newValue: r.newValue, source: r.source,
  }));
}

function keyOf(story: Story): string {
  return story.source ? story.modelId : canonicalKey(story.provider, story.modelId);
}

/** Price gap between two per-token strings, as a signed percentage of the second. */
function gapPct(a: string, b: string): number | null {
  const x = Number(a);
  const y = Number(b);
  if (!a || !b || !Number.isFinite(x) || !Number.isFinite(y) || y === 0) return null;
  return ((x - y) / y) * 100;
}

/** Terminal chrome. Static class strings only: Zero compiles what it can see. */
function Panel(props: { title: string; hint?: string; children: preact.ComponentChildren }) {
  return (
    <section class="border border-line bg-surface">
      <header class="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2">
        <h2 class="font-mono text-xs tracking-widest text-accent uppercase">{props.title}</h2>
        {props.hint ? <span class="font-mono text-xs text-ink-muted">{props.hint}</span> : null}
      </header>
      <div class="p-3">{props.children}</div>
    </section>
  );
}

function indicatorTone(indicator: string) {
  if (indicator === "none") return "text-success";
  if (indicator === "minor") return "text-warning";
  if (indicator === "critical" || indicator === "major") return "text-danger";
  return "text-ink-muted";
}

function indicatorWord(indicator: string) {
  if (indicator === "none") return "operational";
  if (indicator === "minor") return "degraded";
  if (indicator === "critical" || indicator === "major") return "outage";
  if (indicator === "unreachable") return "unreachable";
  return indicator;
}

function storyTone(kind: Story["kind"]) {
  if (kind === "listed" || kind === "relisted") return "text-success";
  if (kind === "delisted") return "text-danger";
  if (kind === "repriced" || kind === "resized") return "text-accent";
  return "text-ink-muted";
}

function storyGlyph(kind: Story["kind"]) {
  if (kind === "listed") return "+";
  if (kind === "delisted") return "−";
  if (kind === "relisted") return "↩";
  if (kind === "repriced") return "$";
  if (kind === "resized") return "⇔";
  if (kind === "drift") return "~";
  return "·";
}

/** Model ids contain a slash. Encoding it (%2F) gets a 403 from the edge, so keep it raw. */
function modelHref(modelId: string): string {
  return `/model/${encodeURIComponent(modelId).replace(/%2F/g, "/")}`;
}

/** How long ago an ISO timestamp was. */
function ago(iso: string | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const DAY = 86_400_000;

function dayLabel(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  const day = iso.slice(0, 10);
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(day).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function nameIndex(models: ModelRow[] | undefined): Map<string, string> {
  return new Map((models ?? []).map((m) => [m.modelId, m.name]));
}

function SourceTag({ story }: { story: Story }) {
  if (story.source) {
    return <span class="ml-2 border border-line px-1 text-ink-muted">at {SOURCE_LABEL[story.source] ?? story.source}</span>;
  }
  if (story.confirmedBy?.length) {
    return (
      <span class="ml-2 text-success" title="Another catalogue recorded the same move within a week">
        ✓ {story.confirmedBy.map((s) => SOURCE_LABEL[s] ?? s).join(", ")}
      </span>
    );
  }
  return null;
}

function StoryLine({ story, href, showModel = true, relative = false }: { story: Story; href?: string | null; showModel?: boolean; relative?: boolean }) {
  const to = href === undefined ? modelHref(story.modelId) : href;
  return (
    <li class="flex gap-3 border-b border-line py-2 font-mono text-xs last:border-0">
      <span class={`w-4 shrink-0 text-center ${storyTone(story.kind)}`} aria-hidden="true">{storyGlyph(story.kind)}</span>
      <div class="min-w-0 flex-1">
        <span class="block">
          {showModel && to ? (
            <Link to={to} class={`${storyTone(story.kind)} hover:underline`}>{story.headline}</Link>
          ) : (
            <span class={storyTone(story.kind)}>{story.headline}</span>
          )}
          <SourceTag story={story} />
        </span>
        {story.detail ? <span class="block truncate text-ink-muted">{story.detail}</span> : null}
      </div>
      <span class="shrink-0 text-ink-muted">{relative ? ago(story.at) : story.at.slice(11, 16)}</span>
    </li>
  );
}

function Freshness() {
  const latest = useQuery<Record<string, string>>("freshness");
  const models = latest?.models;
  const stale = models ? Date.now() - Date.parse(models) > 3 * 3600 * 1000 : true;
  return (
    <span class={`font-mono text-xs ${stale ? "text-warning" : "text-ink-muted"}`}>
      last sweep {ago(models)}{stale ? " (overdue)" : ""}
    </span>
  );
}

function StatusStrip({ statuses }: { statuses: StatusRow[] | undefined }) {
  if (!statuses || statuses.length === 0) return null;
  return (
    <ul class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
      {statuses.map((s) => (
        <li key={s.id} class="flex items-center gap-1.5" title={`${s.description || indicatorWord(s.indicator)} · checked ${ago(s.checkedAt)}`}>
          <span class={indicatorTone(s.indicator)} aria-hidden="true">●</span>
          <span class="text-ink">{providerName(s.provider)}</span>
          <span class="sr-only">{indicatorWord(s.indicator)}</span>
          {s.indicator !== "none" ? <span class={indicatorTone(s.indicator)}>{indicatorWord(s.indicator)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function ChangesPage() {
  const models = useQuery<ModelRow[]>("activeModels");
  const statuses = useQuery<StatusRow[]>("statuses");
  const sizes = useQuery<SweepSize[]>("sweepSizes");
  const sourceEvents = useQuery<SourceEventRow[]>("recentSourceEvents");

  // Paged archive. Each page is its own live subscription keyed by cursor.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const pages = cursors.map((cursor) => useQuery<EventsPage>("eventsPage", cursor));
  const last = pages[pages.length - 1];
  const events = pages.flatMap((p) => p?.page ?? []);

  const names = nameIndex(models);
  const keyToModel = new Map((models ?? []).map((m) => [canonicalKey(m.provider, m.modelId), m.modelId]));
  const linkFor = (s: Story) => (s.source ? (keyToModel.has(s.modelId) ? modelHref(keyToModel.get(s.modelId) as string) : null) : modelHref(s.modelId));
  const stories = corroborate(foldDrift(groupStories([...events, ...asArchive(sourceEvents)], names)), keyOf);
  const lead = headlines(stories, Date.now());
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const week = tally(stories, weekAgo);
  const drifting = new Set(stories.filter((s) => s.kind === "drift" && s.at >= lead.stories[lead.stories.length - 1]?.at).map((s) => s.modelId));

  const active = models ?? [];
  const providers = new Set(active.map((m) => m.provider.replace(/^~/, "")));
  const trend = (sizes ?? []).map((s) => s.listed);
  const weekStart = (sizes ?? []).find((s) => s.at >= weekAgo);
  const delta = weekStart && trend.length ? trend[trend.length - 1] - weekStart.listed : 0;

  const byDay = new Map<string, Story[]>();
  for (const s of stories) {
    const key = s.at.slice(0, 10);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }

  const windowLabel = lead.windowHours === 24 ? "last 24 hours" : lead.windowHours === 72 ? "last 3 days" : lead.windowHours === 168 ? "last 7 days" : lead.windowHours === 720 ? "last 30 days" : "all time";

  return (
    <div class="flex flex-col gap-4">
      <p class="max-w-3xl font-mono text-sm leading-relaxed text-ink">
        Tracking <span class="text-accent">{active.length}</span> models from{" "}
        <span class="text-accent">{providers.size}</span> providers. Prices, context windows and availability,
        checked every 30 minutes and kept forever. Providers change these things without announcing them.
        This is the changelog they don't publish.
      </p>

      <Panel title="What changed" hint={windowLabel}>
        {events.length === 0 ? (
          <EmptyState title="Nothing recorded yet" description="The archive fills as providers change things." />
        ) : lead.stories.length === 0 ? (
          <p class="font-mono text-xs text-ink-muted">Quiet. Only exchange-rate drift in this window.</p>
        ) : (
          <ul class="flex flex-col">
            {lead.stories.map((s) => (
              <StoryLine key={s.key} story={s} href={linkFor(s)} relative />
            ))}
          </ul>
        )}
        {drifting.size > 0 ? (
          <p class="mt-2 font-mono text-xs text-ink-muted">
            Also {drifting.size} model{drifting.size === 1 ? "" : "s"} whose price wobbles with an exchange rate. Those are folded into the log below.
          </p>
        ) : null}
      </Panel>

      <div class="grid gap-4 sm:grid-cols-3">
        <Panel title="This week">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
            <dt class="text-ink-muted">listed</dt><dd class="text-success">{week.listed}</dd>
            <dt class="text-ink-muted">delisted</dt><dd class="text-danger">{week.delisted}</dd>
            <dt class="text-ink-muted">repriced</dt><dd class="text-accent">{week.repriced}</dd>
            <dt class="text-ink-muted">resized</dt><dd class="text-accent">{week.resized}</dd>
            <dt class="text-ink-muted">price drift</dt><dd class="text-ink-muted">{week.drift}</dd>
          </dl>
          {!last?.isDone ? <p class="mt-2 font-mono text-xs text-ink-muted">counts cover the loaded log</p> : null}
        </Panel>
        <Panel title="Catalogue size" hint={delta ? `${delta > 0 ? "+" : ""}${delta} this week` : "flat this week"}>
          <p class="font-mono text-3xl text-accent">{active.length}</p>
          {trend.length > 1 ? <Sparkline values={trend} height={36} /> : null}
          <p class="font-mono text-xs text-ink-muted">{trend.length} sweeps shown</p>
        </Panel>
        <Panel title="Provider status" hint="status pages">
          <StatusStrip statuses={statuses} />
        </Panel>
      </div>

      <Panel title="Everything" hint="every change ever recorded, newest first">
        {[...byDay.entries()].map(([day, list]) => (
          <details key={day} open={day === [...byDay.keys()][0]} class="group border-b border-line last:border-0">
            <summary class="flex cursor-pointer items-baseline justify-between py-2 font-mono text-xs text-ink hover:text-accent">
              <span>{dayLabel(day)}</span>
              <span class="text-ink-muted">{list.length} {list.length === 1 ? "story" : "stories"}</span>
            </summary>
            <ul class="mb-2 flex flex-col border-l border-line pl-3">
              {list.map((s) => (
                <StoryLine key={s.key} story={s} href={linkFor(s)} />
              ))}
            </ul>
          </details>
        ))}
        {last && !last.isDone ? (
          <button
            type="button"
            class="mt-3 border border-line px-3 py-1 font-mono text-xs text-accent hover:bg-canvas"
            onClick={() => setCursors((c) => [...c, last.continueCursor])}
          >
            load older
          </button>
        ) : null}
      </Panel>

      <Panel title="How this works">
        <div class="flex max-w-3xl flex-col gap-2 font-mono text-xs leading-relaxed text-ink-muted">
          <p>
            Every 30 minutes the catalogue is fetched and diffed against the last known state. Only what moved is
            written down: a model appearing, a model quietly disappearing, a price change, a context window change, a
            capability flag flipping. Nothing is ever deleted.
          </p>
          <p>
            The catalogue is OpenRouter's, which lists models and pricing across dozens of providers on one API.
            OpenRouter keeps no history of its own; this is that history. Price moves under {3}% are called drift and
            folded up, since a handful of models are priced off an exchange rate and wobble every sweep.
          </p>
          <p>
            Two other catalogues are checked against it: <span class="text-ink">models.dev</span>, a maintained database of
            first-party listings, and <span class="text-ink">LiteLLM</span>'s price table, which most client libraries bill from.
            A move that shows up there too is marked <span class="text-success">✓</span>: it came from the provider. One that
            doesn't may be OpenRouter's own margin or routing. Moves seen only at another catalogue are tagged with where.
          </p>
          <p>
            Provider status is read from each company's public status page. The <Link to="/ecosystem" class="text-accent hover:underline">ecosystem</Link> page
            tracks adoption signals daily. Click any model for its full history.
          </p>
        </div>
      </Panel>
    </div>
  );
}

type SortKey = "model" | "context" | "input" | "output" | "listed";

function ModelsPage() {
  const active = useQuery<ModelRow[]>("activeModels");
  const retired = useQuery<ModelRow[]>("retiredModels");
  const [filter, setFilter] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [sort, setSort] = useState<SortKey>("listed");

  const needle = filter.trim().toLowerCase();
  const all = [...(active ?? []), ...(showRetired ? retired ?? [] : [])];
  const rows = all
    .filter((m) => !needle || m.modelId.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle) || providerName(m.provider).toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === "model") return a.modelId.localeCompare(b.modelId);
      if (sort === "context") return Number(b.contextLength) - Number(a.contextLength);
      if (sort === "input") return Number(a.promptPrice) - Number(b.promptPrice);
      if (sort === "output") return Number(a.completionPrice) - Number(b.completionPrice);
      return b.firstSeenAt.localeCompare(a.firstSeenAt);
    });

  const header = (key: SortKey, label: string) => (
    <th class="py-1 pr-3 font-normal">
      <button type="button" class={`hover:text-accent ${sort === key ? "text-accent" : "text-ink-muted"}`} onClick={() => setSort(key)}>
        {label}{sort === key ? " ▾" : ""}
      </button>
    </th>
  );

  return (
    <Panel title="Models" hint={`${rows.length} shown`}>
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <input
          class="w-full max-w-sm border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink"
          placeholder="filter by model or provider"
          value={filter}
          onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
          aria-label="Filter models"
        />
        <label class="flex items-center gap-2 font-mono text-xs text-ink-muted">
          <input type="checkbox" checked={showRetired} onChange={() => setShowRetired((v) => !v)} />
          include delisted ({(retired ?? []).length})
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="Try a shorter filter." />
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full font-mono text-xs">
            <thead>
              <tr class="border-b border-line text-left">
                {header("model", "model")}
                {header("context", "context")}
                {header("input", "in $/M")}
                {header("output", "out $/M")}
                {header("listed", "listed")}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} class={`border-b border-line last:border-0 ${m.active ? "" : "opacity-50"}`}>
                  <td class="py-1 pr-3">
                    <Link to={modelHref(m.modelId)} class="text-ink hover:text-accent">
                      <span class="text-ink-muted">{providerName(m.provider)}</span> {modelName(m.modelId, m.name)}
                    </Link>
                  </td>
                  <td class="py-1 pr-3 text-ink-muted">{formatContext(m.contextLength)}</td>
                  <td class="py-1 pr-3 text-ink-muted">{perMillion(m.promptPrice)}</td>
                  <td class="py-1 pr-3 text-ink-muted">{perMillion(m.completionPrice)}</td>
                  <td class="py-1 text-ink-muted">{m.firstSeenAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * Rebuilds a price-over-time series from the change events plus the current value.
 * Points are keyed to the minute, not the day: a model listed and repriced on the same
 * day would otherwise collapse to one point and the change would vanish from the chart.
 */
function priceSeries(events: ArchiveEvent[], field: string, current: string, firstSeenAt: string) {
  const key = (iso: string) => shortTime(iso);
  const points: { at: string; value: number }[] = [];
  const changes = events.filter((e) => e.kind === "changed" && e.field === field);
  if (changes.length === 0) {
    const v = Number(perMillion(current));
    return [
      { at: key(firstSeenAt), value: v },
      { at: key(new Date().toISOString()), value: v },
    ];
  }
  points.push({ at: key(firstSeenAt), value: Number(perMillion(changes[0].oldValue)) });
  for (const c of changes) points.push({ at: key(c.at), value: Number(perMillion(c.newValue)) });
  points.push({ at: key(new Date().toISOString()), value: Number(perMillion(current)) });
  return points;
}

function ModelPage({ modelId }: { modelId: string }) {
  const data = useQuery<{ model: ModelRow | null; events: ArchiveEvent[] }>("modelHistory", modelId);
  const key = canonicalKey(data?.model?.provider ?? "", modelId);
  const cross = useQuery<{ listings: SourceListing[]; events: SourceEventRow[] }>("crossSources", key);
  const model = data?.model;
  const events = data?.events ?? [];

  if (data && !model) {
    return <EmptyState title="Unknown model" description={`${modelId} has never been seen.`} />;
  }
  if (!model) return null;

  const inputSeries = priceSeries(events, "promptPrice", model.promptPrice, model.firstSeenAt);
  const outputSeries = priceSeries(events, "completionPrice", model.completionPrice, model.firstSeenAt);
  const byDate = new Map<string, { at: string; input?: number; output?: number }>();
  for (const p of inputSeries) byDate.set(p.at, { ...(byDate.get(p.at) ?? { at: p.at }), input: p.value });
  for (const p of outputSeries) byDate.set(p.at, { ...(byDate.get(p.at) ?? { at: p.at }), output: p.value });
  const chart = [...byDate.values()].sort((a, b) => a.at.localeCompare(b.at));

  const names = new Map([[model.modelId, model.name]]);
  const stories = corroborate(foldDrift(groupStories([...events, ...asArchive(cross?.events)], names)), keyOf);
  const drift = stories.filter((s) => s.kind === "drift").reduce((n, s) => n + (s.folded ?? 1), 0);
  const listings = (cross?.listings ?? []).slice().sort((a, b) => a.source.localeCompare(b.source));

  return (
    <div class="flex flex-col gap-4">
      <Panel title={`${providerName(model.provider)} · ${modelName(model.modelId, model.name)}`} hint={model.active ? "listed" : "no longer listed"}>
        <dl class="grid gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-3">
          <dt class="text-ink-muted">id</dt><dd class="text-ink sm:col-span-2">{model.modelId}{isAlias(model.modelId) ? " · rolling alias, always points at the newest model in its family" : ""}</dd>
          <dt class="text-ink-muted">context</dt><dd class="text-ink sm:col-span-2">{formatContext(model.contextLength)} · max output {formatContext(model.maxCompletion)}</dd>
          <dt class="text-ink-muted">price /M</dt><dd class="text-ink sm:col-span-2">in ${perMillion(model.promptPrice)} · out ${perMillion(model.completionPrice)}{model.cacheReadPrice ? ` · cache read $${perMillion(model.cacheReadPrice)}` : ""}</dd>
          <dt class="text-ink-muted">modality</dt><dd class="text-ink sm:col-span-2">{model.modality}</dd>
          <dt class="text-ink-muted">listed</dt><dd class="text-ink sm:col-span-2">{model.firstSeenAt.slice(0, 10)} · last seen {ago(model.lastSeenAt)}</dd>
        </dl>
      </Panel>

      <Panel title="Price over time" hint="$ per million tokens">
        <LineChart
          data={chart}
          x="at"
          series={[{ key: "input", label: "input" }, { key: "output", label: "output" }]}
          height={220}
          formatValue={(v) => `$${v}`}
        />
      </Panel>

      <Panel title="Other catalogues" hint={listings.length ? "what the provider's own listing says" : `no match for ${key}`}>
        {listings.length === 0 ? (
          <p class="font-mono text-xs text-ink-muted">
            Neither models.dev nor LiteLLM lists a model this maps to. Either it is only reachable through OpenRouter, or the ids don't line up.
          </p>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full font-mono text-xs">
              <thead>
                <tr class="border-b border-line text-left text-ink-muted">
                  <th class="py-1 pr-3 font-normal">catalogue</th>
                  <th class="py-1 pr-3 font-normal">id</th>
                  <th class="py-1 pr-3 font-normal">context</th>
                  <th class="py-1 pr-3 font-normal">in $/M</th>
                  <th class="py-1 pr-3 font-normal">out $/M</th>
                  <th class="py-1 pr-3 font-normal">released</th>
                  <th class="py-1 font-normal">vs OpenRouter</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => {
                  const inGap = gapPct(model.promptPrice, l.promptPrice);
                  const outGap = gapPct(model.completionPrice, l.completionPrice);
                  const verdict = (gap: number | null) =>
                    gap === null ? "?" : Math.abs(gap) < 3 ? "same" : `${gap > 0 ? "+" : "−"}${Math.abs(gap).toFixed(0)}%`;
                  const differs = (inGap !== null && Math.abs(inGap) >= 3) || (outGap !== null && Math.abs(outGap) >= 3);
                  return (
                    <tr key={l.id} class={`border-b border-line last:border-0 ${l.active ? "" : "opacity-50"}`}>
                      <td class="py-1 pr-3 text-ink">{SOURCE_LABEL[l.source] ?? l.source}</td>
                      <td class="py-1 pr-3 text-ink-muted">{l.sourceId}{l.active ? "" : " (gone)"}</td>
                      <td class="py-1 pr-3 text-ink-muted">{formatContext(l.contextLength)}</td>
                      <td class="py-1 pr-3 text-ink-muted">{perMillion(l.promptPrice)}</td>
                      <td class="py-1 pr-3 text-ink-muted">{perMillion(l.completionPrice)}</td>
                      <td class="py-1 pr-3 text-ink-muted">{l.releaseDate || "–"}</td>
                      <td class={`py-1 ${differs ? "text-warning" : "text-success"}`}>
                        {differs ? `in ${verdict(inGap)} · out ${verdict(outGap)}` : "same price"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p class="mt-2 font-mono text-xs text-ink-muted">
              "vs OpenRouter" is OpenRouter's price relative to that listing. A positive gap is what routing through OpenRouter costs on top.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="History" hint={`${stories.length} ${stories.length === 1 ? "story" : "stories"}${drift ? ` · ${drift} drift moves folded` : ""}`}>
        {stories.length === 0 ? (
          <EmptyState title="No changes yet" description="Nothing has moved since it was first seen." />
        ) : (
          <ul class="flex flex-col">
            {stories.map((s) => (
              <li key={s.key} class="flex gap-3 border-b border-line py-2 font-mono text-xs last:border-0">
                <span class="shrink-0 text-ink-muted">{shortTime(s.at)}</span>
                <div class="min-w-0 flex-1">
                  <span class="block"><span class={storyTone(s.kind)}>{s.headline}</span><SourceTag story={s} /></span>
                  {s.detail ? <span class="block text-ink-muted">{s.detail}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function EcosystemPage() {
  const trending = useQuery<TrendRow[]>("latestTrending");
  const packages = useQuery<PkgRow[]>("latestPackages");
  const pypi = useQuery<PypiRow[]>("latestPypi");
  const repos = useQuery<RepoRow[]>("latestRepos");
  const polls = useQuery<PollRow[]>("recentPolls");

  const list = <T extends { id: string }>(rows: T[] | undefined, render: (r: T) => preact.ComponentChildren) =>
    (rows ?? []).length === 0 ? (
      <EmptyState title="No snapshot yet" description="The daily poll has not run." />
    ) : (
      <ul class="flex flex-col">{(rows ?? []).map((r) => <li key={r.id} class="flex gap-3 border-b border-line py-1 font-mono text-xs last:border-0">{render(r)}</li>)}</ul>
    );

  return (
    <div class="flex flex-col gap-4">
      <p class="max-w-3xl font-mono text-sm leading-relaxed text-ink">
        Where attention is going, snapshotted once a day: what people download, star and look at.
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <Panel title="Hugging Face trending" hint="open-weights models people are looking at">
          {list(trending, (row) => (
            <>
              <span class="w-6 shrink-0 text-ink-muted">{row.rank}</span>
              <span class="min-w-0 flex-1 truncate text-ink">{row.modelId}</span>
              <span class="shrink-0 text-ink-muted">{Number(row.likes).toLocaleString()} likes</span>
            </>
          ))}
        </Panel>
        <Panel title="npm downloads" hint="client SDKs, last week">
          {list(packages, (row) => (
            <>
              <span class="min-w-0 flex-1 truncate text-ink">{row.pkg}</span>
              <span class="shrink-0 text-ink-muted">{Number(row.downloads).toLocaleString()}</span>
            </>
          ))}
        </Panel>
        <Panel title="PyPI downloads" hint="client SDKs, last week">
          {list(pypi, (row) => (
            <>
              <span class="min-w-0 flex-1 truncate text-ink">{row.pkg}</span>
              <span class="shrink-0 text-ink-muted">{Number(row.lastWeek).toLocaleString()}</span>
            </>
          ))}
        </Panel>
        <Panel title="GitHub" hint="stars · open issues">
          {list(repos, (row) => (
            <>
              <span class="min-w-0 flex-1 truncate text-ink">{row.repo}</span>
              <span class="shrink-0 text-accent">{Number(row.stars).toLocaleString()}</span>
              <span class="w-12 shrink-0 text-right text-ink-muted">{row.openIssues}</span>
            </>
          ))}
        </Panel>
        <Panel title="Collector log" hint="gaps in the archive show up here">
          {list(polls, (row) => (
            <>
              <span class="shrink-0 text-ink-muted">{shortTime(row.at)}</span>
              <span class="w-14 shrink-0 text-ink-muted">{row.source}</span>
              <span class="min-w-0 flex-1 truncate text-ink">{row.note}</span>
              <span class={row.ok ? "shrink-0 text-success" : "shrink-0 text-danger"}>{row.ok ? "ok" : "fail"}</span>
            </>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Nav() {
  return (
    <nav class="flex gap-4 font-mono text-xs tracking-widest uppercase">
      <Link to="/" class="text-ink hover:text-accent">Changes</Link>
      <Link to="/models" class="text-ink hover:text-accent">Models</Link>
      <Link to="/ecosystem" class="text-ink hover:text-accent">Ecosystem</Link>
    </nav>
  );
}

function ModelRoute() {
  const id = decodeURIComponent(window.location.pathname.replace(/^\/model\//, ""));
  return <ModelPage modelId={id} />;
}

export function App() {
  return (
    <Router>
      <main class="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 p-6">
        <header class="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
          <div>
            <h1 class="font-mono text-lg tracking-[0.3em] text-accent uppercase"><Link to="/" class="hover:text-ink">AI Observatory</Link></h1>
            <p class="font-mono text-xs text-ink-muted">what AI providers changed, and when</p>
            <Freshness />
          </div>
          <Nav />
        </header>
        <Routes>
          <Route path="/" element={<ChangesPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/catalog" element={<ModelsPage />} />
          <Route path="/model/*" element={<ModelRoute />} />
          <Route path="/ecosystem" element={<EcosystemPage />} />
          <Route path="/signals" element={<EcosystemPage />} />
          <Route path="/about" element={<ChangesPage />} />
          <Route path="*" element={<EmptyState title="Not found" description="No page at this path." />} />
        </Routes>
      </main>
    </Router>
  );
}
