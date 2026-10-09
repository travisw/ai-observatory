/**
 * Up to four models side by side: the spec table with the best cell marked, overlaid price
 * history, and one merged timeline.
 */
import { useMemo } from "preact/hooks";
import { Link, useNavigate, useQuery } from "@spacefast/zero/client";
import { Button, EmptyState, Icon } from "@spacefast/zero/kit";

import { formatContext, money } from "../../shared/model";
import { modelName, providerName } from "../../shared/providers";
import type { CompareData, ModelRow } from "../../shared/types";
import { Card, DeltaChip, ModelLink, Section } from "../components/bits";
import { StepChart, type StepSeries } from "../components/StepChart";
import { StoryRow } from "../components/StoryRow";
import { openPalette } from "../lib/palette";
import { stepSeries } from "../lib/series";
import { assembleStories, keyIndex, nameIndex, storyHref } from "../lib/stories";
import { DAY, compareHref, isLoading, longDate, modelHref, pctChange, usePageTitle, useSearchParams } from "../lib/util";

type Spec = { label: string; value: (m: ModelRow) => number | null; show: (m: ModelRow) => string; lowerIsBetter: boolean };

const SPECS: Spec[] = [
  { label: "Input $/M", value: (m) => (m.promptPrice ? Number(m.promptPrice) * 1e6 : null), show: (m) => money(m.promptPrice), lowerIsBetter: true },
  { label: "Output $/M", value: (m) => (m.completionPrice ? Number(m.completionPrice) * 1e6 : null), show: (m) => money(m.completionPrice), lowerIsBetter: true },
  { label: "Cache read $/M", value: (m) => (m.cacheReadPrice ? Number(m.cacheReadPrice) * 1e6 : null), show: (m) => (m.cacheReadPrice ? money(m.cacheReadPrice) : "–"), lowerIsBetter: true },
  { label: "Context", value: (m) => Number(m.contextLength) || null, show: (m) => formatContext(m.contextLength), lowerIsBetter: false },
  { label: "Max output", value: (m) => Number(m.maxCompletion) || null, show: (m) => formatContext(m.maxCompletion), lowerIsBetter: false },
  { label: "Intelligence index", value: (m) => (m.aaIntelligence ? Number(m.aaIntelligence) : null), show: (m) => m.aaIntelligence || "–", lowerIsBetter: false },
  { label: "Listed", value: (m) => Date.parse(m.firstSeenAt) || null, show: (m) => longDate(m.firstSeenAt), lowerIsBetter: false },
  { label: "Changes recorded", value: (m) => Number(m.changeCount) || 0, show: (m) => m.changeCount || "0", lowerIsBetter: true },
];

export function ComparePage() {
  usePageTitle("Compare");
  const params = useSearchParams();
  const navigate = useNavigate();
  const ids = (params.get("m") ?? "").split(",").map((s) => decodeURIComponent(s.trim())).filter(Boolean).slice(0, 4);
  const data = useQuery<CompareData>("compareModels", ids);
  const loading = isLoading(data);
  const models = loading ? [] : ids.map((id) => data.models.find((m) => m.modelId === id)).filter((m): m is ModelRow => Boolean(m));
  const names = useMemo(() => nameIndex(models), [models]);
  const keys = useMemo(() => keyIndex(models), [models]);
  const stories = useMemo(() => (loading ? [] : assembleStories({ events: data.events, names })), [loading, data, names]);

  const pick = () => openPalette({ kind: "pick", title: "Add a model to compare", onPick: (id) => navigate(compareHref([...ids, id].slice(0, 4))) });
  const remove = (id: string) => navigate(compareHref(ids.filter((x) => x !== id)));

  const series: StepSeries[] = models.map((m) => ({
    key: m.modelId,
    label: `${modelName(m.modelId, m.name)} input $/M`,
    points: stepSeries((loading ? [] : data.events).filter((e) => e.modelId === m.modelId), "promptPrice", m.promptPrice, m.firstSeenAt),
  }));
  const earliest = Math.min(...series.flatMap((s) => s.points.map((p) => p.t)), Date.now() - DAY);

  return (
    <div class="flex flex-col gap-8">
      <Section title="Compare" hint="up to four models side by side">
        <div class="flex flex-wrap items-center gap-2">
          {models.map((m) => (
            <span key={m.modelId} class="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-3 text-sm">
              <ModelLink modelId={m.modelId} name={m.name} withProvider />
              <button type="button" class="rounded-full p-0.5 text-ink-muted hover:bg-ink/10 hover:text-ink" onClick={() => remove(m.modelId)} aria-label={`Remove ${m.name}`}><Icon name="x" size="sm" /></button>
            </span>
          ))}
          {ids.length < 4 ? <Button variant="outline" size="sm" icon="plus" onClick={pick}>Add a model</Button> : null}
        </div>
        {ids.length === 0 ? (
          <EmptyState title="Pick two or more models" description="Search for a model to start. The table marks the best value in each row." icon="search" action={<Button onClick={pick}>Choose a model</Button>} />
        ) : models.length === 0 && !loading ? (
          <EmptyState title="None of those ids are tracked" action={<Button onClick={pick}>Choose a model</Button>} />
        ) : (
          <Card padded={false}>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-line text-left text-xs text-ink-muted">
                    <th class="sticky left-0 bg-surface px-4 py-2 font-normal">spec</th>
                    {models.map((m) => (
                      <th key={m.modelId} class="px-3 py-2 font-normal">
                        <Link to={modelHref(m.modelId)} class="text-ink hover:text-accent">{modelName(m.modelId, m.name)}</Link>
                        <span class="block text-[11px] text-ink-muted">{providerName(m.provider)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SPECS.map((spec) => {
                    const values = models.map((m) => spec.value(m));
                    const known = values.filter((v): v is number => v !== null);
                    const best = known.length > 1 ? (spec.lowerIsBetter ? Math.min(...known) : Math.max(...known)) : null;
                    return (
                      <tr key={spec.label} class="border-b border-line last:border-0">
                        <td class="sticky left-0 bg-surface px-4 py-2 text-xs text-ink-muted">{spec.label}</td>
                        {models.map((m, i) => {
                          const v = values[i];
                          const isBest = best !== null && v === best;
                          const gap = best !== null && v !== null && !isBest && spec.label !== "Listed" ? pctChange(best, v) : null;
                          return (
                            <td key={m.modelId} class={`px-3 py-2 font-mono tabular-nums ${isBest ? "bg-success/10 text-success" : "text-ink"}`}>
                              {spec.show(m)}
                              {gap !== null && Math.abs(gap) >= 1 ? <span class="ml-2"><DeltaChip value={gap} good={spec.lowerIsBetter ? gap < 0 : gap > 0} size="sm" title="versus the best in this row" /></span> : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

      {models.length ? (
        <>
          <Section title="Input price history" hint="$ per million tokens">
            <Card><StepChart series={series} from={earliest} /></Card>
          </Section>
          <Section title="What changed" hint="all of them, newest first">
            <Card padded={false} class="px-4">
              {stories.length === 0 ? <EmptyState title="No changes recorded" /> : (
                <ul>{stories.filter((s) => s.kind !== "drift").slice(0, 60).map((s) => <StoryRow key={s.key} story={s} href={storyHref(s, keys)} compact />)}</ul>
              )}
            </Card>
          </Section>
          <p class="text-xs text-ink-muted">Share this comparison: <code class="font-mono">{`https://ai-observatory.view.fast${compareHref(ids)}`}</code></p>
        </>
      ) : null}
    </div>
  );
}
