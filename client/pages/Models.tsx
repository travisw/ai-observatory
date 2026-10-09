/**
 * The catalogue: the sky tonight on top (every scored model as a star), the full logbook table
 * beneath, sortable and filterable, with a sparkline per row.
 */
import { useMemo } from "preact/hooks";
import { Link, useNavigate, useQuery } from "@spacefast/zero/client";
import { Sparkline } from "@spacefast/zero/charts";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import type { ArchiveEvent, HostsOverviewRow, ModelRow } from "../../shared/types";
import { Board, Sign } from "../components/Flap";
import { BoardEmpty, LogSection, Marquee, PageSkeleton, SignInput, SignSelect, Stencil } from "../components/Log";
import { StarChart } from "../components/StarChart";
import { shortName } from "../lib/board";
import { inputSpark } from "../lib/series";
import { isLoading, longDate, modelHref, plural, usePageTitle, useSearchParams, useSince } from "../lib/util";
import { matchesWatchModel, useWatchlist } from "../lib/watch";

type SortKey = "model" | "context" | "input" | "output" | "listed" | "score" | "changes";

const SORTS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "model", label: "Model" },
  { key: "context", label: "Context", align: "right" },
  { key: "input", label: "In $/M", align: "right" },
  { key: "output", label: "Out $/M", align: "right" },
  { key: "score", label: "Index", align: "right" },
  { key: "changes", label: "Changes", align: "right" },
  { key: "listed", label: "Listed", align: "right" },
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

  if (isLoading(active)) return <PageSkeleton />;

  const skyModels = (active ?? []).filter((m) => !provider || m.provider.replace(/^~/, "") === provider);

  return (
    <div class="flex flex-col gap-8">
      <Marquee title="Models" action={<Sign href="/api/models.json">JSON</Sign>}>
        {plural((active ?? []).length, "model")} listed right now. Prices per million tokens as listed on OpenRouter.
      </Marquee>

      <Board label="The sky tonight" hint="every scored model: capability across, input price up, size is context" action={provider ? <Sign to="/models">Whole sky</Sign> : undefined}>
        <div class="p-3">
          <StarChart models={skyModels} title="The sky tonight" />
        </div>
      </Board>

      <LogSection
        title="The catalogue"
        hint={`${plural(rows.length, "model")} shown`}
        action={
          <>
            <SignInput value={q} onInput={(v) => set("q", v)} placeholder="Filter by model or provider" label="Filter models" class="w-56" />
            <SignSelect value={provider} onChange={(v) => set("provider", v)} label="Provider">
              <option value="">Every provider</option>
              {providers.map((p) => <option key={p} value={p}>{providerName(p)}</option>)}
            </SignSelect>
            <Stencil active={retiredOn} onClick={() => set("retired", retiredOn ? "" : "1")}>Delisted {(retired ?? []).length}</Stencil>
            {watchlist.length ? <Stencil active={watchOnly} onClick={() => set("watch", watchOnly ? "" : "1")}>Watching {watchlist.length}</Stencil> : null}
          </>
        }
      >
        {rows.length === 0 ? (
          <BoardEmpty>Nothing matches. Try a shorter filter.</BoardEmpty>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-accent/40 text-left text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                  {SORTS.map((s) => (
                    <th key={s.key} class={`py-2 pr-3 font-semibold ${s.key === "model" ? "sticky left-0 bg-canvas" : ""} ${s.align === "right" ? "text-right" : ""}`}>
                      <button type="button" class={`uppercase tracking-[0.2em] hover:text-ink ${sort === s.key ? "text-accent" : ""}`} onClick={() => set("sort", s.key)} aria-sort={sort === s.key ? "descending" : undefined}>
                        {s.label}{sort === s.key ? " ▾" : ""}
                      </button>
                    </th>
                  ))}
                  <th class="py-2 pr-3 font-semibold">90 days</th>
                  <th class="py-2 font-semibold">Cheapest host</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const host = hostIndex.get(m.modelId);
                  return (
                    <tr key={m.id} class={`border-b border-dotted border-line last:border-0 ${m.active ? "" : "opacity-50"}`}>
                      <td class="sticky left-0 bg-canvas py-1.5 pr-3">
                        <Link to={modelHref(m.modelId)} class="text-[15px] text-ink hover:text-accent">
                          <span class="text-ink-muted">{providerName(m.provider)} </span>{shortName(m.modelId, m.name)}
                        </Link>
                        {isAlias(m.modelId) ? <span class="ml-2 text-[10px] uppercase tracking-[0.2em] text-ink-muted">alias</span> : null}
                      </td>
                      <td class="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink-muted">{formatContext(m.contextLength)}</td>
                      <td class="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink">{money(m.promptPrice)}</td>
                      <td class="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink">{money(m.completionPrice)}</td>
                      <td class="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink-muted">{m.aaIntelligence || "–"}</td>
                      <td class="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink-muted">{m.changeCount || "0"}</td>
                      <td class="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-ink-muted">{longDate(m.firstSeenAt)}</td>
                      <td class="py-1.5 pr-3"><Sparkline values={inputSpark(m, events ?? [])} width={64} height={18} color="#ffb000" /></td>
                      <td class="py-1.5 text-xs text-ink-muted">{host ? `${host.cheapestHost} · ${money(host.cheapestIn)}${Number(host.hosts) > 1 ? ` of ${host.hosts}` : ""}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p class="text-xs text-ink-muted">
          "Index" is the Artificial Analysis intelligence index OpenRouter publishes for each model; higher is more capable. The sparkline is the input price over 90 days.
          {" "}<Link to="/compare" class="text-accent hover:underline">Compare models side by side</Link>.
        </p>
      </LogSection>
    </div>
  );
}
