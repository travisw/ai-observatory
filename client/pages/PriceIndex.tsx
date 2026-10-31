/**
 * The Token Price Index: what a million tokens costs, per day, for three baskets of models.
 */
import { useState } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import type { DailyRow, ModelRow } from "../../shared/types";
import { StepChart, StepTable, type StepSeries } from "../components/StepChart";
import { Chip, Empty, PageHead, Section, Skeleton, Stat } from "../components/Wire";
import { pct, shortName } from "../lib/text";
import { isLoading, modelHref, pctChange, plural, usePageTitle } from "../lib/util";

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
  // The daily figures decide what shows; the model list only names the cheapest frontier model.
  if (daily === undefined || daily === null) return <Skeleton />;
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
  // While the archive is younger than 30 days, the comparison runs from its first day; say how long it really spans.
  const span = monthAgo && latest ? Math.round((Date.parse(latest.date) - Date.parse(monthAgo.date)) / 86_400_000) : 0;
  const change = (now: string, then?: string) => {
    const delta = then ? pctChange(then, now) : null;
    if (delta === null || span < 1) return "no earlier figure";
    return Math.abs(delta) >= 0.5 ? `${pct(delta)} over ${plural(span, "day")}` : `flat over ${plural(span, "day")}`;
  };
  const dollars = (v: string) => (v === "" ? "–" : `$${Number(v).toFixed(2)}`);
  // An empty basket is written as "" by the rollup; it has no price, not a price of $0.
  const basket = (name: string, value: string, n: string, then?: string) => (
    <Stat value={dollars(value)} label={value === "" ? `${name} · no scored models today` : `${name} · ${n} models · ${change(value, then)}`} />
  );

  return (
    <div class="stack">
      <PageHead title="Token price index" action={<Chip href="/api/index.json">JSON, daily</Chip>}>
        What a million input tokens costs, per day, for three baskets: the fifteen most capable models, the next thirty, and everything else with a published capability score. Each basket's number is its median price, so one outlier cannot move it. Baskets are rebuilt every day from the Artificial Analysis intelligence index that OpenRouter publishes; rolling aliases and free models are left out.
      </PageHead>

      {!latest ? (
        <Empty>No daily figures yet. The first point lands after the next daily run.</Empty>
      ) : (
        <>
          <div class="stats">
            {basket("Frontier", latest.frontierIn, latest.frontierN, monthAgo?.frontierIn)}
            {basket("Mid-tier", latest.midIn, latest.midN, monthAgo?.midIn)}
            {basket("Budget", latest.budgetIn, latest.budgetN, monthAgo?.budgetIn)}
            <Stat value={dollars(latest.medianIn)} label={`All models · ${latest.listed} listed · ${change(latest.medianIn, monthAgo?.medianIn)}`} />
          </div>
          {cheapestFrontier ? (
            <p class="note">
              Cheapest way into the frontier basket today: <Link to={modelHref(cheapestFrontier.modelId)} class="acc hl">{shortName(cheapestFrontier.modelId, cheapestFrontier.name)}</Link> at ${Number(latest.cheapestFrontierIn).toFixed(2)} per million input tokens.
            </p>
          ) : null}
          <Section
            title="Input price by basket"
            hint="$ per million tokens, daily"
            action={<><Chip active={tab === "chart"} onClick={() => setTab("chart")}>Chart</Chip><Chip active={tab === "table"} onClick={() => setTab("table")}>Table</Chip></>}
          >
            {rows.length < 2 ? (
              <Empty>One day on record so far. The chart draws itself as days accumulate.</Empty>
            ) : tab === "chart" ? (
              <div class="box"><StepChart series={chart} from={Date.parse(`${rows[0].date}T00:00:00Z`)} height={300} /></div>
            ) : (
              <StepTable series={chart} />
            )}
          </Section>
          <Section title="Catalogue size" hint="models listed per day">
            {rows.length < 2 ? (
              <Empty>One day on record so far.</Empty>
            ) : (
              <div class="box"><StepChart series={[series(rows, "listed", "models listed"), series(rows, "free", "free models")]} from={Date.parse(`${rows[0].date}T00:00:00Z`)} height={180} formatValue={(v) => String(Math.round(v))} /></div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
