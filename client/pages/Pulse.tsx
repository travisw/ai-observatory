/**
 * Pulse: where developer attention is going, snapshotted once a day, kept as a logbook.
 */
import type { ComponentChildren } from "preact";
import { useQuery } from "@spacefast/zero/client";

import type { PkgRow, PollRow, PypiRow, RepoRow, TrendRow } from "../../shared/types";
import { BoardEmpty, LogLine, LogSection, Marquee } from "../components/Log";
import { boardDate, boardTime } from "../lib/board";
import { dayLabel, usePageTitle } from "../lib/util";

function List<T extends { id: string }>(props: { rows: T[] | undefined; render: (r: T) => ComponentChildren; empty?: string }) {
  const rows = props.rows ?? [];
  if (rows.length === 0) return <BoardEmpty>{props.empty ?? "No snapshot yet. The daily check has not run."}</BoardEmpty>;
  return <ul>{rows.map((r) => props.render(r))}</ul>;
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
    <div class="flex flex-col gap-8">
      <Marquee title="Pulse">
        Where attention is going, snapshotted once a day: what people download, star and look at.{latestDay ? ` Last snapshot ${dayLabel(latestDay).toLowerCase()}.` : ""}
      </Marquee>
      <div class="grid gap-8 md:grid-cols-2">
        <LogSection title="Hugging Face trending" hint="open-weights models people are looking at">
          <List rows={trending} render={(r) => (
            <LogLine key={r.id} left={`#${r.rank}`} right={<span class="text-ink-muted">{Number(r.likes).toLocaleString()} LIKES</span>}>
              <a href={`https://huggingface.co/${r.modelId}`} target="_blank" rel="noopener" class="font-mono text-xs hover:text-accent">{r.modelId}</a>
            </LogLine>
          )} />
        </LogSection>
        <LogSection title="npm downloads" hint="client libraries, last week">
          <List rows={packages} render={(r) => (
            <LogLine key={r.id} left="NPM" right={<span class="text-ink">{Number(r.downloads).toLocaleString()}</span>}><span class="font-mono text-xs">{r.pkg}</span></LogLine>
          )} />
        </LogSection>
        <LogSection title="PyPI downloads" hint="client libraries, last week">
          <List rows={pypi} render={(r) => (
            <LogLine key={r.id} left="PYPI" right={<span class="text-ink">{Number(r.lastWeek).toLocaleString()}</span>}><span class="font-mono text-xs">{r.pkg}</span></LogLine>
          )} />
        </LogSection>
        <LogSection title="GitHub" hint="stars · open issues">
          <List rows={repos} render={(r) => (
            <LogLine key={r.id} left="REPO" right={<span><span class="text-accent">{Number(r.stars).toLocaleString()} ★</span> <span class="text-ink-muted">{r.openIssues} OPEN</span></span>}>
              <a href={`https://github.com/${r.repo}`} target="_blank" rel="noopener" class="font-mono text-xs hover:text-accent">{r.repo}</a>
            </LogLine>
          )} />
        </LogSection>
      </div>
      <LogSection title="Collector log" hint="each check, newest first; gaps in the record show up here">
        <List rows={polls} render={(r) => (
          <LogLine key={r.id} left={`${boardDate(r.at)} ${boardTime(r.at)}`} right={<span class={r.ok ? "text-success" : "text-danger"}>{r.ok ? "OK" : "FAILED"}</span>}>
            <span class="mr-2 text-[10px] uppercase tracking-[0.2em] text-ink-muted">{r.source}</span>{r.note}
          </LogLine>
        )} />
      </LogSection>
    </div>
  );
}
