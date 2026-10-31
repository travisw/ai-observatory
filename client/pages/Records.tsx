/**
 * The records: each extreme of the archive, linking to the model that set it.
 */
import { useMemo } from "preact/hooks";
import { useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { providerName } from "../../shared/providers";
import type { ModelRow, RecordRow } from "../../shared/types";
import { Chip, Empty, PageHead, Rec, Skeleton } from "../components/Wire";
import { nameIndex } from "../lib/stories";
import { dayYear, shortName } from "../lib/text";
import { isLoading, modelHref, plural, usePageTitle } from "../lib/util";

type Shape = { title: string | ((r: RecordRow) => string); value: (r: RecordRow) => string };

const SHAPES: Record<string, Shape> = {
  "biggest-cut-input": { title: "largest input price cut", value: (r) => `−${Math.abs(Number(r.value)).toFixed(0)}%` },
  "biggest-raise-input": { title: "largest input price rise", value: (r) => `+${Math.abs(Number(r.value)).toFixed(0)}%` },
  "biggest-cut-output": { title: "largest output price cut", value: (r) => `−${Math.abs(Number(r.value)).toFixed(0)}%` },
  "biggest-raise-output": { title: "largest output price rise", value: (r) => `+${Math.abs(Number(r.value)).toFixed(0)}%` },
  "most-repriced": { title: "most price changes", value: (r) => Number(r.value).toLocaleString() },
  "shortest-lived": { title: (r) => `${Number(r.value) === 1 ? "day" : "days"} listed, the shortest ever`, value: (r) => Number(r.value).toLocaleString() },
  "largest-context-jump": { title: "largest context increase, tokens", value: (r) => `+${formatContext(r.value)}` },
  "cheapest-listed-ever": { title: "cheapest paid model ever, per million input", value: (r) => money(r.value) },
  "longest-unchanged": { title: "days without a price change", value: (r) => Number(r.value).toLocaleString() },
};

const ORDER = ["biggest-cut-input", "biggest-raise-input", "biggest-cut-output", "biggest-raise-output", "cheapest-listed-ever", "largest-context-jump", "longest-unchanged", "most-repriced", "shortest-lived"];

export function RecordsPage() {
  usePageTitle("Records");
  const records = useQuery<RecordRow[]>("records");
  const models = useQuery<ModelRow[]>("activeModels");
  const names = useMemo(() => nameIndex(models ?? []), [models]);
  // The records decide what shows; the model names only improve labels, and the palette may already hold them.
  if (records === undefined || records === null) return <Skeleton />;
  const byKey = new Map((records ?? []).map((r) => [r.key, r]));
  const rows = ORDER.map((k) => byKey.get(k)).filter((r): r is RecordRow => Boolean(r));

  return (
    <div class="stack">
      <PageHead title="Records" action={<Chip href="/api/records.json">JSON</Chip>}>
        The extremes of the archive, updated the moment a new change beats one. Moves of 3% or more; rolling aliases do not count, since they only echo the model they point at.
      </PageHead>
      {rows.length === 0 ? (
        <Empty>No records yet. Records are set as changes are recorded.</Empty>
      ) : (
        <div class="records" style={{ borderTop: 0, paddingTop: 0 }}>
          {rows.map((r) => {
            const shape = SHAPES[r.key];
            return (
              <div key={r.id}>
                <Rec value={shape.value(r)} label={typeof shape.title === "function" ? shape.title(r) : shape.title} holder={shortName(r.modelId, names.get(r.modelId))} href={modelHref(r.modelId)} />
                <div class="soft small" style={{ marginTop: 4 }}>
                  {providerName(r.provider)} · {r.detail}{r.at && r.key !== "longest-unchanged" ? ` · ${dayYear(r.at)}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p class="note">{plural(rows.length, "record")}.</p>
    </div>
  );
}
