/**
 * One model's flight details: the name on the board, the numbers now, the price as a step
 * chart, who serves it, what the other lists say, its notices, and every change ever recorded.
 */
import { useMemo, useState } from "preact/hooks";
import { Link, useNavigate, useParams, useQuery } from "@spacefast/zero/client";
import { CodeBlock } from "@spacefast/zero/kit";

import { formatContext, money, parseTiers } from "../../shared/model";
import { isAlias, modelName, providerName } from "../../shared/providers";
import { SOURCE_LABEL, SOURCE_URL, canonicalKey } from "../../shared/sources";
import type { Story } from "../../shared/stories";
import type { ArchiveEvent, LifecycleRow, ModelPageData, ModelRow } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, FlapText, Sign, type FlapTone } from "../components/Flap";
import { BoardEmpty, LogLine, LogSection, PageSkeleton, Plaque, Readout, Stencil, StoryLine } from "../components/Log";
import { StepChart, StepTable, type StepSeries } from "../components/StepChart";
import { boardDate, boardPct, shortName } from "../lib/board";
import { sourceStepSeries, stepSeries } from "../lib/series";
import { assembleStories, keyIndex, storyHref } from "../lib/stories";
import { DAY, ago, compareHref, copyText, countdown, daysUntil, isLoading, longDate, modelHref, pctChange, plural, signedPct, usePageTitle, useSearchParams } from "../lib/util";
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
  if (row.state === "retired") parts.push(<span class="text-danger">Retired{row.retiresAt ? ` ${longDate(row.retiresAt)}` : ""}</span>);
  else if (row.state === "deprecated") parts.push(<span class="text-warning">Deprecated{row.deprecatedAt ? ` ${longDate(row.deprecatedAt)}` : ""}</span>);
  else parts.push(<span class="text-success">Active</span>);
  if (row.state !== "retired" && row.retiresAt) parts.push(<span>{row.retiresNote === "not sooner than" ? "supported until at least" : "retires"} {longDate(row.retiresAt)} ({countdown(row.retiresAt)})</span>);
  if (row.state !== "retired" && !row.retiresAt && row.state === "deprecated") parts.push(<span>retirement date to be announced</span>);
  if (row.replacement) parts.push(<span>replacement: {replacementId ? <Link to={modelHref(replacementId)} class="text-accent hover:underline">{modelName(replacementId)}</Link> : <span class="font-mono">{row.replacement}</span>}</span>);
  return parts.map((p, i) => <span key={i}>{i ? " · " : ""}{p}</span>);
}

