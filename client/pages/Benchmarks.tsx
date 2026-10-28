/**
 * Benchmarks: published results from two leaderboards, one benchmark at a time, with the
 * price tracked here beside each score. Nothing is run here.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import { BENCHMARKS, BENCHMARK_SOURCE, benchmarkSpec, looseKey, looseSlug, scoreText } from "../../shared/benchmarks";
import { money } from "../../shared/model";
import { providerName } from "../../shared/providers";
import type { BenchmarkPageData, BenchmarkRow, ModelRow } from "../../shared/types";
import { Chip, Empty, PageHead, Section, Skeleton } from "../components/Wire";
import { dayYear, shortName } from "../lib/text";
import { ago, isLoading, modelHref, plural, usePageTitle, useSearchParams } from "../lib/util";

/** One line of the table: a model's best result, its other settings, and the catalogue row if there is one. */
type Line = { key: string; best: BenchmarkRow; others: BenchmarkRow[]; model: ModelRow | null };

/** The catalogue by loose key. The plain listing wins over its `:batch` and `:free` variants, and a listed model over a removed one. */
function catalogueIndex(models: ModelRow[]): { byKey: Map<string, ModelRow>; bySlug: Map<string, ModelRow[]> } {
  const byKey = new Map<string, ModelRow>();
  const bySlug = new Map<string, ModelRow[]>();
  const better = (a: ModelRow, b: ModelRow) => (a.active !== b.active ? a.active : a.modelId.includes(":") !== b.modelId.includes(":") ? !a.modelId.includes(":") : a.modelId.length < b.modelId.length);
  for (const m of models) {
    const key = looseKey(m.provider, m.modelId);
    const prior = byKey.get(key);
    if (!prior || better(m, prior)) byKey.set(key, m);
  }
  for (const m of byKey.values()) {
    const slug = looseSlug(m.modelId);
    const list = bySlug.get(slug);
    if (list) list.push(m);
    else bySlug.set(slug, [m]);
  }
  return { byKey, bySlug };
}

