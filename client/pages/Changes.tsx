/**
 * The full log with filters in the URL, so every view is a link someone can send.
 */
import { useMemo } from "preact/hooks";
import { useNavigate, useQuery } from "@spacefast/zero/client";

import { providerName } from "../../shared/providers";
import type { Story } from "../../shared/stories";
import type { ArchiveEvent, HostEvent, LifecycleEvent, ModelRow, Page, SourceEventRow } from "../../shared/types";
import { Sign } from "../components/Flap";
import { BoardEmpty, BoardSkeleton, LogDay, LogSection, Marquee, SignSelect, Stencil, StoryLine } from "../components/Log";
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
  usePageTitle("The log");
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
    <div class="flex flex-col gap-8">
      <Marquee title="The log" action={<><Sign href="/feed.xml">RSS</Sign><Sign href="/export/changes.csv">CSV</Sign></>}>
        Everything recorded, newest first. Small price wobbles are folded into one line per model per day; every view here is a link you can send.
      </Marquee>
      <LogSection
        title="Entries"
        hint={stories.length ? `${plural(stories.length, "entry", "entries")} loaded` : undefined}
        action={
          <>
            <Stencil active={!kind} href={withParam(params, "kind", "")}>All</Stencil>
            {Object.entries(KIND_GROUPS).map(([key, g]) => (
              <Stencil key={key} active={kind === key} href={withParam(params, "kind", key)}>{g.label}</Stencil>
            ))}
            <Stencil active={confirmedOnly} href={withParam(params, "confirmed", confirmedOnly ? "" : "1")} title="Only moves another price list also recorded">Confirmed</Stencil>
            {watchlist.length ? <Stencil active={watchOnly} href={withParam(params, "watch", watchOnly ? "" : "1")}>Watching {watchlist.length}</Stencil> : null}
            <SignSelect value={provider} onChange={(v) => navigate(withParam(params, "provider", v))} label="Filter by provider">
              <option value="">Every provider</option>
              {providers.map((p) => <option key={p} value={p}>{providerName(p)}</option>)}
            </SignSelect>
          </>
        }
      >
        {loading ? (
          <BoardSkeleton rows={8} size="sm" />
        ) : stories.length === 0 ? (
          <BoardEmpty>{last && !last.isDone ? "Nothing matches in what is loaded. Load older, or loosen the filters." : "Nothing matches. Loosen the filters."}</BoardEmpty>
        ) : (
          [...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <LogDay>{dayLabel(day)} <span class="font-normal text-ink-muted">· {plural(list.length, "entry", "entries")}</span></LogDay>
              <ul>{list.map((s) => <StoryLine key={s.key} story={s} href={storyHref(s, keys)} showMore />)}</ul>
            </div>
          ))
        )}
        <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
          <span class="text-xs text-ink-muted">{oldest ? `Loaded back to ${dayLabel(oldest)}.` : ""}</span>
          <span class="flex gap-1.5">
            {pages > 1 ? <Sign to={withParam(params, "page", String(pages - 1))}>Fewer</Sign> : null}
            {last && !last.isDone ? (
              <Sign onClick={() => navigate(withParam(params, "page", String(pages + 1)))} active>Load older</Sign>
            ) : (
              <span class="text-[11px] uppercase tracking-[0.2em] text-ink-muted">That is the whole record</span>
            )}
          </span>
        </div>
      </LogSection>
    </div>
  );
}
