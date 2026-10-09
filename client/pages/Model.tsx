/**
 * One model's dossier: the numbers now, the price as a step chart, who serves it, what the
 * other lists say, its lifecycle, and every change ever recorded.
 */
import { useMemo, useState } from "preact/hooks";
import { Link, useNavigate, useParams, useQuery } from "@spacefast/zero/client";
import { BarChart } from "@spacefast/zero/charts";
import { Accordion, AccordionItem, Badge, Button, EmptyState, Icon, Skeleton, Tabs, TabsList, TabsTrigger } from "@spacefast/zero/kit";

import { formatContext, money, parseTiers, perMillion } from "../../shared/model";
import { isAlias, modelName, providerName } from "../../shared/providers";
import { SOURCE_LABEL, SOURCE_URL, canonicalKey } from "../../shared/sources";
import type { Story } from "../../shared/stories";
import type { ArchiveEvent, LifecycleRow, ModelPageData, ModelRow } from "../../shared/types";
import { Card, CopyButton, DeltaChip, ExternalLink, ModelLink, ProviderLink, Section } from "../components/bits";
import { StepChart, StepTable, type StepSeries } from "../components/StepChart";
import { StoryRow } from "../components/StoryRow";
import { sourceStepSeries, stepSeries } from "../lib/series";
import { assembleStories, keyIndex, storyHref } from "../lib/stories";
import { DAY, ago, compareHref, countdown, daysUntil, isLoading, longDate, modelHref, pctChange, plural, signedPct, usePageTitle, useSearchParams } from "../lib/util";
import { useWatchlist } from "../lib/watch";

const RANGES: { key: string; label: string; days: number }[] = [
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "1y", label: "1y", days: 365 },
  { key: "all", label: "all", days: 0 },
];

function Stat(props: { label: string; value: string; sub?: preact.ComponentChildren; tag?: string }) {
  return (
    <div class="flex flex-col gap-0.5 rounded-xl border border-line bg-surface px-4 py-3">
      <span class="text-xs text-ink-muted">{props.label}</span>
      <span class="font-mono text-2xl font-semibold tabular-nums text-ink">{props.value || "–"}</span>
      {props.sub ? <span class="text-xs text-ink-muted">{props.sub}</span> : null}
      {props.tag ? <span class="mt-1 self-start rounded-md bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success">{props.tag}</span> : null}
    </div>
  );
}

/** The first value of a price field in the archive, for "since listed" deltas. */
function firstValue(events: ArchiveEvent[], field: string, current: string): string {
  const first = events.find((e) => e.kind === "changed" && e.field === field);
  return first ? first.oldValue : current;
}

