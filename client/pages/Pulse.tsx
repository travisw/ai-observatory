/**
 * Pulse: where developer attention is going, snapshotted once a day.
 */
import type { ComponentChildren } from "preact";
import { useQuery } from "@spacefast/zero/client";
import { EmptyState } from "@spacefast/zero/kit";

import type { PkgRow, PollRow, PypiRow, RepoRow, TrendRow } from "../../shared/types";
import { Card, Section } from "../components/bits";
import { clockTime, dayLabel, usePageTitle } from "../lib/util";

function List<T extends { id: string }>(props: { rows: T[] | undefined; render: (r: T) => ComponentChildren; empty?: string }) {
  const rows = props.rows ?? [];
  if (rows.length === 0) return <EmptyState title="No snapshot yet" description={props.empty ?? "The daily check has not run."} />;
  return <ul>{rows.map((r) => <li key={r.id} class="flex items-center gap-3 border-b border-line px-4 py-1.5 text-sm last:border-0">{props.render(r)}</li>)}</ul>;
}

export function PulsePage() {
  usePageTitle("Pulse");
  const trending = useQuery<TrendRow[]>("latestTrending");
  const packages = useQuery<PkgRow[]>("latestPackages");
  const pypi = useQuery<PypiRow[]>("latestPypi");
  const repos = useQuery<RepoRow[]>("latestRepos");
  const polls = useQuery<PollRow[]>("recentPolls");
  const latestDay = trending?.[0]?.at;

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Pulse</h1>
        <p class="max-w-2xl text-sm text-ink-muted">Where attention is going, snapshotted once a day: what people download, star and look at.{latestDay ? ` Last snapshot ${dayLabel(latestDay).toLowerCase()}.` : ""}</p>
      </div>
      <div class="grid gap-8 md:grid-cols-2">
        <Section title="Hugging Face trending" hint="open-weights models people are looking at">
          <Card padded={false}>
            <List rows={trending} render={(r) => (<><span class="w-6 font-mono text-xs text-ink-muted">{r.rank}</span><a href={`https://huggingface.co/${r.modelId}`} target="_blank" rel="noopener" class="min-w-0 flex-1 truncate text-ink hover:text-accent">{r.modelId}</a><span class="font-mono text-xs tabular-nums text-ink-muted">{Number(r.likes).toLocaleString()} likes</span></>)} />
          </Card>
        </Section>
        <Section title="npm downloads" hint="client libraries, last week">
          <Card padded={false}>
            <List rows={packages} render={(r) => (<><span class="min-w-0 flex-1 truncate font-mono text-ink">{r.pkg}</span><span class="font-mono text-xs tabular-nums text-ink-muted">{Number(r.downloads).toLocaleString()}</span></>)} />
          </Card>
        </Section>
        <Section title="PyPI downloads" hint="client libraries, last week">
          <Card padded={false}>
            <List rows={pypi} render={(r) => (<><span class="min-w-0 flex-1 truncate font-mono text-ink">{r.pkg}</span><span class="font-mono text-xs tabular-nums text-ink-muted">{Number(r.lastWeek).toLocaleString()}</span></>)} />
          </Card>
        </Section>
        <Section title="GitHub" hint="stars · open issues">
          <Card padded={false}>
            <List rows={repos} render={(r) => (<><a href={`https://github.com/${r.repo}`} target="_blank" rel="noopener" class="min-w-0 flex-1 truncate font-mono text-ink hover:text-accent">{r.repo}</a><span class="font-mono text-xs tabular-nums text-accent">{Number(r.stars).toLocaleString()}</span><span class="w-12 text-right font-mono text-xs tabular-nums text-ink-muted">{r.openIssues}</span></>)} />
          </Card>
        </Section>
      </div>
      <Section title="Collector log" hint="each check, newest first; gaps in the record show up here">
        <Card padded={false}>
          <List rows={polls} render={(r) => (<><span class="font-mono text-xs text-ink-muted">{dayLabel(r.at)} {clockTime(r.at)}</span><span class="w-16 font-mono text-xs text-ink-muted">{r.source}</span><span class="min-w-0 flex-1 truncate text-ink">{r.note}</span><span class={`font-mono text-xs ${r.ok ? "text-success" : "text-danger"}`}>{r.ok ? "ok" : "failed"}</span></>)} />
        </Card>
      </Section>
    </div>
  );
}
