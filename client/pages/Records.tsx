/**
 * The records board: the biggest cut, the biggest hike, the longest-unchanged price, each
 * linking to the model that set it.
 */
import { useMemo } from "preact/hooks";
import { useQuery } from "@spacefast/zero/client";
import { EmptyState, Skeleton } from "@spacefast/zero/kit";

import { formatContext, money } from "../../shared/model";
import { modelName, providerName } from "../../shared/providers";
import type { ModelRow, RecordRow } from "../../shared/types";
import { Card, Section } from "../components/bits";
import { nameIndex } from "../lib/stories";
import { isLoading, longDate, modelHref, plural, usePageTitle } from "../lib/util";
import { Link } from "@spacefast/zero/client";

type Shape = { title: string; blurb: string; value: (r: RecordRow) => string };

const SHAPES: Record<string, Shape> = {
  "biggest-cut-input": { title: "Biggest input price cut", blurb: "one move, one model", value: (r) => `−${Math.abs(Number(r.value)).toFixed(0)}%` },
  "biggest-raise-input": { title: "Biggest input price hike", blurb: "one move, one model", value: (r) => `+${Math.abs(Number(r.value)).toFixed(0)}%` },
  "biggest-cut-output": { title: "Biggest output price cut", blurb: "one move, one model", value: (r) => `−${Math.abs(Number(r.value)).toFixed(0)}%` },
  "biggest-raise-output": { title: "Biggest output price hike", blurb: "one move, one model", value: (r) => `+${Math.abs(Number(r.value)).toFixed(0)}%` },
  "most-repriced": { title: "Most repriced", blurb: "changes recorded", value: (r) => plural(Number(r.value), "change") },
  "shortest-lived": { title: "Shortest-lived listing", blurb: "listed, then gone", value: (r) => plural(Number(r.value), "day") },
  "largest-context-jump": { title: "Largest context jump", blurb: "new window after one change", value: (r) => `${formatContext(r.value)} tokens` },
  "cheapest-listed-ever": { title: "Cheapest paid model ever", blurb: "input price, excluding free", value: (r) => `${money(r.value)} /M` },
  "longest-unchanged": { title: "Longest unchanged price", blurb: "same price, no movement", value: (r) => plural(Number(r.value), "day") },
};

const ORDER = ["biggest-cut-input", "biggest-raise-input", "biggest-cut-output", "biggest-raise-output", "cheapest-listed-ever", "largest-context-jump", "longest-unchanged", "most-repriced", "shortest-lived"];

export function RecordsPage() {
  usePageTitle("Records");
  const records = useQuery<RecordRow[]>("records");
  const models = useQuery<ModelRow[]>("activeModels");
  const retired = useQuery<ModelRow[]>("retiredModels");
  const names = useMemo(() => nameIndex([...(models ?? []), ...(retired ?? [])]), [models, retired]);
  if (isLoading(records) && isLoading(models)) return <div class="flex flex-col gap-3"><Skeleton class="h-10 w-1/3" /><Skeleton class="h-40 w-full" /></div>;
  const byKey = new Map((records ?? []).map((r) => [r.key, r]));
  const rows = ORDER.map((k) => byKey.get(k)).filter((r): r is RecordRow => Boolean(r));

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Records</h1>
        <p class="max-w-2xl text-sm text-ink-muted">The extremes of the archive, updated the moment a new change beats one. Click a record to see the story that set it.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No records yet" description="Records are set as changes are recorded." />
      ) : (
        <Section title="The board" hint={`${rows.length} records`}>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const shape = SHAPES[r.key];
              return (
                <li key={r.id}>
                  <Link to={modelHref(r.modelId)} class="block h-full rounded-xl hover:ring-2 hover:ring-accent/40">
                    <Card class="flex h-full flex-col gap-1">
                      <span class="text-xs text-ink-muted">{shape.title}</span>
                      <span class="font-mono text-3xl font-semibold tabular-nums text-ink">{shape.value(r)}</span>
                      <span class="text-sm text-ink">{modelName(r.modelId, names.get(r.modelId))} <span class="text-ink-muted">· {providerName(r.provider)}</span></span>
                      <span class="text-xs text-ink-muted">{r.detail}{r.at ? ` · ${longDate(r.at)}` : ""}</span>
                      <span class="sr-only">{shape.blurb}</span>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <p class="text-xs text-ink-muted">Records count moves of 3% or more and ignore rolling aliases, which only echo the model they point at. <a href="/api/records.json" class="text-accent hover:underline">JSON</a></p>
    </div>
  );
}
