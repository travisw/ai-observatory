/**
 * The full record with filters in the URL, so every view is a link someone can send.
 */
import { useMemo } from "preact/hooks";
import { Link, useNavigate, useQuery } from "@spacefast/zero/client";
import { Button, EmptyState, Select, Skeleton } from "@spacefast/zero/kit";

import { providerName } from "../../shared/providers";
import type { Story } from "../../shared/stories";
import type { ArchiveEvent, HostEvent, LifecycleEvent, ModelRow, Page, SourceEventRow } from "../../shared/types";
import { Card, Chip, Section } from "../components/bits";
import { StoryRow } from "../components/StoryRow";
import { KIND_GROUPS, assembleStories, keyIndex, kindInGroup, nameIndex } from "../lib/stories";
import { storyHref } from "../lib/stories";
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
  const retired = useQuery<ModelRow[]>("retiredModels");
  const { events, last, loaded } = usePages(provider, pages);
  const hostEvents = useQuery<HostEvent[]>("recentHostEvents");
  const lifecycleEvents = useQuery<LifecycleEvent[]>("recentLifecycleEvents");
  const sourceEvents = useQuery<SourceEventRow[]>("recentSourceEvents");
  const [watchlist] = useWatchlist();

  const all = useMemo(() => [...(models ?? []), ...(retired ?? [])], [models, retired]);
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
    <div class="flex flex-col gap-6">
      <Section title="Changes" hint={stories.length ? `${plural(stories.length, "change")} loaded` : undefined}>
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex flex-wrap gap-1.5">
            <Chip active={!kind} href={withParam(params, "kind", "")}>All</Chip>
            {Object.entries(KIND_GROUPS).map(([key, g]) => (
              <Chip key={key} active={kind === key} href={withParam(params, "kind", key)}>{g.label}</Chip>
            ))}
            <Chip active={confirmedOnly} href={withParam(params, "confirmed", confirmedOnly ? "" : "1")} title="Only moves another price list also recorded">Confirmed only</Chip>
            {watchlist.length ? <Chip active={watchOnly} href={withParam(params, "watch", watchOnly ? "" : "1")}>Watching ({watchlist.length})</Chip> : null}
          </div>
          <label class="ml-auto flex items-center gap-2 text-xs text-ink-muted">
            Provider
            <Select value={provider} onChange={(e) => navigate(withParam(params, "provider", (e.currentTarget as HTMLSelectElement).value))} aria-label="Filter by provider">
              <option value="">all</option>
              {providers.map((p) => <option key={p} value={p}>{providerName(p)}</option>)}
            </Select>
          </label>
        </div>
        <Card padded={false} class="px-4">
          {loading ? (
            <div class="flex flex-col gap-3 py-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} class="h-8 w-full" />)}</div>
          ) : stories.length === 0 ? (
            <EmptyState title="Nothing matches" description={last && !last.isDone ? "Try loading older changes, or loosen the filters." : "Loosen the filters."} action={last && !last.isDone ? <Button variant="outline" size="sm" onClick={() => navigate(withParam(params, "page", String(pages + 1)))}>Load older</Button> : undefined} />
          ) : (
            [...byDay.entries()].map(([day, list]) => (
              <div key={day}>
                <h3 class="sticky top-0 z-10 -mx-4 border-b border-line bg-surface/95 px-4 py-1.5 text-xs font-medium text-ink-muted backdrop-blur">
                  {dayLabel(day)} <span class="font-normal">· {plural(list.length, "change")}</span>
                </h3>
                <ul>
                  {list.map((s) => <StoryRow key={s.key} story={s} href={storyHref(s, keys)} compact showMore />)}
                </ul>
              </div>
            ))
          )}
        </Card>
        <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
          <span>
            {oldest ? `Loaded back to ${dayLabel(oldest)}.` : ""} Small price wobbles are folded into one line per model per day.
          </span>
          <span class="flex gap-2">
            {pages > 1 ? <Link to={withParam(params, "page", String(pages - 1))} class="text-accent hover:underline">fewer</Link> : null}
            {last && !last.isDone ? (
              <Button variant="outline" size="sm" onClick={() => navigate(withParam(params, "page", String(pages + 1)))}>Load older</Button>
            ) : (
              <span>That is the whole record.</span>
            )}
          </span>
        </div>
      </Section>
    </div>
  );
}
