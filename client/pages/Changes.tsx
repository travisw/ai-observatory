/**
 * Every change recorded, with the filters in the URL so every view is a link someone can send.
 */
import { useMemo } from "preact/hooks";
import { useNavigate, useQuery } from "@spacefast/zero/client";

import { providerName } from "../../shared/providers";
import type { Story } from "../../shared/stories";
import type { ChangesData, ModelRow } from "../../shared/types";
import { Chip, DayRow, Empty, PageHead, Section, Select, Skeleton, StoryRow, StoryTable } from "../components/Wire";
import { KIND_GROUPS, assembleStories, keyIndex, kindInGroup, nameIndex, storyHref } from "../lib/stories";
import { dayLabel, plural, usePageTitle, useSearchParams } from "../lib/util";
import { matchesWatch, useWatchlist } from "../lib/watch";

/** The most the page loads: ten steps of 150 archive events. */
const MAX_PAGES = 10;

function withParam(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key !== "page") next.delete("page");
  const s = next.toString();
  return `/changes${s ? `?${s}` : ""}`;
}

export function ChangesPage() {
  usePageTitle("Changes");
  const params = useSearchParams();
  const navigate = useNavigate();
  const kind = params.get("kind") ?? "";
  const provider = params.get("provider") ?? "";
  const confirmedOnly = params.get("confirmed") === "1";
  const watchOnly = params.get("watch") === "1";
  const pages = Math.max(1, Math.min(MAX_PAGES, Number(params.get("page") ?? "1") || 1));

  const models = useQuery<ModelRow[]>("activeModels");
  const data = useQuery<ChangesData>("changesPage", provider, pages);
  const [watchlist] = useWatchlist();

  const all = models ?? [];
  const names = useMemo(() => nameIndex(all), [all]);
  const keys = useMemo(() => keyIndex(all), [all]);
  const providers = useMemo(() => [...new Set((models ?? []).map((m) => m.provider.replace(/^~/, "")))].sort((a, b) => providerName(a).localeCompare(providerName(b))), [models]);

  const loading = data === undefined || data === null;
  const stories = useMemo(() => {
    if (!data) return [];
    const pile = assembleStories({
      events: data.events,
      sourceEvents: data.sourceEvents,
      hostEvents: data.hostEvents,
      lifecycleEvents: data.lifecycleEvents,
      names,
    });
    return pile.filter((s) => {
      if (kind && !kindInGroup(s.kind, kind)) return false;
      if (provider && s.provider.replace(/^~/, "") !== provider && !(s.source === "hosts" && s.modelId.startsWith(`${provider}/`))) return false;
      if (confirmedOnly && !s.confirmedBy?.length) return false;
      if (watchOnly && !matchesWatch(s, watchlist)) return false;
      return true;
    });
  }, [data, names, kind, provider, confirmedOnly, watchOnly, watchlist]);

  const byDay = new Map<string, Story[]>();
  for (const s of stories) {
    const key = s.at.slice(0, 10);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  const more = Boolean(data?.more);

  return (
    <div class="stack">
      <PageHead title="Changes" action={<><Chip href="/feed.xml">Feed</Chip><Chip href="/export/changes.csv">CSV</Chip></>}>
        Everything recorded, newest first. Small price wobbles are folded into one line per model per day; every view here is a link you can send.
      </PageHead>
      <Section
        title="Entries"
        hint={stories.length ? `${plural(stories.length, "entry", "entries")} loaded` : undefined}
        action={
          <>
            <Chip active={!kind} to={withParam(params, "kind", "")}>All</Chip>
            {Object.entries(KIND_GROUPS).map(([key, g]) => (
              <Chip key={key} active={kind === key} to={withParam(params, "kind", key)}>{g.label}</Chip>
            ))}
            <Chip active={confirmedOnly} to={withParam(params, "confirmed", confirmedOnly ? "" : "1")} title="Only moves another price list also recorded">Confirmed</Chip>
            {watchlist.length ? <Chip active={watchOnly} to={withParam(params, "watch", watchOnly ? "" : "1")}>Watching {watchlist.length}</Chip> : null}
            <Select value={provider} onChange={(v) => navigate(withParam(params, "provider", v))} label="Filter by provider">
              <option value="">Every provider</option>
              {providers.map((p) => <option key={p} value={p}>{providerName(p)}</option>)}
            </Select>
          </>
        }
      >
        {loading ? (
          <Skeleton rows={8} />
        ) : stories.length === 0 ? (
          <Empty>{more ? "Nothing matches in what is loaded. Load older, or loosen the filters." : "Nothing matches. Loosen the filters."}</Empty>
        ) : (
          <StoryTable label="Changes">
            {[...byDay.entries()].map(([day, list]) => (
              <>
                <DayRow key={`day-${day}`}>{dayLabel(day)} <span class="soft" style={{ fontWeight: 400 }}>· {plural(list.length, "entry", "entries")}</span></DayRow>
                {list.map((s) => <StoryRow key={s.key} story={s} href={storyHref(s, keys)} showMore />)}
              </>
            ))}
          </StoryTable>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 12 }}>
          <span class="small soft">{loading ? "" : data.from ? `Loaded back to ${dayLabel(data.from).toLowerCase()}.` : "Loaded back to the start of the record."}</span>
          <span class="chips">
            {pages > 1 ? <Chip to={withParam(params, "page", String(pages - 1))}>Fewer</Chip> : null}
            {loading ? null : more && pages < MAX_PAGES ? (
              <Chip onClick={() => navigate(withParam(params, "page", String(pages + 1)))} active>Load older</Chip>
            ) : more ? (
              <span class="small soft">That is as far back as this page loads; each model's page keeps its full history</span>
            ) : (
              <span class="small soft">That is the whole record</span>
            )}
          </span>
        </div>
      </Section>
    </div>
  );
}
