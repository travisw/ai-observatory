/**
 * Every change recorded, with the filters in the URL so every view is a link someone can send.
 */
import { useMemo } from "preact/hooks";
import { useNavigate, useQuery } from "@spacefast/zero/client";

import { providerName } from "../../shared/providers";
import type { Story } from "../../shared/stories";
import type { ArchiveEvent, HostEvent, LifecycleEvent, ModelRow, Page, SourceEventRow } from "../../shared/types";
import { Chip, DayRow, Empty, PageHead, Section, Select, Skeleton, StoryRow, StoryTable } from "../components/Wire";
import { KIND_GROUPS, assembleStories, keyIndex, kindInGroup, nameIndex, storyHref } from "../lib/stories";
import { dayLabel, plural, usePageTitle, useSearchParams } from "../lib/util";
import { matchesWatch, useWatchlist } from "../lib/watch";

function withParam(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  if (key !== "page") next.delete("page");
  const s = next.toString();
  return `/changes${s ? `?${s}` : ""}`;
}

/** Each loaded page is its own live subscription keyed by cursor; page N needs page N-1's cursor. */
function usePages(provider: string, pages: number): { events: ArchiveEvent[]; last: Page<ArchiveEvent> | null; loaded: number } {
  const cursors: (string | null)[] = [null];
  const results: Page<ArchiveEvent>[] = [];
  for (let i = 0; i < pages; i++) {
    const cursor = cursors[i];
    if (cursor === undefined) break;
    // Hooks run in a stable order because `pages` only changes with the URL.
    const result = provider ? useQuery<Page<ArchiveEvent>>("eventsByProvider", provider, cursor) : useQuery<Page<ArchiveEvent>>("eventsPage", cursor);
    const page = Array.isArray(result) ? null : result;
    if (!page) break;
    results.push(page);
    if (page.isDone || !page.continueCursor) break;
    cursors.push(page.continueCursor);
  }
  return { events: results.flatMap((p) => p.page), last: results[results.length - 1] ?? null, loaded: results.length };
}

export function ChangesPage() {
  usePageTitle("Changes");
  const params = useSearchParams();
  const navigate = useNavigate();
  const kind = params.get("kind") ?? "";
  const provider = params.get("provider") ?? "";
  const confirmedOnly = params.get("confirmed") === "1";
  const watchOnly = params.get("watch") === "1";
  const pages = Math.max(1, Math.min(20, Number(params.get("page") ?? "1") || 1));

  const models = useQuery<ModelRow[]>("activeModels");
  const { events, last, loaded } = usePages(provider, pages);
  const hostEvents = useQuery<HostEvent[]>("recentHostEvents");
  const lifecycleEvents = useQuery<LifecycleEvent[]>("recentLifecycleEvents");
  const sourceEvents = useQuery<SourceEventRow[]>("recentSourceEvents");
  const [watchlist] = useWatchlist();

  const all = models ?? [];
  const names = useMemo(() => nameIndex(all), [all]);
  const keys = useMemo(() => keyIndex(all), [all]);
  const providers = useMemo(() => [...new Set((models ?? []).map((m) => m.provider.replace(/^~/, "")))].sort((a, b) => providerName(a).localeCompare(providerName(b))), [models]);

  const oldest = events.length ? events[events.length - 1].at : "";
  const stories = useMemo(() => {
    const pile = assembleStories({
      events,
      sourceEvents: (sourceEvents ?? []).filter((e) => !oldest || e.at >= oldest),
      hostEvents: (hostEvents ?? []).filter((e) => !oldest || e.at >= oldest),
      lifecycleEvents: (lifecycleEvents ?? []).filter((e) => !oldest || e.at >= oldest),
      names,
    });
    return pile.filter((s) => {
      if (kind && !kindInGroup(s.kind, kind)) return false;
      if (provider && s.provider.replace(/^~/, "") !== provider && !(s.source === "hosts" && s.modelId.startsWith(`${provider}/`))) return false;
      if (confirmedOnly && !s.confirmedBy?.length) return false;
      if (watchOnly && !matchesWatch(s, watchlist)) return false;
      return true;
    });
  }, [events, sourceEvents, hostEvents, lifecycleEvents, names, kind, provider, confirmedOnly, watchOnly, watchlist, oldest]);

  const byDay = new Map<string, Story[]>();
  for (const s of stories) {
    const key = s.at.slice(0, 10);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  const loading = events.length === 0 && loaded === 0;

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
          <Empty>{last && !last.isDone ? "Nothing matches in what is loaded. Load older, or loosen the filters." : "Nothing matches. Loosen the filters."}</Empty>
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
          <span class="small soft">{oldest ? `Loaded back to ${dayLabel(oldest)}.` : ""}</span>
          <span class="chips">
            {pages > 1 ? <Chip to={withParam(params, "page", String(pages - 1))}>Fewer</Chip> : null}
            {last && !last.isDone ? (
              <Chip onClick={() => navigate(withParam(params, "page", String(pages + 1)))} active>Load older</Chip>
            ) : (
              <span class="small soft">That is the whole record</span>
            )}
          </span>
        </div>
      </Section>
    </div>
  );
}
