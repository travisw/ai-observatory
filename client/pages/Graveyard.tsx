/**
 * Departed: where models go when they leave. One board per month, each row with its epitaph.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import { isAlias, modelName, providerName } from "../../shared/providers";
import { canonicalKey } from "../../shared/sources";
import type { GraveyardData, ModelRow, RetiringData } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, FlapText, Sign } from "../components/Flap";
import { BoardEmpty, LogLine, LogSection, Marquee, PageSkeleton } from "../components/Log";
import { boardDate, shortName } from "../lib/board";
import { keyIndex } from "../lib/stories";
import { DAY, daysUntil, isLoading, longDate, modelHref, monthLabel, plural, usePageTitle } from "../lib/util";

function lifespan(from: string, to: string): string {
  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY));
  if (days < 1) return "< 1 DAY";
  if (days < 60) return `${days} DAYS`;
  if (days < 730) return `${Math.round(days / 30)} MONTHS`;
  return `${(days / 365).toFixed(1)} YEARS`;
}

export function GraveyardPage() {
  usePageTitle("Graveyard");
  const data = useQuery<GraveyardData>("graveyard");
  const retiring = useQuery<RetiringData>("retiring");
  const active = useQuery<ModelRow[]>("activeModels");
  const keys = useMemo(() => keyIndex(active ?? []), [active]);
  if (isLoading(data)) return <PageSkeleton />;

  const retired = data.retired.filter((m) => !isAlias(m.modelId));
  const byKey = new Map(data.lifecycle.map((l) => [l.key, l]));
  const next = isLoading(retiring) ? null : retiring.lifecycle.filter((l) => l.state === "deprecated" && l.retiresAt && l.retiresNote !== "not sooner than" && daysUntil(l.retiresAt) >= 0).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt))[0] ?? null;
  const lifespans = retired.map((m) => (Date.parse(m.lastSeenAt) - Date.parse(m.firstSeenAt)) / DAY).filter((d) => d > 0).sort((a, b) => a - b);
  const medianLife = lifespans.length ? lifespans[Math.floor(lifespans.length / 2)] : null;
  const official = data.lifecycle.filter((l) => !retired.some((m) => canonicalKey(m.provider, m.modelId) === l.key));
  const byMonth = new Map<string, typeof retired>();
  for (const m of retired) {
    const key = m.lastSeenAt.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(m);
    else byMonth.set(key, [m]);
  }

  return (
    <div class="flex flex-col gap-8">
      <Marquee title="Graveyard" action={<Sign to="/retiring">Departures</Sign>}>
        {plural(retired.length, "model")} that were listed and then quietly weren't.{medianLife ? ` The typical one lasted ${plural(Math.round(medianLife), "day")}.` : ""} Rolling aliases are not buried; they move on to the next model in their family.
      </Marquee>

      <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">Buried</span>
          <FlapText text={String(retired.length)} width={4} size="lg" tone="danger" />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">Typical lifespan</span>
          <FlapText text={medianLife ? `${Math.round(medianLife)} DAYS` : "-"} width={9} size="lg" delay={120} />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">Next funeral</span>
          {next ? (
            <Link to="/retiring" class="inline-flex flex-wrap items-center gap-3" aria-label={`${shortName(next.modelId)} in ${daysUntil(next.retiresAt)} days`}>
              <FlapText text={shortName(next.modelId)} width={Math.min(22, Math.max(8, shortName(next.modelId).length))} size="lg" delay={240} />
              <FlapText text={`${daysUntil(next.retiresAt)} DAYS`} width={8} size="lg" tone={daysUntil(next.retiresAt) <= 30 ? "warning" : "ink"} delay={360} />
            </Link>
          ) : (
            <FlapText text="NONE ANNOUNCED" width={14} size="lg" tone="muted" delay={240} />
          )}
        </div>
      </div>

      {retired.length === 0 ? (
        <BoardEmpty>Nobody here yet. Models that leave the catalogue are laid to rest on this page.</BoardEmpty>
      ) : (
        [...byMonth.entries()].map(([month, list], b) => (
          <Board key={month} label={`Departed · ${monthLabel(month)}`} hint={plural(list.length, "model")}>
            <ColumnHeads columns={[{ label: "Model", width: 22, sticky: true }, { label: "Provider", width: 10 }, { label: "Born", width: 6 }, { label: "Died", width: 6 }, { label: "Lived", width: 10 }, { label: "Status", width: 9 }]} />
            {list.map((m, i) => {
              const notice = byKey.get(canonicalKey(m.provider, m.modelId));
              const successor = notice?.replacement ? keys.get(canonicalKey(m.provider, notice.replacement)) : undefined;
              const heir = (active ?? []).find((a) => a.aliasTarget && canonicalKey(a.provider, a.aliasTarget) === canonicalKey(m.provider, m.modelId));
              return (
                <div key={m.id}>
                  <FlapRow
                    href={modelHref(m.modelId)}
                    label={`${shortName(m.modelId, m.name)} by ${providerName(m.provider)}: listed ${longDate(m.firstSeenAt)}, gone ${longDate(m.lastSeenAt)}, lived ${lifespan(m.firstSeenAt, m.lastSeenAt).toLowerCase()}`}
                    delay={b * 80 + i * 40}
                    columns={[
                      { text: shortName(m.modelId, m.name), width: 22, sticky: true },
                      { text: providerName(m.provider), width: 10, tone: "muted" },
                      { text: boardDate(m.firstSeenAt), width: 6, tone: "muted" },
                      { text: boardDate(m.lastSeenAt), width: 6, tone: "muted" },
                      { text: lifespan(m.firstSeenAt, m.lastSeenAt), width: 10 },
                      { text: "DEPARTED", width: 9, tone: "danger" },
                    ]}
                  />
                  <p class="border-b border-dotted border-line px-3 pb-1.5 text-xs text-ink-muted">
                    {notice ? `Retired by ${providerName(notice.provider)}${notice.retiresAt ? ` on ${longDate(notice.retiresAt)}` : ""}.` : "Delisted without a notice we could find."}
                    {successor ? <> Survived by <Link to={modelHref(successor)} class="text-accent hover:underline">{modelName(successor)}</Link>.</> : notice?.replacement ? ` Survived by ${notice.replacement}.` : heir ? <> The name <Link to={modelHref(heir.modelId)} class="text-accent hover:underline">{modelName(heir.modelId, heir.name)}</Link> lives on.</> : ""}
                  </p>
                </div>
              );
            })}
          </Board>
        ))
      )}

      {official.length ? (
        <LogSection title="Retired by notice" hint="on the providers' own pages, never listed here">
          <ul class="columns-1 sm:columns-2">
            {official.sort((a, b) => (b.retiresAt || "").localeCompare(a.retiresAt || "")).map((l) => (
              <LogLine key={l.id} left={<span class="uppercase">{providerName(l.provider).slice(0, 7)}</span>} right={l.retiresAt ? <span class="text-ink-muted">{boardDate(l.retiresAt)} {l.retiresAt.slice(0, 4)}</span> : null} dim>
                <span class="font-mono text-xs">{l.modelId}</span>
              </LogLine>
            ))}
          </ul>
        </LogSection>
      ) : null}
    </div>
  );
}
