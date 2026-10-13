/**
 * Every provider in one table: how many models it lists, what it changed this week, whether
 * its status page says it is up.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import { providerName } from "../../shared/providers";
import { canonicalProvider } from "../../shared/sources";
import type { ArchiveEvent, ModelRow, StatusPageData } from "../../shared/types";
import { Chip, Empty, PageHead, Pill, Skeleton } from "../components/Wire";
import { statusRemark, statusWord } from "../lib/text";
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

  if (isLoading(models)) return <Skeleton />;

  return (
    <div class="stack">
      <PageHead title="Providers" action={<Chip to="/status">Status history</Chip>}>
        {plural(rows.length, "provider")} with models listed. Status comes from each provider's own status page where it has a machine-readable one.
      </PageHead>
      {rows.length === 0 ? (
        <Empty>No providers yet.</Empty>
      ) : (
        <div class="tw">
          <table aria-label="Providers">
            <thead><tr><th>Provider</th><th class="n">Models</th><th class="n">Aliases</th><th class="n">Changes, 7 days</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const word = r.status ? statusWord(r.status.indicator) : null;
                return (
                  <tr key={r.slug} data-feed-row>
                    <td><Link to={providerHref(r.slug)} class="hl">{providerName(r.slug)}</Link></td>
                    <td class="n">{r.listed}</td>
                    <td class="n soft">{r.aliases || "—"}</td>
                    <td class={`n ${r.changes ? "acc" : "soft"}`}>{r.changes || "—"}</td>
                    <td>{word ? <Pill tone={word.tone}>{word.word}</Pill> : <span class="soft small">no status page</span>}</td>
                    <td class="soft small">{r.status ? statusRemark(r.status.indicator, r.status.description) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
