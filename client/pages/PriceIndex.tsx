/**
 * The Token Price Index: what a million tokens costs, per day, for three baskets of models.
 */
import { useState } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import type { DailyRow, ModelRow } from "../../shared/types";
import { Sign } from "../components/Flap";
import { BoardEmpty, LogSection, Marquee, PageSkeleton, Readout, Stencil } from "../components/Log";
import { StepChart, StepTable, type StepSeries } from "../components/StepChart";
import { boardPct, shortName } from "../lib/board";
import { isLoading, modelHref, pctChange, usePageTitle } from "../lib/util";

function series(rows: DailyRow[], key: keyof DailyRow, label: string): StepSeries {
  return {
    key: String(key),
    label,
    points: rows.map((d) => ({ t: Date.parse(`${d.date}T00:00:00Z`), value: Number(d[key]) })).filter((p) => Number.isFinite(p.value) && p.value > 0),
  };
}

export function PriceIndexPage() {
  usePageTitle("Price index");
  const daily = useQuery<DailyRow[]>("dailyStats", 365);
  const models = useQuery<ModelRow[]>("activeModels");
  const [tab, setTab] = useState("chart");
  if (isLoading(daily) && isLoading(models)) return <PageSkeleton />;
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
  const change = (now: string, then?: string) => {
    const pct = then ? pctChange(then, now) : null;
    return pct !== null && Math.abs(pct) >= 0.5 ? `${boardPct(pct)} over 30 days` : "flat over 30 days";
  };
  const dollars = (v: string) => `$${Number(v).toFixed(2)}`;

  return (
    <div class="flex flex-col gap-8">
      <Marquee title="Token price index" action={<Sign href="/api/index.json">JSON, daily</Sign>}>
        What a million input tokens costs, per day, for three baskets: the fifteen most capable models, the next thirty, and everything else with a published capability score. Each basket's number is its median price, so one outlier cannot move it. Baskets are rebuilt every day from the Artificial Analysis intelligence index that OpenRouter publishes; rolling aliases and free models are left out.
      </Marquee>

      {!latest ? (
        <BoardEmpty>No daily figures yet. The first point lands after the next daily run.</BoardEmpty>
      ) : (
        <>
          <div class="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
            <Readout label={`Frontier · ${latest.frontierN} models`} value={dollars(latest.frontierIn)} width={6} sub={change(latest.frontierIn, monthAgo?.frontierIn)} delay={0} />
            <Readout label={`Mid-tier · ${latest.midN} models`} value={dollars(latest.midIn)} width={6} sub={change(latest.midIn, monthAgo?.midIn)} delay={40} />
            <Readout label={`Budget · ${latest.budgetN} models`} value={dollars(latest.budgetIn)} width={6} sub={change(latest.budgetIn, monthAgo?.budgetIn)} delay={80} />
            <Readout label={`All models · ${latest.listed} listed`} value={dollars(latest.medianIn)} width={6} sub={change(latest.medianIn, monthAgo?.medianIn)} delay={120} />
          </div>
          {cheapestFrontier ? (
            <p class="text-sm text-ink-muted">
              Cheapest way into the frontier basket today: <Link to={modelHref(cheapestFrontier.modelId)} class="text-accent hover:underline">{shortName(cheapestFrontier.modelId, cheapestFrontier.name)}</Link> at ${Number(latest.cheapestFrontierIn).toFixed(2)} per million input tokens.
            </p>
          ) : null}
          <LogSection
            title="Input price by basket"
            hint="$ per million tokens, daily"
            action={<><Stencil active={tab === "chart"} onClick={() => setTab("chart")}>Chart</Stencil><Stencil active={tab === "table"} onClick={() => setTab("table")}>Table</Stencil></>}
          >
            {rows.length < 2 ? (
              <BoardEmpty>One day on record so far. The chart draws itself as days accumulate.</BoardEmpty>
            ) : tab === "chart" ? (
              <StepChart series={chart} from={Date.parse(`${rows[0].date}T00:00:00Z`)} height={300} />
            ) : (
              <StepTable series={chart} />
            )}
          </LogSection>
          <LogSection title="Catalogue size" hint="models listed per day">
            {rows.length < 2 ? (
              <BoardEmpty>One day on record so far</BoardEmpty>
            ) : (
              <StepChart series={[series(rows, "listed", "models listed"), series(rows, "free", "free models")]} from={Date.parse(`${rows[0].date}T00:00:00Z`)} height={180} formatValue={(v) => String(Math.round(v))} />
            )}
          </LogSection>
        </>
      )}
    </div>
  );
}
