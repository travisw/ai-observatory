/**
 * Today: the lead story with its figures, the rest of the day's changes, the price index,
 * status, what is retiring, what is new, and the records. One subscription feeds the page,
 * plus the daily rollup for the index chart.
 */
import { useEffect, useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import { canonicalKey } from "../../shared/sources";
import { headlines, type Story } from "../../shared/stories";
import type { DailyRow, HomeModel, HomePageData, LifecycleRow, RecordRow } from "../../shared/types";
import { Delta, Fig, LineChart, More, Pill, Rec, Section, Skeleton, StoryRow, StoryTable } from "../components/Wire";
import { provideFreshness } from "../lib/freshness";
import { assembleStories, deltaIsGood, keyIndex, nameIndex, storyDelta, storyHref } from "../lib/stories";
import { dayShort, daysLeft, hm, shortName, statusWord } from "../lib/text";
import { DAY, daysUntil, modelHref, plural, providerHref, usePageTitle } from "../lib/util";

type Departure = { key: string; model: string; provider: string; providerSlug: string; retiresAt: string; replacement: string; href: string | null; source: string };

/** Lifecycle notices and catalogue expiries as one list, soonest first, dated ones only. */
export function departures(rows: LifecycleRow[], models: HomeModel[], keys: Map<string, string>): Departure[] {
  const rank: Record<string, number> = { openai: 0, anthropic: 0, cohere: 0, modelsdev: 1, litellm: 2 };
  const seen = new Map<string, Departure>();
  for (const row of rows.slice().sort((a, b) => (rank[a.source] ?? 3) - (rank[b.source] ?? 3))) {
    if (!row.retiresAt || row.retiresNote === "not sooner than") continue;
    // Matched on the shared key, as on the Retirements page, so one model is one line and the counts agree.
    const id = row.key || `${row.provider}/${row.modelId}`;
    if (seen.has(id)) continue;
    const tracked = keys.get(row.key);
    seen.set(id, {
      key: id,
      model: row.modelId.includes("/") ? row.modelId.slice(row.modelId.indexOf("/") + 1) : row.modelId,
      provider: providerName(row.provider),
      providerSlug: row.provider,
      retiresAt: row.retiresAt,
      replacement: row.replacement,
      href: tracked ? modelHref(tracked) : null,
      source: row.source,
    });
  }
  for (const m of models) {
    if (!m.expirationDate || isAlias(m.modelId)) continue;
    const id = canonicalKey(m.provider, m.modelId);
    if (seen.has(id)) continue;
    seen.set(id, {
      key: id,
      model: shortName(m.modelId, m.name),
      provider: providerName(m.provider),
      providerSlug: m.provider,
      retiresAt: m.expirationDate,
      replacement: "",
      href: modelHref(m.modelId),
      source: "openrouter",
    });
  }
  return [...seen.values()].filter((d) => daysUntil(d.retiresAt) >= 0).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
}

/** The price pair a story moved, from its events: input and output, old and new, per million. */
function figures(story: Story) {
  const find = (field: string) => story.events.find((e) => e.field === field && e.oldValue && e.newValue);
  const input = find("promptPrice");
  const output = find("completionPrice");
  const context = find("contextLength");
  return { input, output, context };
}

/** Longest unchanged price is a property of the present, so it is computed here rather than stored. */
function longestUnchanged(models: HomeModel[]): { modelId: string; days: number } | null {
  let best: { modelId: string; since: string } | null = null;
  for (const m of models) {
    if (isAlias(m.modelId) || !(Number(m.promptPrice) > 0)) continue;
    const since = m.lastChangedAt || m.firstSeenAt || "";
    if (!since) continue;
    if (!best || since < best.since) best = { modelId: m.modelId, since };
  }
  return best ? { modelId: best.modelId, days: Math.floor((Date.now() - Date.parse(best.since)) / DAY) } : null;
}

const SOURCE_WORD: Record<string, string> = { openai: "provider notice", anthropic: "provider notice", cohere: "provider notice", litellm: "price list", modelsdev: "models.dev", openrouter: "catalogue expiry" };

export function HomePage() {
  usePageTitle("");
  const page = useQuery<HomePageData>("homePage");
  const daily = useQuery<DailyRow[]>("dailyStats", 60);
  const ready = Boolean(page) && !Array.isArray(page) && Array.isArray(page.models);
  useEffect(() => { if (ready) provideFreshness(page.freshness.models); }, [ready, page]);

  const models = ready ? page.models : [];
  const names = useMemo(() => nameIndex(models), [models]);
  const keys = useMemo(() => keyIndex(models), [models]);
  const byId = useMemo(() => new Map(models.map((m) => [m.modelId, m])), [models]);
  const stories = useMemo(
    () => (ready ? assembleStories({ events: page.events, sourceEvents: page.sourceEvents, hostEvents: page.hostEvents, lifecycleEvents: page.lifecycleEvents, names }) : []),
    [ready, page, names],
  );

  if (!ready) return <Skeleton rows={10} />;

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const checked = page.freshness.models ?? "";

  // The ticker.
  const providers = new Set(models.map((m) => m.provider.replace(/^~/, "")));
  const todays = stories.filter((s) => s.at.slice(0, 10) === today && s.kind !== "drift");
  const cuts = todays.filter((s) => { const d = s.kind === "repriced" ? storyDelta(s) : null; return d !== null && d < 0; }).length;
  const rises = todays.filter((s) => { const d = s.kind === "repriced" ? storyDelta(s) : null; return d !== null && d > 0; }).length;
  const statuses = page.statuses;
  const degraded = statuses.filter((s) => s.indicator !== "none" && s.indicator !== "unreachable" && s.indicator !== "unknown").length;
  const leaving = departures(page.retiring ?? [], models, keys);
  // Same window as the Retirements page's "retiring within 30 days", so the two numbers agree.
  const leavingSoon = leaving.filter((d) => daysUntil(d.retiresAt) <= 30).length;

  // The lead: the strongest story of the last day (or the shortest window that has three), aliases aside.
  const candidates = stories.filter((s) => s.kind !== "drift" && !isAlias(s.modelId) && s.source !== "hosts");
  const picked = headlines(candidates, now, 12);
  const lead = picked.stories[0];
  const rest = stories.filter((s) => s !== lead && s.kind !== "drift").slice(0, 8);
  const changesToday = todays.length;
  const fig = lead ? figures(lead) : null;
  const leadDelta = lead ? storyDelta(lead) : null;
  const leadGood = lead && leadDelta !== null ? deltaIsGood(lead, leadDelta) : true;
  const leadTone = leadDelta === null ? "" : leadGood ? "cut" : "rise";
  const leadHref = lead ? storyHref(lead, keys) : null;
  const leadToday = Boolean(lead && lead.at.slice(0, 10) === today);
  const leadDay = lead ? (leadToday ? `${hm(lead.at)} UTC` : `${dayShort(lead.at)}, ${hm(lead.at)} UTC`) : "";

  // The index chart from the daily rollup.
  const days = Array.isArray(daily) ? daily : [];
  // An empty basket is written as ""; Number("") would plot it as $0.
  const num = (v: string) => (v === "" ? NaN : Number(v));
  const indexSeries = [
    // Kept one value per day, gaps included, so every line's points sit over the same dates.
    { label: "Frontier", color: "#ece9e0", values: days.map((d) => num(d.frontierIn)) },
    { label: "Mid", color: "#9fb3ff", values: days.map((d) => num(d.midIn)) },
    { label: "Budget", color: "#5fcf8a", values: days.map((d) => num(d.budgetIn)) },
  ];
  const latestDay = days.length ? days[days.length - 1] : null;

  // New this week: first listings, aliases aside.
  const week = new Date(now - 7 * DAY).toISOString();
  const seenNew = new Set<string>();
  const fresh = stories.filter((s) => {
    if ((s.kind !== "listed" && s.kind !== "relisted") || s.at < week || s.source || isAlias(s.modelId) || seenNew.has(s.modelId)) return false;
    seenNew.add(s.modelId);
    return true;
  }).slice(0, 8);

  // Records.
  const rec = (key: string): RecordRow | undefined => page.records.find((r) => r.key === key);
  const unchanged = longestUnchanged(models);
  const cutIn = rec("biggest-cut-input");
  const ctx = rec("largest-context-jump");
  const shortest = rec("shortest-lived");
  const holder = (id: string) => shortName(id, names.get(id));

  return (
    <div>
      <div class="ticker" aria-label="Right now">
        <span><b>{models.length}</b> models</span>
        <span><b>{providers.size}</b> providers</span>
        <span><b>{changesToday}</b> {changesToday === 1 ? "change" : "changes"} today</span>
        {cuts + rises > 0 ? <span><b class="cut">{cuts}</b> {cuts === 1 ? "cut" : "cuts"} · <b class="rise">{rises}</b> {rises === 1 ? "rise" : "rises"}</span> : null}
        <span><b>{leavingSoon}</b> retiring within 30 days</span>
        <span>{statuses.length === 0 ? <b class="soft">status pending</b> : degraded === 0 ? <b class="cut">all operational</b> : <b class="warn">{degraded} degraded</b>}</span>
        {checked ? <span>checked <b>{hm(checked)}</b> UTC</span> : null}
      </div>

      <div class="lead">
        <article>
          {lead ? (
            <>
              <span class="kicker">Lead · {providerName(lead.provider)} · {leadDay}</span>
              <h1>{leadHref ? <Link to={leadHref} class="hl">{lead.headline}</Link> : lead.headline}</h1>
              {fig && (fig.input || fig.output || fig.context) ? (
                <div class="fig">
                  {fig.input ? <Fig label="Input / M" old={money(fig.input.oldValue)} value={money(fig.input.newValue)} tone={leadTone} /> : null}
                  {fig.output ? <Fig label="Output / M" old={money(fig.output.oldValue)} value={money(fig.output.newValue)} tone={leadTone} /> : null}
                  {fig.context ? <Fig label="Context" old={formatContext(fig.context.oldValue)} value={formatContext(fig.context.newValue)} tone={leadTone} /> : null}
                  {leadDelta !== null ? <Fig label="Change" value={<Delta value={leadDelta} good={leadGood} />} /> : null}
                </div>
              ) : lead.detail ? <p class="deck num">{lead.detail}</p> : null}
              <p class="deck">
                {lead.kind === "repriced" || lead.kind === "resized"
                  ? <>{providerName(lead.provider)} changed the listing at {hm(lead.at)} UTC{leadToday ? `, one of ${plural(changesToday, "change")} recorded today` : ` on ${dayShort(lead.at)}`}. {lead.confirmedBy?.length ? `The same move is on ${lead.confirmedBy.join(" and ")}.` : "The other catalogues we check have not recorded it yet."}</>
                  : <>Recorded at {hm(lead.at)} UTC{leadToday ? `, one of ${plural(changesToday, "change")} today` : ` on ${dayShort(lead.at)}`}.{lead.more.length ? ` Also: ${lead.more.join("; ")}.` : ""}</>}
                {leadHref ? <> <Link to={leadHref}>Full history of {holder(lead.modelId)} →</Link></> : null}
              </p>
            </>
          ) : (
            <p class="deck">Nothing recorded yet. The first changes appear after the next check.</p>
          )}
          <Section title={rest.length && rest.every((s) => s.at.slice(0, 10) === today) ? "Also today" : "Recent"} action={<More to="/changes">All changes</More>}>
            {rest.length === 0 ? <p class="note">No other changes yet.</p> : (
              <StoryTable label="Recent changes">
                {rest.map((s) => <StoryRow key={s.key} story={s} href={storyHref(s, keys)} date={s.at.slice(0, 10) !== today} />)}
              </StoryTable>
            )}
          </Section>
        </article>

        <aside class="side">
          <LineChart
            title="Price index · $ per million input"
            hint={days.length ? `${days.length} days` : undefined}
            series={indexSeries}
            left={days.length ? dayShort(days[0].date) : undefined}
            right={latestDay ? dayShort(latestDay.date) : undefined}
            format={(v) => money(String(v / 1_000_000))}
          />
          <Section title="Status" action={<More to="/status">History</More>}>
            {statuses.length === 0 ? <p class="note">No status checks yet.</p> : (
              <table aria-label="Provider status">
                <tbody>
                  {statuses.map((s) => {
                    const word = statusWord(s.indicator);
                    return (
                      <tr key={s.id}>
                        <td><Link to={providerHref(s.provider)} class="hl">{providerName(s.provider)}</Link></td>
                        <td class="n"><Pill tone={word.tone} title={s.description}>{word.word}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>
        </aside>
      </div>

      <div class="two">
        <Section title="Retiring soon" action={<More to="/retiring">All {leaving.length} notices</More>}>
          {leaving.length === 0 ? <p class="note">No retirements announced.</p> : (
            <div class="tw">
              <table aria-label="Retiring soon">
                <thead><tr><th>Retires</th><th>Model</th><th>Replacement</th><th class="n">Left</th></tr></thead>
                <tbody>
                  {leaving.slice(0, 8).map((d) => {
                    const left = daysLeft(d.retiresAt);
                    return (
                      <tr key={d.key}>
                        <td class="when">{dayShort(d.retiresAt)}</td>
                        <td>
                          {d.href ? <Link to={d.href} class="hl">{d.model}</Link> : d.model}
                          <span class="who"><Link to={providerHref(d.providerSlug)}>{d.provider}</Link> · {SOURCE_WORD[d.source] ?? d.source}</span>
                        </td>
                        <td class="soft small">{d.replacement || "—"}</td>
                        <td class="n"><Pill tone={left.tone}>{left.text}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <div class="side">
          <Section title="New this week">
            {fresh.length === 0 ? <p class="note">Nothing new listed this week.</p> : (
              <table aria-label="New this week">
                <tbody>
                  {fresh.map((s) => {
                    const m = byId.get(s.modelId);
                    return (
                      <tr key={s.key}>
                        <td class="when">{dayShort(s.at)}</td>
                        <td><Link to={modelHref(s.modelId)} class="hl">{holder(s.modelId)}</Link><span class="who">{providerName(s.provider)}</span></td>
                        <td class="n num">{m ? `${money(m.promptPrice)} / ${money(m.completionPrice)}` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>
          {latestDay && latestDay.cheapestFrontierId ? (
            <Section title="Cheapest frontier seat">
              <p style={{ fontSize: 14 }}>
                <Link to={modelHref(latestDay.cheapestFrontierId)} class="hl">{holder(latestDay.cheapestFrontierId)}</Link> at {money(String(num(latestDay.cheapestFrontierIn) / 1_000_000))} per million input, inside the top-{latestDay.frontierN} capability basket. <Link to="/models" class="acc">Price vs capability →</Link>
              </p>
            </Section>
          ) : null}
        </div>
      </div>

      <div class="records" aria-label="Records">
        {unchanged ? <Rec value={unchanged.days.toLocaleString()} label="days without a price change" holder={holder(unchanged.modelId)} href={modelHref(unchanged.modelId)} /> : null}
        {cutIn ? <Rec value={`−${Math.round(Math.abs(Number(cutIn.value)))}%`} label="largest input price cut" holder={holder(cutIn.modelId)} href={modelHref(cutIn.modelId)} /> : null}
        {ctx ? <Rec value={`+${formatContext(ctx.value)}`} label="largest context increase" holder={holder(ctx.modelId)} href={modelHref(ctx.modelId)} /> : null}
        {shortest ? <Rec value={Number(shortest.value).toLocaleString()} label={`${Number(shortest.value) === 1 ? "day" : "days"} listed, the shortest ever`} holder={holder(shortest.modelId)} href={modelHref(shortest.modelId)} /> : null}
      </div>
    </div>
  );
}
