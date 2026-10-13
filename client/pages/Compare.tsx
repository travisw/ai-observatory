/**
 * Up to four models side by side: the spec table with the best cell in green, overlaid price
 * history, and one merged timeline.
 */
import { useMemo } from "preact/hooks";
import { useNavigate, useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { modelName, providerName } from "../../shared/providers";
import type { CompareData, ModelRow } from "../../shared/types";
import { StepChart, type StepSeries } from "../components/StepChart";
import { Chip, Empty, PageHead, Section, Skeleton, StoryRow, StoryTable } from "../components/Wire";
import { openPalette } from "../lib/palette";
import { stepSeries } from "../lib/series";
import { assembleStories, keyIndex, nameIndex, storyHref } from "../lib/stories";
import { dayYear, pct, shortName } from "../lib/text";
import { DAY, compareHref, isLoading, modelHref, pctChange, usePageTitle, useSearchParams } from "../lib/util";

type Spec = { label: string; value: (m: ModelRow) => number | null; show: (m: ModelRow) => string; lowerIsBetter: boolean; gap: boolean };

const SPECS: Spec[] = [
  { label: "Input $/M", value: (m) => (m.promptPrice ? Number(m.promptPrice) * 1e6 : null), show: (m) => money(m.promptPrice), lowerIsBetter: true, gap: true },
  { label: "Output $/M", value: (m) => (m.completionPrice ? Number(m.completionPrice) * 1e6 : null), show: (m) => money(m.completionPrice), lowerIsBetter: true, gap: true },
  { label: "Cache $/M", value: (m) => (m.cacheReadPrice ? Number(m.cacheReadPrice) * 1e6 : null), show: (m) => (m.cacheReadPrice ? money(m.cacheReadPrice) : "—"), lowerIsBetter: true, gap: true },
  { label: "Context", value: (m) => Number(m.contextLength) || null, show: (m) => formatContext(m.contextLength), lowerIsBetter: false, gap: true },
  { label: "Max output", value: (m) => Number(m.maxCompletion) || null, show: (m) => formatContext(m.maxCompletion), lowerIsBetter: false, gap: true },
  { label: "Capability index", value: (m) => (m.aaIntelligence ? Number(m.aaIntelligence) : null), show: (m) => m.aaIntelligence || "—", lowerIsBetter: false, gap: true },
  { label: "Listed", value: (m) => Date.parse(m.firstSeenAt) || null, show: (m) => dayYear(m.firstSeenAt), lowerIsBetter: false, gap: false },
  { label: "Changes", value: (m) => Number(m.changeCount) || 0, show: (m) => m.changeCount || "0", lowerIsBetter: true, gap: false },
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
    <div class="stack">
      <PageHead title="Compare" action={ids.length < 4 ? <Chip onClick={pick}>+ Add a model</Chip> : undefined}>
        Up to four models side by side. The best value in each row is green; the others say how far behind they are.
      </PageHead>

      <div class="chips">
        {models.map((m) => (
          <span key={m.modelId} style={{ display: "inline-flex", gap: 4 }}>
            <Chip to={modelHref(m.modelId)}>{providerName(m.provider)} {shortName(m.modelId, m.name)}</Chip>
            <Chip onClick={() => remove(m.modelId)} ariaLabel={`Remove ${m.name}`}>×</Chip>
          </span>
        ))}
        {ids.length === 0 ? <Chip onClick={pick} active>Choose a model</Chip> : null}
      </div>

      {ids.length > 0 && loading ? <Skeleton /> : null}
      {ids.length === 0 ? (
        <Empty>Pick two or more models to start.</Empty>
      ) : models.length === 0 && !loading ? (
        <Empty>None of those ids are tracked.</Empty>
      ) : models.length ? (
        <>
          <Section title="Side by side" hint="best in each row in green">
            <div class="tw">
              <table>
                <thead>
                  <tr>
                    <th>Spec</th>
                    {models.map((m) => <th key={m.modelId} class="n">{shortName(m.modelId, m.name)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {SPECS.map((spec) => {
                    const values = models.map((m) => spec.value(m));
                    const known = values.filter((v): v is number => v !== null);
                    const best = known.length > 1 ? (spec.lowerIsBetter ? Math.min(...known) : Math.max(...known)) : null;
                    return (
                      <tr key={spec.label}>
                        <td class="soft">{spec.label}</td>
                        {models.map((m, j) => {
                          const v = values[j];
                          const isBest = best !== null && v === best;
                          const gap = best !== null && v !== null && !isBest && spec.gap ? pctChange(best, v) : null;
                          const behind = gap !== null && Math.abs(gap) >= 1;
                          return (
                            <td key={m.modelId} class={`n ${isBest ? "cut" : behind ? "rise" : ""}`}>
                              {spec.show(m)}
                              {behind ? <span class="soft small" title={`${pct(gap).replace(/^[+−]/, "")} ${spec.lowerIsBetter ? "more" : "less"} than the best`}> {pct(gap).replace(/^[+−]/, "")}</span> : null}
                              {isBest ? <span class="soft small"> best</span> : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Input price history" hint="$ per million tokens">
            <div class="box"><StepChart series={series} from={earliest} /></div>
          </Section>
          <Section title="What changed" hint="all of them, newest first">
            {stories.length === 0 ? <Empty>No changes recorded.</Empty> : (
              <StoryTable label="Changes to the compared models">
                {stories.filter((s) => s.kind !== "drift").slice(0, 60).map((s) => <StoryRow key={s.key} story={s} href={storyHref(s, keys)} date />)}
              </StoryTable>
            )}
          </Section>
          <p class="note">
            Share this comparison: <code class="mono" style={{ wordBreak: "break-all" }}>{`https://ai-observatory.view.fast${compareHref(ids)}`}</code>
            <br />Listed {models.map((m) => `${shortName(m.modelId, m.name)} ${dayYear(m.firstSeenAt)}`).join(" · ")}
          </p>
        </>
      ) : null}
    </div>
  );
}
