/**
 * Home: the state of the world in one line, then what moved, ranked, with proof.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";
import { Sparkline, StatTile } from "@spacefast/zero/charts";
import { EmptyState, Skeleton } from "@spacefast/zero/kit";

import { money } from "../../shared/model";
import { isAlias, modelName, providerName } from "../../shared/providers";
import { headlines, tally, type Story } from "../../shared/stories";
import type { ArchiveEvent, HomePageData, ModelRow } from "../../shared/types";
import { Card, Chip, DeltaChip, ModelLink, ProviderLink, Section } from "../components/bits";
import { StoryRow } from "../components/StoryRow";
import { UptimeBar } from "../components/UptimeBar";
import { inputSpark, uptimeDays, uptimeSummary } from "../lib/series";
import { KIND_GROUPS, assembleStories, keyIndex, kindInGroup, nameIndex, storyDelta, storyHref } from "../lib/stories";
import { provideFreshness } from "../lib/freshness";
import { DAY, ago, dayLabel, isLoading, longDate, pctChange, plural, readStorage, useCountUp, usePageTitle, useSearchParams, writeStorage } from "../lib/util";
import { matchesWatch, useWatchlist } from "../lib/watch";

const LAST_VISIT = "observatory.lastVisit";

function indicatorWord(indicator: string) {
  if (indicator === "none") return "up";
  if (indicator === "minor") return "degraded";
  if (indicator === "critical" || indicator === "major") return "outage";
  if (indicator === "unreachable") return "status page unreachable";
  return indicator || "unknown";
}

function indicatorClass(indicator: string) {
  if (indicator === "none") return "text-success";
  if (indicator === "minor") return "text-warning";
  if (indicator === "critical" || indicator === "major") return "text-danger";
  return "text-ink-muted";
}

function Tile(props: { label: string; value: number; trend?: number[]; href: string; good?: boolean }) {
  const shown = useCountUp(props.value);
  return (
    <Link to={props.href} class="block rounded-xl hover:ring-2 hover:ring-accent/40" title={`See ${props.label.toLowerCase()} this week`}>
      <StatTile label={props.label} value={shown} trend={props.trend} />
    </Link>
  );
}

/** Net input-price move per model over a window, for the movers lists. */
function movers(events: ArchiveEvent[], models: Map<string, ModelRow>, sinceIso: string) {
  const byModel = new Map<string, ArchiveEvent[]>();
  for (const e of events) {
    if (e.kind !== "changed" || e.field !== "promptPrice" || e.at < sinceIso || isAlias(e.modelId)) continue;
    const list = byModel.get(e.modelId);
    if (list) list.push(e);
    else byModel.set(e.modelId, [e]);
  }
  const out: { modelId: string; from: string; to: string; pct: number; at: string }[] = [];
  for (const [modelId, list] of byModel) {
    const sorted = list.sort((a, b) => a.at.localeCompare(b.at));
    const from = sorted[0].oldValue;
    const to = sorted[sorted.length - 1].newValue;
    const pct = pctChange(from, to);
    if (pct === null || Math.abs(pct) < 3 || !models.has(modelId)) continue;
    out.push({ modelId, from, to, pct, at: sorted[sorted.length - 1].at });
  }
  return out;
}

