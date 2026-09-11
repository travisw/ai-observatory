import { Link, Route, Router, Routes, useQuery } from "@spacefast/zero/client";
import { LineChart } from "@spacefast/zero/charts";
import { EmptyState } from "@spacefast/zero/kit";
import { useState } from "preact/hooks";

import { describeEvent, formatContext, perMillion, shortTime } from "../shared/model";

type EventRow = {
  id: string;
  at: string;
  kind: string;
  modelId: string;
  provider: string;
  field: string;
  oldValue: string;
  newValue: string;
};

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
type EventsPage = { page: EventRow[]; continueCursor: string | null; isDone: boolean };

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

function kindTone(kind: string) {
  if (kind === "added") return "text-success";
  if (kind === "removed") return "text-danger";
  if (kind === "returned") return "text-accent";
  return "text-ink";
}

/** Model ids contain a slash. Encoding it (%2F) gets a 403 from the edge, so keep it raw. */
function modelHref(modelId: string): string {
  return `/model/${encodeURIComponent(modelId).replace(/%2F/g, "/")}`;
}

/** How long ago an ISO timestamp was, for the freshness stamp. */
function ago(iso: string | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function EventLine({ row, showModel = true }: { row: EventRow; showModel?: boolean }) {
  return (
    <li class="flex gap-3 border-b border-line py-1.5 font-mono text-xs last:border-0">
      <span class="shrink-0 text-ink-muted">{shortTime(row.at)}</span>
      {showModel ? (
        <>
          <span class="w-16 shrink-0 truncate text-ink-muted">{row.provider}</span>
          <Link to={modelHref(row.modelId)} class="min-w-0 flex-1 truncate text-ink hover:text-accent">
            {row.modelId}
          </Link>
        </>
      ) : null}
      <span class={`shrink-0 ${kindTone(row.kind)}`}>
        {describeEvent(row.kind, row.field, row.oldValue, row.newValue)}
      </span>
    </li>
  );
}

function Freshness() {
  const latest = useQuery<Record<string, string>>("freshness");
  const models = latest?.models;
  const stale = models ? Date.now() - Date.parse(models) > 3 * 3600 * 1000 : true;
  return (
    <span class={`font-mono text-xs ${stale ? "text-warning" : "text-ink-muted"}`}>
      catalogue {ago(models)} · status {ago(latest?.status)} · daily {ago(latest?.daily)}
    </span>
  );
}

function ConsolePage() {
  const models = useQuery<ModelRow[]>("activeModels");
  const statuses = useQuery<StatusRow[]>("statuses");
  const polls = useQuery<PollRow[]>("recentPolls");

  // Paged archive. Each page is its own live subscription keyed by cursor.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const pages = cursors.map((cursor) => useQuery<EventsPage>("eventsPage", cursor));
  const last = pages[pages.length - 1];
  const events = pages.flatMap((p) => p?.page ?? []);

  const active = (models ?? []).filter((m) => m.active);
  const providers = new Set(active.map((m) => m.provider));
  const lastPoll = (polls ?? []).find((p) => p.source === "models");

  return (
    <div class="flex flex-col gap-4">
      <div class="grid gap-4 sm:grid-cols-4">
        <Panel title="Models tracked">
          <p class="font-mono text-3xl text-accent">{active.length}</p>
          <p class="font-mono text-xs text-ink-muted">{providers.size} providers</p>
        </Panel>
        <Panel title="Changes loaded">
          <p class="font-mono text-3xl text-accent">{events.length}</p>
          <p class="font-mono text-xs text-ink-muted">{last?.isDone ? "entire archive" : "more below"}</p>
        </Panel>
        <Panel title="Last catalogue sweep">
          <p class="font-mono text-sm text-ink">{lastPoll ? shortTime(lastPoll.at) : "never"}</p>
          <p class="font-mono text-xs text-ink-muted">{lastPoll ? lastPoll.note : "awaiting first run"}</p>
        </Panel>
        <Panel title="Provider status">
          <ul class="flex flex-col gap-1">
            {(statuses ?? []).length === 0 ? (
              <li class="font-mono text-xs text-ink-muted">no checks yet</li>
            ) : (
              (statuses ?? []).map((s) => (
                <li key={s.id} class="flex justify-between font-mono text-xs">
                  <span class="text-ink-muted">{s.provider}</span>
                  <span class={indicatorTone(s.indicator)}>{s.indicator}</span>
                </li>
              ))
            )}
          </ul>
        </Panel>
      </div>

      <Panel title="Change log" hint="every catalogue movement, kept forever">
        {events.length === 0 ? (
          <EmptyState title="Nothing recorded yet" description="The archive fills as providers change things." />
        ) : (
          <>
            <ul class="flex flex-col">
              {events.map((row) => (
                <EventLine key={row.id} row={row} />
              ))}
            </ul>
            {last && !last.isDone ? (
              <button
                type="button"
                class="mt-3 border border-line px-3 py-1 font-mono text-xs text-accent hover:bg-surface"
                onClick={() => setCursors((c) => [...c, last.continueCursor])}
              >
                load older
              </button>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  );
}

function CatalogPage() {
  const models = useQuery<ModelRow[]>("activeModels");
  const [filter, setFilter] = useState("");
  const [showRetired, setShowRetired] = useState(false);

  const needle = filter.trim().toLowerCase();
  const rows = (models ?? [])
    .filter((m) => showRetired || m.active)
    .filter((m) => !needle || m.modelId.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
    .sort((a, b) => a.modelId.localeCompare(b.modelId));

  return (
    <Panel title="Catalogue" hint={`${rows.length} shown`}>
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <input
          class="w-full max-w-sm border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink"
          placeholder="filter by id or name"
          value={filter}
          onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
          aria-label="Filter models"
        />
        <label class="flex items-center gap-2 font-mono text-xs text-ink-muted">
          <input type="checkbox" checked={showRetired} onChange={() => setShowRetired((v) => !v)} />
          include retired
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="Try a shorter filter." />
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full font-mono text-xs">
            <thead>
              <tr class="border-b border-line text-left text-ink-muted">
                <th class="py-1 pr-3 font-normal">model</th>
                <th class="py-1 pr-3 font-normal">ctx</th>
                <th class="py-1 pr-3 font-normal">in $/M</th>
                <th class="py-1 pr-3 font-normal">out $/M</th>
                <th class="py-1 font-normal">listed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} class={`border-b border-line last:border-0 ${m.active ? "" : "opacity-50"}`}>
                  <td class="py-1 pr-3">
                    <Link to={modelHref(m.modelId)} class="text-ink hover:text-accent">
                      {m.modelId}
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

/** Rebuilds a price-over-time series from the change events plus the current value. */
function priceSeries(events: EventRow[], field: string, current: string, firstSeenAt: string) {
  const points: { at: string; value: number }[] = [];
  const changes = events.filter((e) => e.kind === "changed" && e.field === field);
  if (changes.length === 0) {
    const v = Number(perMillion(current));
    return [
      { at: firstSeenAt.slice(0, 10), value: v },
      { at: new Date().toISOString().slice(0, 10), value: v },
    ];
  }
  points.push({ at: firstSeenAt.slice(0, 10), value: Number(perMillion(changes[0].oldValue)) });
  for (const c of changes) points.push({ at: c.at.slice(0, 10), value: Number(perMillion(c.newValue)) });
  points.push({ at: new Date().toISOString().slice(0, 10), value: Number(perMillion(current)) });
  return points;
}

function ModelPage({ modelId }: { modelId: string }) {
  const data = useQuery<{ model: ModelRow | null; events: EventRow[] }>("modelHistory", modelId);
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

  return (
    <div class="flex flex-col gap-4">
      <Panel title={model.modelId} hint={model.active ? "listed" : "retired"}>
        <dl class="grid gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-3">
          <dt class="text-ink-muted">name</dt><dd class="text-ink sm:col-span-2">{model.name}</dd>
          <dt class="text-ink-muted">context</dt><dd class="text-ink sm:col-span-2">{formatContext(model.contextLength)} · max out {formatContext(model.maxCompletion)}</dd>
          <dt class="text-ink-muted">price /M</dt><dd class="text-ink sm:col-span-2">in ${perMillion(model.promptPrice)} · out ${perMillion(model.completionPrice)} · cache read ${perMillion(model.cacheReadPrice)}</dd>
          <dt class="text-ink-muted">modality</dt><dd class="text-ink sm:col-span-2">{model.modality}</dd>
          <dt class="text-ink-muted">listed</dt><dd class="text-ink sm:col-span-2">{model.firstSeenAt.slice(0, 10)} · last seen {shortTime(model.lastSeenAt)}</dd>
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

      <Panel title="History" hint={`${events.length} events`}>
        {events.length === 0 ? (
          <EmptyState title="No changes yet" description="Nothing has moved since it was first seen." />
        ) : (
          <ul class="flex flex-col">
            {[...events].reverse().map((row) => (
              <EventLine key={row.id} row={row} showModel={false} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function SignalsPage() {
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
    <div class="grid gap-4 sm:grid-cols-2">
      <Panel title="Hugging Face trending" hint="daily snapshot">
        {list(trending, (row) => (
          <>
            <span class="w-6 shrink-0 text-ink-muted">{row.rank}</span>
            <span class="min-w-0 flex-1 truncate text-ink">{row.modelId}</span>
            <span class="shrink-0 text-ink-muted">{row.likes} likes</span>
          </>
        ))}
      </Panel>
      <Panel title="npm downloads" hint="last week">
        {list(packages, (row) => (
          <>
            <span class="min-w-0 flex-1 truncate text-ink">{row.pkg}</span>
            <span class="shrink-0 text-ink-muted">{Number(row.downloads).toLocaleString()}</span>
          </>
        ))}
      </Panel>
      <Panel title="PyPI downloads" hint="last week">
        {list(pypi, (row) => (
          <>
            <span class="min-w-0 flex-1 truncate text-ink">{row.pkg}</span>
            <span class="shrink-0 text-ink-muted">{Number(row.lastWeek).toLocaleString()}</span>
          </>
        ))}
      </Panel>
      <Panel title="Repository pull" hint="stars / open issues">
        {list(repos, (row) => (
          <>
            <span class="min-w-0 flex-1 truncate text-ink">{row.repo}</span>
            <span class="shrink-0 text-accent">{Number(row.stars).toLocaleString()}</span>
            <span class="w-12 shrink-0 text-right text-ink-muted">{row.openIssues}</span>
          </>
        ))}
      </Panel>
      <Panel title="Collector log" hint="gaps in the archive are visible here">
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
  );
}

function AboutPage() {
  return (
    <Panel title="What this is">
      <div class="flex flex-col gap-3 text-sm leading-relaxed text-ink-muted">
        <p>
          Most AI provider APIs are "now" APIs. They report the current state and keep either
          nothing or a short rolling window. This polls them on a schedule and never deletes
          anything, so the history accumulates in one place.
        </p>
        <p>
          The catalogue comes from OpenRouter, which lists models and pricing across dozens of
          providers. Each sweep is diffed against the last known state and only what moved is
          recorded: a model appearing, a model quietly disappearing, a price change, a context
          window change, a capability flag flipping.
        </p>
        <p>
          Providers do this without announcements and edit their docs in place. The archive
          timestamps it instead. Click any model for its full history.
        </p>
      </div>
    </Panel>
  );
}

function Nav() {
  return (
    <nav class="flex gap-4 font-mono text-xs tracking-widest uppercase">
      <Link to="/" class="text-ink hover:text-accent">Console</Link>
      <Link to="/catalog" class="text-ink hover:text-accent">Catalogue</Link>
      <Link to="/signals" class="text-ink hover:text-accent">Signals</Link>
      <Link to="/about" class="text-ink hover:text-accent">About</Link>
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
            <h1 class="font-mono text-lg tracking-[0.3em] text-accent uppercase">AI Observatory</h1>
            <p class="font-mono text-xs text-ink-muted">what the providers changed, and when</p>
            <Freshness />
          </div>
          <Nav />
        </header>
        <Routes>
          <Route path="/" element={<ConsolePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/model/*" element={<ModelRoute />} />
          <Route path="/signals" element={<SignalsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<EmptyState title="Not found" description="No panel at this path." />} />
        </Routes>
      </main>
    </Router>
  );
}
