/**
 * The catalogue as a table: sortable, filterable, with a sparkline per row.
 */
import { useMemo } from "preact/hooks";
import { Link, useNavigate, useQuery } from "@spacefast/zero/client";
import { Sparkline } from "@spacefast/zero/charts";
import { Checkbox, EmptyState, Input, Select, Skeleton } from "@spacefast/zero/kit";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import type { ArchiveEvent, HostsOverviewRow, ModelRow } from "../../shared/types";
import { Card, ModelLink, Section } from "../components/bits";
import { inputSpark } from "../lib/series";
import { isLoading, longDate, plural, usePageTitle, useSearchParams, useSince } from "../lib/util";
import { matchesWatchModel, useWatchlist } from "../lib/watch";

type SortKey = "model" | "context" | "input" | "output" | "listed" | "score" | "changes";

const SORTS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "model", label: "model" },
  { key: "context", label: "context", align: "right" },
  { key: "input", label: "in $/M", align: "right" },
  { key: "output", label: "out $/M", align: "right" },
  { key: "score", label: "intelligence", align: "right" },
  { key: "changes", label: "changes", align: "right" },
  { key: "listed", label: "listed", align: "right" },
];

function paidFirst(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (x > 0 && y > 0) return x - y;
  if (x > 0) return -1;
  if (y > 0) return 1;
  return 0;
}

export function ModelsPage() {
  usePageTitle("Models");
  const params = useSearchParams();
  const navigate = useNavigate();
  const sort = (params.get("sort") as SortKey) || "listed";
  const q = params.get("q") ?? "";
  const provider = params.get("provider") ?? "";
  const retiredOn = params.get("retired") === "1";
  const watchOnly = params.get("watch") === "1";

  const active = useQuery<ModelRow[]>("activeModels");
  const retired = useQuery<ModelRow[]>("retiredModels");
  const hosts = useQuery<HostsOverviewRow[]>("hostsOverview");
  const since90 = useSince(90);
  const events = useQuery<ArchiveEvent[]>("eventsSince", since90);
  const [watchlist] = useWatchlist();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const s = next.toString();
    navigate(`/models${s ? `?${s}` : ""}`, { replace: key === "q" });
  };

  const providers = useMemo(() => [...new Set((active ?? []).map((m) => m.provider.replace(/^~/, "")))].sort((a, b) => providerName(a).localeCompare(providerName(b))), [active]);
  const hostIndex = useMemo(() => new Map((hosts ?? []).map((h) => [h.modelId, h])), [hosts]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const all = [...(active ?? []), ...(retiredOn ? retired ?? [] : [])];
    return all
      .filter((m) => !provider || m.provider.replace(/^~/, "") === provider)
      .filter((m) => !watchOnly || matchesWatchModel(m, watchlist))
      .filter((m) => !needle || m.modelId.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle) || providerName(m.provider).toLowerCase().includes(needle))
      .sort((a, b) => {
        switch (sort) {
          case "model": return a.modelId.localeCompare(b.modelId);
          case "context": return Number(b.contextLength) - Number(a.contextLength);
          // Free models sort last on price, so the cheapest view is about paid prices.
          case "input": return paidFirst(a.promptPrice, b.promptPrice);
          case "output": return paidFirst(a.completionPrice, b.completionPrice);
          case "score": return (Number(b.aaIntelligence) || -1) - (Number(a.aaIntelligence) || -1);
          case "changes": return Number(b.changeCount) - Number(a.changeCount);
          default: return b.firstSeenAt.localeCompare(a.firstSeenAt);
        }
      });
  }, [active, retired, retiredOn, provider, watchOnly, watchlist, needle, sort]);

  if (isLoading(active)) return <div class="flex flex-col gap-3"><Skeleton class="h-10 w-1/3" /><Skeleton class="h-64 w-full" /></div>;

  return (
    <Section title="Models" hint={`${plural(rows.length, "model")} shown`} action={<a href="/api/models.json" class="text-accent hover:underline">JSON</a>}>
      <div class="flex flex-wrap items-center gap-3">
        <span class="w-full max-w-xs"><Input placeholder="Filter by model or provider" value={q} onInput={(e) => set("q", (e.currentTarget as HTMLInputElement).value)} aria-label="Filter models" /></span>
        <Select value={provider} onChange={(e) => set("provider", (e.currentTarget as HTMLSelectElement).value)} aria-label="Provider">
          <option value="">every provider</option>
          {providers.map((p) => <option key={p} value={p}>{providerName(p)}</option>)}
        </Select>
        <Checkbox label={`include delisted (${(retired ?? []).length})`} checked={retiredOn} onChange={() => set("retired", retiredOn ? "" : "1")} />
        {watchlist.length ? <Checkbox label={`watching only (${watchlist.length})`} checked={watchOnly} onChange={() => set("watch", watchOnly ? "" : "1")} /> : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="Try a shorter filter." icon="search" />
      ) : (
        <Card padded={false}>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-line text-left text-xs text-ink-muted">
                  {SORTS.map((s) => (
                    <th key={s.key} class={`px-3 py-2 font-normal first:px-4 ${s.align === "right" ? "text-right" : ""}`}>
                      <button type="button" class={`hover:text-ink ${sort === s.key ? "text-accent" : ""}`} onClick={() => set("sort", s.key)} aria-sort={sort === s.key ? "descending" : undefined}>
                        {s.label}{sort === s.key ? " ▾" : ""}
                      </button>
                    </th>
                  ))}
                  <th class="px-3 py-2 font-normal">90 days</th>
                  <th class="px-4 py-2 font-normal">cheapest host</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const host = hostIndex.get(m.modelId);
                  return (
                    <tr key={m.id} class={`border-b border-line last:border-0 ${m.active ? "" : "opacity-50"}`}>
                      <td class="px-4 py-1.5">
                        <ModelLink modelId={m.modelId} name={m.name} withProvider />
                        {isAlias(m.modelId) ? <span class="ml-1 text-[11px] text-ink-muted">alias</span> : null}
                      </td>
                      <td class="px-3 py-1.5 text-right font-mono tabular-nums text-ink-muted">{formatContext(m.contextLength)}</td>
                      <td class="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{money(m.promptPrice)}</td>
                      <td class="px-3 py-1.5 text-right font-mono tabular-nums text-ink">{money(m.completionPrice)}</td>
                      <td class="px-3 py-1.5 text-right font-mono tabular-nums text-ink-muted">{m.aaIntelligence || "–"}</td>
                      <td class="px-3 py-1.5 text-right font-mono tabular-nums text-ink-muted">{m.changeCount || "0"}</td>
                      <td class="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-ink-muted">{longDate(m.firstSeenAt)}</td>
                      <td class="px-3 py-1.5"><Sparkline values={inputSpark(m, events ?? [])} width={64} height={18} /></td>
                      <td class="px-4 py-1.5 text-xs text-ink-muted">{host ? `${host.cheapestHost} · ${money(host.cheapestIn)}${Number(host.hosts) > 1 ? ` of ${host.hosts}` : ""}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p class="text-xs text-ink-muted">
        Prices per million tokens as listed on OpenRouter. "Intelligence" is the Artificial Analysis index OpenRouter publishes for each model; higher is more capable. The sparkline is the input price over 90 days.
        {" "}<Link to="/compare" class="text-accent hover:underline">Compare models side by side</Link>.
      </p>
    </Section>
  );
}