export function HomePage() {
  usePageTitle("");
  const params = useSearchParams();
  const kindFilter = params.get("kind") ?? "";
  const watchOnly = params.get("watch") === "1";

  // One subscription for the whole page: a burst of a dozen parallel requests gets rate-limited.
  const page = useQuery<HomePageData>("homePage");
  const ready = !isLoading(page);
  const models = ready ? page.models : undefined;
  const events = ready ? page.events : undefined;
  const cheapest = ready ? page.cheapest : undefined;
  const records = ready ? page.records : undefined;
  const hostEvents = ready ? page.hostEvents : undefined;
  const lifecycleEvents = ready ? page.lifecycleEvents : undefined;
  const sourceEvents = ready ? page.sourceEvents : undefined;
  const sizes = ready ? page.sweeps : undefined;
  const status = ready ? { statuses: page.statuses, statusEvents: page.statusEvents, incidents: page.incidents } : null;
  useEffect(() => { if (ready) provideFreshness(page.freshness.models); }, [ready, page]);
  const [watchlist] = useWatchlist();

  // "New since your last visit": read the previous stamp once, then move it to now.
  const [lastVisit] = useState(() => readStorage<string>(LAST_VISIT, ""));
  useEffect(() => { writeStorage(LAST_VISIT, new Date().toISOString()); }, []);

  const active = models ?? [];
  const names = useMemo(() => nameIndex(active), [active]);
  const keys = useMemo(() => keyIndex(active), [active]);
  const byId = useMemo(() => new Map(active.map((m) => [m.modelId, m])), [active]);
  const stories = useMemo(
    () => assembleStories({ events: events ?? [], sourceEvents: sourceEvents ?? [], hostEvents: hostEvents ?? [], lifecycleEvents: lifecycleEvents ?? [], names }),
    [events, sourceEvents, hostEvents, lifecycleEvents, names],
  );
  const visible = stories.filter((s) => (!watchOnly || matchesWatch(s, watchlist)) && (!kindFilter || kindInGroup(s.kind, kindFilter)));
  const lead = headlines(visible, Date.now());
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const monthAgo = new Date(Date.now() - 30 * DAY).toISOString();
  const week = tally(stories, weekAgo);
  const cuts = stories.filter((s) => s.kind === "repriced" && !s.source && s.at >= weekAgo && (storyDelta(s) ?? 0) < 0).length;
  const raises = stories.filter((s) => s.kind === "repriced" && !s.source && s.at >= weekAgo && (storyDelta(s) ?? 0) > 0).length;
  const dayTrend = (pick: (s: Story) => boolean) => {
    const out: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
      out.push(stories.filter((s) => s.at.slice(0, 10) === day && pick(s)).length);
    }
    return out;
  };

  const providers = new Set(active.map((m) => m.provider.replace(/^~/, "")));
  const today = new Date().toISOString().slice(0, 10);
  const changesToday = stories.filter((s) => s.at.slice(0, 10) === today && s.kind !== "drift").length;
  const statuses = status ? status.statuses : [];
  const notUp = statuses.filter((s) => s.indicator !== "none");
  const trend = (sizes ?? []).map((s) => s.listed);
  const weekStart = (sizes ?? []).find((s) => s.at >= weekAgo);
  const delta = weekStart && trend.length ? trend[trend.length - 1] - weekStart.listed : 0;

  const moves = movers(events ?? [], byId, monthAgo);
  const cheaper = moves.filter((m) => m.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 5);
  const pricier = moves.filter((m) => m.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 5);

  // Streak facts, generated from the archive. Only facts the data can actually support.
  const facts: string[] = [];
  const lastRaise = (events ?? []).find((e) => e.kind === "changed" && (e.field === "promptPrice" || e.field === "completionPrice") && Number(e.newValue) > Number(e.oldValue) * 1.03 && !isAlias(e.modelId));
  const lastRemoval = (events ?? []).find((e) => e.kind === "removed" && !isAlias(e.modelId));
  if (events && events.length) {
    const sinceRaise = lastRaise ? Math.floor((Date.now() - Date.parse(lastRaise.at)) / DAY) : null;
    const sinceRemoval = lastRemoval ? Math.floor((Date.now() - Date.parse(lastRemoval.at)) / DAY) : null;
    facts.push(sinceRaise === null ? "no price has gone up in 90 days" : sinceRaise === 0 ? "a price went up today" : `${plural(sinceRaise, "day")} since a price went up anywhere`);
    facts.push(sinceRemoval === null ? "no model has been removed in 90 days" : sinceRemoval === 0 ? "a model was removed today" : `${plural(sinceRemoval, "day")} since a model was removed`);
  }
  const longest = (records ?? []).find((r) => r.key === "longest-unchanged");
  if (longest) facts.push(`longest unchanged price: ${modelName(longest.modelId, names.get(longest.modelId))}, ${longest.value} days`);

  const record = visible.filter((s) => s.kind !== "drift").slice(0, 60);
  const byDay = new Map<string, Story[]>();
  for (const s of record) {
    const key = s.at.slice(0, 10);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  let dividerPlaced = !lastVisit;
  const windowLabel = lead.windowHours === 24 ? "last 24 hours" : lead.windowHours === 72 ? "last 3 days" : lead.windowHours === 168 ? "last 7 days" : lead.windowHours === 720 ? "last 30 days" : "all time";
  const loading = !ready;

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-1">
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[13px] tabular-nums text-ink-muted">
          <Link to="/models" class="text-ink hover:text-accent">{active.length} models</Link>
          <span aria-hidden="true">·</span>
          <Link to="/status" class="text-ink hover:text-accent">{providers.size} providers</Link>
          <span aria-hidden="true">·</span>
          <Link to="/status" class={`hover:text-accent ${notUp.length ? "text-warning" : "text-success"}`}>
            {statuses.length === 0 ? "status pending" : notUp.length === 0 ? "all providers up" : `${plural(notUp.length, "provider")} not fully up`}
          </Link>
          <span aria-hidden="true">·</span>
          <Link to="/changes" class="text-ink hover:text-accent">{plural(changesToday, "change")} today</Link>
          {delta ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{delta > 0 ? "+" : ""}{delta} models this week</span>
            </>
          ) : null}
        </p>
        {facts.length ? <p class="text-xs text-ink-muted">{facts.join(" · ")}</p> : null}
      </div>

      <Section
        title="What moved"
        hint={windowLabel}
        action={
          <div class="flex flex-wrap gap-1.5">
            <Chip active={!kindFilter && !watchOnly} href="/">All</Chip>
            {watchlist.length ? <Chip active={watchOnly} href="/?watch=1">Watching ({watchlist.length})</Chip> : null}
            <Chip active={kindFilter === "prices"} href="/?kind=prices">Prices</Chip>
            <Chip active={kindFilter === "listings"} href="/?kind=listings">Listings</Chip>
            <Chip active={kindFilter === "lifecycle"} href="/?kind=lifecycle">Retirements</Chip>
          </div>
        }
      >
        <Card padded={false} class="px-4">
          {loading ? (
            <div class="flex flex-col gap-3 py-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} class="h-10 w-full" />)}</div>
          ) : lead.stories.length === 0 ? (
            <EmptyState title="Quiet" description={watchOnly ? "Nothing changed for the models you watch." : "Only small price moves in this window."} />
          ) : (
            <ul>
              {lead.stories.map((s) => (
                <StoryRow key={s.key} story={s} href={storyHref(s, keys)} spark={!s.source && byId.has(s.modelId) ? inputSpark(byId.get(s.modelId)!, events ?? []) : undefined} relative />
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section title="This week in numbers" hint="last 7 days">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Price cuts" value={cuts} trend={dayTrend((s) => s.kind === "repriced" && !s.source && (storyDelta(s) ?? 0) < 0)} href="/changes?kind=prices" />
          <Tile label="Price raises" value={raises} trend={dayTrend((s) => s.kind === "repriced" && !s.source && (storyDelta(s) ?? 0) > 0)} href="/changes?kind=prices" />
          <Tile label="New models" value={week.listed} trend={dayTrend((s) => s.kind === "listed")} href="/changes?kind=listings" />
          <Tile label="Removed" value={week.delisted} trend={dayTrend((s) => s.kind === "delisted")} href="/changes?kind=listings" />
          <Tile label="Context changes" value={week.resized} trend={dayTrend((s) => s.kind === "resized")} href="/changes?kind=context" />
        </div>
        {week.drift ? <p class="text-xs text-ink-muted">{plural(week.drift, "small or back-and-forth move")} folded away this week.</p> : null}
      </Section>

      <div class="grid gap-10 lg:grid-cols-2">
        <Section title="Cheapest it has ever been" hint="at an all-time low input price right now" action={<Link to="/models?sort=input" class="text-accent hover:underline">all models</Link>}>
          <Card padded={false}>
            {isLoading(cheapest) ? (
              <p class="p-4 text-sm text-ink-muted">Nothing at a record low right now.</p>
            ) : (
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-line text-left text-xs text-ink-muted">
                    <th class="px-4 py-2 font-normal">model</th>
                    <th class="px-2 py-2 text-right font-normal">input $/M</th>
                    <th class="px-2 py-2 text-right font-normal">was</th>
                    <th class="px-4 py-2 text-right font-normal">since</th>
                  </tr>
                </thead>
                <tbody>
                  {(cheapest ?? []).slice(0, 8).map((m) => {
                    const prior = (events ?? []).find((e) => e.modelId === m.modelId && e.field === "promptPrice" && e.kind === "changed");
                    return (
                      <tr key={m.id} class="border-b border-line last:border-0">
                        <td class="px-4 py-2"><ModelLink modelId={m.modelId} name={m.name} withProvider /></td>
                        <td class="px-2 py-2 text-right font-mono tabular-nums text-success">{money(m.promptPrice)}</td>
                        <td class="px-2 py-2 text-right font-mono tabular-nums text-ink-muted">{prior ? money(prior.oldValue) : m.highInput ? money(m.highInput) : "–"}</td>
                        <td class="px-4 py-2 text-right font-mono text-xs tabular-nums text-ink-muted">{m.lowInputAt ? longDate(m.lowInputAt) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </Section>

        <Section title="Biggest movers" hint="input price, last 30 days">
          <div class="grid gap-3 sm:grid-cols-2">
            {[{ title: "Cheaper", rows: cheaper }, { title: "Pricier", rows: pricier }].map((col) => (
              <Card key={col.title} padded={false}>
                <p class={`border-b border-line px-4 py-2 text-xs font-medium ${col.title === "Cheaper" ? "text-success" : "text-warning"}`}>{col.title}</p>
                {col.rows.length === 0 ? (
                  <p class="px-4 py-3 text-xs text-ink-muted">None in the last 30 days.</p>
                ) : (
                  <ul>
                    {col.rows.map((m) => {
                      const model = byId.get(m.modelId)!;
                      return (
                        <li key={m.modelId} class="flex items-center gap-2 border-b border-line px-4 py-2 last:border-0">
                          <div class="min-w-0 flex-1">
                            <ModelLink modelId={m.modelId} name={model.name} class="block truncate text-sm text-ink" />
                            <span class="font-mono text-[11px] tabular-nums text-ink-muted">{money(m.from)} → {money(m.to)}</span>
                          </div>
                          <Sparkline values={inputSpark(model, events ?? [], 30)} width={64} height={20} />
                          <DeltaChip value={m.pct} good={m.pct < 0} size="sm" />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Is it up right now" hint="from each provider's own status page" action={<Link to="/status" class="text-accent hover:underline">status page</Link>}>
        <Card padded={false}>
          {statuses.length === 0 ? (
            <p class="p-4 text-sm text-ink-muted">No status checks yet.</p>
          ) : (
            <ul class="divide-y divide-line">
              {statuses.map((s) => {
                const days = uptimeDays(s, status!.statusEvents.filter((e) => e.provider === s.provider), status!.incidents.filter((i) => i.provider === s.provider), 90);
                const sum = uptimeSummary(days);
                return (
                  <li key={s.id} class="grid items-center gap-x-4 gap-y-1 px-4 py-2 sm:grid-cols-[10rem_1fr_6rem]">
                    <span class="flex items-center gap-2 text-sm">
                      <span class={`inline-block size-2 rounded-full ${s.indicator === "none" ? "bg-success" : s.indicator === "minor" ? "bg-warning" : s.indicator === "major" || s.indicator === "critical" ? "bg-danger" : "bg-line"}`} aria-hidden="true" />
                      <ProviderLink slug={s.provider} />
                    </span>
                    <UptimeBar days={days} label={providerName(s.provider)} height={16} />
                    <span class={`text-right font-mono text-xs ${indicatorClass(s.indicator)}`} title={s.description || undefined}>
                      {indicatorWord(s.indicator)}{sum.recorded ? <span class="block text-[11px] text-ink-muted">{sum.incidentDays} incident {sum.incidentDays === 1 ? "day" : "days"} of {sum.recorded}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </Section>

      <Section
        title="The record"
        hint="everything, newest first"
        action={<Link to="/changes" class="text-accent hover:underline">full record with filters</Link>}
      >
        <div class="flex flex-wrap gap-1.5">
          <Chip active={!kindFilter} href={watchOnly ? "/?watch=1" : "/"}>All</Chip>
          {Object.entries(KIND_GROUPS).map(([key, g]) => (
            <Chip key={key} active={kindFilter === key} href={`/?kind=${key}${watchOnly ? "&watch=1" : ""}`}>{g.label}</Chip>
          ))}
        </div>
        <Card padded={false} class="px-4">
          {record.length === 0 ? (
            <EmptyState title="Nothing recorded yet" description="The record fills as providers change things." />
          ) : (
            [...byDay.entries()].map(([day, list]) => (
              <div key={day}>
                <h3 class="sticky top-0 z-10 -mx-4 border-b border-line bg-surface/95 px-4 py-1.5 text-xs font-medium text-ink-muted backdrop-blur">
                  {dayLabel(day)} <span class="font-normal">· {plural(list.length, "change")}</span>
                </h3>
                <ul>
                  {list.map((s) => {
                    const divider = !dividerPlaced && lastVisit && s.at < lastVisit;
                    if (divider) dividerPlaced = true;
                    return (
                      <div key={s.key}>
                        {divider ? <li class="flex items-center gap-2 py-1 text-[11px] text-accent"><span class="h-px flex-1 bg-accent/40" />new since your last visit ({ago(lastVisit)})<span class="h-px flex-1 bg-accent/40" /></li> : null}
                        <StoryRow story={s} href={storyHref(s, keys)} compact />
                      </div>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
          <p class="py-3 text-xs text-ink-muted">
            Showing the latest {record.length}. <Link to="/changes" class="text-accent hover:underline">Older changes, filters and paging</Link>.
          </p>
        </Card>
      </Section>

      <div class="grid gap-8 border-t border-line pt-8 text-sm text-ink-muted md:grid-cols-3">
        <div class="flex flex-col gap-2">
          <h3 class="font-medium text-ink">How this works</h3>
          <p>Every half hour, the public price list for every model is compared with the one from half an hour ago. Anything that moved is written down with the time, and nothing is ever deleted.</p>
          <p>Prices are also checked against the providers' own lists, so a change gets a "confirmed" mark when more than one source saw it. Retirement dates come from the providers' own notices.</p>
          <Link to="/about" class="text-accent hover:underline">More about the method</Link>
        </div>
        <div class="flex flex-col gap-2">
          <h3 class="font-medium text-ink">Sources</h3>
          <p>Model listings and prices from OpenRouter and each host it routes to. Cross-checks from models.dev and LiteLLM. Retirement notices from OpenAI, Anthropic and Cohere. Status from each provider's status page.</p>
        </div>
        <div class="flex flex-col gap-2">
          <h3 class="font-medium text-ink">Get the data</h3>
          <ul class="flex flex-col gap-1">
            <li><a href="/feed.xml" class="text-accent hover:underline">RSS feed</a> of every change, filterable</li>
            <li><Link to="/api" class="text-accent hover:underline">JSON API and badges</Link></li>
            <li><a href="/export/changes.csv" class="text-accent hover:underline">Download the latest changes as CSV</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
