/**
 * The retirement calendar: every model a provider has said it will switch off, by month, with
 * a countdown and the replacement it recommends. OpenRouter's own listing expiries sit below.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";
import { Badge, EmptyState, Skeleton } from "@spacefast/zero/kit";

import { providerName } from "../../shared/providers";
import { SOURCE_LABEL, SOURCE_URL, canonicalKey } from "../../shared/sources";
import type { LifecycleRow, ModelRow, RetiringData } from "../../shared/types";
import { Card, ExternalLink, ModelLink, ProviderLink, Section } from "../components/bits";
import { keyIndex } from "../lib/stories";
import { countdown, dayMonth, daysUntil, isLoading, longDate, monthLabel, plural, usePageTitle } from "../lib/util";

function urgency(iso: string): "danger" | "warning" | "neutral" {
  const days = daysUntil(iso);
  if (days <= 30) return "danger";
  if (days <= 90) return "warning";
  return "neutral";
}

export function RetiringPage() {
  usePageTitle("Retiring soon");
  const data = useQuery<RetiringData>("retiring");
  const models = useQuery<ModelRow[]>("activeModels");
  const keys = useMemo(() => keyIndex(models ?? []), [models]);
  if (isLoading(data)) return <div class="flex flex-col gap-3"><Skeleton class="h-10 w-1/3" /><Skeleton class="h-40 w-full" /></div>;

  // One line per model id: the provider's own page outranks the aggregator lists.
  const rank: Record<string, number> = { openai: 0, anthropic: 0, cohere: 0, modelsdev: 1, litellm: 2 };
  const seen = new Map<string, LifecycleRow>();
  for (const row of data.lifecycle.slice().sort((a, b) => (rank[a.source] ?? 3) - (rank[b.source] ?? 3))) {
    const id = `${row.provider}/${row.modelId}`;
    if (!seen.has(id)) seen.set(id, row);
  }
  const rows = [...seen.values()].filter((r) => r.retiresAt && r.state !== "retired" && r.retiresNote !== "not sooner than").sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
  const byMonth = new Map<string, LifecycleRow[]>();
  for (const r of rows) {
    const key = r.retiresAt.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(r);
    else byMonth.set(key, [r]);
  }
  const floor = [...seen.values()].filter((r) => r.retiresNote === "not sooner than" && r.retiresAt).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt));
  const next = rows.find((r) => daysUntil(r.retiresAt) >= 0);
  const expiring = data.expiring.slice().sort((a, b) => a.expirationDate.localeCompare(b.expirationDate));

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Retiring soon</h1>
        <p class="max-w-2xl text-sm text-ink-muted">
          Models their makers have announced an end date for, collected from the providers' own deprecation pages and the open price lists. Build on something here and you have a deadline.
          {next ? <> Next up: <span class="text-ink">{next.modelId}</span> from {providerName(next.provider)}, {countdown(next.retiresAt)}.</> : null}
        </p>
        <p class="text-xs text-ink-muted"><a href="/api/retiring.json" class="text-accent hover:underline">JSON</a> · <a href="/feed.xml?kind=lifecycle" class="text-accent hover:underline">RSS of retirement notices</a></p>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No retirement dates on record" description="This fills in as providers publish notices." />
      ) : (
        [...byMonth.entries()].map(([month, list]) => (
          <Section key={month} title={monthLabel(month)} hint={plural(list.length, "model")}>
            <Card padded={false}>
              <ul>
                {list.map((r) => {
                  const tracked = keys.get(r.key);
                  const replacement = r.replacement ? keys.get(canonicalKey(r.provider, r.replacement)) : undefined;
                  return (
                    <li key={r.id} class="grid gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[7rem_1fr_auto]">
                      <div class="flex flex-col">
                        <span class="font-mono text-sm whitespace-nowrap tabular-nums text-ink">{dayMonth(r.retiresAt)}</span>
                        <Badge tone={urgency(r.retiresAt)}>{countdown(r.retiresAt)}</Badge>
                      </div>
                      <div class="flex min-w-0 flex-col gap-0.5">
                        <span class="text-sm text-ink">
                          {tracked ? <ModelLink modelId={tracked} /> : <span class="font-mono">{r.modelId}</span>}
                          <span class="text-ink-muted"> · <ProviderLink slug={r.provider} class="text-ink-muted" /></span>
                        </span>
                        <span class="text-xs text-ink-muted">
                          {r.deprecatedAt ? `deprecated ${longDate(r.deprecatedAt)}` : "deprecation announced"}
                          {r.replacement ? <> · use {replacement ? <ModelLink modelId={replacement} class="text-accent" /> : <span class="font-mono">{r.replacement}</span>} instead</> : null}
                        </span>
                      </div>
                      <div class="text-xs">
                        <ExternalLink href={r.sourceUrl || SOURCE_URL[r.source] || "#"}>{SOURCE_LABEL[r.source]?.replace("'s deprecation page", "") ?? r.source}</ExternalLink>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </Section>
        ))
      )}

      {expiring.length ? (
        <Section title="Listings with an expiry on OpenRouter" hint="the date OpenRouter has set for the listing to go">
          <Card padded={false}>
            <ul>
              {expiring.map((m) => (
                <li key={m.id} class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-sm last:border-0">
                  <span class="w-24 font-mono text-xs tabular-nums text-ink">{longDate(m.expirationDate)}</span>
                  <Badge tone={urgency(m.expirationDate)}>{countdown(m.expirationDate)}</Badge>
                  <ModelLink modelId={m.modelId} name={m.name} withProvider />
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      {floor.length ? (
        <Section title="Promised support" hint="the earliest date a provider says it might retire a model">
          <Card padded={false}>
            <ul class="columns-1 sm:columns-2">
              {floor.map((r) => (
                <li key={r.id} class="flex items-center gap-2 break-inside-avoid border-b border-line px-4 py-1.5 text-sm">
                  <span class="font-mono text-xs text-ink-muted">{r.modelId}</span>
                  <span class="ml-auto text-xs text-ink-muted">at least until {longDate(r.retiresAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <p class="text-xs text-ink-muted">Retired already? See the <Link to="/graveyard" class="text-accent hover:underline">graveyard</Link>.</p>
    </div>
  );
}
