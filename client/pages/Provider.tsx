/**
 * One provider: is it up, is it getting cheaper, what does it list, what did it change.
 */
import { useMemo } from "preact/hooks";
import { Link, useParams, useQuery } from "@spacefast/zero/client";
import { Sparkline } from "@spacefast/zero/charts";
import { Badge, EmptyState, Skeleton } from "@spacefast/zero/kit";

import { money, formatContext } from "../../shared/model";
import { providerName, isAlias } from "../../shared/providers";
import { canonicalProvider } from "../../shared/sources";
import type { ArchiveEvent, ProviderPageData } from "../../shared/types";
import { Card, ModelLink, Section } from "../components/bits";
import { StepChart, type StepSeries } from "../components/StepChart";
import { StoryRow } from "../components/StoryRow";
import { UptimeBar } from "../components/UptimeBar";
import { inputSpark, uptimeDays, uptimePct } from "../lib/series";
import { assembleStories, keyIndex, nameIndex, storyHref } from "../lib/stories";
import { DAY, ago, dayLabel, isLoading, longDate, plural, usePageTitle, useSince } from "../lib/util";

function impactTone(impact: string) {
  if (impact === "critical" || impact === "major") return "danger" as const;
  if (impact === "minor") return "warning" as const;
  return "neutral" as const;
}

