/**
 * Turns archive rows into stories.
 *
 * The archive stores one row per changed field, which is the right shape for a queryable
 * history and the wrong shape for a reader: a repricing is four rows. A story is everything
 * that happened to one model in one sweep, with a headline, a score for how much it matters,
 * and the rows underneath for anyone who wants them.
 */
import { contextPair, formatContext, money } from "./model";
import { isAlias, modelName, providerName } from "./providers";

export type ArchiveEvent = {
  id: string;
  at: string;
  kind: string;
  modelId: string;
  provider: string;
  field: string;
  oldValue: string;
  newValue: string;
  /** Absent for the OpenRouter archive; set for rows from another catalogue. */
  source?: string;
};

export type StoryKind =
  | "listed"
  | "delisted"
  | "relisted"
  | "repriced"
  | "resized"
  | "renamed"
  | "capabilities"
  | "drift"
  | "other";

export type Story = {
  key: string;
  at: string;
  modelId: string;
  provider: string;
  kind: StoryKind;
  headline: string;
  /** The one or two numbers a reader wants: input and output price, or context. */
  detail: string;
  /** Everything else that moved in the same sweep, for the model page. */
  more: string[];
  score: number;
  events: ArchiveEvent[];
  /** Set when several drift stories were folded into one. */
  folded?: number;
  source?: string;
  /** Other catalogues that recorded the same move within a week. */
  confirmedBy?: string[];
};

/** Below this, a price move is exchange-rate wobble or rounding, not a decision anyone made. */
export const DRIFT_THRESHOLD_PCT = 3;

/** A price that comes back to within this of where it started, within a day, was a flap, not a change. */
const FLAP_TOLERANCE_PCT = 5;

const PRICE_FIELDS = ["promptPrice", "completionPrice", "cacheReadPrice", "cacheWritePrice"] as const;
const PRICE_LABEL: Record<string, string> = {
  promptPrice: "input",
  completionPrice: "output",
  cacheReadPrice: "cache read",
  cacheWritePrice: "cache write",
};
const SIZE_LABEL: Record<string, string> = {
  contextLength: "context",
  maxCompletion: "max output",
};

function pct(oldValue: string, newValue: string): number {
  const before = Number(oldValue);
  const after = Number(newValue);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return after === 0 ? 0 : 100;
  return ((after - before) / before) * 100;
}

function fmtPct(value: number): string {
  const abs = Math.abs(value);
  return abs >= 10 ? `${Math.round(abs)}%` : `${abs.toFixed(1)}%`;
}

function priceMove(e: ArchiveEvent): string {
  const label = PRICE_LABEL[e.field];
  if (!e.oldValue) return `${label} now ${money(e.newValue)}`;
  if (!e.newValue) return `${label} price removed (was ${money(e.oldValue)})`;
  return `${label} ${money(e.oldValue)} → ${money(e.newValue)}`;
}

/** "gained tools, reasoning · lost seed" for a comma-list field. */
function listDiff(oldValue: string, newValue: string): string {
  const before = new Set(oldValue.split(",").filter(Boolean));
  const after = new Set(newValue.split(",").filter(Boolean));
  const gained = [...after].filter((x) => !before.has(x));
  const lost = [...before].filter((x) => !after.has(x));
  const parts: string[] = [];
  if (gained.length) parts.push(`gained ${gained.join(", ")}`);
  if (lost.length) parts.push(`lost ${lost.join(", ")}`);
  return parts.join(" · ");
}

