/**
 * The catalogue: price vs capability on top, the full table beneath, sortable and filterable,
 * with a sparkline per row.
 */
import { useMemo } from "preact/hooks";
import { Link, useNavigate, useQuery } from "@spacefast/zero/client";
import { Sparkline } from "@spacefast/zero/charts";

import { formatContext, money } from "../../shared/model";
import { isAlias, providerName } from "../../shared/providers";
import type { ArchiveEvent, HostsOverviewRow, ModelRow } from "../../shared/types";
import { StarChart } from "../components/StarChart";
import { Chip, Empty, PageHead, Section, Select, Skeleton, TextInput } from "../components/Wire";
import { inputSpark } from "../lib/series";
import { shortName } from "../lib/text";
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

  if (isLoading(active)) return <Skeleton rows={10} />;

  const chartModels = (active ?? []).filter((m) => !provider || m.provider.replace(/^~/, "") === provider);

  return (
    <div class="stack">
      <PageHead title="Models" action={<Chip href="/api/models.json">JSON</Chip>}>
        {plural((active ?? []).length, "model")} listed right now. Prices per million tokens as listed on OpenRouter.
      </PageHead>

      <Section title="Price vs capability" hint="every scored model" action={provider ? <Chip to="/models">Every provider</Chip> : undefined}>
        <StarChart models={chartModels} title={provider ? `Price vs capability · ${providerName(provider)}` : "Price vs capability"} />
      </Section>

      <Section
        title="The catalogue"
        hint={`${plural(rows.length, "model")} shown`}
        action={
          <>
            <TextInput value={q} onInput={(v) => set("q", v)} placeholder="Filter by model or provider" label="Filter models" style={{ width: 220 }} />
            <Select value={provider} onChange={(v) => set("provider", v)} label="Provider">
              <option value="">Every provider</option>
              {providers.map((p) => <option key={p} value={p}>{providerName(p)}</option>)}
            </Select>
            <Chip active={retiredOn} onClick={() => set("retired", retiredOn ? "" : "1")}>Removed {(retired ?? []).length}</Chip>
            {watchlist.length ? <Chip active={watchOnly} onClick={() => set("watch", watchOnly ? "" : "1")}>Watching {watchlist.length}</Chip> : null}
          </>
        }
      >
        {rows.length === 0 ? (
          <Empty>Nothing matches. Try a shorter filter.</Empty>
        ) : (
          <div class="tw">
            <table>
              <thead>
                <tr>
                  {SORTS.map((s) => (
                    <th key={s.key} class={s.align === "right" ? "n" : undefined} aria-sort={sort === s.key ? "descending" : undefined}>
                      <button type="button" class="chip" style={{ border: 0, padding: 0, font: "inherit", letterSpacing: "inherit", textTransform: "inherit", color: sort === s.key ? "var(--fg)" : "var(--soft)" }} onClick={() => set("sort", s.key)}>
                        {s.label}{sort === s.key ? " ▾" : ""}
                      </button>
                    </th>
                  ))}
                  <th>90 days</th>
                  <th>Cheapest host</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const host = hostIndex.get(m.modelId);
                  return (
                    <tr key={m.id} class={m.active ? undefined : "dim"}>
                      <td>
                        <Link to={modelHref(m.modelId)} class="hl">
                          <span class="soft">{providerName(m.provider)} </span>{shortName(m.modelId, m.name)}
                        </Link>
                        {isAlias(m.modelId) ? <span class="tag">alias</span> : null}
                      </td>
                      <td class="n soft">{formatContext(m.contextLength)}</td>
                      <td class="n">{money(m.promptPrice)}</td>
                      <td class="n">{money(m.completionPrice)}</td>
                      <td class="n soft">{m.aaIntelligence || "–"}</td>
                      <td class="n soft">{m.changeCount || "0"}</td>
                      <td class="n soft when">{longDate(m.firstSeenAt)}</td>
                      <td><Sparkline values={inputSpark(m, events ?? [])} width={64} height={18} color="#9fb3ff" /></td>
                      <td class="small soft">{host ? `${host.cheapestHost} · ${money(host.cheapestIn)}${Number(host.hosts) > 1 ? ` of ${host.hosts}` : ""}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p class="note" style={{ marginTop: 10 }}>
          "Index" is the Artificial Analysis intelligence index OpenRouter publishes for each model; higher is more capable. The sparkline is the input price over 90 days.
          {" "}<Link to="/compare" class="acc">Compare models side by side</Link>.
        </p>
      </Section>
    </div>
  );
}
