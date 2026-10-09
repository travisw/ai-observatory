/**
 * The records board: each extreme of the archive as a trophy tile, linking to the model that set it.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { providerName } from "../../shared/providers";
import type { ModelRow, RecordRow } from "../../shared/types";
import { FlapText, Sign, type FlapTone } from "../components/Flap";
import { BoardEmpty, Marquee, PageSkeleton } from "../components/Log";
import { boardDate, shortName } from "../lib/board";
import { nameIndex } from "../lib/stories";
import { isLoading, modelHref, plural, usePageTitle } from "../lib/util";

type Shape = { title: string; value: (r: RecordRow) => string; width: number; tone: FlapTone };

const SHAPES: Record<string, Shape> = {
  "biggest-cut-input": { title: "Biggest input price cut", value: (r) => `-${Math.abs(Number(r.value)).toFixed(0)}%`, width: 5, tone: "success" },
  "biggest-raise-input": { title: "Biggest input price hike", value: (r) => `+${Math.abs(Number(r.value)).toFixed(0)}%`, width: 6, tone: "warning" },
  "biggest-cut-output": { title: "Biggest output price cut", value: (r) => `-${Math.abs(Number(r.value)).toFixed(0)}%`, width: 5, tone: "success" },
  "biggest-raise-output": { title: "Biggest output price hike", value: (r) => `+${Math.abs(Number(r.value)).toFixed(0)}%`, width: 6, tone: "warning" },
  "most-repriced": { title: "Most repriced", value: (r) => `${Number(r.value)} CHANGES`, width: 11, tone: "accent" },
  "shortest-lived": { title: "Shortest-lived listing", value: (r) => `${Number(r.value)} ${Number(r.value) === 1 ? "DAY" : "DAYS"}`, width: 7, tone: "danger" },
  "largest-context-jump": { title: "Largest context jump", value: (r) => `${formatContext(r.value)} TOKENS`, width: 11, tone: "ink" },
  "cheapest-listed-ever": { title: "Cheapest paid model ever", value: (r) => `${money(r.value)}/M`, width: 8, tone: "success" },
  "longest-unchanged": { title: "Longest unchanged price", value: (r) => `${Number(r.value)} DAYS`, width: 9, tone: "ink" },
};

const ORDER = ["biggest-cut-input", "biggest-raise-input", "biggest-cut-output", "biggest-raise-output", "cheapest-listed-ever", "largest-context-jump", "longest-unchanged", "most-repriced", "shortest-lived"];

export function RecordsPage() {
  usePageTitle("Records");
  const records = useQuery<RecordRow[]>("records");
  const models = useQuery<ModelRow[]>("activeModels");
  const names = useMemo(() => nameIndex(models ?? []), [models]);
  if (isLoading(records) && isLoading(models)) return <PageSkeleton />;
  const byKey = new Map((records ?? []).map((r) => [r.key, r]));
  const rows = ORDER.map((k) => byKey.get(k)).filter((r): r is RecordRow => Boolean(r));

  return (
    <div class="flex flex-col gap-8">
      <Marquee title="Records" action={<Sign href="/api/records.json">JSON</Sign>}>
        The extremes of the archive, updated the moment a new change beats one. Moves of 3% or more; rolling aliases do not count, since they only echo the model they point at.
      </Marquee>
      {rows.length === 0 ? (
        <BoardEmpty>No records yet. Records are set as changes are recorded.</BoardEmpty>
      ) : (
        <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r, i) => {
            const shape = SHAPES[r.key];
            const holder = shortName(r.modelId, names.get(r.modelId));
            return (
              <li key={r.id}>
                <Link to={modelHref(r.modelId)} class="flex h-full flex-col gap-3 rounded-md border border-line bg-surface p-4 shadow-[0_12px_40px_rgba(0,0,0,0.5)] hover:border-accent/60" aria-label={`${shape.title}: ${shape.value(r)}, ${holder} by ${providerName(r.provider)}. ${r.detail}`}>
                  <span class="text-[11px] font-bold uppercase tracking-[0.35em] text-accent [text-shadow:0_0_14px_rgba(255,176,0,0.45)]">{shape.title}</span>
                  <FlapText text={shape.value(r)} width={shape.width} size="lg" tone={shape.tone} delay={i * 60} />
                  <FlapText text={holder} width={Math.min(22, Math.max(8, holder.length))} size="sm" delay={i * 60 + 120} />
                  <span class="text-xs text-ink-muted">{providerName(r.provider)} · {r.detail}{r.at && r.key !== "longest-unchanged" ? ` · ${boardDate(r.at)} ${r.at.slice(0, 4)}` : ""}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p class="text-xs text-ink-muted">{plural(rows.length, "record")} on the board.</p>
    </div>
  );
}