function lifecycleLine(row: LifecycleRow, tracked: Map<string, string>): preact.ComponentChildren {
  const replacementId = row.replacement ? tracked.get(canonicalKey(row.provider, row.replacement)) : undefined;
  const parts: preact.ComponentChildren[] = [];
  if (row.state === "retired") parts.push(<span class="text-danger">Retired{row.retiresAt ? ` ${longDate(row.retiresAt)}` : ""}</span>);
  else if (row.state === "deprecated") parts.push(<span class="text-warning">Deprecated{row.deprecatedAt ? ` ${longDate(row.deprecatedAt)}` : ""}</span>);
  else parts.push(<span class="text-success">Active</span>);
  if (row.state !== "retired" && row.retiresAt) parts.push(<span>{row.retiresNote === "not sooner than" ? "supported until at least" : "retires"} {longDate(row.retiresAt)} ({countdown(row.retiresAt)})</span>);
  if (row.state !== "retired" && !row.retiresAt && row.state === "deprecated") parts.push(<span>retirement date to be announced</span>);
  if (row.replacement) parts.push(<span>replacement: {replacementId ? <ModelLink modelId={replacementId} class="text-accent" /> : <span class="font-mono">{row.replacement}</span>}</span>);
  return parts.map((p, i) => <span key={i}>{i ? " · " : ""}{p}</span>);
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
    return <EmptyState title="Unknown model" description={`${modelId} has never been seen.`} icon="search" action={<Link to="/models" class="text-accent hover:underline">Browse models</Link>} />;
  }
  if (!model) {
    return <div class="flex flex-col gap-4"><Skeleton class="h-10 w-2/3" /><Skeleton class="h-24 w-full" /><Skeleton class="h-64 w-full" /></div>;
  }

  const watching = watchlist.includes(model.modelId);
  const alias = isAlias(model.modelId);
  const lifecycle = data.lifecycle;
  const retiring = lifecycle.find((l) => l.state === "deprecated" && l.retiresAt) ?? null;
  const retired = lifecycle.find((l) => l.state === "retired") ?? null;
  const expiring = model.expirationDate && daysUntil(model.expirationDate) >= -1 ? model.expirationDate : "";
  const confirmedCount = stories.filter((s) => s.confirmedBy?.length).length;

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
  const atLow = model.lowInput && model.promptPrice === model.lowInput && Number(model.changeCount) > 0;
  const cheapestHost = data.hosts.filter((h) => h.active && h.promptPrice).sort((a, b) => Number(a.promptPrice) - Number(b.promptPrice))[0];
  const tiers = parseTiers(model.tiers);
  const key = canonicalKey(model.provider, model.modelId);
  const listings = data.listings.slice().sort((a, b) => a.source.localeCompare(b.source));
  const markup = listings
    .filter((l) => l.promptPrice && model.promptPrice)
    .map((l) => ({ at: SOURCE_LABEL[l.source]?.split("'")[0] ?? l.source, gap: Math.round((pctChange(l.promptPrice, model.promptPrice) ?? 0) * 10) / 10 }));
  const small = stories.filter((s) => s.kind === "drift");
  const big = stories.filter((s) => s.kind !== "drift");
  const targetId = model.aliasTarget ? (tracked.get(canonicalKey(model.provider, model.aliasTarget)) ?? model.aliasTarget) : "";

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex min-w-0 flex-col gap-1.5">
            <span class="text-sm text-ink-muted"><ProviderLink slug={model.provider} class="text-ink-muted" /></span>
            <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{modelName(model.modelId, model.name).replace(/ \(alias\)$/, "")}</h1>
            <div class="flex flex-wrap items-center gap-2">
              <code class="font-mono text-sm text-ink-muted">{model.modelId}</code>
              <CopyButton text={model.modelId} label="copy id" />
            </div>
            <div class="flex flex-wrap items-center gap-1.5 pt-1">
              {model.active ? <Badge tone="success">listed</Badge> : <Badge tone="danger">no longer listed</Badge>}
              {alias ? <Badge tone="accent">rolling alias</Badge> : null}
              {confirmedCount ? <Badge tone="accent">{confirmedCount} confirmed {confirmedCount === 1 ? "change" : "changes"}</Badge> : null}
              {retired ? <Badge tone="danger">retired by {providerName(retired.provider)}</Badge> : retiring ? <Badge tone="danger">retires {countdown(retiring.retiresAt)}</Badge> : null}
              {expiring ? <Badge tone="warning">listing expires {countdown(expiring)}</Badge> : null}
              {model.reasoning ? <Badge>reasoning{model.reasoning === "mandatory" ? " always on" : ""}</Badge> : null}
              {model.inputModalities && model.inputModalities !== "text" ? <Badge>{model.inputModalities.split(",").join(" + ")} in</Badge> : null}
            </div>
            <p class="text-sm text-ink-muted">
              listed {longDate(model.firstSeenAt)} · last seen {ago(model.lastSeenAt)}
              {model.knowledgeCutoff ? ` · knows the world up to ${longDate(model.knowledgeCutoff)}` : ""}
              {model.huggingFaceId ? <> · <a href={`https://huggingface.co/${model.huggingFaceId}`} class="text-accent hover:underline" target="_blank" rel="noopener">open weights</a></> : ""}
            </p>
            {alias && model.aliasTarget ? (
              <p class="text-sm text-ink">
                This name always points at the newest model in its family. Right now that is <ModelLink modelId={targetId} class="text-accent" />.
              </p>
            ) : null}
          </div>
          <div class="flex shrink-0 flex-wrap gap-2">
            <Button variant={watching ? "secondary" : "outline"} size="sm" icon="star" onClick={() => (watching ? removeWatch(model.modelId) : addWatch(model.modelId))} aria-pressed={watching}>
              {watching ? "Watching" : "Watch"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(compareHref([model.modelId]))}>Compare</Button>
            <a href={`/og/model.png?id=${encodeURIComponent(model.modelId)}`} target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:border-ink-muted" title="A shareable card for this model">
              <Icon name="share-2" size="sm" /> Share card
            </a>
          </div>
        </div>
        {model.description ? <p class="max-w-3xl text-sm leading-relaxed text-ink-muted">{model.description.length > 420 ? `${model.description.slice(0, 420)}…` : model.description}</p> : null}
      </div>

      {retiring || retired || expiring ? (
        <div class="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-ink">
          {retired ? (
            <span><span class="font-medium text-danger">Retired.</span> {providerName(retired.provider)} stopped serving {retired.modelId}{retired.retiresAt ? ` on ${longDate(retired.retiresAt)}` : ""}.{retired.replacement ? ` Recommended replacement: ${retired.replacement}.` : ""}</span>
          ) : retiring ? (
            <span><span class="font-medium text-danger">Retiring {countdown(retiring.retiresAt)}.</span> {providerName(retiring.provider)} deprecated {retiring.modelId}{retiring.deprecatedAt ? ` on ${longDate(retiring.deprecatedAt)}` : ""} and will retire it on {longDate(retiring.retiresAt)}.{retiring.replacement ? ` Recommended replacement: ${retiring.replacement}.` : ""}</span>
          ) : (
            <span><span class="font-medium text-warning">Listing expires {countdown(expiring)}.</span> OpenRouter has set {longDate(expiring)} as the last day for this listing.</span>
          )}
        </div>
      ) : null}

      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Input $/M" value={money(model.promptPrice)} sub={inputSinceListed !== null && inputSinceListed !== 0 ? `${signedPct(inputSinceListed)} since listed` : "unchanged since listed"} tag={atLow ? "lowest ever" : undefined} />
        <Stat label="Output $/M" value={money(model.completionPrice)} sub={outputSinceListed !== null && outputSinceListed !== 0 ? `${signedPct(outputSinceListed)} since listed` : "unchanged since listed"} />
        <Stat label="Cache read $/M" value={model.cacheReadPrice ? money(model.cacheReadPrice) : "–"} sub={model.cacheWritePrice ? `write ${money(model.cacheWritePrice)}` : undefined} />
        <Stat label="Context" value={formatContext(model.contextLength)} sub={tiers.length ? `pricier above ${formatContext(String(tiers[0].minPromptTokens))}` : undefined} />
        <Stat label="Max output" value={formatContext(model.maxCompletion)} />
        <Stat label="Changes recorded" value={model.changeCount || "0"} sub={model.lastChangedAt ? `last ${ago(model.lastChangedAt)}` : "never"} />
      </div>

      {tiers.length ? (
        <p class="text-sm text-ink-muted">
          Long prompts cost more: {tiers.map((t) => `above ${formatContext(String(t.minPromptTokens))} tokens, ${money(t.prompt)} in · ${money(t.completion)} out`).join("; ")}.
        </p>
      ) : null}

      <Section
        title="Price over time"
        hint="$ per million tokens"
        action={
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex gap-0.5 rounded-lg border border-line p-0.5">
              {RANGES.map((r) => (
                <Link key={r.key} to={`${modelHref(model.modelId)}?range=${r.key}`} replace class={`rounded-md px-2 py-0.5 font-mono text-xs ${range === r.key ? "bg-ink/10 text-ink" : "text-ink-muted hover:text-ink"}`} aria-current={range === r.key ? "true" : undefined}>
                  {r.label}
                </Link>
              ))}
            </div>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="chart" current={tab} onSelect={setTab}>Chart</TabsTrigger>
                <TabsTrigger value="table" current={tab} onSelect={setTab}>Table</TabsTrigger>
              </TabsList>
            </Tabs>
            <a href={`/api/model.json?id=${encodeURIComponent(model.modelId)}`} class="inline-flex items-center gap-1 text-xs text-accent hover:underline"><Icon name="download" size="sm" /> JSON</a>
          </div>
        }
      >
        <Card>
          {tab === "chart" ? (
            inputSeries.length ? (
              <StepChart series={series} from={from} lowLine={lowInput !== null && lowInput > 0 && Number(model.changeCount) > 0 ? { value: lowInput, label: `lowest input ${money(model.lowInput)}` } : undefined} />
            ) : (
              <p class="text-sm text-ink-muted">No price on record.</p>
            )
          ) : (
            <StepTable series={series} />
          )}
        </Card>
      </Section>

      {contextSeries.length > 2 ? (
        <Section title="Context window over time" hint="million tokens">
          <Card>
            <StepChart series={[{ key: "context", label: "context (M tokens)", points: contextSeries }]} from={from} height={160} formatValue={(v) => `${v >= 1 ? v.toFixed(v % 1 ? 1 : 0) : (v * 1000).toFixed(0) + "K"}${v >= 1 ? "M" : ""}`} />
          </Card>
        </Section>
      ) : null}

      <Section title="Who serves it" hint={data.hosts.length ? `${plural(data.hosts.filter((h) => h.active).length, "host")} via OpenRouter` : "no host detail yet"}>
        <Card padded={false}>
          {data.hosts.length === 0 ? (
            <p class="p-4 text-sm text-ink-muted">Host-level prices and uptime arrive with the next daily check.</p>
          ) : (
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-line text-left text-xs text-ink-muted">
                    <th class="px-4 py-2 font-normal">host</th>
                    <th class="px-2 py-2 font-normal">precision</th>
                    <th class="px-2 py-2 text-right font-normal">context</th>
                    <th class="px-2 py-2 text-right font-normal">in $/M</th>
                    <th class="px-2 py-2 text-right font-normal">out $/M</th>
                    <th class="px-4 py-2 font-normal">uptime, 24h</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hosts.slice().sort((a, b) => Number(b.active) - Number(a.active) || Number(a.promptPrice) - Number(b.promptPrice)).map((h) => {
                    const up = Number(h.uptime1d);
                    const cheapest = cheapestHost && h.id === cheapestHost.id;
                    return (
                      <tr key={h.id} class={`border-b border-line last:border-0 ${h.active ? "" : "opacity-50"}`}>
                        <td class="px-4 py-2 text-ink">{h.host}{cheapest ? <span class="ml-2 rounded-md bg-success/15 px-1.5 text-[11px] text-success">cheapest</span> : null}{h.active ? "" : <span class="ml-2 text-xs text-ink-muted">gone</span>}</td>
                        <td class="px-2 py-2 font-mono text-xs text-ink-muted">{h.quantization && h.quantization !== "unknown" ? h.quantization : "–"}</td>
                        <td class="px-2 py-2 text-right font-mono tabular-nums text-ink-muted">{formatContext(h.contextLength)}</td>
                        <td class="px-2 py-2 text-right font-mono tabular-nums text-ink">{money(h.promptPrice)}</td>
                        <td class="px-2 py-2 text-right font-mono tabular-nums text-ink">{money(h.completionPrice)}</td>
                        <td class="px-4 py-2">
                          <div class="flex items-center gap-2" title={`${h.uptime1d}% over the last day`}>
                            <div class="h-1.5 w-24 overflow-hidden rounded-full bg-line"><div class={`h-full ${up >= 99 ? "bg-success" : up >= 95 ? "bg-warning" : "bg-danger"}`} style={{ width: `${Math.max(0, Math.min(100, up))}%` }} /></div>
                            <span class="font-mono text-xs tabular-nums text-ink-muted">{Number.isFinite(up) ? `${up.toFixed(1)}%` : "–"}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Section title="Across price lists" hint={listings.length ? "what the provider's own listing says" : "not listed elsewhere"}>
        <Card padded={false}>
          {listings.length === 0 ? (
            <p class="p-4 text-sm text-ink-muted">The other price lists have no entry for this model.</p>
          ) : (
            <div class="flex flex-col gap-4 p-4">
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-line text-left text-xs text-ink-muted">
                      <th class="py-1 pr-3 font-normal">list</th>
                      <th class="py-1 pr-3 font-normal">id there</th>
                      <th class="py-1 pr-3 text-right font-normal">context</th>
                      <th class="py-1 pr-3 text-right font-normal">in $/M</th>
                      <th class="py-1 pr-3 text-right font-normal">out $/M</th>
                      <th class="py-1 pr-3 font-normal">released</th>
                      <th class="py-1 font-normal">vs here</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listings.map((l) => {
                      const inGap = pctChange(l.promptPrice, model.promptPrice);
                      const outGap = pctChange(l.completionPrice, model.completionPrice);
                      const same = (inGap === null || Math.abs(inGap) < 3) && (outGap === null || Math.abs(outGap) < 3);
                      return (
                        <tr key={l.id} class={`border-b border-line last:border-0 ${l.active ? "" : "opacity-50"}`}>
                          <td class="py-1.5 pr-3 text-ink">{SOURCE_URL[l.source] ? <a href={SOURCE_URL[l.source]} target="_blank" rel="noopener" class="hover:text-accent">{SOURCE_LABEL[l.source]}</a> : SOURCE_LABEL[l.source] ?? l.source}</td>
                          <td class="py-1.5 pr-3 font-mono text-xs text-ink-muted">{l.sourceId}{l.active ? "" : " (gone)"}</td>
                          <td class="py-1.5 pr-3 text-right font-mono tabular-nums text-ink-muted">{formatContext(l.contextLength)}</td>
                          <td class="py-1.5 pr-3 text-right font-mono tabular-nums text-ink-muted">{perMillion(l.promptPrice)}</td>
                          <td class="py-1.5 pr-3 text-right font-mono tabular-nums text-ink-muted">{perMillion(l.completionPrice)}</td>
                          <td class="py-1.5 pr-3 font-mono text-xs text-ink-muted">{l.releaseDate ? longDate(l.releaseDate) : "–"}</td>
                          <td class="py-1.5">
                            {same ? <span class="text-xs text-success">same price</span> : (
                              <span class="flex flex-wrap gap-1">
                                {inGap !== null && Math.abs(inGap) >= 3 ? <DeltaChip value={inGap} good={inGap < 0} size="sm" title="input price here vs that list" /> : null}
                                {outGap !== null && Math.abs(outGap) >= 3 ? <DeltaChip value={outGap} good={outGap < 0} size="sm" title="output price here vs that list" /> : null}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {markup.length ? (
                <div>
                  <p class="mb-1 text-xs text-ink-muted">Input price here, as a percentage above or below each list. Above zero is what the middleman adds.</p>
                  <BarChart data={markup.map((m) => ({ at: m.at, markup: Math.max(0, m.gap) }))} x="at" series={[{ key: "markup", label: "% above list" }]} height={120} formatValue={(v) => `${v.toFixed(0)}%`} />
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </Section>

      {lifecycle.length ? (
        <Section title="Lifecycle" hint="from the provider's own notices">
          <Card>
            <ul class="flex flex-col gap-2 text-sm">
              {lifecycle.map((l) => (
                <li key={l.id} class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span class="font-mono text-xs text-ink-muted">{l.modelId}</span>
                  <span>{lifecycleLine(l, tracked)}</span>
                  {l.sourceUrl || SOURCE_URL[l.source] ? <ExternalLink href={l.sourceUrl || SOURCE_URL[l.source]}>{SOURCE_LABEL[l.source] ?? l.source}</ExternalLink> : null}
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <Section title="History" hint={`${plural(big.length, "change")}${small.length ? ` · ${plural(small.reduce((n, s) => n + (s.folded ?? 1), 0), "small move")} folded` : ""}`}>
        <Card padded={false} class="px-4">
          {stories.length === 0 ? (
            <EmptyState title="No changes yet" description="Nothing has moved since it was first seen." />
          ) : (
            <ul>
              {stories.map((s) =>
                s.kind === "drift" ? (
                  <li key={s.key} class="border-b border-line py-1 last:border-0">
                    <Accordion>
                      <AccordionItem title={`${longDate(s.at)} · ${s.headline}`}>
                        <ul class="flex flex-col gap-1 font-mono text-xs">
                          {s.events.map((e) => <li key={e.id}>{e.at.replace("T", " ").slice(0, 16)} · {e.field === "promptPrice" ? "input" : e.field === "completionPrice" ? "output" : e.field} {money(e.oldValue)} → {money(e.newValue)}</li>)}
                        </ul>
                      </AccordionItem>
                    </Accordion>
                  </li>
                ) : (
                  <StoryRow key={s.key} story={s} href={null} compact showMore />
                ),
              )}
            </ul>
          )}
        </Card>
      </Section>

      {data.family.length ? (
        <Section title="Same family" hint="from the same provider" action={<Link to={compareHref([model.modelId, ...data.family.slice(0, 3).map((m) => m.modelId)])} class="text-accent hover:underline">compare these</Link>}>
          <Card padded={false}>
            <ul>
              {data.family.map((m) => (
                <li key={m.id} class={`flex items-center gap-3 border-b border-line px-4 py-2 last:border-0 ${m.active ? "" : "opacity-60"}`}>
                  <div class="min-w-0 flex-1">
                    <ModelLink modelId={m.modelId} name={m.name} class="block truncate text-sm text-ink" />
                    <span class="font-mono text-[11px] text-ink-muted">{m.modelId}{m.active ? "" : " · no longer listed"}{m.aliasTarget && canonicalKey(m.provider, m.aliasTarget) === key ? " · points here" : ""}</span>
                  </div>
                  <span class="w-20 text-right font-mono text-xs tabular-nums text-ink">{money(m.promptPrice)} in</span>
                  <Link to={compareHref([model.modelId, m.modelId])} class="text-xs text-accent hover:underline">compare</Link>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <p class="text-xs text-ink-muted">
        Badge for your README: <code class="font-mono">{`![input price](https://ai-observatory.view.fast/badge.svg?model=${model.modelId}&metric=input)`}</code>
        {" · "}<Link to="/api" class="text-accent hover:underline">all badges and feeds</Link>
        {" · "}<a href={`/feed.xml?model=${encodeURIComponent(model.modelId)}`} class="text-accent hover:underline">RSS for this model</a>
      </p>
    </div>
  );
}
