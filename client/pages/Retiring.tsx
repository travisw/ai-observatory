/**
 * Departures: every model a provider has said it will switch off, one board per month, with
 * the gate (replacement) and a status. Promised-support floors sit below as a dim log.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import { isAlias, providerName } from "../../shared/providers";
import { SOURCE_URL, canonicalKey } from "../../shared/sources";
import type { LifecycleRow, ModelRow, RetiringData } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, FlapText, Sign } from "../components/Flap";
import { BoardEmpty, LogLine, LogSection, Marquee, PageSkeleton } from "../components/Log";
import { boardDate, departureStatus, shortName } from "../lib/board";
import { keyIndex } from "../lib/stories";
import { countdown, daysUntil, isLoading, longDate, modelHref, monthLabel, plural, usePageTitle } from "../lib/util";

type Departure = { key: string; model: string; provider: string; retiresAt: string; deprecatedAt: string; replacement: string; replacementHref: string | null; href: string | null; source: string; sourceUrl: string; label: string };

export function RetiringPage() {
  usePageTitle("Departures");
  const data = useQuery<RetiringData>("retiring");
  const models = useQuery<ModelRow[]>("activeModels");
  const keys = useMemo(() => keyIndex(models ?? []), [models]);
  if (isLoading(data)) return <PageSkeleton />;

  // One line per model id: the provider's own page outranks the aggregator lists.
  const rank: Record<string, number> = { openai: 0, anthropic: 0, cohere: 0, modelsdev: 1, litellm: 2 };
  const seen = new Map<string, LifecycleRow>();
  for (const row of data.lifecycle.slice().sort((a, b) => (rank[a.source] ?? 3) - (rank[b.source] ?? 3))) {
    const id = `${row.provider}/${row.modelId}`;
    if (!seen.has(id)) seen.set(id, row);
  }
  const rows: Departure[] = [...seen.values()]
    .filter((r) => r.retiresAt && r.state !== "retired" && r.retiresNote !== "not sooner than")
    .map((r) => {
      const tracked = keys.get(r.key);
      const replacement = r.replacement ? keys.get(canonicalKey(r.provider, r.replacement)) : undefined;
      return {
        key: r.id,
        model: r.modelId.includes("/") ? r.modelId.slice(r.modelId.indexOf("/") + 1) : r.modelId,
        provider: r.provider,
        retiresAt: r.retiresAt,
        deprecatedAt: r.deprecatedAt,
        replacement: r.replacement,
        replacementHref: replacement ? modelHref(replacement) : null,
        href: tracked ? modelHref(tracked) : null,
        source: r.source,
        sourceUrl: r.sourceUrl || SOURCE_URL[r.source] || "",
        label: `${providerName(r.provider)} retires ${r.modelId} on ${longDate(r.retiresAt)} (${countdown(r.retiresAt)})${r.replacement ? `, use ${r.replacement} instead` : ""}`,
      };
    });
  for (const m of data.expiring) {
    if (isAlias(m.modelId)) continue;
    rows.push({
      key: m.id,
      model: shortName(m.modelId, m.name),
      provider: m.provider,
      retiresAt: m.expirationDate,
      deprecatedAt: "",
      replacement: "",
      replacementHref: null,
      href: modelHref(m.modelId),
      source: "openrouter",
      sourceUrl: SOURCE_URL.openrouter ?? "",
      label: `${shortName(m.modelId, m.name)} leaves the OpenRouter catalogue on ${longDate(m.expirationDate)} (${countdown(m.expirationDate)})`,
    });
  }
  rows.sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
  const byMonth = new Map<string, Departure[]>();
  for (const r of rows) {
    const key = r.retiresAt.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(r);
    else byMonth.set(key, [r]);
  }
  const floor = [...seen.values()].filter((r) => r.retiresNote === "not sooner than" && r.retiresAt).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
  const next = rows.find((r) => daysUntil(r.retiresAt) >= 0);

  return (
    <div class="flex flex-col gap-8">
      <Marquee title="Departures" action={<><Sign href="/api/retiring.json">JSON</Sign><Sign href="/feed.xml?kind=retiring">RSS</Sign></>}>
        Models their makers have announced an end date for, from the providers' own notices and the open price lists. Build on something here and you have a deadline.
      </Marquee>

      {next ? (
        <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">Next departure</span>
            <FlapText text={next.model} width={Math.min(26, Math.max(8, next.model.length))} size="lg" />
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">In</span>
            <FlapText text={`${daysUntil(next.retiresAt)} DAYS`} width={8} size="lg" tone={daysUntil(next.retiresAt) <= 30 ? "warning" : "ink"} delay={120} />
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-muted">Provider</span>
            <FlapText text={providerName(next.provider)} width={10} size="lg" tone="muted" delay={240} />
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <BoardEmpty>No retirement dates on record. This fills in as providers publish notices.</BoardEmpty>
      ) : (
        [...byMonth.entries()].map(([month, list], b) => (
          <Board key={month} label={monthLabel(month)} hint={plural(list.length, "departure")}>
            <ColumnHeads columns={[{ label: "Retires", width: 6, sticky: true }, { label: "Model", width: 22, sticky: true }, { label: "Provider", width: 9 }, { label: "Gate", width: 23 }, { label: "Status", width: 10 }]} />
            {list.map((r, i) => {
              const status = departureStatus(r.retiresAt);
              return (
                <div key={r.key}>
                  <FlapRow
                    href={r.href}
                    label={r.label}
                    delay={b * 80 + i * 40}
                    class={status.word === "DEPARTED" ? "opacity-60" : ""}
                    columns={[
                      { text: boardDate(r.retiresAt), width: 6, sticky: true, tone: "muted" },
                      { text: r.model, width: 22, sticky: true, tone: status.word === "DEPARTED" ? "danger" : "ink" },
                      { text: providerName(r.provider), width: 9, tone: "muted" },
                      { text: r.replacement || "-", width: 23, tone: r.replacement ? "ink" : "muted" },
                      { text: status.word, width: 10, tone: status.tone },
                    ]}
                  />
                  <p class="border-b border-dotted border-line px-3 pb-1.5 text-xs text-ink-muted">
                    {r.deprecatedAt ? `Deprecated ${longDate(r.deprecatedAt)}.` : r.source === "openrouter" ? "OpenRouter has set this as the listing's last day." : "Deprecation announced."}
                    {" "}{countdown(r.retiresAt).charAt(0).toUpperCase() + countdown(r.retiresAt).slice(1)}.
                    {r.replacement ? <> Use {r.replacementHref ? <Link to={r.replacementHref} class="text-accent hover:underline">{r.replacement}</Link> : <span class="font-mono">{r.replacement}</span>} instead.</> : null}
                    {r.sourceUrl ? <> <a href={r.sourceUrl} target="_blank" rel="noopener" class="uppercase tracking-[0.15em] text-accent hover:underline">read the notice</a></> : null}
                  </p>
                </div>
              );
            })}
          </Board>
        ))
      )}

      {floor.length ? (
        <LogSection title="Promised support" hint="the earliest date a provider says it might retire a model">
          <ul class="columns-1 sm:columns-2">
            {floor.map((r) => (
              <LogLine key={r.id} left={<span class="uppercase">{providerName(r.provider).slice(0, 7)}</span>} right={<span class="text-ink-muted">UNTIL {boardDate(r.retiresAt)} {r.retiresAt.slice(0, 4)}</span>} dim>
                <span class="font-mono text-xs">{r.modelId}</span>
              </LogLine>
            ))}
          </ul>
        </LogSection>
      ) : null}

      <p class="text-xs text-ink-muted">Retired already? See the <Link to="/graveyard" class="text-accent hover:underline">graveyard</Link>.</p>
    </div>
  );
}
