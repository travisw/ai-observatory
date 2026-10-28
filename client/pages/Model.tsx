/**
 * One model: the name, the numbers now, the price as a step chart, who serves it, what the
 * other lists say, its notices, and every change ever recorded.
 */
import { useMemo, useState } from "preact/hooks";
import { Link, useNavigate, useParams, useQuery } from "@spacefast/zero/client";

import { BENCHMARK_SOURCE, benchmarkSpec, scoreText } from "../../shared/benchmarks";
import { formatContext, money, parseTiers } from "../../shared/model";
import { isAlias, modelName, providerName } from "../../shared/providers";
import { SOURCE_LABEL, SOURCE_URL, canonicalKey } from "../../shared/sources";
import type { Story } from "../../shared/stories";
import type { ArchiveEvent, BenchmarkRow, LifecycleRow, ModelPageData, ModelRow } from "../../shared/types";
import { StepChart, StepTable, type StepSeries } from "../components/StepChart";
import { Chip, Empty, Fig, More, Pill, Section, Skeleton, StoryRow, StoryTable } from "../components/Wire";
import { sourceStepSeries, stepSeries } from "../lib/series";
import { assembleStories, keyIndex } from "../lib/stories";
import { dayShort, dayYear, pct, shortName, type PillTone } from "../lib/text";
import { DAY, ago, compareHref, copyText, countdown, daysUntil, isLoading, longDate, modelHref, pctChange, plural, providerHref, signedPct, usePageTitle, useSearchParams } from "../lib/util";
import { useWatchlist } from "../lib/watch";

const RANGES: { key: string; label: string; days: number }[] = [
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "1y", label: "1y", days: 365 },
  { key: "all", label: "all", days: 0 },
];

/** The first value of a price field in the archive, for "since listed" deltas. */
function firstValue(events: ArchiveEvent[], field: string, current: string): string {
  const first = events.find((e) => e.kind === "changed" && e.field === field);
  return first ? first.oldValue : current;
}

function noticeLine(row: LifecycleRow, tracked: Map<string, string>): preact.ComponentChildren {
  const replacementId = row.replacement ? tracked.get(canonicalKey(row.provider, row.replacement)) : undefined;
  const parts: preact.ComponentChildren[] = [];
  if (row.state === "retired") parts.push(<span class="rise">Retired{row.retiresAt ? ` ${longDate(row.retiresAt)}` : ""}</span>);
  else if (row.state === "deprecated") parts.push(<span class="warn">Deprecated{row.deprecatedAt ? ` ${longDate(row.deprecatedAt)}` : ""}</span>);
  else parts.push(<span class="cut">Active</span>);
  if (row.state !== "retired" && row.retiresAt) parts.push(<span>{row.retiresNote === "not sooner than" ? "supported until at least" : "retires"} {longDate(row.retiresAt)} ({countdown(row.retiresAt)})</span>);
  if (row.state !== "retired" && !row.retiresAt && row.state === "deprecated") parts.push(<span>retirement date to be announced</span>);
  if (row.replacement) parts.push(<span>replacement: {replacementId ? <Link to={modelHref(replacementId)} class="acc hl">{modelName(replacementId)}</Link> : <span class="mono">{row.replacement}</span>}</span>);
  return parts.map((p, i) => <span key={i}>{i ? " · " : ""}{p}</span>);
}

/** A model's results grouped per benchmark, best setting first, in the order the benchmarks page lists them. */
function resultLines(rows: BenchmarkRow[]): { best: BenchmarkRow; others: BenchmarkRow[] }[] {
  const bySlug = new Map<string, BenchmarkRow[]>();
  for (const row of rows) {
    const list = bySlug.get(row.slug);
    if (list) list.push(row);
    else bySlug.set(row.slug, [row]);
  }
  const order = (slug: string) => {
    const spec = benchmarkSpec(slug);
    return spec ? ["eci", "arena-text"].indexOf(slug) + 1 || 10 : 20;
  };
  return [...bySlug.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([, list]) => {
      const sorted = list.slice().sort((a, b) => Number(b.score) - Number(a.score));
      return { best: sorted[0], others: sorted.slice(1) };
    });
}

function CopyChip(props: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Chip onClick={() => copyText(props.text).then((ok) => { setDone(ok); setTimeout(() => setDone(false), 1500); })} ariaLabel={`Copy ${props.text}`}>
      {done ? "Copied" : props.label}
    </Chip>
  );
}

