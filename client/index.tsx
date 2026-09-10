import { Route, Router, Routes, Link, useQuery } from "@spacefast/zero/client";
import { Badge, Card, EmptyState, Spinner } from "@spacefast/zero/kit";

import {
  describeEvent,
  formatContext,
  perMillion,
  shortTime,
} from "../shared/model";

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
  promptPrice: string;
  completionPrice: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
};

type StatusRow = {
  id: string;
  provider: string;
  indicator: string;
  description: string;
  checkedAt: string;
};

type PollRow = { id: string; at: string; source: string; ok: boolean; note: string; ms: string };
type TrendRow = { id: string; at: string; rank: string; modelId: string; likes: string; downloads: string };
type PkgRow = { id: string; at: string; pkg: string; downloads: string };
type PypiRow = { id: string; at: string; pkg: string; lastDay: string; lastWeek: string; lastMonth: string };
type RepoRow = { id: string; at: string; repo: string; stars: string; forks: string; openIssues: string };

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

function EventLine({ row }: { row: EventRow }) {
  const tone =
    row.kind === "added"
      ? "text-success"
      : row.kind === "removed"
        ? "text-danger"
        : row.kind === "returned"
          ? "text-accent"
          : "text-ink";
  return (
    <li class="flex gap-3 border-b border-line py-1.5 font-mono text-xs last:border-0">
      <span class="shrink-0 text-ink-muted">{shortTime(row.at)}</span>
      <span class="shrink-0 w-16 truncate text-ink-muted">{row.provider}</span>
      <span class="min-w-0 flex-1 truncate text-ink">{row.modelId}</span>
      <span class={`shrink-0 ${tone}`}>
        {describeEvent(row.kind, row.field, row.oldValue, row.newValue)}
      </span>
    </li>
  );
}

