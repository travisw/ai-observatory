/**
 * Retirements: every model a provider has said it will switch off, by month, with the
 * replacement and how long is left. Promised-support floors sit below.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import { isAlias, providerName } from "../../shared/providers";
import { SOURCE_URL, canonicalKey } from "../../shared/sources";
import type { LifecycleRow, ModelRow, RetiringData } from "../../shared/types";
import { Chip, DayRow, Empty, PageHead, Pill, Section, Skeleton, Stat } from "../components/Wire";
import { keyIndex } from "../lib/stories";
import { dayShort, daysLeft, shortName } from "../lib/text";
import { countdown, daysUntil, isLoading, longDate, modelHref, monthLabel, plural, providerHref, usePageTitle } from "../lib/util";

type Retirement = { key: string; model: string; provider: string; retiresAt: string; deprecatedAt: string; replacement: string; replacementHref: string | null; href: string | null; source: string; sourceUrl: string };

const SOURCE_WORD: Record<string, string> = { openai: "provider notice", anthropic: "provider notice", cohere: "provider notice", litellm: "price list", modelsdev: "models.dev", openrouter: "catalogue expiry" };

export function RetiringPage() {
  usePageTitle("Retirements");
  const data = useQuery<RetiringData>("retiring");
  const models = useQuery<ModelRow[]>("activeModels");
  const keys = useMemo(() => keyIndex(models ?? []), [models]);
  if (isLoading(data)) return <Skeleton />;

  // One line per model id: the provider's own page outranks the aggregator lists.
  const rank: Record<string, number> = { openai: 0, anthropic: 0, cohere: 0, modelsdev: 1, litellm: 2 };
  const seen = new Map<string, LifecycleRow>();
  for (const row of data.lifecycle.slice().sort((a, b) => (rank[a.source] ?? 3) - (rank[b.source] ?? 3))) {
    const id = `${row.provider}/${row.modelId}`;
    if (!seen.has(id)) seen.set(id, row);
  }
  const rows: Retirement[] = [...seen.values()]
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
    });
  }
  rows.sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
  const byMonth = new Map<string, Retirement[]>();
  for (const r of rows) {
    const key = r.retiresAt.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(r);
    else byMonth.set(key, [r]);
  }
  const floor = [...seen.values()].filter((r) => r.retiresNote === "not sooner than" && r.retiresAt).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
  const next = rows.find((r) => daysUntil(r.retiresAt) >= 0);
  const withinMonth = rows.filter((r) => { const d = daysUntil(r.retiresAt); return d >= 0 && d <= 30; }).length;

  return (
    <div class="stack">
      <PageHead title="Retirements" action={<><Chip href="/api/retiring.json">JSON</Chip><Chip href="/feed.xml?kind=retiring">Feed</Chip></>}>
        Models their makers have announced an end date for, from the providers' own notices and the open price lists. Build on something here and you have a deadline.
      </PageHead>

      {next ? (
        <div class="stats">
          <Stat value={next.model} label={`next to retire · ${providerName(next.provider)}`} href={next.href ?? undefined} />
          <Stat value={`${daysUntil(next.retiresAt)} days`} label={`until ${longDate(next.retiresAt)}`} tone={daysUntil(next.retiresAt) <= 30 ? "rise" : ""} />
          <Stat value={String(withinMonth)} label="retiring within 30 days" />
          <Stat value={String(rows.length)} label="notices with a date" />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Empty>No retirement dates on record. This fills in as providers publish notices.</Empty>
      ) : (
        <div class="tw">
          <table aria-label="Retirements by month">
            <thead><tr><th>Retires</th><th>Model</th><th>Provider</th><th>Replacement</th><th>Source</th><th class="n">Left</th></tr></thead>
            <tbody>
              {[...byMonth.entries()].map(([month, list]) => (
                <>
                  <DayRow key={month} span={6}>{monthLabel(month)} <span class="soft" style={{ fontWeight: 400 }}>· {plural(list.length, "retirement")}</span></DayRow>
                  {list.map((r) => {
                    const left = daysLeft(r.retiresAt);
                    return (
                      <tr key={r.key} data-feed-row class={left.text === "retired" ? "dim" : undefined}>
                        <td class="when" title={longDate(r.retiresAt)}>{dayShort(r.retiresAt)}</td>
                        <td>
                          {r.href ? <Link to={r.href} class="hl">{r.model}</Link> : r.model}
                          <span class="who">
                            {r.deprecatedAt ? `Deprecated ${longDate(r.deprecatedAt)}.` : r.source === "openrouter" ? "Last day on the OpenRouter catalogue." : "Deprecation announced."}
                            {" "}{countdown(r.retiresAt).charAt(0).toUpperCase() + countdown(r.retiresAt).slice(1)}.
                          </span>
                        </td>
                        <td class="soft small"><Link to={providerHref(r.provider)} class="hl">{providerName(r.provider)}</Link></td>
                        <td class="small">{r.replacement ? (r.replacementHref ? <Link to={r.replacementHref} class="hl acc">{r.replacement}</Link> : <span class="mono">{r.replacement}</span>) : <span class="soft">—</span>}</td>
                        <td class="soft small">{r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noopener" class="hl">{SOURCE_WORD[r.source] ?? r.source}</a> : SOURCE_WORD[r.source] ?? r.source}</td>
                        <td class="n"><Pill tone={left.tone}>{left.text}</Pill></td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {floor.length ? (
        <Section title="Promised support" hint="the earliest date a provider says it might retire a model">
          <div class="tw">
            <table aria-label="Promised support">
              <thead><tr><th>Provider</th><th>Model</th><th class="n">Supported until at least</th></tr></thead>
              <tbody>
                {floor.map((r) => (
                  <tr key={r.id} class="dim">
                    <td class="small"><Link to={providerHref(r.provider)} class="hl">{providerName(r.provider)}</Link></td>
                    <td class="mono small">{r.modelId}</td>
                    <td class="n when">{longDate(r.retiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <p class="note">Already retired? See the <Link to="/graveyard" class="acc">graveyard</Link>.</p>
    </div>
  );
}