function CopySign(props: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Sign onClick={() => copyText(props.text).then((ok) => { setDone(ok); setTimeout(() => setDone(false), 1500); })} ariaLabel={`Copy ${props.text}`}>
      {done ? "Copied" : props.label}
    </Sign>
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
      <div class="flex flex-col gap-4">
        <FlapText text="UNKNOWN MODEL" width={13} size="lg" tone="danger" />
        <p class="text-sm text-ink-muted">{modelId} has never been seen. <Link to="/models" class="text-accent hover:underline">Browse the models</Link>.</p>
      </div>
    );
  }
  if (!model) return <PageSkeleton />;

  const watching = watchlist.includes(model.modelId);
  const alias = isAlias(model.modelId);
  const lifecycle = data.lifecycle;
  const retiring = lifecycle.find((l) => l.state === "deprecated" && l.retiresAt) ?? null;
  const retired = lifecycle.find((l) => l.state === "retired") ?? null;
  const expiring = model.expirationDate && daysUntil(model.expirationDate) >= -1 ? model.expirationDate : "";
  const targetId = model.aliasTarget ? (tracked.get(canonicalKey(model.provider, model.aliasTarget)) ?? model.aliasTarget) : "";

  const status: { word: string; tone: FlapTone } =
    !model.active ? { word: "CANCELLED", tone: "danger" }
    : retired ? { word: "DEPARTED", tone: "danger" }
    : retiring ? (daysUntil(retiring.retiresAt) <= 30 ? { word: "FINAL CALL", tone: "warning" } : { word: "BOARDING", tone: "success" })
    : expiring ? (daysUntil(expiring) <= 30 ? { word: "FINAL CALL", tone: "warning" } : { word: "BOARDING", tone: "success" })
    : alias && model.aliasTarget ? { word: "REROUTED", tone: "warning" }
    : { word: "LISTED", tone: "success" };

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
  const badgeMarkdown = `![input price](https://ai-observatory.view.fast/badge.svg?model=${model.modelId}&metric=input)`;
  const name = shortName(model.modelId, model.name);
  const sinceWord = (pct: number | null) => (pct !== null && pct !== 0 ? `${signedPct(pct)} since listed` : "unchanged since listed");

  return (
    <div class="flex flex-col gap-8">
      <Board label={providerName(model.provider)} hint={alias ? "rolling alias" : model.modality || undefined} action={<Sign to={`/provider/${encodeURIComponent(model.provider.replace(/^~/, ""))}`}>All {providerName(model.provider)} models</Sign>}>
        <div class="flex flex-col gap-4 px-3 py-4">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <h1 class="min-w-0">
              <FlapText text={name} width={Math.min(30, Math.max(8, name.length))} size="lg" />
            </h1>
            <FlapText text={status.word} width={10} size="lg" tone={status.tone} delay={200} />
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="rounded-sm border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink-muted">{model.modelId}</span>
            <CopySign text={model.modelId} label="Copy id" />
            <Sign onClick={() => (watching ? removeWatch(model.modelId) : addWatch(model.modelId))} active={watching} ariaLabel={watching ? "Stop watching" : "Watch this model"}>{watching ? "Watching" : "Watch"}</Sign>
            <Sign onClick={() => navigate(compareHref([model.modelId]))}>Compare</Sign>
            <Sign href={`/og/model.png?id=${encodeURIComponent(model.modelId)}`} title="A shareable card for this model">Share card</Sign>
            <Sign href={`/api/model.json?id=${encodeURIComponent(model.modelId)}`}>JSON</Sign>
            <Sign href={`/feed.xml?model=${encodeURIComponent(model.modelId)}`}>RSS</Sign>
          </div>
          <p class="text-xs uppercase tracking-[0.2em] text-ink-muted">
            listed {boardDate(model.firstSeenAt)} {model.firstSeenAt.slice(0, 4)} · last seen {ago(model.lastSeenAt)}
            {model.knowledgeCutoff ? ` · knows the world to ${longDate(model.knowledgeCutoff)}` : ""}
            {model.reasoning ? ` · reasoning${model.reasoning === "mandatory" ? " always on" : ""}` : ""}
            {model.inputModalities && model.inputModalities !== "text" ? ` · ${model.inputModalities.split(",").join(" + ")} in` : ""}
            {model.huggingFaceId ? <> · <a href={`https://huggingface.co/${model.huggingFaceId}`} class="text-accent hover:underline" target="_blank" rel="noopener">open weights</a></> : null}
          </p>
          <div class="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            <Readout label="In $/M" value={money(model.promptPrice) || "-"} width={7} size="md" sub={sinceWord(inputSinceListed)} tag={atLow ? "Lowest ever" : undefined} delay={0} />
            <Readout label="Out $/M" value={money(model.completionPrice) || "-"} width={7} size="md" sub={sinceWord(outputSinceListed)} delay={40} />
            <Readout label="Cache $/M" value={model.cacheReadPrice ? money(model.cacheReadPrice) : "-"} width={7} size="md" sub={model.cacheWritePrice ? `write ${money(model.cacheWritePrice)}` : undefined} delay={80} />
            <Readout label="Context" value={formatContext(model.contextLength)} width={6} size="md" sub={tiers.length ? `pricier above ${formatContext(String(tiers[0].minPromptTokens))}` : undefined} delay={120} />
            <Readout label="Max out" value={formatContext(model.maxCompletion)} width={6} size="md" sub={`${model.changeCount || "0"} changes recorded`} delay={160} />
          </div>
          {alias && model.aliasTarget ? (
            <p class="text-sm text-ink">This name always points at the newest model in its family. Right now that is <Link to={modelHref(targetId)} class="text-accent hover:underline">{modelName(targetId, names.get(targetId))}</Link>.</p>
          ) : null}
          {model.description ? <p class="max-w-3xl text-sm leading-relaxed text-ink-muted">{model.description.length > 420 ? `${model.description.slice(0, 420)}…` : model.description}</p> : null}
          {tiers.length ? <p class="text-sm text-ink-muted">Long prompts cost more: {tiers.map((t) => `above ${formatContext(String(t.minPromptTokens))} tokens, ${money(t.prompt)} in · ${money(t.completion)} out`).join("; ")}.</p> : null}
        </div>
      </Board>

      {retiring || retired || expiring ? (
        <Plaque class="border-danger/50 bg-danger/10">
          {retired ? (
            <span><span class="font-bold uppercase tracking-[0.2em] text-danger">Departed.</span> {providerName(retired.provider)} stopped serving {retired.modelId}{retired.retiresAt ? ` on ${longDate(retired.retiresAt)}` : ""}.{retired.replacement ? ` Recommended replacement: ${retired.replacement}.` : ""}</span>
          ) : retiring ? (
            <span><span class="font-bold uppercase tracking-[0.2em] text-danger">Departing {countdown(retiring.retiresAt)}.</span> {providerName(retiring.provider)} deprecated {retiring.modelId}{retiring.deprecatedAt ? ` on ${longDate(retiring.deprecatedAt)}` : ""} and will retire it on {longDate(retiring.retiresAt)}.{retiring.replacement ? ` Recommended replacement: ${retiring.replacement}.` : ""}</span>
          ) : (
            <span><span class="font-bold uppercase tracking-[0.2em] text-warning">Listing expires {countdown(expiring)}.</span> OpenRouter has set {longDate(expiring)} as the last day for this listing.</span>
          )}
        </Plaque>
      ) : null}

      <LogSection
        title="Price over time"
        hint="$ per million tokens"
        action={
          <>
            {RANGES.map((r) => <Stencil key={r.key} href={`${modelHref(model.modelId)}?range=${r.key}`} active={range === r.key}>{r.label}</Stencil>)}
            <span class="mx-1 h-4 w-px bg-line" aria-hidden="true" />
            <Stencil active={tab === "chart"} onClick={() => setTab("chart")}>Chart</Stencil>
            <Stencil active={tab === "table"} onClick={() => setTab("table")}>Table</Stencil>
          </>
        }
      >
        {tab === "chart" ? (
          inputSeries.length ? (
            <StepChart series={series} from={from} lowLine={lowInput !== null && lowInput > 0 && Number(model.changeCount) > 0 ? { value: lowInput, label: `lowest input ${money(model.lowInput)}` } : undefined} />
          ) : (
            <BoardEmpty>No price on record</BoardEmpty>
          )
        ) : (
          <StepTable series={series} />
        )}
      </LogSection>

      {contextSeries.length > 2 ? (
        <LogSection title="Context window over time" hint="million tokens">
          <StepChart series={[{ key: "context", label: "context (M tokens)", points: contextSeries }]} from={from} height={160} formatValue={(v) => `${v >= 1 ? v.toFixed(v % 1 ? 1 : 0) : (v * 1000).toFixed(0) + "K"}${v >= 1 ? "M" : ""}`} />
        </LogSection>
      ) : null}

      <Board label="Who serves it" hint={hosts.length ? `${plural(hosts.filter((h) => h.active).length, "host")} via OpenRouter` : "no host detail yet"} action={hosts.length > 15 ? <Sign onClick={() => setAllHosts((v) => !v)}>{allHosts ? "Fewer" : `All ${hosts.length}`}</Sign> : undefined}>
        {hosts.length === 0 ? (
          <BoardEmpty>Host prices and uptime arrive with the next daily check</BoardEmpty>
        ) : (
          <>
            <ColumnHeads columns={[{ label: "Host", width: 16, sticky: true }, { label: "Precision", width: 7 }, { label: "Context", width: 6, align: "right" }, { label: "In $/M", width: 7, align: "right" }, { label: "Out $/M", width: 7, align: "right" }, { label: "Uptime 24h", width: 12 }, { label: "Status", width: 8 }]} />
            {shownHosts.map((h, i) => {
              const up = Number(h.uptime1d);
              const cheapest = cheapestHost && h.id === cheapestHost.id;
              return (
                <FlapRow
                  key={h.id}
                  label={`${h.host}: ${money(h.promptPrice)} in, ${money(h.completionPrice)} out per million, ${Number.isFinite(up) ? `${up.toFixed(1)}% uptime` : "no uptime reading"}${cheapest ? ", cheapest" : ""}${h.active ? "" : ", no longer serving"}`}
                  delay={i * 40}
                  class={h.active ? "" : "opacity-60"}
                  columns={[
                    { text: h.host, width: 16, sticky: true, tone: h.active ? "ink" : "muted" },
                    { text: h.quantization && h.quantization !== "unknown" ? h.quantization : "-", width: 7, tone: "muted" },
                    { text: formatContext(h.contextLength), width: 6, align: "right", tone: "muted" },
                    { text: money(h.promptPrice), width: 7, align: "right", tone: cheapest ? "success" : "ink" },
                    { text: money(h.completionPrice), width: 7, align: "right" },
                    { text: "", width: 12, render: (
                      <span class="inline-flex items-center gap-2" title={`${h.uptime1d}% over the last day`}>
                        <span class="inline-block h-[10px] w-24 overflow-hidden rounded-[1px] bg-flap"><span class={`block h-full ${up >= 99 ? "bg-success" : up >= 95 ? "bg-warning" : "bg-danger"}`} style={{ width: `${Math.max(0, Math.min(100, Number.isFinite(up) ? up : 0))}%` }} /></span>
                        <span class="font-mono text-xs tabular-nums text-ink-muted">{Number.isFinite(up) ? `${up.toFixed(1)}%` : "-"}</span>
                      </span>
                    ) },
                    { text: !h.active ? "GONE" : cheapest ? "CHEAPEST" : up >= 99 ? "ON TIME" : up >= 95 ? "DELAYED" : "SPOTTY", width: 8, tone: !h.active ? "muted" : cheapest ? "success" : up >= 99 ? "success" : "warning" },
                  ]}
                />
              );
            })}
          </>
        )}
      </Board>

      <Board label="Across price lists" hint={listings.length ? "what the provider's own listing says" : "not listed elsewhere"}>
        {listings.length === 0 ? (
          <BoardEmpty>The other price lists have no entry for this model</BoardEmpty>
        ) : (
          <>
            <ColumnHeads columns={[{ label: "List", width: 9, sticky: true }, { label: "Id there", width: 17 }, { label: "Context", width: 6, align: "right" }, { label: "In $/M", width: 7, align: "right" }, { label: "Out $/M", width: 7, align: "right" }, { label: "Released", width: 6 }, { label: "Vs here", width: 14 }]} />
            {listings.map((l, i) => {
              const inGap = pctChange(l.promptPrice, model.promptPrice);
              const outGap = pctChange(l.completionPrice, model.completionPrice);
              const same = (inGap === null || Math.abs(inGap) < 3) && (outGap === null || Math.abs(outGap) < 3);
              const gapText = same ? "SAME PRICE" : [inGap !== null && Math.abs(inGap) >= 3 ? `IN ${boardPct(inGap)}` : "", outGap !== null && Math.abs(outGap) >= 3 ? `OUT ${boardPct(outGap)}` : ""].filter(Boolean).join(" ");
              return (
                <FlapRow
                  key={l.id}
                  label={`${SOURCE_LABEL[l.source] ?? l.source} lists ${l.sourceId} at ${money(l.promptPrice)} in, ${money(l.completionPrice)} out; ${same ? "same price as here" : gapText}`}
                  delay={i * 40}
                  class={l.active ? "" : "opacity-60"}
                  columns={[
                    { text: (SOURCE_LABEL[l.source] ?? l.source).split("'")[0], width: 9, sticky: true },
                    { text: l.sourceId + (l.active ? "" : " GONE"), width: 17, tone: "muted" },
                    { text: formatContext(l.contextLength), width: 6, align: "right", tone: "muted" },
                    { text: money(l.promptPrice), width: 7, align: "right" },
                    { text: money(l.completionPrice), width: 7, align: "right" },
                    { text: l.releaseDate ? boardDate(l.releaseDate) : "-", width: 6, tone: "muted" },
                    { text: gapText, width: 14, tone: same ? "success" : "warning" },
                  ]}
                />
              );
            })}
            <p class="px-3 py-2 text-xs text-ink-muted">
              "Vs here" compares the price tracked here with that list. A higher price here is what the middleman adds; lower means a discount.
              {SOURCE_URL.litellm ? <> Lists: {listings.map((l, i) => <span key={l.id}>{i ? ", " : ""}<a href={l.sourceId && SOURCE_URL[l.source] ? SOURCE_URL[l.source] : "#"} target="_blank" rel="noopener" class="text-accent hover:underline">{SOURCE_LABEL[l.source]}</a></span>)}.</> : null}
            </p>
          </>
        )}
      </Board>

      {lifecycle.length ? (
        <LogSection title="Notices" hint="from the providers' own pages">
          <ul>
            {lifecycle.map((l) => (
              <LogLine key={l.id} left={<span class="uppercase">{(SOURCE_LABEL[l.source] ?? l.source).split("'")[0].slice(0, 7)}</span>} right={l.sourceUrl || SOURCE_URL[l.source] ? <a href={l.sourceUrl || SOURCE_URL[l.source]} target="_blank" rel="noopener" class="uppercase tracking-[0.15em] text-accent hover:underline">read</a> : null}>
                <span class="font-mono text-xs text-ink-muted">{l.modelId}</span> <span>{noticeLine(l, tracked)}</span>
              </LogLine>
            ))}
          </ul>
        </LogSection>
      ) : null}

      <LogSection title="History" hint={`${plural(stories.filter((s) => s.kind !== "drift").length, "change")}${stories.some((s) => s.kind === "drift") ? ` · ${plural(stories.filter((s) => s.kind === "drift").reduce((n, s) => n + (s.folded ?? 1), 0), "small move")} folded` : ""}`}>
        {stories.length === 0 ? (
          <BoardEmpty>Nothing has moved since it was first seen</BoardEmpty>
        ) : (
          <ul>{stories.map((s) => <StoryLine key={s.key} story={s} href={null} showMore date />)}</ul>
        )}
      </LogSection>

      {data.family.length ? (
        <Board label="Same family" hint="from the same provider" action={<Sign to={compareHref([model.modelId, ...data.family.slice(0, 3).map((m) => m.modelId)])}>Compare these</Sign>}>
          <ColumnHeads columns={[{ label: "Model", width: 22, sticky: true }, { label: "Id", width: 22 }, { label: "In $/M", width: 7, align: "right" }, { label: "Out $/M", width: 7, align: "right" }, { label: "Status", width: 10 }]} />
          {data.family.slice(0, 15).map((m, i) => {
            const pointsHere = Boolean(m.aliasTarget && canonicalKey(m.provider, m.aliasTarget) === key);
            return (
              <FlapRow
                key={m.id}
                href={modelHref(m.modelId)}
                label={`${shortName(m.modelId, m.name)}: ${money(m.promptPrice)} in, ${money(m.completionPrice)} out${m.active ? "" : ", no longer listed"}${pointsHere ? ", points here" : ""}`}
                delay={i * 40}
                class={m.active ? "" : "opacity-60"}
                columns={[
                  { text: shortName(m.modelId, m.name), width: 22, sticky: true },
                  { text: m.modelId, width: 22, tone: "muted" },
                  { text: money(m.promptPrice), width: 7, align: "right" },
                  { text: money(m.completionPrice), width: 7, align: "right" },
                  { text: !m.active ? "CANCELLED" : pointsHere ? "POINTS HERE" : isAlias(m.modelId) ? "ALIAS" : "LISTED", width: 10, tone: !m.active ? "danger" : pointsHere ? "accent" : isAlias(m.modelId) ? "muted" : "success" },
                ]}
              />
            );
          })}
        </Board>
      ) : null}

      <Plaque class="flex flex-col gap-3">
        <span class="text-[11px] font-bold uppercase tracking-[0.3em] text-accent">Take it with you</span>
        <div class="flex flex-wrap items-center gap-3">
          <img src={`/badge.svg?model=${encodeURIComponent(model.modelId)}&metric=input`} alt={`input price badge for ${model.modelId}`} height={20} />
          <img src={`/badge.svg?model=${encodeURIComponent(model.modelId)}&metric=changed`} alt={`last change badge for ${model.modelId}`} height={20} />
          <CopySign text={badgeMarkdown} label="Copy markdown" />
        </div>
        <CodeBlock language="markdown" code={badgeMarkdown} />
        <p class="text-xs text-ink-muted">
          <Link to="/api" class="text-accent hover:underline">All badges, feeds and JSON</Link>
          {" · "}<a href={`/feed.xml?model=${encodeURIComponent(model.modelId)}`} class="text-accent hover:underline">RSS for this model</a>
          {" · "}<a href={`/api/model.json?id=${encodeURIComponent(model.modelId)}`} class="text-accent hover:underline">JSON</a>
        </p>
      </Plaque>
    </div>
  );
}