function ConsolePage() {
  const events = useQuery<EventRow[]>("recentEvents");
  const models = useQuery<ModelRow[]>("activeModels");
  const statuses = useQuery<StatusRow[]>("statuses");
  const polls = useQuery<PollRow[]>("recentPolls");

  const active = models.filter((m) => m.active);
  const providers = new Set(active.map((m) => m.provider));
  const lastPoll = polls.find((p) => p.source === "models");

  return (
    <div class="flex flex-col gap-4">
      <div class="grid gap-4 sm:grid-cols-4">
        <Panel title="Models tracked">
          <p class="font-mono text-3xl text-accent">{active.length}</p>
          <p class="font-mono text-xs text-ink-muted">{providers.size} providers</p>
        </Panel>
        <Panel title="Changes logged">
          <p class="font-mono text-3xl text-accent">{events.length}</p>
          <p class="font-mono text-xs text-ink-muted">most recent first</p>
        </Panel>
        <Panel title="Last catalogue poll">
          <p class="font-mono text-sm text-ink">{lastPoll ? shortTime(lastPoll.at) : "never"}</p>
          <p class="font-mono text-xs text-ink-muted">{lastPoll ? lastPoll.note : "awaiting first run"}</p>
        </Panel>
        <Panel title="Provider status">
          <ul class="flex flex-col gap-1">
            {statuses.length === 0 ? (
              <li class="font-mono text-xs text-ink-muted">no checks yet</li>
            ) : (
              statuses.map((s) => (
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
          <EmptyState
            title="Nothing recorded yet"
            description="The archive starts empty and fills as providers change things. Run a poll to seed it."
          />
        ) : (
          <ul class="flex flex-col">
            {events.map((row) => (
              <EventLine key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function CatalogPage() {
  const models = useQuery<ModelRow[]>("activeModels");
  const active = models.filter((m) => m.active).slice(0, 200);

  return (
    <Panel title="Catalogue" hint={`${active.length} shown`}>
      {active.length === 0 ? (
        <EmptyState title="Empty" description="No catalogue poll has run yet." />
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full font-mono text-xs">
            <thead>
              <tr class="border-b border-line text-left text-ink-muted">
                <th class="py-1 pr-3 font-normal">model</th>
                <th class="py-1 pr-3 font-normal">ctx</th>
                <th class="py-1 pr-3 font-normal">in $/M</th>
                <th class="py-1 pr-3 font-normal">out $/M</th>
                <th class="py-1 font-normal">first seen</th>
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id} class="border-b border-line last:border-0">
                  <td class="py-1 pr-3 text-ink">{m.modelId}</td>
                  <td class="py-1 pr-3 text-ink-muted">{formatContext(m.contextLength)}</td>
                  <td class="py-1 pr-3 text-ink-muted">{perMillion(m.promptPrice)}</td>
                  <td class="py-1 pr-3 text-ink-muted">{perMillion(m.completionPrice)}</td>
                  <td class="py-1 text-ink-muted">{shortTime(m.firstSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SignalsPage() {
  const trending = useQuery<TrendRow[]>("latestTrending");
  const packages = useQuery<PkgRow[]>("latestPackages");
  const pypi = useQuery<PypiRow[]>("latestPypi");
  const repos = useQuery<RepoRow[]>("latestRepos");
  const polls = useQuery<PollRow[]>("recentPolls");

  return (
    <div class="grid gap-4 sm:grid-cols-2">
      <Panel title="Hugging Face trending" hint="daily snapshot">
        {trending.length === 0 ? (
          <EmptyState title="No snapshot yet" description="The daily poll has not run." />
        ) : (
          <ul class="flex flex-col">
            {trending.map((row) => (
              <li key={row.id} class="flex gap-3 border-b border-line py-1 font-mono text-xs last:border-0">
                <span class="w-6 shrink-0 text-ink-muted">{row.rank}</span>
                <span class="min-w-0 flex-1 truncate text-ink">{row.modelId}</span>
                <span class="shrink-0 text-ink-muted">{row.likes} likes</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="SDK downloads" hint="npm, last week">
        {packages.length === 0 ? (
          <EmptyState title="No snapshot yet" description="The daily poll has not run." />
        ) : (
          <ul class="flex flex-col">
            {packages.map((row) => (
              <li key={row.id} class="flex justify-between border-b border-line py-1 font-mono text-xs last:border-0">
                <span class="text-ink">{row.pkg}</span>
                <span class="text-ink-muted">{Number(row.downloads).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="PyPI downloads" hint="last week">
        {pypi.length === 0 ? (
          <EmptyState title="No snapshot yet" description="The daily poll has not run." />
        ) : (
          <ul class="flex flex-col">
            {pypi.map((row) => (
              <li key={row.id} class="flex justify-between border-b border-line py-1 font-mono text-xs last:border-0">
                <span class="text-ink">{row.pkg}</span>
                <span class="text-ink-muted">{Number(row.lastWeek).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Repository pull" hint="stars / open issues">
        {repos.length === 0 ? (
          <EmptyState title="No snapshot yet" description="The daily poll has not run." />
        ) : (
          <ul class="flex flex-col">
            {repos.map((row) => (
              <li key={row.id} class="flex gap-3 border-b border-line py-1 font-mono text-xs last:border-0">
                <span class="min-w-0 flex-1 truncate text-ink">{row.repo}</span>
                <span class="shrink-0 text-accent">{Number(row.stars).toLocaleString()}</span>
                <span class="w-12 shrink-0 text-right text-ink-muted">{row.openIssues}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Collector log" hint="gaps in the archive are visible here">
        {polls.length === 0 ? (
          <EmptyState title="No runs yet" description="Nothing has polled." />
        ) : (
          <ul class="flex flex-col">
            {polls.map((row) => (
              <li key={row.id} class="flex gap-3 border-b border-line py-1 font-mono text-xs last:border-0">
                <span class="shrink-0 text-ink-muted">{shortTime(row.at)}</span>
                <span class="w-14 shrink-0 text-ink-muted">{row.source}</span>
                <span class="min-w-0 flex-1 truncate text-ink">{row.note}</span>
                <span class={row.ok ? "shrink-0 text-success" : "shrink-0 text-danger"}>
                  {row.ok ? "ok" : "fail"}
                </span>
              </li>
            ))}
          </ul>
        )}
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
          providers without an API key. Every 30 minutes the collector diffs the catalogue against
          what it saw last time and records what moved: a model appearing, a model quietly
          disappearing, a price change, a context window change, a capability flag flipping.
        </p>
        <p>
          Providers do this without announcements and edit their docs in place. The archive
          timestamps it instead. The change log is the artifact; the rest of the console is
          just a way to look at it.
        </p>
        <p class="font-mono text-xs">
          Raw data: <a class="text-accent hover:underline" href="/api/events.json">/api/events.json</a>
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

export function App() {
  return (
    <Router>
      <main class="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 p-6">
        <header class="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
          <div>
            <h1 class="font-mono text-lg tracking-[0.3em] text-accent uppercase">AI Observatory</h1>
            <p class="font-mono text-xs text-ink-muted">
              what the providers changed, and when
            </p>
          </div>
          <Nav />
        </header>
        <Routes>
          <Route path="/" element={<ConsolePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/signals" element={<SignalsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route
            path="*"
            element={<EmptyState title="Not found" description="No panel at this path." />}
          />
        </Routes>
      </main>
    </Router>
  );
}