function buildStory(events: ArchiveEvent[], names: Map<string, string>): Story {
  const first = events[0];
  const provider = providerName(first.provider);
  const model = modelName(first.modelId, names.get(first.modelId));
  const base = {
    key: `${first.source ?? ""}|${first.modelId}|${first.at}`,
    at: first.at,
    modelId: first.modelId,
    provider: first.provider,
    events,
    ...(first.source ? { source: first.source } : {}),
  };

  const lifecycle = events.find((e) => e.kind !== "changed");
  if (lifecycle) {
    if (lifecycle.kind === "added") {
      return { ...base, kind: "listed", score: 70, headline: `${provider} listed a new model: ${model}`, detail: "", more: [] };
    }
    if (lifecycle.kind === "removed") {
      return { ...base, kind: "delisted", score: 80, headline: `${provider} removed ${model}`, detail: "no longer available", more: [] };
    }
    return { ...base, kind: "relisted", score: 60, headline: `${model} is back`, detail: `${provider} relisted it`, more: [] };
  }

  const fieldOrder = (e: ArchiveEvent) => PRICE_FIELDS.indexOf(e.field as (typeof PRICE_FIELDS)[number]);
  const prices = events.filter((e) => fieldOrder(e) !== -1).sort((a, b) => fieldOrder(a) - fieldOrder(b));
  const sizes = events.filter((e) => e.field in SIZE_LABEL).sort((a, b) => (a.field === b.field ? 0 : a.field === "contextLength" ? -1 : 1));
  const renamed = events.find((e) => e.field === "name");
  const params = events.find((e) => e.field === "supportedParams");
  const rest = events.filter((e) => !prices.includes(e) && !sizes.includes(e) && e !== renamed && e !== params);

  const details: string[] = [];
  const more: string[] = [];
  let kind: StoryKind = "other";
  let score = 10;
  let headline = "";

  if (prices.length) {
    const lead = prices.find((e) => e.field === "promptPrice") ?? prices.find((e) => e.field === "completionPrice") ?? prices[0];
    const quoted = prices.filter((e) => e.field === "promptPrice" || e.field === "completionPrice");
    const moves = quoted.length ? quoted.map((e) => pct(e.oldValue, e.newValue)) : prices.map((e) => pct(e.oldValue, e.newValue));
    const biggest = Math.max(...moves.map(Math.abs));
    const allDown = moves.every((m) => m <= 0);
    const allUp = moves.every((m) => m >= 0);
    for (const e of prices) (quoted.includes(e) ? details : more).push(priceMove(e));
    if (biggest < DRIFT_THRESHOLD_PCT) {
      kind = "drift";
      score = 5;
      headline = `${model} price moved ${fmtPct(pct(lead.oldValue, lead.newValue))}`;
    } else {
      kind = "repriced";
      // A move in the quoted prices is news; a cache-only move is a footnote.
      score = quoted.length ? 40 + Math.min(50, biggest) : 20 + Math.min(20, biggest / 4);
      // Input and output are what people quote. Name both when they moved differently.
      const named = prices
        .filter((e) => e.field === "promptPrice" || e.field === "completionPrice")
        .map((e) => ({ label: PRICE_LABEL[e.field], move: pct(e.oldValue, e.newValue) }))
        .filter((n) => Math.abs(n.move) >= DRIFT_THRESHOLD_PCT);
      if (named.length === 0) named.push({ label: PRICE_LABEL[lead.field], move: pct(lead.oldValue, lead.newValue) });
      const signed = (m: number) => `${m < 0 ? "−" : "+"}${fmtPct(m)}`;
      if (!allDown && !allUp) {
        headline = `${provider} repriced ${model}: ${named.map((n) => `${n.label} ${signed(n.move)}`).join(", ")}`;
      } else {
        const verb = allDown ? "cut" : "raised";
        const spread = named.length > 1 ? Math.abs(named[0].move - named[1].move) : 0;
        if (named.length > 1 && spread >= 2) {
          headline = `${provider} ${verb} ${model} prices: ${named.map((n) => `${n.label} ${fmtPct(n.move)}`).join(", ")}`;
        } else {
          const which = named.length > 1 ? "prices" : `${PRICE_LABEL[lead.field]} price`;
          headline = `${provider} ${verb} ${model} ${which} ${fmtPct(named[0]?.move ?? pct(lead.oldValue, lead.newValue))}`;
        }
      }
    }
  }

  if (sizes.length) {
    const context = sizes.find((e) => e.field === "contextLength");
    const lead = context ?? sizes[0];
    const move = pct(lead.oldValue, lead.newValue);
    // Context is a headline number; max output only matters when nothing else moved.
    const sizeScore = context ? 30 + Math.min(40, Math.abs(move) / 2) : 12;
    for (const e of sizes) (e.field === "contextLength" ? details : more).push(`${SIZE_LABEL[e.field]} ${contextPair(e.oldValue, e.newValue)}`);
    if (sizeScore > score) {
      kind = "resized";
      score = sizeScore;
      headline = `${provider} ${move > 0 ? "raised" : "lowered"} ${model} ${SIZE_LABEL[lead.field]} to ${formatContext(lead.newValue)}`;
    }
  }

  if (renamed) {
    more.push(`renamed from "${renamed.oldValue}"`);
    if (score < 20) {
      kind = "renamed";
      score = 20;
      headline = `${provider} renamed ${modelName(first.modelId, renamed.oldValue)} to ${modelName(first.modelId, renamed.newValue)}`;
    }
  }

  if (params) {
    const diff = listDiff(params.oldValue, params.newValue);
    more.push(`parameters: ${diff || "reordered"}`);
    if (score < 15) {
      kind = "capabilities";
      score = 15;
      headline = `${model} ${diff || "changed parameters"}`;
    }
  }

  for (const e of rest) more.push(`${e.field} changed`);
  if (!headline) headline = `${provider} changed ${model}`;

  return { ...base, kind, score, headline, detail: details.join(" · "), more };
}

