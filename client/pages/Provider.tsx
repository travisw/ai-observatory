/**
 * One provider: is it up, is it getting cheaper, what does it list, what did it change,
 * what has it promised to retire.
 */
import { useMemo } from "preact/hooks";
import { Link, useParams, useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import type { ArchiveEvent, ProviderPageData } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, FlapText, Sign } from "../components/Flap";
import { BoardEmpty, LogDay, LogLine, LogSection, PageSkeleton, StoryLine } from "../components/Log";
import { StepChart, type StepSeries } from "../components/StepChart";
import { boardDate, boardTime, departureStatus, remarkWord, shortName, statusWord } from "../lib/board";
import { uptimeDays, uptimeSummary } from "../lib/series";
import { assembleStories, keyIndex, nameIndex, storyHref } from "../lib/stories";
import { DAY, ago, dayLabel, isLoading, longDate, modelHref, plural, usePageTitle, useSince } from "../lib/util";
import { UptimeStrip } from "./Home";

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

  if (loading) return <PageSkeleton />;
  if (models.length === 0) {
    return (
      <div class="flex flex-col gap-4">
        <FlapText text="UNKNOWN PROVIDER" width={16} size="lg" tone="danger" />
        <p class="text-sm text-ink-muted">No models from "{slug}" have been seen. <Link to="/providers" class="text-accent hover:underline">All providers</Link>.</p>
      </div>
    );
  }

  const active = models.filter((m) => m.active);
  const retired = models.filter((m) => !m.active);
  const days = uptimeDays(data.status, data.statusEvents, data.incidents, 90);
  const sum = uptimeSummary(days);
  const spec = data.status ? statusWord(data.status.indicator) : { word: "NO PAGE", tone: "muted" as const };

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
    <div class="flex flex-col gap-8">
      <Board label={name} hint={data.status?.description ? remarkWord(data.status.indicator, data.status.description).toLowerCase() : "no status page tracked"} action={<Sign href={`/feed.xml?provider=${encodeURIComponent(slug)}`}>RSS</Sign>}>
        <div class="flex flex-col gap-4 px-3 py-4">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <h1><FlapText text={name} width={Math.min(24, Math.max(6, name.length))} size="lg" /></h1>
            <FlapText text={spec.word} width={9} size="lg" tone={spec.tone} delay={200} />
          </div>
          <p class="text-xs uppercase tracking-[0.2em] text-ink-muted">
            {plural(active.length, "model")} listed{retired.length ? ` · ${retired.length} no longer listed` : ""}
            {leaving.length ? <> · <Link to="/retiring" class="text-danger hover:underline">{plural(leaving.length, "departure")} announced</Link></> : null}
            {data.status ? ` · checked ${ago(data.status.checkedAt)}` : ""}
          </p>
          {data.status ? (
            <div class="flex flex-col gap-1">
              <div class="overflow-x-auto"><UptimeStrip days={days} label={`${name} over the last 90 days`} /></div>
              <span class="text-[11px] uppercase tracking-[0.2em] text-ink-muted">90 days · {sum.recorded === 0 ? "no record yet" : sum.incidentDays === 0 ? `no incidents in ${sum.recorded} recorded days` : `${sum.incidentDays} incident days of ${sum.recorded} recorded`}</span>
            </div>
          ) : null}
        </div>
      </Board>

      <Board label="Models" hint={`${active.length} listed, most recently moved first`} action={<Sign to={`/models?provider=${encodeURIComponent(slug)}`}>Full list</Sign>}>
        <ColumnHeads columns={[{ label: "Model", width: 22, sticky: true }, { label: "Context", width: 6, align: "right" }, { label: "In $/M", width: 7, align: "right" }, { label: "Out $/M", width: 7, align: "right" }, { label: "Last move", width: 12 }, { label: "Listed", width: 6 }]} />
        {movers.map((m, i) => {
          const move = lastMove(m);
          const pct = move ? ((Number(move.newValue) - Number(move.oldValue)) / Number(move.oldValue)) * 100 : null;
          const moveText = move && pct !== null && Number.isFinite(pct) ? `${boardDate(move.at)} ${pct < 0 ? "▼" : "▲"}${Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%` : m.lastChangedAt ? boardDate(m.lastChangedAt) : "-";
          return (
            <FlapRow
              key={m.id}
              href={modelHref(m.modelId)}
              label={`${shortName(m.modelId, m.name)}: ${money(m.promptPrice)} in, ${money(m.completionPrice)} out, ${formatContext(m.contextLength)} context, listed ${longDate(m.firstSeenAt)}`}
              delay={i * 40}
              columns={[
                { text: isAlias(m.modelId) ? `${shortName(m.modelId, m.name).slice(0, 16)} ALIAS` : shortName(m.modelId, m.name), width: 22, sticky: true },
                { text: formatContext(m.contextLength), width: 6, align: "right", tone: "muted" },
                { text: money(m.promptPrice), width: 7, align: "right" },
                { text: money(m.completionPrice), width: 7, align: "right" },
                { text: moveText, width: 12, tone: pct === null ? "muted" : pct < 0 ? "success" : "warning" },
                { text: boardDate(m.firstSeenAt), width: 6, tone: "muted" },
              ]}
            />
          );
        })}
      </Board>

      {medianSeries.length ? (
        <LogSection title="Price direction" hint="median price across this provider's listed models, per day">
          <StepChart series={medianSeries} from={Date.parse(`${daily[0].date}T00:00:00Z`)} height={200} />
        </LogSection>
      ) : null}

      {leaving.length ? (
        <Board label="Departures" hint="from the provider's own notices" action={<Sign to="/retiring">All departures</Sign>}>
          <ColumnHeads columns={[{ label: "Retires", width: 6, sticky: true }, { label: "Model", width: 22, sticky: true }, { label: "Gate", width: 16 }, { label: "Status", width: 10 }]} />
          {leaving.map((l, i) => {
            const status = departureStatus(l.retiresAt);
            const tracked = keys.get(l.key);
            return (
              <FlapRow
                key={l.id}
                href={tracked ? modelHref(tracked) : null}
                label={`${name} retires ${l.modelId} on ${l.retiresAt}${l.replacement ? `, replacement ${l.replacement}` : ""}`}
                delay={i * 40}
                class={status.word === "DEPARTED" ? "opacity-60" : ""}
                columns={[
                  { text: boardDate(l.retiresAt), width: 6, sticky: true, tone: "muted" },
                  { text: l.modelId, width: 22, sticky: true, tone: status.word === "DEPARTED" ? "danger" : "ink" },
                  { text: l.replacement || "-", width: 16, tone: l.replacement ? "ink" : "muted" },
                  { text: status.word, width: 10, tone: status.tone },
                ]}
              />
            );
          })}
        </Board>
      ) : null}

      <div class="grid gap-8 lg:grid-cols-2">
        <LogSection title="Changes" hint="newest first">
          {stories.length === 0 ? (
            <BoardEmpty>Nothing recorded yet</BoardEmpty>
          ) : (
            <ul>{stories.filter((s) => s.kind !== "drift").slice(0, 40).map((s) => <StoryLine key={s.key} story={s} href={storyHref(s, keys)} date />)}</ul>
          )}
        </LogSection>
        <LogSection title="Incidents" hint="last 90 days, from the status page">
          {data.incidents.length === 0 ? (
            <BoardEmpty>{data.status ? "No incidents recorded" : "No status page tracked"}</BoardEmpty>
          ) : (
            [...incidentsByDay.entries()].map(([day, list]) => (
              <div key={day}>
                <LogDay>{dayLabel(day)}</LogDay>
                <ul>
                  {list.map((i) => (
                    <LogLine
                      key={i.id}
                      left={boardTime(i.startedAt)}
                      right={<span class={i.impact === "critical" || i.impact === "major" ? "text-danger" : i.impact === "minor" ? "text-warning" : "text-ink-muted"}>{i.resolvedAt ? `${Math.max(1, Math.round((Date.parse(i.resolvedAt) - Date.parse(i.startedAt)) / 60000))} MIN` : i.status === "resolved" ? "RESOLVED" : `ONGOING · ${ago(i.startedAt).toUpperCase()}`}</span>}
                    >
                      <span class="mr-2 text-[10px] uppercase tracking-[0.2em] text-ink-muted">{i.impact || "incident"}</span>
                      {i.url ? <a href={i.url} target="_blank" rel="noopener" class="hover:text-accent">{i.name}</a> : i.name}
                    </LogLine>
                  ))}
                </ul>
              </div>
            ))
          )}
        </LogSection>
      </div>
    </div>
  );
}
