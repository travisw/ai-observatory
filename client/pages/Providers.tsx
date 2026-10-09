/**
 * Every provider on one board: how many models it lists, what it changed this week, whether
 * its status page says it is up.
 */
import { useMemo } from "preact/hooks";
import { useQuery } from "@spacefast/zero/client";

import { providerName } from "../../shared/providers";
import { canonicalProvider } from "../../shared/sources";
import type { ArchiveEvent, ModelRow, StatusPageData } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, Sign } from "../components/Flap";
import { BoardEmpty, Marquee, PageSkeleton } from "../components/Log";
import { remarkWord, statusWord } from "../lib/board";
import { isLoading, plural, providerHref, usePageTitle, useSince } from "../lib/util";

export function ProvidersPage() {
  usePageTitle("Providers");
  const models = useQuery<ModelRow[]>("activeModels");
  const status = useQuery<StatusPageData>("statusPage");
  const since7 = useSince(7);
  const events = useQuery<ArchiveEvent[]>("eventsSince", since7);

  const rows = useMemo(() => {
    const counts = new Map<string, { listed: number; aliases: number }>();
    for (const m of models ?? []) {
      const slug = m.provider.replace(/^~/, "");
      const c = counts.get(slug) ?? { listed: 0, aliases: 0 };
      if (m.provider.startsWith("~")) c.aliases++;
      else c.listed++;
      counts.set(slug, c);
    }
    const changes = new Map<string, number>();
    for (const e of events ?? []) {
      const slug = e.provider.replace(/^~/, "");
      changes.set(slug, (changes.get(slug) ?? 0) + 1);
    }
    const statuses = new Map((isLoading(status) ? [] : status.statuses).map((s) => [canonicalProvider(s.provider), s]));
    return [...counts.entries()]
      .map(([slug, c]) => ({ slug, ...c, changes: changes.get(slug) ?? 0, status: statuses.get(canonicalProvider(slug)) ?? null }))
      .sort((a, b) => b.listed - a.listed || providerName(a.slug).localeCompare(providerName(b.slug)));
  }, [models, events, status]);

  if (isLoading(models)) return <PageSkeleton />;

  return (
    <div class="flex flex-col gap-8">
      <Marquee title="Providers" action={<Sign to="/status">Status board</Sign>}>
        {plural(rows.length, "provider")} with models listed. Status comes from each provider's own status page where it has a machine-readable one.
      </Marquee>
      <Board label="Providers" hint="models listed · changes this week · status">
        {rows.length === 0 ? (
          <BoardEmpty>No providers yet</BoardEmpty>
        ) : (
          <>
            <ColumnHeads columns={[{ label: "Provider", width: 18, sticky: true }, { label: "Models", width: 6, align: "right" }, { label: "Changes 7d", width: 10, align: "right" }, { label: "Status", width: 10 }, { label: "Remarks", width: 20 }]} />
            {rows.map((r, i) => {
              const spec = r.status ? statusWord(r.status.indicator) : { word: "NO PAGE", tone: "muted" as const };
              return (
                <FlapRow
                  key={r.slug}
                  href={providerHref(r.slug)}
                  label={`${providerName(r.slug)}: ${plural(r.listed, "model")} listed, ${plural(r.changes, "change")} this week, ${spec.word.toLowerCase()}`}
                  delay={i * 40}
                  columns={[
                    { text: providerName(r.slug), width: 18, sticky: true },
                    { text: String(r.listed), width: 6, align: "right" },
                    { text: r.changes ? String(r.changes) : "-", width: 10, align: "right", tone: r.changes ? "accent" : "muted" },
                    { text: spec.word, width: 10, tone: spec.tone },
                    { text: r.status ? remarkWord(r.status.indicator, r.status.description) : "", width: 20, tone: "muted" },
                  ]}
                />
              );
            })}
          </>
        )}
      </Board>
    </div>
  );
}