export function ProviderPage() {
  const { slug = "" } = useParams() as { slug?: string };
  const data = useQuery<ProviderPageData>("providerPage", slug);
  const since90 = useSince(90);
  const recent = useQuery<ArchiveEvent[]>("eventsSince", since90);
  const name = providerName(slug);
  usePageTitle(name);

  const loading = isLoading(data);
  const models = loading ? [] : data.models;
  const names = useMemo(() => nameIndex(models), [models]);
  const keys = useMemo(() => keyIndex(models), [models]);
  const stories = useMemo(() => (loading ? [] : assembleStories({ events: data.events, names })), [loading, data, names]);
  const ownRecent = (recent ?? []).filter((e) => e.provider.replace(/^~/, "") === slug);

  if (loading) return <div class="flex flex-col gap-4"><Skeleton class="h-10 w-1/2" /><Skeleton class="h-24 w-full" /><Skeleton class="h-64 w-full" /></div>;
  if (models.length === 0) return <EmptyState title="Unknown provider" description={`No models from "${slug}" have been seen.`} icon="search" action={<Link to="/status" class="text-accent hover:underline">All providers</Link>} />;

  const active = models.filter((m) => m.active);
  const retired = models.filter((m) => !m.active);
  const days = uptimeDays(data.status, data.statusEvents, data.incidents, 90);
  const pct = uptimePct(days);
  const indicator = data.status?.indicator ?? "";
  const stateWord = indicator === "none" ? "up" : indicator === "minor" ? "degraded" : indicator === "major" || indicator === "critical" ? "outage" : indicator === "unreachable" ? "status page unreachable" : "no status page tracked";
  const stateClass = indicator === "none" ? "text-success" : indicator === "minor" ? "text-warning" : indicator === "major" || indicator === "critical" ? "text-danger" : "text-ink-muted";

  const daily = data.daily;
  const medianSeries: StepSeries[] = daily.length > 1 ? [
    { key: "in", label: "median input $/M", points: daily.map((d) => ({ t: Date.parse(`${d.date}T00:00:00Z`), value: Number(d.medianIn) })).filter((p) => Number.isFinite(p.value)) },
    { key: "out", label: "median output $/M", points: daily.map((d) => ({ t: Date.parse(`${d.date}T00:00:00Z`), value: Number(d.medianOut) })).filter((p) => Number.isFinite(p.value)) },
  ] : [];
  const incidentsByDay = new Map<string, typeof data.incidents>();
  for (const i of data.incidents) {
    const day = i.startedAt.slice(0, 10);
    const list = incidentsByDay.get(day);
    if (list) list.push(i);
    else incidentsByDay.set(day, [i]);
  }
  const retiringSoon = data.lifecycle.filter((l) => l.state === "deprecated" && l.retiresAt && Date.parse(l.retiresAt) > Date.now() - DAY).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
  const sorted = active.slice().sort((a, b) => Number(isAlias(a.modelId)) - Number(isAlias(b.modelId)) || b.firstSeenAt.localeCompare(a.firstSeenAt));

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{name}</h1>
        <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span class={`inline-flex items-center gap-1.5 ${stateClass}`}>
            <span class={`inline-block size-2 rounded-full ${indicator === "none" ? "bg-success" : indicator === "minor" ? "bg-warning" : indicator === "major" || indicator === "critical" ? "bg-danger" : "bg-line"}`} aria-hidden="true" />
            {stateWord}
          </span>
          {data.status?.description ? <span>· {data.status.description}</span> : null}
          <span>· {plural(active.length, "model")} listed{retired.length ? `, ${retired.length} no longer listed` : ""}</span>
          {retiringSoon.length ? <span>· <Link to="/retiring" class="text-danger hover:underline">{plural(retiringSoon.length, "retirement")} announced</Link></span> : null}
          <span>· <a href={`/feed.xml?provider=${encodeURIComponent(slug)}`} class="text-accent hover:underline">RSS</a></span>
        </p>
        {data.status ? <div class="max-w-2xl"><UptimeBar days={days} label={name} /></div> : <p class="text-xs text-ink-muted">This provider's status page is not tracked yet.</p>}
      </div>

      {medianSeries.length ? (
        <Section title="Price direction" hint="median price across this provider's listed models, per day">
          <Card>
            <StepChart series={medianSeries} from={Date.parse(`${daily[0].date}T00:00:00Z`)} height={200} />
          </Card>
        </Section>
      ) : null}

      <Section title="Models" hint={`${active.length} listed`} action={<Link to={`/models?provider=${encodeURIComponent(slug)}`} class="text-accent hover:underline">open in the table</Link>}>
        <Card padded={false}>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-line text-left text-xs text-ink-muted">
                  <th class="px-4 py-2 font-normal">model</th>
                  <th class="px-2 py-2 font-normal">90 days</th>
                  <th class="px-2 py-2 text-right font-normal">context</th>
                  <th class="px-2 py-2 text-right font-normal">in $/M</th>
                  <th class="px-2 py-2 text-right font-normal">out $/M</th>
                  <th class="px-4 py-2 text-right font-normal">listed</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.id} class="border-b border-line last:border-0">
                    <td class="px-4 py-1.5"><ModelLink modelId={m.modelId} name={m.name} />{Number(m.changeCount) > 0 ? <span class="ml-2 text-[11px] text-ink-muted">{m.changeCount} changes</span> : null}</td>
                    <td class="px-2 py-1.5"><Sparkline values={inputSpark(m, ownRecent)} width={72} height={18} /></td>
                    <td class="px-2 py-1.5 text-right font-mono tabular-nums text-ink-muted">{formatContext(m.contextLength)}</td>
                    <td class="px-2 py-1.5 text-right font-mono tabular-nums text-ink">{money(m.promptPrice)}</td>
                    <td class="px-2 py-1.5 text-right font-mono tabular-nums text-ink">{money(m.completionPrice)}</td>
                    <td class="px-4 py-1.5 text-right font-mono text-xs tabular-nums text-ink-muted">{longDate(m.firstSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      {data.lifecycle.length ? (
        <Section title="Lifecycle notices" hint="from the provider's own deprecation page">
          <Card padded={false}>
            <ul>
              {data.lifecycle.slice().sort((a, b) => (a.retiresAt || "9999").localeCompare(b.retiresAt || "9999")).map((l) => (
                <li key={l.id} class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-sm last:border-0">
                  <span class="font-mono text-xs text-ink">{l.modelId}</span>
                  <Badge tone={l.state === "retired" ? "danger" : l.state === "deprecated" ? "warning" : "success"}>{l.state}</Badge>
                  {l.retiresAt ? <span class="text-ink-muted">{l.state === "retired" ? "retired" : l.retiresNote === "not sooner than" ? "supported until at least" : "retires"} {longDate(l.retiresAt)}</span> : l.state === "deprecated" ? <span class="text-ink-muted">retirement date to be announced</span> : null}
                  {l.replacement ? <span class="text-ink-muted">→ {l.replacement}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <div class="grid gap-10 lg:grid-cols-2">
        <Section title="Changes" hint="newest first">
          <Card padded={false} class="px-4">
            {stories.length === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <ul>{stories.filter((s) => s.kind !== "drift").slice(0, 40).map((s) => <StoryRow key={s.key} story={s} href={storyHref(s, keys)} compact relative />)}</ul>
            )}
          </Card>
        </Section>
        <Section title="Incidents" hint="last 90 days, from the status page">
          <Card padded={false} class="px-4">
            {data.incidents.length === 0 ? (
              <p class="py-3 text-sm text-ink-muted">{data.status ? "No incidents recorded." : "No status page tracked."}</p>
            ) : (
              [...incidentsByDay.entries()].map(([day, list]) => (
                <div key={day}>
                  <h3 class="border-b border-line py-1.5 text-xs font-medium text-ink-muted">{dayLabel(day)}</h3>
                  <ul>
                    {list.map((i) => (
                      <li key={i.id} class="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm last:border-0">
                        <Badge tone={impactTone(i.impact)}>{i.impact || "incident"}</Badge>
                        {i.url ? <a href={i.url} target="_blank" rel="noopener" class="text-ink hover:text-accent">{i.name}</a> : <span class="text-ink">{i.name}</span>}
                        <span class="ml-auto font-mono text-xs text-ink-muted">
                          {i.resolvedAt ? `${Math.max(1, Math.round((Date.parse(i.resolvedAt) - Date.parse(i.startedAt)) / 60000))} min` : i.status === "resolved" ? "resolved" : `ongoing · ${ago(i.startedAt)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </Card>
        </Section>
      </div>
      <p class="text-xs text-ink-muted">Status and incidents are read from the provider's own status page; the provider's slug here is "{canonicalProvider(slug)}".</p>
    </div>
  );
}
