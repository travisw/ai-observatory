/**
 * The watchlist: model ids, provider slugs and free-text terms the reader cares about, kept in
 * this browser only. Free text is still accepted so the old comma-separated filter carries over.
 */
import { useEffect, useState } from "preact/hooks";

import { providerName } from "../../shared/providers";
import type { Story } from "../../shared/stories";
import { readStorage, writeStorage } from "./util";

const KEY = "observatory.watchlist";
const LEGACY_KEY = "observatory.watch";
const EVENT = "observatory:watchlist";

function load(): string[] {
  const list = readStorage<string[]>(KEY, []);
  if (list.length) return list;
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const terms = legacy.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      writeStorage(KEY, terms);
      localStorage.removeItem(LEGACY_KEY);
      return terms;
    }
  } catch {
    // No storage: start empty.
  }
  return [];
}

function save(list: string[]) {
  writeStorage(KEY, list);
  window.dispatchEvent(new Event(EVENT));
}

export function useWatchlist(): [string[], (entry: string) => void, (entry: string) => void, (list: string[]) => void] {
  const [list, setList] = useState<string[]>(load);
  useEffect(() => {
    const sync = () => setList(load());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const add = (entry: string) => {
    const next = [...new Set([...load(), entry])];
    save(next);
    setList(next);
  };
  const remove = (entry: string) => {
    const next = load().filter((e) => e !== entry);
    save(next);
    setList(next);
  };
  const replace = (next: string[]) => {
    save(next);
    setList(next);
  };
  return [list, add, remove, replace];
}

/** A model id or provider slug matches exactly; anything else is a substring term. */
export function matchesWatch(story: Pick<Story, "modelId" | "provider" | "headline">, list: string[]): boolean {
  if (list.length === 0) return true;
  const provider = story.provider.replace(/^~/, "").toLowerCase();
  const hay = `${story.modelId} ${providerName(story.provider)} ${story.headline}`.toLowerCase();
  return list.some((entry) => {
    const e = entry.toLowerCase();
    if (e === story.modelId.toLowerCase() || e === provider) return true;
    if (e.includes("/")) return false;
    return hay.includes(e);
  });
}

export function matchesWatchModel(model: { modelId: string; provider: string; name: string }, list: string[]): boolean {
  return matchesWatch({ modelId: model.modelId, provider: model.provider, headline: model.name }, list);
}
