/**
 * The catalogue as it was on any past day, the sky that night, and what differs from today.
 */
import { useMemo } from "preact/hooks";
import { useNavigate, useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import type { CatalogueAtData, ModelRow } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, FlapText } from "../components/Flap";
import { BoardEmpty, LogSection, Marquee, PageSkeleton, SignInput } from "../components/Log";
import { StarChart } from "../components/StarChart";
import { boardDateYear, boardPct, shortName } from "../lib/board";
import { isLoading, longDate, modelHref, pctChange, plural, usePageTitle, useSearchParams } from "../lib/util";

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

  const listed = (m: ModelRow) => `${providerName(m.provider)} ${shortName(m.modelId, m.name)}`;

  return (
    <div class="flex flex-col gap-8">
      <Marquee title="Time machine">
        Pick a day and see the catalogue exactly as it stood at the end of it, rebuilt from the record of every change since. Then see what is different today. Links to a date can be shared.
      </Marquee>

      <div class="flex flex-wrap items-end gap-6">
        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">Catalogue as of</span>
          <FlapText text={at ? boardDateYear(at) : "-- --- --"} width={9} size="lg" tone={at ? "ink" : "muted"} />
        </div>
        <SignInput type="date" value={at} max={today} onInput={(v) => navigate(`/time-machine?at=${v}`)} label="Date" class="font-mono" />
      </div>

      {!at ? (
        <BoardEmpty>Choose a date. Any day since the record began.</BoardEmpty>
      ) : isLoading(past) ? (
        <PageSkeleton />
      ) : (
        <>
          {diff ? (
            <>
              <p class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">
                Since {longDate(at)}: {plural(diff.added.length, "model")} added, {diff.removed.length} removed, {diff.repriced.length} repriced by 3% or more
              </p>
              <Board label="Added" hint="listed since then">
                {diff.added.length === 0 ? <BoardEmpty>None</BoardEmpty> : (
                  <>
                    <ColumnHeads columns={[{ label: "Model", width: 32, sticky: true }, { label: "In $/M", width: 7, align: "right" }, { label: "Out $/M", width: 7, align: "right" }, { label: "Context", width: 6, align: "right" }, { label: "Status", width: 8 }]} />
                    {diff.added.slice(0, 15).map((m, i) => (
                      <FlapRow key={m.id} href={modelHref(m.modelId)} label={`${listed(m)} arrived: ${money(m.promptPrice)} in, ${money(m.completionPrice)} out`} delay={i * 40} columns={[
                        { text: listed(m), width: 32, sticky: true },
                        { text: money(m.promptPrice), width: 7, align: "right" },
                        { text: money(m.completionPrice), width: 7, align: "right" },
                        { text: formatContext(m.contextLength), width: 6, align: "right", tone: "muted" },
                        { text: "ARRIVED", width: 8, tone: "success" },
                      ]} />
                    ))}
                    {diff.added.length > 15 ? <p class="px-3 py-2 text-xs text-ink-muted">and {diff.added.length - 15} more</p> : null}
                  </>
                )}
              </Board>
              <Board label="Gone" hint="listed then, not now">
                {diff.removed.length === 0 ? <BoardEmpty>None</BoardEmpty> : (
                  <>
                    <ColumnHeads columns={[{ label: "Model", width: 32, sticky: true }, { label: "In $/M then", width: 11, align: "right" }, { label: "Out $/M then", width: 12, align: "right" }, { label: "Status", width: 9 }]} />
                    {diff.removed.slice(0, 15).map((m, i) => (
                      <FlapRow key={m.modelId} href={modelHref(m.modelId)} label={`${listed(m)} is gone; it was ${money(m.promptPrice)} in, ${money(m.completionPrice)} out`} delay={i * 40} columns={[
                        { text: listed(m), width: 32, sticky: true, tone: "danger" },
                        { text: money(m.promptPrice), width: 11, align: "right", tone: "muted" },
                        { text: money(m.completionPrice), width: 12, align: "right", tone: "muted" },
                        { text: "CANCELLED", width: 9, tone: "danger" },
                      ]} />
                    ))}
                    {diff.removed.length > 15 ? <p class="px-3 py-2 text-xs text-ink-muted">and {diff.removed.length - 15} more</p> : null}
                  </>
                )}
              </Board>
              <Board label="Repriced" hint="input price then and now, biggest cuts first">
                {diff.repriced.length === 0 ? <BoardEmpty>None</BoardEmpty> : (
                  <>
                    <ColumnHeads columns={[{ label: "Model", width: 32, sticky: true }, { label: "Was", width: 7, align: "right" }, { label: "Now", width: 7, align: "right" }, { label: "Change", width: 9 }]} />
                    {diff.repriced.slice(0, 15).map((r, i) => (
                      <FlapRow key={r.now.id} href={modelHref(r.now.modelId)} label={`${listed(r.now)}: ${money(r.then.promptPrice)} then, ${money(r.now.promptPrice)} now`} delay={i * 40} columns={[
                        { text: listed(r.now), width: 32, sticky: true },
                        { text: money(r.then.promptPrice), width: 7, align: "right", tone: "muted" },
                        { text: money(r.now.promptPrice), width: 7, align: "right" },
                        { text: boardPct(r.pct ?? 0), width: 9, tone: (r.pct ?? 0) < 0 ? "success" : "warning" },
                      ]} />
                    ))}
                    {diff.repriced.length > 15 ? <p class="px-3 py-2 text-xs text-ink-muted">and {diff.repriced.length - 15} more</p> : null}
                  </>
                )}
              </Board>
            </>
          ) : null}

          <Board label={`The sky on ${longDate(at)}`} hint="every scored model that night">
            <div class="p-3"><StarChart models={past.models} title={`The sky on ${longDate(at)}`} height={380} /></div>
          </Board>

          <LogSection title={`The catalogue on ${longDate(at)}`} hint={plural(past.models.length, "model")}>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-accent/40 text-left text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                    <th class="py-2 pr-3 font-semibold">Model</th>
                    <th class="py-2 pr-3 text-right font-semibold">Context</th>
                    <th class="py-2 pr-3 text-right font-semibold">In $/M</th>
                    <th class="py-2 text-right font-semibold">Out $/M</th>
                  </tr>
                </thead>
                <tbody>
                  {past.models.slice().sort((a, b) => a.modelId.localeCompare(b.modelId)).map((m) => (
                    <tr key={m.modelId} class="border-b border-dotted border-line last:border-0">
                      <td class="py-1 pr-3"><a href={modelHref(m.modelId)} class="text-[15px] text-ink hover:text-accent"><span class="text-ink-muted">{providerName(m.provider)} </span>{shortName(m.modelId, m.name)}</a></td>
                      <td class="py-1 pr-3 text-right font-mono text-xs tabular-nums text-ink-muted">{formatContext(m.contextLength)}</td>
                      <td class="py-1 pr-3 text-right font-mono text-xs tabular-nums text-ink">{money(m.promptPrice)}</td>
                      <td class="py-1 text-right font-mono text-xs tabular-nums text-ink">{money(m.completionPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </LogSection>
        </>
      )}
    </div>
  );
}
