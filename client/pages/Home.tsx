/**
 * Home: the hall. A stack of split-flap boards (now, departures, arrivals, prices, status)
 * and, under them, the logbook of everything recorded. One subscription feeds the lot.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";
import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import { headlines, type Story } from "../../shared/stories";
import type { ArchiveEvent, HomeModel, HomePageData, LifecycleRow, StatusRow } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, FlapText, Sign, type FlapTone } from "../components/Flap";
import { LogDay, PageSkeleton, Stencil, StoryLine } from "../components/Log";
import { boardDate, boardPct, boardTime, boardWhen, departureStatus, remarkWord, shortName, statusWord } from "../lib/board";
import { uptimeDays, type DayState } from "../lib/series";
import { KIND_GROUPS, assembleStories, deltaIsGood, keyIndex, kindInGroup, nameIndex, storyDelta, storyHref } from "../lib/stories";
import { provideFreshness } from "../lib/freshness";
import { DAY, ago, dayLabel, daysUntil, modelHref, plural, readStorage, usePageTitle, useSearchParams, writeStorage } from "../lib/util";
import { matchesWatch, useWatchlist } from "../lib/watch";

const LAST_VISIT = "observatory.lastVisit";

const DAY_CLASS: Record<DayState, string> = { up: "bg-success", degraded: "bg-warning", down: "bg-danger", none: "bg-line" };

/** One small flap per day, in the day's real colour; dim when nothing was recorded. */
export function UptimeStrip(props: { days: { day: string; state: DayState }[]; label: string }) {
  return (
    <span class="inline-flex items-center gap-[2px]" role="img" aria-label={props.label}>
      {props.days.map((d) => (
        <span key={d.day} class={`block h-[14px] w-[6px] rounded-[1px] ${DAY_CLASS[d.state]} ${d.state === "none" ? "opacity-60" : ""}`} title={`${d.day}: ${d.state === "none" ? "no record" : d.state}`} />
      ))}
    </span>
  );
}

type Departure = { key: string; model: string; provider: string; retiresAt: string; replacement: string; href: string | null; label: string };

