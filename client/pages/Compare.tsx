/**
 * Up to four models side by side: the spec board with the best cell lit green, overlaid price
 * history, and one merged timeline.
 */
import { useMemo } from "preact/hooks";
import { useNavigate, useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { modelName, providerName } from "../../shared/providers";
import type { CompareData, ModelRow } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, Sign, type FlapColumn } from "../components/Flap";
import { BoardEmpty, LogSection, Marquee, PageSkeleton, Plaque, StoryLine } from "../components/Log";
import { StepChart, type StepSeries } from "../components/StepChart";
import { boardDate, boardPct, shortName } from "../lib/board";
import { openPalette } from "../lib/palette";
import { stepSeries } from "../lib/series";
import { assembleStories, keyIndex, nameIndex, storyHref } from "../lib/stories";
import { DAY, compareHref, isLoading, longDate, modelHref, pctChange, usePageTitle, useSearchParams } from "../lib/util";

type Spec = { label: string; value: (m: ModelRow) => number | null; show: (m: ModelRow) => string; lowerIsBetter: boolean; gap: boolean };

const SPECS: Spec[] = [
  { label: "Input $/M", value: (m) => (m.promptPrice ? Number(m.promptPrice) * 1e6 : null), show: (m) => money(m.promptPrice), lowerIsBetter: true, gap: true },
  { label: "Output $/M", value: (m) => (m.completionPrice ? Number(m.completionPrice) * 1e6 : null), show: (m) => money(m.completionPrice), lowerIsBetter: true, gap: true },
  { label: "Cache $/M", value: (m) => (m.cacheReadPrice ? Number(m.cacheReadPrice) * 1e6 : null), show: (m) => (m.cacheReadPrice ? money(m.cacheReadPrice) : "-"), lowerIsBetter: true, gap: true },
  { label: "Context", value: (m) => Number(m.contextLength) || null, show: (m) => formatContext(m.contextLength), lowerIsBetter: false, gap: true },
  { label: "Max out", value: (m) => Number(m.maxCompletion) || null, show: (m) => formatContext(m.maxCompletion), lowerIsBetter: false, gap: true },
  { label: "Index", value: (m) => (m.aaIntelligence ? Number(m.aaIntelligence) : null), show: (m) => m.aaIntelligence || "-", lowerIsBetter: false, gap: true },
  { label: "Listed", value: (m) => Date.parse(m.firstSeenAt) || null, show: (m) => boardDate(m.firstSeenAt) + " " + m.firstSeenAt.slice(0, 4), lowerIsBetter: false, gap: false },
  { label: "Changes", value: (m) => Number(m.changeCount) || 0, show: (m) => m.changeCount || "0", lowerIsBetter: true, gap: false },
];

const COL = 14;

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
      <Marquee title="Compare" action={ids.length < 4 ? <Sign onClick={pick}>+ Add a model</Sign> : undefined}>
        Up to four models side by side. The best value in each row is lit green; the others say how far behind they are.
      </Marquee>

      <div class="flex flex-wrap items-center gap-1.5">
        {models.map((m) => (
          <span key={m.modelId} class="inline-flex items-center gap-1">
            <Sign to={modelHref(m.modelId)}>{providerName(m.provider)} {shortName(m.modelId, m.name)}</Sign>
            <Sign onClick={() => remove(m.modelId)} ariaLabel={`Remove ${m.name}`}>×</Sign>
          </span>
        ))}
        {ids.length === 0 ? <Sign onClick={pick} active>Choose a model</Sign> : null}
      </div>

      {ids.length > 0 && loading ? <PageSkeleton /> : null}
      {ids.length === 0 ? (
        <BoardEmpty>Pick two or more models to start</BoardEmpty>
      ) : models.length === 0 && !loading ? (
        <BoardEmpty>None of those ids are tracked</BoardEmpty>
      ) : models.length ? (
        <>
          <Board label="Side by side" hint="best in each row lit green">
            <ColumnHeads columns={[{ label: "Spec", width: 10, sticky: true }, ...models.map((m) => ({ label: shortName(m.modelId, m.name), width: COL }))]} />
            {SPECS.map((spec, i) => {
              const values = models.map((m) => spec.value(m));
              const known = values.filter((v): v is number => v !== null);
              const best = known.length > 1 ? (spec.lowerIsBetter ? Math.min(...known) : Math.max(...known)) : null;
              const columns: FlapColumn[] = [{ text: spec.label, width: 10, sticky: true, tone: "muted" }];
              const words: string[] = [];
              models.forEach((m, j) => {
                const v = values[j];
                const isBest = best !== null && v === best;
                const gap = best !== null && v !== null && !isBest && spec.gap ? pctChange(best, v) : null;
                const gapText = gap !== null && Math.abs(gap) >= 1 ? (Math.abs(gap) > 300 ? ` ${Math.round(Math.abs(gap) / 100 + 1)}X` : ` ${boardPct(gap).replace(/[▲▼] /, "")}`) : "";
                columns.push({ text: `${spec.show(m)}${gapText}`, width: COL, tone: isBest ? "success" : gap !== null && Math.abs(gap) >= 1 ? "warning" : "ink" });
                words.push(`${shortName(m.modelId, m.name)} ${spec.show(m)}${isBest ? " (best)" : gapText ? ` (${gapText.trim()} ${spec.lowerIsBetter ? "more" : "less"})` : ""}`);
              });
              return <FlapRow key={spec.label} label={`${spec.label}: ${words.join("; ")}`} delay={i * 40} columns={columns} />;
            })}
          </Board>

          <LogSection title="Input price history" hint="$ per million tokens">
            <StepChart series={series} from={earliest} />
          </LogSection>
          <LogSection title="What changed" hint="all of them, newest first">
            {stories.length === 0 ? <BoardEmpty>No changes recorded</BoardEmpty> : (
              <ul>{stories.filter((s) => s.kind !== "drift").slice(0, 60).map((s) => <StoryLine key={s.key} story={s} href={storyHref(s, keys)} date />)}</ul>
            )}
          </LogSection>
          <Plaque>
            <span class="text-[11px] font-bold uppercase tracking-[0.3em] text-accent">Share this comparison</span>
            <span class="ml-3 font-mono text-xs text-ink">{`https://ai-observatory.view.fast${compareHref(ids)}`}</span>
            <span class="ml-3 text-xs text-ink-muted">Listed {models.map((m) => `${shortName(m.modelId, m.name)} ${longDate(m.firstSeenAt)}`).join(" · ")}</span>
          </Plaque>
        </>
      ) : null}
    </div>
  );
}