/**
 * Drops a rolling alias's story when the model it points at tells the same story in the same
 * sweep. "DeepSeek Flash Latest" repricing is not news if "DeepSeek V4.1 Flash" repriced
 * identically; it is the same change seen twice. An alias moving on its own is kept, since that
 * usually means it was repointed.
 */
export function foldAliases(stories: Story[]): Story[] {
  // Matched on the shape of the move, not the exact cents: an alias is often routed a little
  // differently from the model it names, so the same 56% cut lands at slightly different prices.
  const signature = (s: Story) =>
    `${s.provider.replace(/^~/, "")}|${s.at}|${s.kind}|${s.events
      .filter((e) => e.field === "promptPrice" || e.field === "completionPrice")
      .map((e) => `${e.field}:${Math.round(pct(e.oldValue, e.newValue))}`)
      .sort()
      .join(",")}`;
  const concrete = new Set(stories.filter((s) => !isAlias(s.modelId)).map(signature));
  return stories.filter((s) => !isAlias(s.modelId) || s.kind === "listed" || s.kind === "delisted" || !concrete.has(signature(s)));
}

/**
 * Folds a model's repricings within one calendar day that end up back where they started.
 * A price that goes up 168% and back down 63% two hours later is one flapping price, not two
 * stories, and it should not lead the page.
 */
export function foldFlapping(stories: Story[]): Story[] {
  const WINDOW = 24 * 3600 * 1000;
  const byModel = new Map<string, Story[]>();
  for (const s of stories) {
    if (s.kind !== "repriced" || s.source) continue;
    const list = byModel.get(s.modelId);
    if (list) list.push(s);
    else byModel.set(s.modelId, [s]);
  }
  const replaced = new Map<string, Story>();
  const dropped = new Set<string>();
  const fold = (run: Story[]) => {
    const newest = run[run.length - 1];
    const model = modelName(newest.modelId, undefined);
    replaced.set(newest.key, {
      ...newest,
      kind: "drift",
      score: 8,
      folded: run.length,
      events: run.flatMap((s) => s.events),
      headline: `${model} price flipped ${run.length} times and ended where it started`,
      detail: run.map((s) => s.detail).filter(Boolean).join(", then ").slice(0, 160),
      more: [],
    });
    for (const s of run.slice(0, -1)) dropped.add(s.key);
  };
  for (const group of byModel.values()) {
    const ordered = [...group].sort((a, b) => a.at.localeCompare(b.at));
    // Walk forward; a run closes when the price is back within a few percent of where some
    // earlier story in the last 24 hours started.
    let start = 0;
    for (let i = 1; i < ordered.length; i++) {
      for (let j = start; j < i; j++) {
        if (Date.parse(ordered[i].at) - Date.parse(ordered[j].at) > WINDOW) continue;
        const run = ordered.slice(j, i + 1);
        const net = (field: string) => {
          const moves = run.flatMap((s) => s.events.filter((e) => e.field === field));
          return moves.length ? pct(moves[0].oldValue, moves[moves.length - 1].newValue) : 0;
        };
        if (Math.abs(net("promptPrice")) < FLAP_TOLERANCE_PCT && Math.abs(net("completionPrice")) < FLAP_TOLERANCE_PCT) {
          fold(run);
          start = i + 1;
          break;
        }
      }
    }
  }
  return stories.filter((s) => !dropped.has(s.key)).map((s) => replaced.get(s.key) ?? s);
}