/** Groups a benchmark's rows by model, best score first. A row with no organisation matches a slug the catalogue holds once. */
export function groupResults(rows: BenchmarkRow[], models: ModelRow[]): Line[] {
  const { byKey, bySlug } = catalogueIndex(models);
  const groups = new Map<string, BenchmarkRow[]>();
  for (const row of rows) {
    let key = row.key;
    if (key.startsWith("?/")) {
      const candidates = bySlug.get(key.slice(2)) ?? [];
      if (candidates.length === 1) key = looseKey(candidates[0].provider, candidates[0].modelId);
    }
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const lines: Line[] = [];
  for (const [key, list] of groups) {
    const sorted = list.slice().sort((a, b) => Number(b.score) - Number(a.score));
    lines.push({ key, best: sorted[0], others: sorted.slice(1), model: byKey.get(key) ?? null });
  }
  return lines.sort((a, b) => Number(b.best.score) - Number(a.best.score));
}

/** How full the bar is: percentages against 100, ratings against the spread on the page. */
function fill(value: number, unit: string, min: number, max: number): number {
  if (unit === "pct") return Math.max(0, Math.min(100, value));
  if (max <= min) return 100;
  return Math.max(4, ((value - min) / (max - min)) * 100);
}

export function BenchmarksPage() {
  usePageTitle("Benchmarks");
  const params = useSearchParams();
  const slug = params.get("b") ?? BENCHMARKS[0].slug;
  const trackedOnly = params.get("tracked") === "1";
  const spec = benchmarkSpec(slug);
  const data = useQuery<BenchmarkPageData>("benchmarkPage", slug);
  const active = useQuery<ModelRow[]>("activeModels");
  const retired = useQuery<ModelRow[]>("retiredModels");
  const freshness = useQuery<Record<string, string>>("freshness");

  const models = useMemo(() => [...(active ?? []), ...(retired ?? [])], [active, retired]);
  const lines = useMemo(() => (isLoading(data) ? [] : groupResults(data.rows, models)), [data, models]);
  const href = (b: string, tracked: boolean) => `/benchmarks?b=${b}${tracked ? "&tracked=1" : ""}`;

  if (!spec) {
    return (
      <div class="stack">
        <h1>Unknown benchmark</h1>
        <p class="deck">No leaderboard called {slug} is read here. <Link to="/benchmarks" class="acc">See the ones that are</Link>.</p>
      </div>
    );
  }
  if (data === undefined || isLoading(active)) return <Skeleton rows={12} />;

  const shown = trackedOnly ? lines.filter((l) => l.model) : lines;
  const values = shown.map((l) => Number(l.best.score)).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const latest = shown.reduce((d, l) => (l.best.date > d ? l.best.date : d), "");
  const source = BENCHMARK_SOURCE[spec.source];
  const read = freshness && !Array.isArray(freshness) ? freshness[spec.source] : undefined;
  const tracked = lines.filter((l) => l.model).length;

  return (
    <div class="stack">
      <PageHead title="Benchmarks" action={<><Chip href={`/api/benchmarks.json?benchmark=${slug}`}>JSON</Chip></>}>
        Published results, copied once a day from Epoch AI and LMArena, with the price tracked here beside each score. Nothing is run here; every number links to where it came from.
      </PageHead>

      <div class="chips" role="navigation" aria-label="Benchmarks">
        {BENCHMARKS.map((b) => <Chip key={b.slug} to={href(b.slug, trackedOnly)} active={b.slug === slug}>{b.name}</Chip>)}
      </div>

      <Section
        title={spec.name}
        hint={`${plural(shown.length, "model")}${trackedOnly ? "" : ` · ${tracked} priced here`}${latest ? ` · latest result ${dayYear(latest)}` : ""}`}
        action={
          <>
            <Chip to={href(slug, false)} active={!trackedOnly}>Everyone</Chip>
            <Chip to={href(slug, true)} active={trackedOnly}>Priced here</Chip>
          </>
        }
      >
        <p class="note" style={{ marginBottom: 10 }}>
          {spec.measures} Read from <a href={spec.url} class="acc hl" target="_blank" rel="noopener">{source.label}</a>{read ? `, last ${ago(read)}` : ""}.
        </p>
        {shown.length === 0 ? (
          <Empty>{lines.length === 0 ? "No results read yet. They arrive with the next daily check." : "None of these models is in the catalogue here."}</Empty>
        ) : (
          <div class="tw">
            <table aria-label={`${spec.name} results`}>
              <thead>
                <tr>
                  <th class="n">#</th>
                  <th>Model</th>
                  <th>Score</th>
                  <th>Setting</th>
                  <th>Measured</th>
                  <th class="n">In $/M</th>
                  <th class="n">Out $/M</th>
                  <th class="n">Source</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l, i) => {
                  const value = Number(l.best.score);
                  const m = l.model;
                  const publishedName = l.best.sourceModel;
                  return (
                    <tr key={l.key} class={m ? undefined : "dim"} data-feed-row>
                      <td class="n soft">{i + 1}</td>
                      <td>
                        {m ? <Link to={modelHref(m.modelId)} class="hl">{shortName(m.modelId, m.name)}</Link> : <span>{publishedName}</span>}
                        <span class="who">
                          {m ? providerName(m.provider) : l.best.provider ? providerName(l.best.provider) : "unknown maker"}
                          {m && !m.active ? " · removed from the catalogue" : ""}
                          {m && publishedName !== m.modelId ? <> · as <span class="mono">{publishedName}</span></> : null}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span class="bar" aria-hidden="true"><i style={{ width: `${fill(value, spec.unit, min, max)}%` }} /></span>
                        <span class="mono" style={{ marginLeft: 8 }}>{scoreText(l.best.score, spec.unit)}</span>
                        {l.best.detail ? <span class="small soft" style={{ marginLeft: 6 }}>{l.best.detail}</span> : null}
                      </td>
                      <td class="small soft">
                        {l.best.variant || "–"}
                        {l.others.length ? <span class="who num">also {l.others.map((o) => `${o.variant || "default"} ${scoreText(o.score, spec.unit)}`).join(" · ")}</span> : null}
                      </td>
                      <td class="when">{l.best.date ? dayYear(l.best.date) : "–"}</td>
                      <td class="n">{m ? money(m.promptPrice) || "–" : "–"}</td>
                      <td class="n">{m ? money(m.completionPrice) || "–" : "–"}</td>
                      <td class="n">{l.best.url ? <a href={l.best.url} class="acc hl small" target="_blank" rel="noopener">source →</a> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p class="note" style={{ marginTop: 10 }}>
          Scores as published by {source.label} ({source.licence}). A model named differently by the source than by the catalogue is shown by its published name without a link, and the run setting beside a score is the source's, not a choice made here. Prices are today's, not the price on the day of the run.
        </p>
      </Section>
    </div>
  );
}
