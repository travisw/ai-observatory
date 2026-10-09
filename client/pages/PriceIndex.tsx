/**
 * The Token Price Index: what a million tokens costs, per day, for three baskets of models.
 */
import { useQuery } from "@spacefast/zero/client";
import { EmptyState, Skeleton } from "@spacefast/zero/kit";

import type { DailyRow, ModelRow } from "../../shared/types";
import { Card, DeltaChip, ModelLink, Section } from "../components/bits";
import { StepChart, StepTable, type StepSeries } from "../components/StepChart";
import { isLoading, pctChange, usePageTitle } from "../lib/util";
import { useState } from "preact/hooks";
import { Tabs, TabsList, TabsTrigger } from "@spacefast/zero/kit";

function series(rows: DailyRow[], key: keyof DailyRow, label: string): StepSeries {
  return {
    key: String(key),
    label,
    points: rows.map((d) => ({ t: Date.parse(`${d.date}T00:00:00Z`), value: Number(d[key]) })).filter((p) => Number.isFinite(p.value) && p.value > 0),
  };
}

function Tile(props: { label: string; now: string; then?: string; n?: string }) {
  const change = props.then ? pctChange(props.then, props.now) : null;
  return (
    <div class="flex flex-col gap-0.5 rounded-xl border border-line bg-surface px-4 py-3">
      <span class="text-xs text-ink-muted">{props.label}{props.n ? ` · ${props.n} models` : ""}</span>
      <span class="font-mono text-2xl font-semibold tabular-nums text-ink">${Number(props.now).toFixed(2)}</span>
      {change !== null && Math.abs(change) >= 0.5 ? <span class="self-start"><DeltaChip value={change} good={change < 0} size="sm" title="versus 30 days ago" /></span> : <span class="text-xs text-ink-muted">flat over 30 days</span>}
    </div>
  );
}

export function PriceIndexPage() {
  usePageTitle("Price index");
  const daily = useQuery<DailyRow[]>("dailyStats", 365);
  const models = useQuery<ModelRow[]>("activeModels");
  const [tab, setTab] = useState("chart");
  if (isLoading(daily) && isLoading(models)) return <div class="flex flex-col gap-3"><Skeleton class="h-10 w-1/3" /><Skeleton class="h-64 w-full" /></div>;
  const rows = (daily ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows[rows.length - 1];
  const monthAgo = rows.find((r) => Date.parse(r.date) >= Date.parse(latest?.date ?? "") - 30 * 86_400_000);
  const chart: StepSeries[] = [
    series(rows, "frontierIn", "frontier input $/M"),
    series(rows, "midIn", "mid-tier input $/M"),
    series(rows, "budgetIn", "budget input $/M"),
    series(rows, "medianIn", "all models, median input $/M"),
  ].filter((s) => s.points.length > 0);
  const cheapestFrontier = latest?.cheapestFrontierId ? (models ?? []).find((m) => m.modelId === latest.cheapestFrontierId) : undefined;

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Token price index</h1>
        <p class="max-w-2xl text-sm text-ink-muted">
          What a million input tokens costs, per day, for three baskets: the fifteen most capable models, the next thirty, and everything else with a published capability score. Each basket's number is its median price, so one outlier cannot move it.
        </p>
        <p class="text-xs text-ink-muted"><a href="/api/index.json" class="text-accent hover:underline">JSON, daily</a> · baskets are rebuilt every day from the Artificial Analysis intelligence index that OpenRouter publishes</p>
      </div>

      {!latest ? (
        <EmptyState title="No daily figures yet" description="The index is computed once a day; the first point lands after the next daily run." />
      ) : (
        <>
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Frontier" now={latest.frontierIn} then={monthAgo?.frontierIn} n={latest.frontierN} />
            <Tile label="Mid-tier" now={latest.midIn} then={monthAgo?.midIn} n={latest.midN} />
            <Tile label="Budget" now={latest.budgetIn} then={monthAgo?.budgetIn} n={latest.budgetN} />
            <Tile label="All models" now={latest.medianIn} then={monthAgo?.medianIn} n={latest.listed} />
          </div>
          {cheapestFrontier ? (
            <p class="text-sm text-ink-muted">
              Cheapest way into the frontier basket today: <ModelLink modelId={cheapestFrontier.modelId} name={cheapestFrontier.name} class="text-accent" /> at ${Number(latest.cheapestFrontierIn).toFixed(2)} per million input tokens.
            </p>
          ) : null}
          <Section
            title="Input price by basket"
            hint="$ per million tokens, daily"
            action={
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="chart" current={tab} onSelect={setTab}>Chart</TabsTrigger>
                  <TabsTrigger value="table" current={tab} onSelect={setTab}>Table</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            <Card>
              {rows.length < 2 ? (
                <p class="text-sm text-ink-muted">One day on record so far. The chart draws itself as days accumulate.</p>
              ) : tab === "chart" ? (
                <StepChart series={chart} from={Date.parse(`${rows[0].date}T00:00:00Z`)} height={300} />
              ) : (
                <StepTable series={chart} />
              )}
            </Card>
          </Section>
          <Section title="Catalogue size" hint="models listed per day">
            <Card>
              <StepChart series={[series(rows, "listed", "models listed"), series(rows, "free", "free models")]} from={Date.parse(`${rows[0].date}T00:00:00Z`)} height={180} formatValue={(v) => String(Math.round(v))} />
            </Card>
          </Section>
        </>
      )}
      <p class="text-xs text-ink-muted">Rolling aliases and free models are left out of the price baskets.</p>
    </div>
  );
}
