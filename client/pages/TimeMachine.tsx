/**
 * The catalogue as it was on any past day, price against capability that day, and what differs from today.
 */
import { useMemo } from "preact/hooks";
import { Link, useNavigate, useQuery } from "@spacefast/zero/client";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import type { CatalogueAtData, ModelRow } from "../../shared/types";
import { StarChart } from "../components/StarChart";
import { Delta, Empty, PageHead, Pill, Section, Skeleton, TextInput } from "../components/Wire";
import { dayYear, shortName } from "../lib/text";
import { isLoading, modelHref, pctChange, plural, usePageTitle, useSearchParams } from "../lib/util";

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

  const listed = (m: ModelRow) => <><span class="soft">{providerName(m.provider)} </span>{shortName(m.modelId, m.name)}</>;
  const more = (n: number) => (n > 15 ? <p class="note">and {n - 15} more</p> : null);

  return (
    <div class="stack">
      <PageHead
        title="Time machine"
        action={
          <label class="chips" style={{ gap: 10 }}>
            <span class="tiny">Catalogue as of</span>
            <TextInput type="date" value={at} max={today} onInput={(v) => navigate(`/time-machine?at=${v}`)} label="Date" style={{ fontFamily: "'IBM Plex Mono', SFMono-Regular, Menlo, monospace" }} />
          </label>
        }
      >
        Pick a day and see the catalogue exactly as it stood at the end of it, rebuilt from the record of every change since. Then see what is different today. Links to a date can be shared.
      </PageHead>

      {!at ? (
        <Empty>Choose a date. Any day since the record began.</Empty>
      ) : isLoading(past) ? (
        <Skeleton />
      ) : (
        <>
          {diff ? (
            <>
              <p class="note">
                Since {dayYear(at)}: {plural(diff.added.length, "model")} added, {diff.removed.length} removed, {diff.repriced.length} repriced by 3% or more.
              </p>
              <Section title="Added" hint="listed since then">
                {diff.added.length === 0 ? <Empty>None.</Empty> : (
                  <div class="tw">
                    <table>
                      <thead><tr><th>Model</th><th class="n">In $/M</th><th class="n">Out $/M</th><th class="n">Context</th></tr></thead>
                      <tbody>
                        {diff.added.slice(0, 15).map((m) => (
                          <tr key={m.id}>
                            <td><Link to={modelHref(m.modelId)} class="hl">{listed(m)}</Link></td>
                            <td class="n">{money(m.promptPrice)}</td>
                            <td class="n">{money(m.completionPrice)}</td>
                            <td class="n soft">{formatContext(m.contextLength)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {more(diff.added.length)}
                  </div>
                )}
              </Section>
              <Section title="Gone" hint="listed then, not now">
                {diff.removed.length === 0 ? <Empty>None.</Empty> : (
                  <div class="tw">
                    <table>
                      <thead><tr><th>Model</th><th class="n">In $/M then</th><th class="n">Out $/M then</th><th class="n">Status</th></tr></thead>
                      <tbody>
                        {diff.removed.slice(0, 15).map((m) => (
                          <tr key={m.modelId}>
                            <td><Link to={modelHref(m.modelId)} class="hl">{listed(m)}</Link></td>
                            <td class="n soft">{money(m.promptPrice)}</td>
                            <td class="n soft">{money(m.completionPrice)}</td>
                            <td class="n"><Pill tone="bad">removed</Pill></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {more(diff.removed.length)}
                  </div>
                )}
              </Section>
              <Section title="Repriced" hint="input price then and now, biggest cuts first">
                {diff.repriced.length === 0 ? <Empty>None.</Empty> : (
                  <div class="tw">
                    <table>
                      <thead><tr><th>Model</th><th class="n">Was</th><th class="n">Now</th><th class="n">Change</th></tr></thead>
                      <tbody>
                        {diff.repriced.slice(0, 15).map((r) => (
                          <tr key={r.now.id}>
                            <td><Link to={modelHref(r.now.modelId)} class="hl">{listed(r.now)}</Link></td>
                            <td class="n soft">{money(r.then.promptPrice)}</td>
                            <td class="n">{money(r.now.promptPrice)}</td>
                            <td class="n"><Delta value={r.pct ?? 0} good={(r.pct ?? 0) < 0} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {more(diff.repriced.length)}
                  </div>
                )}
              </Section>
            </>
          ) : null}

          <Section title={`Price against capability on ${dayYear(at)}`} hint="every scored model that day">
            <div class="box"><StarChart models={past.models} title={`Price against capability on ${dayYear(at)}`} height={380} /></div>
          </Section>

          <Section title={`The catalogue on ${dayYear(at)}`} hint={plural(past.models.length, "model")}>
            <div class="tw">
              <table>
                <thead><tr><th>Model</th><th class="n">Context</th><th class="n">In $/M</th><th class="n">Out $/M</th></tr></thead>
                <tbody>
                  {past.models.slice().sort((a, b) => a.modelId.localeCompare(b.modelId)).map((m) => (
                    <tr key={m.modelId}>
                      <td><Link to={modelHref(m.modelId)} class="hl">{listed(m)}</Link></td>
                      <td class="n soft">{formatContext(m.contextLength)}</td>
                      <td class="n">{money(m.promptPrice)}</td>
                      <td class="n">{money(m.completionPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