export function ModelPage() {
  const { id } = useParams() as { id?: string };
  const modelId = decodeURIComponent(id ?? "");
  const params = useSearchParams();
  const navigate = useNavigate();
  const range = params.get("range") ?? "all";
  const data = useQuery<ModelPageData>("modelPage", modelId);
  const activeModels = useQuery<ModelRow[]>("activeModels");
  const [watchlist, addWatch, removeWatch] = useWatchlist();
  const [tab, setTab] = useState("chart");
  const [allHosts, setAllHosts] = useState(false);

  const loading = isLoading(data);
  const model = loading ? null : data.model;
  usePageTitle(model ? `${providerName(model.provider)} ${modelName(model.modelId, model.name)}` : "Model");

  const events = loading ? [] : data.events;
  const tracked = useMemo(() => keyIndex([...(activeModels ?? []), ...(loading ? [] : data.family)]), [activeModels, data, loading]);
  const names = useMemo(() => new Map([...(activeModels ?? []), ...(loading ? [] : data.family)].map((m) => [m.modelId, m.name])), [activeModels, data, loading]);
  const stories = useMemo<Story[]>(() => {
    if (!model) return [];
    names.set(model.modelId, model.name);
    return assembleStories({ events, sourceEvents: data.sourceEvents, hostEvents: data.hostEvents, lifecycleEvents: [], names });
  }, [model, events, data, names]);

  if (!loading && !model) {
    return (
      <div class="stack">
        <h1>Unknown model</h1>
        <p class="deck">{modelId} has never been seen. <Link to="/models" class="acc">Browse the models</Link>.</p>
      </div>
    );
  }
  if (!model) return <Skeleton rows={10} />;

  const watching = watchlist.includes(model.modelId);
  const alias = isAlias(model.modelId);
  const lifecycle = data.lifecycle;
  const retiring = lifecycle.find((l) => l.state === "deprecated" && l.retiresAt) ?? null;
  const retired = lifecycle.find((l) => l.state === "retired") ?? null;
  const expiring = model.expirationDate && daysUntil(model.expirationDate) >= -1 ? model.expirationDate : "";
  const targetId = model.aliasTarget ? (tracked.get(canonicalKey(model.provider, model.aliasTarget)) ?? model.aliasTarget) : "";

  const status: { word: string; tone: PillTone } =
    !model.active ? { word: "removed", tone: "bad" }
    : retired ? { word: "retired", tone: "off" }
    : retiring ? (daysUntil(retiring.retiresAt) <= 30 ? { word: `retiring ${countdown(retiring.retiresAt)}`, tone: "soon" } : { word: "retiring", tone: "warn" })
    : expiring ? (daysUntil(expiring) <= 30 ? { word: `expires ${countdown(expiring)}`, tone: "soon" } : { word: "expiring", tone: "warn" })
    : alias && model.aliasTarget ? { word: "rolling alias", tone: "warn" }
    : { word: "listed", tone: "ok" };

  const inputSeries = stepSeries(events, "promptPrice", model.promptPrice, model.firstSeenAt);
  const outputSeries = stepSeries(events, "completionPrice", model.completionPrice, model.firstSeenAt);
  const litellm = data.listings.find((l) => l.source === "litellm");
  const firstParty = litellm ? sourceStepSeries(data.sourceEvents, "litellm", "promptPrice", litellm.promptPrice, litellm.firstSeenAt) : [];
  const series: StepSeries[] = [
    { key: "input", label: "input $/M", points: inputSeries },
    { key: "output", label: "output $/M", points: outputSeries },
  ];
  if (firstParty.length > 1 && (Date.parse(litellm!.firstSeenAt) < Date.parse(model.firstSeenAt) - 30 * DAY || data.sourceEvents.some((e) => e.source === "litellm" && e.field === "promptPrice"))) {
    series.push({ key: "litellm", label: "first-party list (LiteLLM) input $/M", points: firstParty, dashed: true });
  }
  const earliest = Math.min(...series.flatMap((s) => s.points.map((p) => p.t)).filter(Number.isFinite), Date.now() - DAY);
  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? 0;
  const from = rangeDays ? Math.max(earliest, Date.now() - rangeDays * DAY) : earliest;
  const lowInput = model.lowInput ? Number(model.lowInput) * 1e6 : null;
  const contextSeries = events.some((e) => e.field === "contextLength") ? stepSeries(events, "contextLength", String(Number(model.contextLength) / 1e6), model.firstSeenAt) : [];

  const inputSinceListed = pctChange(firstValue(events, "promptPrice", model.promptPrice), model.promptPrice);
  const outputSinceListed = pctChange(firstValue(events, "completionPrice", model.completionPrice), model.completionPrice);
  const atLow = Boolean(model.lowInput && model.promptPrice === model.lowInput && Number(model.changeCount) > 0);
  const hosts = data.hosts.slice().sort((a, b) => Number(b.active) - Number(a.active) || Number(a.promptPrice) - Number(b.promptPrice));
  const cheapestHost = hosts.find((h) => h.active && Number(h.promptPrice) > 0);
  const shownHosts = allHosts ? hosts : hosts.slice(0, 15);
  const tiers = parseTiers(model.tiers);
  const key = canonicalKey(model.provider, model.modelId);
  const listings = data.listings.slice().sort((a, b) => a.source.localeCompare(b.source));
  const results = resultLines(data.benchmarks ?? []);
  const badgeMarkdown = `![input price](https://ai-observatory.view.fast/badge.svg?model=${model.modelId}&metric=input)`;
  const name = shortName(model.modelId, model.name);
  const sinceWord = (p: number | null) => (p !== null && p !== 0 ? `${signedPct(p)} since listed` : "unchanged since listed");
  const toneOf = (p: number | null): "cut" | "rise" | "" => (p === null || p === 0 ? "" : p < 0 ? "cut" : "rise");

  return (
    <div class="stack">
      <div>
        <span class="kicker"><Link to={providerHref(model.provider)} class="hl">{providerName(model.provider)}</Link>{alias ? " · rolling alias" : model.modality ? ` · ${model.modality}` : ""}</span>
        <h1 style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <span>{name}</span>
          <Pill tone={status.tone}>{status.word}</Pill>
        </h1>
        <div class="fig">
          <Fig label="Input / M" value={money(model.promptPrice) || "–"} tone={toneOf(inputSinceListed)} />
          <Fig label="Output / M" value={money(model.completionPrice) || "–"} tone={toneOf(outputSinceListed)} />
          <Fig label="Cache read / M" value={model.cacheReadPrice ? money(model.cacheReadPrice) : "–"} />
          <Fig label="Context" value={formatContext(model.contextLength)} />
          <Fig label="Max output" value={formatContext(model.maxCompletion)} />
          <Fig label="Changes" value={model.changeCount || "0"} />
        </div>
        <p class="note">
          Input {sinceWord(inputSinceListed)}{atLow ? ", at its lowest ever" : ""} · output {sinceWord(outputSinceListed)}
          {model.cacheWritePrice ? ` · cache write ${money(model.cacheWritePrice)}` : ""}
          {tiers.length ? ` · pricier above ${formatContext(String(tiers[0].minPromptTokens))}` : ""}
        </p>
        <div class="chips" style={{ margin: "10px 0" }}>
          <span class="mono small soft" style={{ marginRight: 4 }}>{model.modelId}</span>
          <CopyChip text={model.modelId} label="Copy id" />
          <Chip onClick={() => (watching ? removeWatch(model.modelId) : addWatch(model.modelId))} active={watching} ariaLabel={watching ? "Stop watching" : "Watch this model"}>{watching ? "Watching" : "Watch"}</Chip>
          <Chip onClick={() => navigate(compareHref([model.modelId]))}>Compare</Chip>
          <Chip href={`/og/model.png?id=${encodeURIComponent(model.modelId)}`} title="A shareable card for this model">Share card</Chip>
          <Chip href={`/api/model.json?id=${encodeURIComponent(model.modelId)}`}>JSON</Chip>
          <Chip href={`/feed.xml?model=${encodeURIComponent(model.modelId)}`}>Feed</Chip>
        </div>
        <p class="small soft">
          Listed {dayYear(model.firstSeenAt)} · last seen {ago(model.lastSeenAt)}
          {model.knowledgeCutoff ? ` · knows the world to ${longDate(model.knowledgeCutoff)}` : ""}
          {model.reasoning ? ` · reasoning${model.reasoning === "mandatory" ? " always on" : ""}` : ""}
          {model.inputModalities && model.inputModalities !== "text" ? ` · ${model.inputModalities.split(",").join(" + ")} in` : ""}
          {model.huggingFaceId ? <> · <a href={`https://huggingface.co/${model.huggingFaceId}`} class="acc hl" target="_blank" rel="noopener">open weights</a></> : null}
        </p>
        {alias && model.aliasTarget ? (
          <p>This name always points at the newest model in its family. Right now that is <Link to={modelHref(targetId)} class="acc hl">{modelName(targetId, names.get(targetId))}</Link>.</p>
        ) : null}
        {model.description ? <p class="soft">{model.description.length > 420 ? `${model.description.slice(0, 420)}…` : model.description}</p> : null}
        {tiers.length ? <p class="soft">Long prompts cost more: {tiers.map((t) => `above ${formatContext(String(t.minPromptTokens))} tokens, ${money(t.prompt)} in · ${money(t.completion)} out`).join("; ")}.</p> : null}
      </div>

      {retiring || retired || expiring ? (
        <div class="box" style={{ borderColor: retired ? "var(--soft)" : "var(--rise)" }}>
          {retired ? (
            <p style={{ margin: 0 }}><b>Retired.</b> {providerName(retired.provider)} stopped serving {retired.modelId}{retired.retiresAt ? ` on ${longDate(retired.retiresAt)}` : ""}.{retired.replacement ? ` Recommended replacement: ${retired.replacement}.` : ""}</p>
          ) : retiring ? (
            <p style={{ margin: 0 }}><b class="rise">Retiring {countdown(retiring.retiresAt)}.</b> {providerName(retiring.provider)} deprecated {retiring.modelId}{retiring.deprecatedAt ? ` on ${longDate(retiring.deprecatedAt)}` : ""} and will retire it on {longDate(retiring.retiresAt)}.{retiring.replacement ? ` Recommended replacement: ${retiring.replacement}.` : ""}</p>
          ) : (
            <p style={{ margin: 0 }}><b class="warn">Listing expires {countdown(expiring)}.</b> OpenRouter has set {longDate(expiring)} as the last day for this listing.</p>
          )}
        </div>
      ) : null}

      <Section
        title="Price over time"
        hint="$ per million tokens"
        action={
          <>
            {RANGES.map((r) => <Chip key={r.key} to={`${modelHref(model.modelId)}?range=${r.key}`} active={range === r.key}>{r.label}</Chip>)}
            <span style={{ width: 1, height: 16, background: "var(--rule)", margin: "0 4px" }} aria-hidden="true" />
            <Chip active={tab === "chart"} onClick={() => setTab("chart")}>Chart</Chip>
            <Chip active={tab === "table"} onClick={() => setTab("table")}>Table</Chip>
          </>
        }
      >
        {tab === "chart" ? (
          inputSeries.length ? (
            <StepChart series={series} from={from} lowLine={lowInput !== null && lowInput > 0 && Number(model.changeCount) > 0 ? { value: lowInput, label: `lowest input ${money(model.lowInput)}` } : undefined} />
          ) : (
            <Empty>No price on record.</Empty>
          )
        ) : (
          <StepTable series={series} />
        )}
      </Section>

      {contextSeries.length > 2 ? (
        <Section title="Context window over time" hint="million tokens">
          <StepChart series={[{ key: "context", label: "context (M tokens)", points: contextSeries }]} from={from} height={160} formatValue={(v) => `${v >= 1 ? v.toFixed(v % 1 ? 1 : 0) : (v * 1000).toFixed(0) + "K"}${v >= 1 ? "M" : ""}`} />
        </Section>
      ) : null}

      <Section title="Who serves it" hint={hosts.length ? `${plural(hosts.filter((h) => h.active).length, "host")} via OpenRouter` : "no host detail yet"} action={hosts.length > 15 ? <Chip onClick={() => setAllHosts((v) => !v)}>{allHosts ? "Fewer" : `All ${hosts.length}`}</Chip> : undefined}>
        {hosts.length === 0 ? (
          <Empty>Host prices and uptime arrive with the next daily check.</Empty>
        ) : (
          <div class="tw">
            <table>
              <thead><tr><th>Host</th><th>Precision</th><th class="n">Context</th><th class="n">In $/M</th><th class="n">Out $/M</th><th>Uptime 24h</th><th class="n">Status</th></tr></thead>
              <tbody>
                {shownHosts.map((h) => {
                  const up = Number(h.uptime1d);
                  const cheapest = cheapestHost && h.id === cheapestHost.id;
                  const word = !h.active ? { text: "gone", tone: "off" as PillTone } : cheapest ? { text: "cheapest", tone: "ok" as PillTone } : up >= 99 ? { text: "steady", tone: "ok" as PillTone } : up >= 95 ? { text: "uneven", tone: "warn" as PillTone } : { text: "spotty", tone: "bad" as PillTone };
                  return (
                    <tr key={h.id} class={h.active ? undefined : "dim"}>
                      <td>{h.host}</td>
                      <td class="soft small">{h.quantization && h.quantization !== "unknown" ? h.quantization : "–"}</td>
                      <td class="n soft">{formatContext(h.contextLength)}</td>
                      <td class={`n ${cheapest ? "cut" : ""}`}>{money(h.promptPrice)}</td>
                      <td class="n">{money(h.completionPrice)}</td>
                      <td>
                        <span class="bar" title={`${h.uptime1d}% over the last day`}><i style={{ width: `${Math.max(0, Math.min(100, Number.isFinite(up) ? up : 0))}%`, background: up >= 99 ? "var(--cut)" : up >= 95 ? "var(--warn)" : "var(--rise)" }} /></span>
                        <span class="mono small soft" style={{ marginLeft: 8 }}>{Number.isFinite(up) ? `${up.toFixed(1)}%` : "–"}</span>
                      </td>
                      <td class="n"><Pill tone={word.tone}>{word.text}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Across price lists" hint={listings.length ? "what the other lists say" : "not listed elsewhere"}>
        {listings.length === 0 ? (
          <Empty>The other price lists have no entry for this model.</Empty>
        ) : (
          <>
            <div class="tw">
              <table>
                <thead><tr><th>List</th><th>Id there</th><th class="n">Context</th><th class="n">In $/M</th><th class="n">Out $/M</th><th>Released</th><th class="n">Vs here</th></tr></thead>
                <tbody>
                  {listings.map((l) => {
                    const inGap = pctChange(l.promptPrice, model.promptPrice);
                    const outGap = pctChange(l.completionPrice, model.completionPrice);
                    const same = (inGap === null || Math.abs(inGap) < 3) && (outGap === null || Math.abs(outGap) < 3);
                    const gapText = same ? "same price" : [inGap !== null && Math.abs(inGap) >= 3 ? `in ${pct(inGap)}` : "", outGap !== null && Math.abs(outGap) >= 3 ? `out ${pct(outGap)}` : ""].filter(Boolean).join(" · ");
                    return (
                      <tr key={l.id} class={l.active ? undefined : "dim"}>
                        <td>{SOURCE_URL[l.source] ? <a href={SOURCE_URL[l.source]} target="_blank" rel="noopener" class="hl">{SOURCE_LABEL[l.source] ?? l.source}</a> : SOURCE_LABEL[l.source] ?? l.source}</td>
                        <td class="mono small soft">{l.sourceId}{l.active ? "" : " (gone)"}</td>
                        <td class="n soft">{formatContext(l.contextLength)}</td>
                        <td class="n">{money(l.promptPrice)}</td>
                        <td class="n">{money(l.completionPrice)}</td>
                        <td class="when">{l.releaseDate ? dayYear(l.releaseDate) : "–"}</td>
                        <td class={`n ${same ? "cut" : "warn"}`}>{gapText}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p class="note" style={{ marginTop: 8 }}>"Vs here" compares the price tracked here with that list. A higher price here is what the middleman adds; lower means a discount.</p>
          </>
        )}
      </Section>

      {results.length ? (
        <Section title="Published results" hint="copied from Epoch AI and LMArena, not run here" action={<More to={`/benchmarks?b=${results[0].best.slug}`}>All benchmarks</More>}>
          <div class="tw">
            <table>
              <thead><tr><th>Benchmark</th><th class="n">Score</th><th>Setting</th><th>Measured</th><th>Source</th></tr></thead>
              <tbody>
                {results.map(({ best, others }) => {
                  const spec = benchmarkSpec(best.slug);
                  const source = BENCHMARK_SOURCE[best.source];
                  return (
                    <tr key={best.slug}>
                      <td><Link to={`/benchmarks?b=${best.slug}`} class="hl">{spec?.name ?? best.benchmark}</Link></td>
                      <td class="n">{scoreText(best.score, best.unit)}{best.detail ? <span class="small soft" style={{ marginLeft: 6 }}>{best.detail}</span> : null}</td>
                      <td class="small soft">
                        {best.variant || "–"}
                        {others.length ? <span class="who num">also {others.map((o) => `${o.variant || "default"} ${scoreText(o.score, o.unit)}`).join(" · ")}</span> : null}
                      </td>
                      <td class="when">{best.date ? dayYear(best.date) : "–"}</td>
                      <td class="small">{best.url ? <a href={best.url} class="acc hl" target="_blank" rel="noopener">{source?.label ?? best.source} →</a> : source?.label ?? best.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p class="note" style={{ marginTop: 8 }}>As published for <span class="mono">{results[0].best.sourceModel}</span>{results.some((r) => r.best.sourceModel !== results[0].best.sourceModel) ? " and the source's other names for this model" : ""}. The setting is the source's run configuration, not a choice made here.</p>
        </Section>
      ) : null}

      {lifecycle.length ? (
        <Section title="Notices" hint="from the providers' own pages">
          <div class="tw">
            <table>
              <tbody>
                {lifecycle.map((l) => (
                  <tr key={l.id}>
                    <td class="small soft" style={{ whiteSpace: "nowrap" }}>{SOURCE_LABEL[l.source] ?? l.source}</td>
                    <td><span class="mono small soft">{l.modelId}</span> {noticeLine(l, tracked)}</td>
                    <td class="n">{l.sourceUrl || SOURCE_URL[l.source] ? <a href={l.sourceUrl || SOURCE_URL[l.source]} target="_blank" rel="noopener" class="acc hl small">read →</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title="History" hint={`${plural(stories.filter((s) => s.kind !== "drift").length, "change")}${stories.some((s) => s.kind === "drift") ? ` · ${plural(stories.filter((s) => s.kind === "drift").reduce((n, s) => n + (s.folded ?? 1), 0), "small move")} folded` : ""}`}>
        {stories.length === 0 ? (
          <Empty>Nothing has moved since it was first seen.</Empty>
        ) : (
          <StoryTable label="History">{stories.map((s) => <StoryRow key={s.key} story={s} href={null} showMore date />)}</StoryTable>
        )}
      </Section>

      {data.family.length ? (
        <Section title="Same family" hint="from the same provider" action={<More to={compareHref([model.modelId, ...data.family.slice(0, 3).map((m) => m.modelId)])}>Compare these</More>}>
          <div class="tw">
            <table>
              <thead><tr><th>Model</th><th>Id</th><th class="n">In $/M</th><th class="n">Out $/M</th><th class="n">Status</th></tr></thead>
              <tbody>
                {data.family.slice(0, 15).map((m) => {
                  const pointsHere = Boolean(m.aliasTarget && canonicalKey(m.provider, m.aliasTarget) === key);
                  return (
                    <tr key={m.id} class={m.active ? undefined : "dim"}>
                      <td><Link to={modelHref(m.modelId)} class="hl">{shortName(m.modelId, m.name)}</Link></td>
                      <td class="mono small soft">{m.modelId}</td>
                      <td class="n">{money(m.promptPrice)}</td>
                      <td class="n">{money(m.completionPrice)}</td>
                      <td class="n">{!m.active ? <Pill tone="bad">removed</Pill> : pointsHere ? <Pill>points here</Pill> : isAlias(m.modelId) ? <Pill tone="off">alias</Pill> : <Pill tone="ok">listed</Pill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title="Take it with you">
        <div class="chips" style={{ marginBottom: 10 }}>
          <img src={`/badge.svg?model=${encodeURIComponent(model.modelId)}&metric=input`} alt={`input price badge for ${model.modelId}`} height={20} />
          <img src={`/badge.svg?model=${encodeURIComponent(model.modelId)}&metric=changed`} alt={`last change badge for ${model.modelId}`} height={20} />
          <CopyChip text={badgeMarkdown} label="Copy markdown" />
        </div>
        <pre class="box mono small" style={{ margin: "0 0 10px", overflowX: "auto", whiteSpace: "pre" }}>{badgeMarkdown}</pre>
        <p class="note">
          <Link to="/api" class="acc hl">All badges, feeds and JSON</Link>
          {" · "}<a href={`/feed.xml?model=${encodeURIComponent(model.modelId)}`} class="acc hl">Feed for this model</a>
          {" · "}<a href={`/api/model.json?id=${encodeURIComponent(model.modelId)}`} class="acc hl">JSON</a>
        </p>
      </Section>
    </div>
  );
}