/** Lifecycle notices and OpenRouter expiries as one departures list, soonest first, dated ones only. */
function departures(rows: LifecycleRow[], models: HomeModel[], keys: Map<string, string>): Departure[] {
  const rank: Record<string, number> = { openai: 0, anthropic: 0, cohere: 0, modelsdev: 1, litellm: 2 };
  const seen = new Map<string, Departure>();
  for (const row of rows.slice().sort((a, b) => (rank[a.source] ?? 3) - (rank[b.source] ?? 3))) {
    if (!row.retiresAt || row.retiresNote === "not sooner than") continue;
    const id = `${row.provider}/${row.modelId}`;
    if (seen.has(id)) continue;
    const tracked = keys.get(row.key);
    seen.set(id, {
      key: id,
      model: row.modelId.includes("/") ? row.modelId.slice(row.modelId.indexOf("/") + 1) : row.modelId,
      provider: providerName(row.provider),
      retiresAt: row.retiresAt,
      replacement: row.replacement,
      href: tracked ? modelHref(tracked) : null,
      label: `${providerName(row.provider)} retires ${row.modelId} on ${row.retiresAt}${row.replacement ? `, replacement ${row.replacement}` : ""}`,
    });
  }
  for (const m of models) {
    if (!m.expirationDate || isAlias(m.modelId)) continue;
    const id = `openrouter/${m.modelId}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      key: id,
      model: shortName(m.modelId, m.name),
      provider: providerName(m.provider),
      retiresAt: m.expirationDate,
      replacement: "",
      href: modelHref(m.modelId),
      label: `${shortName(m.modelId, m.name)} leaves the catalogue on ${m.expirationDate}`,
    });
  }
  // Upcoming first, soonest at the top; then the three most recently departed, for the record.
  const all = [...seen.values()];
  const upcoming = all.filter((d) => daysUntil(d.retiresAt) >= 0).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
  const departed = all.filter((d) => daysUntil(d.retiresAt) < 0).sort((a, b) => b.retiresAt.localeCompare(a.retiresAt)).slice(0, 3);
  return [...upcoming, ...departed];
}

export function HomePage() {
  usePageTitle("");
  const params = useSearchParams();
  const kindFilter = params.get("kind") ?? "";
  const watchOnly = params.get("watch") === "1";

  // One subscription for the whole page: a burst of parallel requests gets rate-limited.
  const page = useQuery<HomePageData>("homePage");
  const ready = Boolean(page) && !Array.isArray(page) && Array.isArray(page.models);
  useEffect(() => { if (ready) provideFreshness(page.freshness.models); }, [ready, page]);
  const [watchlist] = useWatchlist();

  // "New since your last visit": read the previous stamp once, then move it to now.
  const [lastVisit] = useState(() => readStorage<string>(LAST_VISIT, ""));
  useEffect(() => { writeStorage(LAST_VISIT, new Date().toISOString()); }, []);

  const models = ready ? page.models : [];
  const events = ready ? page.events : [];
  const names = useMemo(() => nameIndex(models), [models]);
  const keys = useMemo(() => keyIndex(models), [models]);
  const byId = useMemo(() => new Map(models.map((m) => [m.modelId, m])), [models]);
  const stories = useMemo(
    () => (ready ? assembleStories({ events: page.events, sourceEvents: page.sourceEvents, hostEvents: page.hostEvents, lifecycleEvents: page.lifecycleEvents, names }) : []),
    [ready, page, names],
  );

  if (!ready) return <PageSkeleton />;

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const visible = stories.filter((s) => (!watchOnly || matchesWatch(s, watchlist)) && (!kindFilter || kindInGroup(s.kind, kindFilter)));

  // NOW
  const providers = new Set(models.map((m) => m.provider.replace(/^~/, "")));
  const changesToday = stories.filter((s) => s.at.slice(0, 10) === today && s.kind !== "drift").length;
  const statuses: StatusRow[] = page.statuses;
  const delayed = statuses.filter((s) => s.indicator !== "none" && s.indicator !== "unreachable" && s.indicator !== "unknown").length;

  // DEPARTURES
  const allLeaving = departures(page.retiring ?? [], models, keys);
  const leaving = [...allLeaving.filter((d) => daysUntil(d.retiresAt) >= 0).slice(0, 10), ...allLeaving.filter((d) => daysUntil(d.retiresAt) < 0)];
  const departingSoon = allLeaving.filter((d) => { const days = daysUntil(d.retiresAt); return days >= 0 && days <= 30; }).length;

  // ARRIVALS
  const fortnight = new Date(now - 14 * DAY).toISOString();
  const arrivalsSeen = new Set<string>();
  const arrivals: { event: ArchiveEvent; model: HomeModel | undefined }[] = [];
  for (const e of events) {
    if ((e.kind !== "added" && e.kind !== "returned") || e.at < fortnight || isAlias(e.modelId) || arrivalsSeen.has(e.modelId)) continue;
    arrivalsSeen.add(e.modelId);
    arrivals.push({ event: e, model: byId.get(e.modelId) });
    if (arrivals.length >= 10) break;
  }

  // PRICE BOARD
  const priced = visible.filter((s) => !s.source && (s.kind === "repriced" || s.kind === "resized" || s.kind === "delisted" || s.kind === "repointed"));
  const lead = headlines(priced, now, 10);
  const windowLabel = lead.windowHours === 24 ? "last 24 hours" : lead.windowHours === 72 ? "last 3 days" : lead.windowHours === 168 ? "last 7 days" : lead.windowHours === 720 ? "last 30 days" : "all time";

  // THE LOG
  const record = visible.filter((s) => s.kind !== "drift").slice(0, 60);
  const byDay = new Map<string, Story[]>();
  for (const s of record) {
    const key = s.at.slice(0, 10);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  let dividerPlaced = !lastVisit;

  const query = (extra: string) => {
    const q = new URLSearchParams();
    if (watchOnly) q.set("watch", "1");
    if (extra) q.set("kind", extra);
    const s = q.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div class="flex flex-col gap-8">
      {/* NOW */}
      <div class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5" aria-label="Right now">
        {[
          { label: "Models", value: String(models.length), width: 4, href: "/models", tone: "ink" as FlapTone, aria: `${models.length} models` },
          { label: "Providers", value: String(providers.size), width: 4, href: "/status", tone: "ink" as FlapTone, aria: `${providers.size} providers` },
          { label: "Changes today", value: String(changesToday), width: 4, href: "/changes", tone: "ink" as FlapTone, aria: `${changesToday} changes today` },
          { label: "Departing soon", value: String(departingSoon), width: 4, href: "/retiring", tone: (departingSoon ? "warning" : "ink") as FlapTone, aria: `${departingSoon} models retiring within 30 days` },
          { label: "Systems", value: statuses.length === 0 ? "PENDING" : delayed === 0 ? "ON TIME" : `${delayed} DELAYED`, width: 9, href: "/status", tone: (statuses.length === 0 ? "muted" : delayed === 0 ? "success" : "warning") as FlapTone, aria: statuses.length === 0 ? "status pending" : delayed === 0 ? "all systems on time" : `${delayed} systems delayed` },
        ].map((item, i) => (
          <Link key={item.label} to={item.href} class="flex flex-col gap-1.5" aria-label={item.aria}>
            <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">{item.label}</span>
            <FlapText text={item.value} width={item.width} size="lg" tone={item.tone} delay={i * 40} />
          </Link>
        ))}
      </div>

      {/* DEPARTURES */}
      <Board label="Departures" hint="retirements announced by the providers" action={<Sign to="/retiring">All departures</Sign>}>
        <ColumnHeads columns={[{ label: "Retires", width: 6, sticky: true }, { label: "Model", width: 22, sticky: true }, { label: "Provider", width: 9 }, { label: "Gate", width: 16 }, { label: "Status", width: 10 }]} />
        {leaving.length === 0 ? (
          <p class="px-3 py-4 text-sm text-ink-muted">No departures announced.</p>
        ) : (
          leaving.map((d, i) => {
            const status = departureStatus(d.retiresAt);
            const gone = status.word === "DEPARTED";
            return (
              <FlapRow
                key={d.key}
                href={d.href}
                label={d.label}
                delay={i * 40}
                class={gone ? "opacity-60" : ""}
                columns={[
                  { text: boardDate(d.retiresAt), width: 6, sticky: true, tone: "muted" },
                  { text: d.model, width: 22, sticky: true, tone: gone ? "danger" : "ink" },
                  { text: d.provider, width: 9, tone: "muted" },
                  { text: d.replacement ? d.replacement : "-", width: 16, tone: d.replacement ? "ink" : "muted" },
                  { text: status.word, width: 10, tone: status.tone },
                ]}
              />
            );
          })
        )}
      </Board>

      {/* ARRIVALS */}
      <Board label="Arrivals" hint="listed in the last 14 days" action={<Sign to="/changes?kind=listings">All arrivals</Sign>}>
        <ColumnHeads columns={[{ label: "Time", width: 12, sticky: true }, { label: "Model", width: 22, sticky: true }, { label: "Provider", width: 9 }, { label: "In $/M", width: 7, align: "right" }, { label: "Out $/M", width: 7, align: "right" }, { label: "Status", width: 8 }]} />
        {arrivals.length === 0 ? (
          <p class="px-3 py-4 text-sm text-ink-muted">Nothing new in the last two weeks.</p>
        ) : (
          arrivals.map(({ event, model }, i) => {
            const name = shortName(event.modelId, model?.name ?? event.newValue);
            const returned = event.kind === "returned";
            return (
              <FlapRow
                key={event.modelId}
                href={modelHref(event.modelId)}
                label={`${providerName(event.provider)} ${returned ? "relisted" : "listed"} ${name} on ${event.at.slice(0, 10)}${model ? `, ${money(model.promptPrice)} in, ${money(model.completionPrice)} out per million` : ""}`}
                delay={i * 40}
                columns={[
                  { text: `${boardDate(event.at)} ${boardTime(event.at)}`, width: 12, sticky: true, tone: "muted" },
                  { text: name, width: 22, sticky: true },
                  { text: providerName(event.provider), width: 9, tone: "muted" },
                  { text: model ? money(model.promptPrice) : "", width: 7, align: "right" },
                  { text: model ? money(model.completionPrice) : "", width: 7, align: "right" },
                  { text: returned ? "RETURNED" : "ARRIVED", width: 8, tone: "success" },
                ]}
              />
            );
          })
        )}
      </Board>

      {/* PRICE BOARD */}
      <Board
        label="Price board"
        hint={windowLabel}
        action={
          <span class="flex flex-wrap gap-1.5">
            <Sign to={query("")} active={!kindFilter && !watchOnly}>All</Sign>
            {watchlist.length ? <Sign to={watchOnly ? "/" : "/?watch=1"} active={watchOnly}>Watching {watchlist.length}</Sign> : null}
            <Sign to="/changes?kind=prices">Full record</Sign>
          </span>
        }
      >
        <ColumnHeads columns={[{ label: "Model", width: 22, sticky: true }, { label: "Provider", width: 9 }, { label: "Was", width: 7, align: "right" }, { label: "Now", width: 7, align: "right" }, { label: "Change", width: 9 }, { label: "Time", width: 6, align: "right" }]} />
        {lead.stories.length === 0 ? (
          <p class="px-3 py-4 text-sm text-ink-muted">{watchOnly ? "Nothing moved for the models you watch." : "Quiet. Nothing but small moves."}</p>
        ) : (
          lead.stories.map((s, i) => {
            const leadEvent = s.events.find((e) => e.field === "promptPrice") ?? s.events.find((e) => e.field === "completionPrice") ?? s.events.find((e) => e.field === "contextLength");
            const isContext = leadEvent?.field === "contextLength";
            const was = leadEvent ? (isContext ? formatContext(leadEvent.oldValue) : money(leadEvent.oldValue)) : "";
            const nowValue = leadEvent ? (isContext ? formatContext(leadEvent.newValue) : money(leadEvent.newValue)) : "";
            const delta = storyDelta(s);
            const change =
              s.kind === "delisted" ? { text: "CANCELLED", tone: "danger" as FlapTone }
              : s.kind === "repointed" ? { text: "REROUTED", tone: "warning" as FlapTone }
              : delta === null ? { text: "", tone: "muted" as FlapTone }
              : { text: boardPct(delta), tone: (deltaIsGood(s, delta) ? "success" : "warning") as FlapTone };
            const name = shortName(s.modelId, names.get(s.modelId));
            return (
              <FlapRow
                key={s.key}
                href={storyHref(s, keys)}
                label={`${s.headline}${s.detail ? `. ${s.detail}` : ""}`}
                delay={i * 40}
                columns={[
                  { text: isAlias(s.modelId) ? `${name.slice(0, 16)} ALIAS` : name, width: 22, sticky: true },
                  { text: providerName(s.provider), width: 9, tone: "muted" },
                  { text: s.kind === "delisted" ? "" : was, width: 7, align: "right", tone: "muted" },
                  { text: s.kind === "delisted" ? "" : nowValue, width: 7, align: "right" },
                  { text: change.text, width: 9, tone: change.tone },
                  { text: boardWhen(s.at), width: 6, align: "right", tone: "muted" },
                ]}
              />
            );
          })
        )}
      </Board>

      {/* STATUS */}
      <Board label="Status" hint="from each provider's own status page" action={<Sign to="/status">Full status</Sign>}>
        <ColumnHeads columns={[{ label: "Provider", width: 11, sticky: true }, { label: "Status", width: 9 }, { label: "Remarks", width: 28 }, { label: "Last 45 days", width: 24 }]} />
        {statuses.length === 0 ? (
          <p class="px-3 py-4 text-sm text-ink-muted">No status checks yet.</p>
        ) : (
          statuses.map((s, i) => {
            const spec = statusWord(s.indicator);
            const days = uptimeDays(s, page.statusEvents.filter((e) => e.provider === s.provider), page.incidents.filter((inc) => inc.provider === s.provider), 45);
            const remarks = remarkWord(s.indicator, s.description);
            return (
              <FlapRow
                key={s.id}
                href={`/provider/${encodeURIComponent(s.provider)}`}
                label={`${providerName(s.provider)}: ${spec.word.toLowerCase()}. ${remarks}`}
                delay={i * 40}
                columns={[
                  { text: providerName(s.provider), width: 11, sticky: true },
                  { text: spec.word, width: 9, tone: spec.tone },
                  { text: remarks, width: 28, tone: "muted" },
                  { text: "", width: 24, render: <UptimeStrip days={days} label={`${providerName(s.provider)} over the last 45 days`} /> },
                ]}
              />
            );
          })
        )}
      </Board>

      {/* THE LOG */}
      <section class="flex flex-col gap-3" aria-label="The log">
        <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-2">
          <h2 class="text-sm font-bold uppercase tracking-[0.4em] text-ink">The log <span class="ml-2 font-normal tracking-[0.2em] text-ink-muted">everything, newest first</span></h2>
          <div class="flex flex-wrap gap-1.5">
            <Stencil active={!kindFilter} href={query("")}>All</Stencil>
            {Object.entries(KIND_GROUPS).map(([key, g]) => (
              <Stencil key={key} active={kindFilter === key} href={query(key)}>{g.label}</Stencil>
            ))}
          </div>
        </header>
        {record.length === 0 ? (
          <p class="py-4 text-sm text-ink-muted">Nothing recorded yet.</p>
        ) : (
          [...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <LogDay>{dayLabel(day)} <span class="font-normal text-ink-muted">· {plural(list.length, "entry", "entries")}</span></LogDay>
              <ul>
                {list.map((s) => {
                  const divider = !dividerPlaced && lastVisit && s.at < lastVisit;
                  if (divider) dividerPlaced = true;
                  return (
                    <div key={s.key}>
                      {divider ? <li class="flex items-center gap-2 py-1 text-[11px] uppercase tracking-[0.2em] text-accent"><span class="h-px flex-1 bg-accent/40" />new since your last visit ({ago(lastVisit)})<span class="h-px flex-1 bg-accent/40" /></li> : null}
                      <StoryLine story={s} href={storyHref(s, keys)} />
                    </div>
                  );
                })}
              </ul>
            </div>
          ))
        )}
        <div class="flex items-center gap-3 pt-2">
          <Sign to="/changes">Load older</Sign>
          <span class="text-xs text-ink-muted">Showing the latest {record.length}. Filters and paging on the full record.</span>
        </div>
      </section>

      <div class="grid gap-8 border-t border-line pt-8 text-sm text-ink-muted md:grid-cols-3">
        <div class="flex flex-col gap-2">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink">How this works</h3>
          <p>Every half hour, the public price list for every model is compared with the one from half an hour ago. Anything that moved is written down with the time, and nothing is ever deleted.</p>
          <p>Prices are also checked against the providers' own lists. Retirement dates come from the providers' own notices.</p>
          <Link to="/about" class="text-accent hover:underline">More about the method</Link>
        </div>
        <div class="flex flex-col gap-2">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink">Sources</h3>
          <p>Model listings and prices from OpenRouter and each host it routes to. Cross-checks from models.dev and LiteLLM. Retirement notices from OpenAI, Anthropic and Cohere. Status from each provider's status page.</p>
        </div>
        <div class="flex flex-col gap-2">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink">Get the data</h3>
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