/** Groups rows by model and sweep. Input order does not matter; output is newest first. */
export function groupStories(events: ArchiveEvent[], names: Map<string, string>): Story[] {
  const groups = new Map<string, ArchiveEvent[]>();
  for (const e of events) {
    const key = `${e.source ?? ""}|${e.modelId}|${e.at}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const stories = [...groups.values()].map((g) => buildStory(g, names));
  return stories.sort((a, b) => (a.at === b.at ? b.score - a.score : a.at < b.at ? 1 : -1));
}

/**
 * Folds a model's drift stories within one calendar day into a single line with the net move,
 * so a model priced off an exchange rate does not fill the log with its 48 daily wobbles.
 */
export function foldDrift(stories: Story[]): Story[] {
  const out: Story[] = [];
  const folded = new Map<string, Story>();
  for (const s of stories) {
    if (s.kind !== "drift") {
      out.push(s);
      continue;
    }
    const key = `${s.modelId}|${s.at.slice(0, 10)}`;
    const existing = folded.get(key);
    if (!existing) {
      const copy = { ...s, folded: 1, events: [...s.events] };
      folded.set(key, copy);
      out.push(copy);
      continue;
    }
    existing.folded = (existing.folded ?? 1) + 1;
    existing.events.push(...s.events);
  }
  for (const s of folded.values()) {
    if ((s.folded ?? 1) < 2) continue;
    const lead = s.events.filter((e) => e.field === "promptPrice");
    const oldest = lead[lead.length - 1];
    const newest = lead[0];
    const net = oldest && newest ? pct(oldest.oldValue, newest.newValue) : 0;
    const model = s.headline.replace(/ price drifted.*$/, "");
    s.headline = `${model} price moved ${s.folded} times, net ${net < 0 ? "−" : "+"}${fmtPct(net)}`;
    s.detail = oldest && newest ? `input ${money(oldest.oldValue)} → ${money(newest.newValue)} over the day` : s.detail;
  }
  return out;
}

/**
 * Marks OpenRouter stories that another catalogue also recorded: same model, same kind of
 * change, same direction, within a week either side. A confirmed repricing came from the
 * provider; an unconfirmed one may be OpenRouter's own margin or routing. Matching is by
 * `keyOf`, which maps a story to the canonical cross-source key.
 */
export function corroborate(stories: Story[], keyOf: (s: Story) => string): Story[] {
  const WEEK = 7 * 86_400_000;
  const direction = (s: Story) => {
    const lead = s.events.find((e) => e.field === "promptPrice") ?? s.events.find((e) => e.field === "completionPrice") ?? s.events.find((e) => e.field === "contextLength");
    return lead ? Math.sign(Number(lead.newValue) - Number(lead.oldValue)) : 0;
  };
  const others = new Map<string, Story[]>();
  for (const s of stories) {
    if (!s.source) continue;
    const k = keyOf(s);
    const list = others.get(k);
    if (list) list.push(s);
    else others.set(k, [s]);
  }
  return stories.map((s) => {
    if (s.source || s.kind === "drift") return s;
    const candidates = others.get(keyOf(s)) ?? [];
    const at = Date.parse(s.at);
    const dir = direction(s);
    const confirmedBy = [...new Set(
      candidates
        .filter((o) => o.kind === s.kind && Math.abs(Date.parse(o.at) - at) <= WEEK && (dir === 0 || direction(o) === dir))
        .map((o) => o.source as string)
    )];
    return confirmedBy.length ? { ...s, confirmedBy } : s;
  });
}

/** The stories worth leading with: recent, ranked by how much they matter, drift excluded. */
export function headlines(stories: Story[], now: number, limit = 6): { stories: Story[]; windowHours: number } {
  for (const windowHours of [24, 72, 24 * 7, 24 * 30]) {
    const since = new Date(now - windowHours * 3600 * 1000).toISOString();
    const picked = stories
      .filter((s) => s.kind !== "drift" && s.at >= since)
      .sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : -1))
      .slice(0, limit);
    if (picked.length >= Math.min(3, limit)) return { stories: picked, windowHours };
  }
  const fallback = stories.filter((s) => s.kind !== "drift").sort((a, b) => b.score - a.score).slice(0, limit);
  return { stories: fallback, windowHours: 0 };
}

/** Counts by kind since a moment, for the "this week" line. */
export function tally(stories: Story[], since: string): Record<StoryKind, number> {
  const counts: Record<StoryKind, number> = {
    listed: 0, delisted: 0, relisted: 0, repriced: 0, resized: 0, renamed: 0, capabilities: 0, drift: 0, other: 0,
  };
  for (const s of stories) if (s.at >= since) counts[s.kind] += s.folded ?? 1;
  return counts;
}
