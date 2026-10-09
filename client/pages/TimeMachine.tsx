/**
 * The catalogue as it was on any past day, and what differs from today.
 */
import { useMemo } from "preact/hooks";
import { useNavigate, useQuery } from "@spacefast/zero/client";
import { EmptyState, Input, Skeleton } from "@spacefast/zero/kit";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import type { CatalogueAtData, ModelRow } from "../../shared/types";
import { Card, DeltaChip, ModelLink, Section } from "../components/bits";
import { isLoading, longDate, pctChange, plural, usePageTitle, useSearchParams } from "../lib/util";

export function TimeMachinePage() {
  usePageTitle("Time machine");
  const params = useSearchParams();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const at = params.get("at") ?? "";
  const iso = at ? `${at}T23:59:59.999Z` : "";
  const past = useQuery<CatalogueAtData>("catalogueAt", iso);
  const now = useQuery<ModelRow[]>("activeModels");

  const diff = useMemo(() => {
    if (!at || isLoading(past) || !now) return null;
    const then = new Map(past.models.map((m) => [m.modelId, m]));
    const current = new Map((now ?? []).map((m) => [m.modelId, m]));
    const added = [...current.values()].filter((m) => !then.has(m.modelId) && !isAlias(m.modelId));
    const removed = [...then.values()].filter((m) => !current.has(m.modelId) && !isAlias(m.modelId));
    const repriced = [...current.values()]
      .filter((m) => then.has(m.modelId) && !isAlias(m.modelId))
      .map((m) => ({ now: m, then: then.get(m.modelId)!, pct: pctChange(then.get(m.modelId)!.promptPrice, m.promptPrice) }))
      .filter((r) => r.pct !== null && Math.abs(r.pct) >= 3)
      .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
    return { added, removed, repriced };
  }, [at, past, now]);

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Time machine</h1>
        <p class="max-w-2xl text-sm text-ink-muted">Pick a day and see the catalogue exactly as it stood at the end of it, rebuilt from the record of every change since. Then see what is different today.</p>
        <label class="flex flex-wrap items-center gap-2 text-sm text-ink">
          Catalogue as of
          <span class="w-44"><Input type="date" value={at} max={today} onChange={(e) => navigate(`/time-machine?at=${(e.currentTarget as HTMLInputElement).value}`)} aria-label="Date" /></span>
        </label>
      </div>

      {!at ? (
        <EmptyState title="Choose a date" description="Any day since the record began. Links to a date can be shared." icon="calendar" />
      ) : isLoading(past) ? (
        <div class="flex flex-col gap-3"><Skeleton class="h-8 w-1/2" /><Skeleton class="h-48 w-full" /></div>
      ) : (
        <>
          {diff ? (
            <Section title={`Since ${longDate(at)}`} hint={`${plural(diff.added.length, "model")} added, ${diff.removed.length} removed, ${diff.repriced.length} repriced by 3% or more`}>
              <div class="grid gap-3 lg:grid-cols-3">
                <Card padded={false}>
                  <p class="border-b border-line px-4 py-2 text-xs font-medium text-success">Added since then</p>
                  {diff.added.length === 0 ? <p class="px-4 py-3 text-xs text-ink-muted">None.</p> : <ul>{diff.added.slice(0, 40).map((m) => <li key={m.id} class="border-b border-line px-4 py-1.5 text-sm last:border-0"><ModelLink modelId={m.modelId} name={m.name} withProvider /></li>)}</ul>}
                </Card>
                <Card padded={false}>
                  <p class="border-b border-line px-4 py-2 text-xs font-medium text-danger">Gone since then</p>
                  {diff.removed.length === 0 ? <p class="px-4 py-3 text-xs text-ink-muted">None.</p> : <ul>{diff.removed.slice(0, 40).map((m) => <li key={m.modelId} class="border-b border-line px-4 py-1.5 text-sm last:border-0"><ModelLink modelId={m.modelId} name={m.name} withProvider /></li>)}</ul>}
                </Card>
                <Card padded={false}>
                  <p class="border-b border-line px-4 py-2 text-xs font-medium text-accent">Input price moved</p>
                  {diff.repriced.length === 0 ? <p class="px-4 py-3 text-xs text-ink-muted">None.</p> : (
                    <ul>
                      {diff.repriced.slice(0, 40).map((r) => (
                        <li key={r.now.id} class="flex items-center gap-2 border-b border-line px-4 py-1.5 text-sm last:border-0">
                          <ModelLink modelId={r.now.modelId} name={r.now.name} class="min-w-0 flex-1 truncate text-ink" />
                          <span class="font-mono text-xs text-ink-muted">{money(r.then.promptPrice)} → {money(r.now.promptPrice)}</span>
                          <DeltaChip value={r.pct ?? 0} good={(r.pct ?? 0) < 0} size="sm" />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </Section>
          ) : null}
          <Section title={`The catalogue on ${longDate(at)}`} hint={`${plural(past.models.length, "model")}`}>
            <Card padded={false}>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-line text-left text-xs text-ink-muted">
                      <th class="px-4 py-2 font-normal">model</th>
                      <th class="px-2 py-2 text-right font-normal">context</th>
                      <th class="px-2 py-2 text-right font-normal">in $/M</th>
                      <th class="px-4 py-2 text-right font-normal">out $/M</th>
                    </tr>
                  </thead>
                  <tbody>
                    {past.models.slice().sort((a, b) => a.modelId.localeCompare(b.modelId)).map((m) => (
                      <tr key={m.modelId} class="border-b border-line last:border-0">
                        <td class="px-4 py-1"><span class="text-ink-muted">{providerName(m.provider)}</span> <ModelLink modelId={m.modelId} name={m.name} /></td>
                        <td class="px-2 py-1 text-right font-mono tabular-nums text-ink-muted">{formatContext(m.contextLength)}</td>
                        <td class="px-2 py-1 text-right font-mono tabular-nums text-ink">{money(m.promptPrice)}</td>
                        <td class="px-4 py-1 text-right font-mono tabular-nums text-ink">{money(m.completionPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>
        </>
      )}
    </div>
  );
}
