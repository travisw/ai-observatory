/**
 * One provider: is it up, is it getting cheaper, what does it list, what did it change,
 * what has it promised to retire.
 */
import { useMemo } from "preact/hooks";
import { Link, useParams, useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import type { ArchiveEvent, ProviderPageData } from "../../shared/types";
import { StepChart, type StepSeries } from "../components/StepChart";
import { Chip, DayRow, Empty, PageHead, Pill, Section, Skeleton, Stat, StoryRow, StoryTable, UptimeStrip } from "../components/Wire";
import { uptimeDays, uptimeSummary } from "../lib/series";
import { assembleStories, keyIndex, nameIndex, storyHref } from "../lib/stories";
import { dayShort, daysLeft, hm, pct, shortName, statusRemark, statusWord } from "../lib/text";
import { DAY, ago, dayLabel, isLoading, longDate, modelHref, plural, usePageTitle, useSince } from "../lib/util";

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

  if (loading) return <Skeleton />;
  if (models.length === 0) {
    return (
      <div class="stack">
        <PageHead title="Unknown provider">No models from "{slug}" have been seen. <Link to="/providers">All providers</Link>.</PageHead>
      </div>
    );
  }

  const active = models.filter((m) => m.active);
  const retired = models.filter((m) => !m.active);
  const days = uptimeDays(data.status, data.statusEvents, data.incidents, 90);
  const sum = uptimeSummary(days);
  const word = data.status ? statusWord(data.status.indicator) : null;

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
  const leaving = data.lifecycle
    .filter((l) => l.state !== "active" && l.retiresAt && l.retiresNote !== "not sooner than" && Date.parse(l.retiresAt) > Date.now() - 60 * DAY)
    .sort((a, b) => a.retiresAt.localeCompare(b.retiresAt))
    .slice(0, 12);
  // The models that moved most recently lead; the rest in listing order.
  const movers = active.slice().sort((a, b) => (b.lastChangedAt || "").localeCompare(a.lastChangedAt || "") || b.firstSeenAt.localeCompare(a.firstSeenAt)).slice(0, 12);
  const lastMove = (m: typeof active[number]) => ownRecent.find((e) => e.modelId === m.modelId && e.kind === "changed" && e.field === "promptPrice");

  return (
    <div class="stack">
      <PageHead title={name} action={<><Chip to={`/models?provider=${encodeURIComponent(slug)}`}>All models</Chip><Chip href={`/feed.xml?provider=${encodeURIComponent(slug)}`}>Feed</Chip></>}>
        {plural(active.length, "model")} listed{retired.length ? `, ${retired.length} no longer listed` : ""}
        {leaving.length ? <>, <Link to="/retiring">{plural(leaving.length, "retirement")} announced</Link></> : null}.
        {data.status ? ` Status page checked ${ago(data.status.checkedAt)}.` : " No status page tracked."}
      </PageHead>

      {data.status ? (
        <div class="stats">
          <div class="stat">
            <div class="v"><Pill tone={word?.tone}>{word?.word}</Pill></div>
            <div class="l">{statusRemark(data.status.indicator, data.status.description)}</div>
          </div>
          <div class="stat">
            <div class="v"><UptimeStrip days={days} label={`${name} over the last 90 days`} /></div>
            <div class="l">90 days · {sum.recorded === 0 ? "no record yet" : sum.incidentDays === 0 ? `no incidents in ${sum.recorded} recorded days` : `${sum.incidentDays} incident days of ${sum.recorded} recorded`}</div>
          </div>
          <Stat value={String(active.length)} label="models listed" href={`/models?provider=${encodeURIComponent(slug)}`} />
        </div>
      ) : null}

      <Section title="Models" hint={`${active.length} listed, most recently moved first`}>
        <div class="tw">
          <table aria-label={`${name} models`}>
            <thead><tr><th>Model</th><th class="n">Context</th><th class="n">In $/M</th><th class="n">Out $/M</th><th>Last move</th><th>Listed</th></tr></thead>
            <tbody>
              {movers.map((m) => {
                const move = lastMove(m);
                const delta = move ? ((Number(move.newValue) - Number(move.oldValue)) / Number(move.oldValue)) * 100 : null;
                const moved = delta !== null && Number.isFinite(delta);
                return (
                  <tr key={m.id} data-feed-row>
                    <td>
                      <Link to={modelHref(m.modelId)} class="hl">{shortName(m.modelId, m.name)}</Link>
                      {isAlias(m.modelId) ? <span class="tag">alias</span> : null}
                    </td>
                    <td class="n soft">{formatContext(m.contextLength)}</td>
                    <td class="n">{money(m.promptPrice)}</td>
                    <td class="n">{money(m.completionPrice)}</td>
                    <td class="when">
                      {move && moved ? <>{dayShort(move.at)} <span class={delta < 0 ? "cut" : "rise"}>{pct(delta)}</span></> : m.lastChangedAt ? dayShort(m.lastChangedAt) : "—"}
                    </td>
                    <td class="when" title={longDate(m.firstSeenAt)}>{dayShort(m.firstSeenAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {medianSeries.length ? (
        <Section title="Price direction" hint="median price across this provider's listed models, per day">
          <div class="box">
            <StepChart series={medianSeries} from={Date.parse(`${daily[0].date}T00:00:00Z`)} height={200} />
          </div>
        </Section>
      ) : null}

      {leaving.length ? (
        <Section title="Retiring" hint="from the provider's own notices" action={<Chip to="/retiring">All retirements</Chip>}>
          <div class="tw">
            <table aria-label={`${name} retirements`}>
              <thead><tr><th>Retires</th><th>Model</th><th>Replacement</th><th class="n">Left</th></tr></thead>
              <tbody>
                {leaving.map((l) => {
                  const left = daysLeft(l.retiresAt);
                  const tracked = keys.get(l.key);
                  return (
                    <tr key={l.id} data-feed-row class={left.text === "retired" ? "dim" : undefined}>
                      <td class="when">{dayShort(l.retiresAt)}</td>
                      <td>{tracked ? <Link to={modelHref(tracked)} class="hl">{l.modelId}</Link> : l.modelId}</td>
                      <td class="soft small">{l.replacement || "—"}</td>
                      <td class="n"><Pill tone={left.tone}>{left.text}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <div class="two" style={{ padding: 0 }}>
        <Section title="Changes" hint="newest first">
          {stories.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            <StoryTable label={`${name} changes`}>
              {stories.filter((s) => s.kind !== "drift").slice(0, 40).map((s) => <StoryRow key={s.key} story={s} href={storyHref(s, keys)} date />)}
            </StoryTable>
          )}
        </Section>
        <Section title="Incidents" hint="last 90 days, from the status page">
          {data.incidents.length === 0 ? (
            <Empty>{data.status ? "No incidents recorded." : "No status page tracked."}</Empty>
          ) : (
            <div class="tw">
              <table aria-label={`${name} incidents`}>
                <thead><tr><th>Time</th><th>Incident</th><th class="n">Lasted</th></tr></thead>
                <tbody>
                  {[...incidentsByDay.entries()].map(([day, list]) => (
                    <>
                      <DayRow key={day}>{dayLabel(day)}</DayRow>
                      {list.map((i) => (
                        <tr key={i.id} data-feed-row>
                          <td class="when">{hm(i.startedAt)}</td>
                          <td>
                            {i.url ? <a href={i.url} target="_blank" rel="noopener" class="hl">{i.name}</a> : i.name}
                            <span class="who">{i.impact || "incident"}</span>
                          </td>
                          <td class={`n ${i.impact === "critical" || i.impact === "major" ? "rise" : i.impact === "minor" ? "warn" : "soft"}`}>
                            {i.resolvedAt ? `${Math.max(1, Math.round((Date.parse(i.resolvedAt) - Date.parse(i.startedAt)) / 60000))} min` : i.status === "resolved" ? "resolved" : `ongoing · ${ago(i.startedAt)}`}
                          </td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
