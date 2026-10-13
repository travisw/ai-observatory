/**
 * Pulse: where developer attention is going, snapshotted once a day, kept as a record.
 */
import type { ComponentChildren } from "preact";
import { useQuery } from "@spacefast/zero/client";

import type { PkgRow, PollRow, PypiRow, RepoRow, TrendRow } from "../../shared/types";
import { Empty, PageHead, Pill, Section } from "../components/Wire";
import { dayShort, hm } from "../lib/text";
import { dayLabel, usePageTitle } from "../lib/util";

function Table<T extends { id: string }>(props: { rows: T[] | undefined; render: (r: T) => ComponentChildren; empty?: string; label: string }) {
  const rows = props.rows ?? [];
  if (rows.length === 0) return <Empty>{props.empty ?? "No snapshot yet. The daily check has not run."}</Empty>;
  return <div class="tw"><table aria-label={props.label}><tbody>{rows.map((r) => props.render(r))}</tbody></table></div>;
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
    <div class="stack">
      <PageHead title="Pulse">
        Where attention is going, snapshotted once a day: what people download, star and look at.{latestDay ? ` Last snapshot ${dayLabel(latestDay).toLowerCase()}.` : ""}
      </PageHead>
      <div class="two" style={{ gridTemplateColumns: "1fr 1fr", padding: 0 }}>
        <Section title="Hugging Face trending" hint="open-weights models people are looking at">
          <Table label="Hugging Face trending" rows={trending} render={(r) => (
            <tr key={r.id}>
              <td class="when">#{r.rank}</td>
              <td><a href={`https://huggingface.co/${r.modelId}`} target="_blank" rel="noopener" class="hl mono small">{r.modelId}</a></td>
              <td class="n soft">{Number(r.likes).toLocaleString()} likes</td>
            </tr>
          )} />
        </Section>
        <Section title="npm downloads" hint="client libraries, last week">
          <Table label="npm downloads" rows={packages} render={(r) => (
            <tr key={r.id}><td class="mono small">{r.pkg}</td><td class="n">{Number(r.downloads).toLocaleString()}</td></tr>
          )} />
        </Section>
        <Section title="PyPI downloads" hint="client libraries, last week">
          <Table label="PyPI downloads" rows={pypi} render={(r) => (
            <tr key={r.id}><td class="mono small">{r.pkg}</td><td class="n">{Number(r.lastWeek).toLocaleString()}</td></tr>
          )} />
        </Section>
        <Section title="GitHub" hint="stars · open issues">
          <Table label="GitHub repositories" rows={repos} render={(r) => (
            <tr key={r.id}>
              <td><a href={`https://github.com/${r.repo}`} target="_blank" rel="noopener" class="hl mono small">{r.repo}</a></td>
              <td class="n"><span class="acc">{Number(r.stars).toLocaleString()} ★</span> <span class="soft">{r.openIssues} open</span></td>
            </tr>
          )} />
        </Section>
      </div>
      <Section title="Collector record" hint="each check, newest first; gaps in the record show up here">
        <Table label="Collector record" rows={polls} render={(r) => (
          <tr key={r.id}>
            <td class="when">{dayShort(r.at)} {hm(r.at)}</td>
            <td><span class="tag" style={{ marginLeft: 0, marginRight: 8 }}>{r.source}</span>{r.note}</td>
            <td class="n"><Pill tone={r.ok ? "ok" : "bad"}>{r.ok ? "ok" : "failed"}</Pill></td>
          </tr>
        )} />
      </Section>
    </div>
  );
}
