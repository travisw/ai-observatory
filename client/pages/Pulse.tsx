/**
 * Pulse: where developer attention is going, snapshotted once a day, kept as a record.
 */
import type { ComponentChildren } from "preact";
import { useQuery } from "@spacefast/zero/client";

import type { PulseData } from "../../shared/types";
import { Empty, PageHead, Pill, Section, Skeleton } from "../components/Wire";
import { dayShort, hm } from "../lib/text";
import { dayLabel, isLoading, usePageTitle } from "../lib/util";

function Table<T extends { id: string }>(props: { rows: T[]; render: (r: T) => ComponentChildren; empty?: string; label: string }) {
  if (props.rows.length === 0) return <Empty>{props.empty ?? "No snapshot yet. The daily check has not run."}</Empty>;
  return <div class="tw"><table aria-label={props.label}><tbody>{props.rows.map((r) => props.render(r))}</tbody></table></div>;
}

/** The snapshot's day, so a list whose source failed on the latest run says how old it is. */
function taken(rows: { at: string }[]): string {
  return rows[0] ? ` · ${dayLabel(rows[0].at).toLowerCase()}` : "";
}

export function PulsePage() {
  usePageTitle("Pulse");
  const data = useQuery<PulseData>("pulsePage");
  if (isLoading(data)) return <Skeleton rows={10} />;
  const { trending, packages, pypi, repos, polls } = data;
  const latestDay = trending[0]?.at;

  return (
    <div class="stack">
      <PageHead title="Pulse">
        Where attention is going, snapshotted once a day: what people download, star and look at.{latestDay ? ` Last snapshot ${dayLabel(latestDay).toLowerCase()}.` : ""}
      </PageHead>
      <div class="two" style={{ gridTemplateColumns: "1fr 1fr", padding: 0 }}>
        <Section title="Hugging Face trending" hint={`open-weights models people are looking at${taken(trending)}`}>
          <Table label="Hugging Face trending" rows={trending} render={(r) => (
            <tr key={r.id}>
              <td class="when">#{r.rank}</td>
              <td><a href={`https://huggingface.co/${r.modelId}`} target="_blank" rel="noopener" class="hl mono small">{r.modelId}</a></td>
              <td class="n soft">{Number(r.likes).toLocaleString()} likes</td>
            </tr>
          )} />
        </Section>
        <Section title="npm downloads" hint={`client libraries, last week${taken(packages)}`}>
          <Table label="npm downloads" rows={packages} render={(r) => (
            <tr key={r.id}><td class="mono small">{r.pkg}</td><td class="n">{Number(r.downloads).toLocaleString()}</td></tr>
          )} />
        </Section>
        <Section title="PyPI downloads" hint={`client libraries, last week${taken(pypi)}`}>
          <Table label="PyPI downloads" rows={pypi} render={(r) => (
            <tr key={r.id}><td class="mono small">{r.pkg}</td><td class="n">{Number(r.lastWeek).toLocaleString()}</td></tr>
          )} />
        </Section>
        <Section title="GitHub" hint={`stars · open issues${taken(repos)}`}>
          <Table label="GitHub repositories" rows={repos} render={(r) => (
            <tr key={r.id}>
              <td><a href={`https://github.com/${r.repo}`} target="_blank" rel="noopener" class="hl mono small">{r.repo}</a></td>
              <td class="n"><span class="acc">{Number(r.stars).toLocaleString()} ★</span> <span class="soft">{r.openIssues} open</span></td>
            </tr>
          )} />
          <p class="soft small">
            Counts come from <a href="https://repos.ecosyste.ms" target="_blank" rel="noopener">ecosyste.ms</a> (CC BY-SA 4.0), which copies GitHub every few days, so they can trail GitHub by up to a week.
          </p>
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
