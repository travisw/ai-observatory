/**
 * Turns archive rows into stories.
 *
 * The archive stores one row per changed field, which is the right shape for a queryable
 * history and the wrong shape for a reader: a repricing is four rows. A story is everything
 * that happened to one model in one sweep, with a headline, a score for how much it matters,
 * and the rows underneath for anyone who wants them.
 */
import { contextPair, formatContext, longDate, money } from "./model";
import { isAlias, modelName, providerName } from "./providers";
import type { ArchiveEvent, HostEvent, LifecycleEvent } from "./types";

export type { ArchiveEvent } from "./types";

export type StoryKind =
  | "listed"
  | "delisted"
  | "relisted"
  | "repriced"
  | "resized"
  | "renamed"
  | "capabilities"
  | "repointed"
  | "expiring"
  | "retiring"
  | "retired"
  | "hosted"
  | "unhosted"
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
  /** Absent for the OpenRouter archive; "hosts" for host events; a lifecycle source otherwise. */
  source?: string;
  /** The hosting provider a host story is about. */
  host?: string;
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

export function pct(oldValue: string, newValue: string): number {
  const before = Number(oldValue);
  const after = Number(newValue);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return after === 0 ? 0 : 100;
  return ((after - before) / before) * 100;
}

export function fmtPct(value: number): string {
  const abs = Math.abs(value);
  return abs >= 10 ? `${Math.round(abs)}%` : `${abs.toFixed(1)}%`;
}

/** Signed percentage with a real minus sign: "−56%", "+12%". */
export function signedPct(value: number): string {
  return `${value < 0 ? "−" : "+"}${fmtPct(value)}`;
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

/** The slug after the slash, for a target id we may not have a display name for. */
function slugName(modelId: string, names: Map<string, string>): string {
  return modelName(modelId, names.get(modelId));
}

/** The lead number of a price story, as a signed percentage, for delta chips. */
export function storyDelta(story: Story): number | null {
  const lead =
    story.events.find((e) => e.field === "promptPrice") ??
    story.events.find((e) => e.field === "completionPrice") ??
    story.events.find((e) => e.field === "contextLength");
  if (!lead || !lead.oldValue || !lead.newValue) return null;
  return pct(lead.oldValue, lead.newValue);
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
  const repointed = events.find((e) => e.field === "aliasTarget");
  const expiry = events.find((e) => e.field === "expirationDate");
  const tiers = events.find((e) => e.field === "tiers");
  const cutoff = events.find((e) => e.field === "knowledgeCutoff");
  const inputs = events.find((e) => e.field === "inputModalities");
  const reasoning = events.find((e) => e.field === "reasoning");
  const special = new Set<ArchiveEvent | undefined>([renamed, params, repointed, expiry, tiers, cutoff, inputs, reasoning]);
  const rest = events.filter((e) => !prices.includes(e) && !sizes.includes(e) && !special.has(e));

  const details: string[] = [];
  const more: string[] = [];
  let kind: StoryKind = "other";
  let score = 10;
  let headline = "";

  // A negative price means "billed as whatever model answers"; a move into or out of that is a
  // change of pricing model, not a percentage anyone can quote.
  const variable = prices.some((e) => Number(e.oldValue) < 0 || Number(e.newValue) < 0);
  if (variable) {
    const nowVariable = prices.some((e) => Number(e.newValue) < 0);
    for (const e of prices) more.push(priceMove(e));
    kind = "repriced";
    score = 25;
    headline = nowVariable ? `${model} pricing is now variable` : `${provider} gave ${model} a fixed price`;
  } else if (prices.length) {
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
      if (!allDown && !allUp) {
        headline = `${provider} repriced ${model}: ${named.map((n) => `${n.label} ${signedPct(n.move)}`).join(", ")}`;
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

  // An alias moving to a new model is the most dangerous silent change there is: the same id
  // starts answering with a different model. It outranks everything but a removal.
  if (repointed) {
    const target = repointed.newValue ? slugName(repointed.newValue, names) : "";
    more.push(repointed.oldValue ? `previously pointed at ${slugName(repointed.oldValue, names)}` : "alias target first recorded");
    if (score < 78) {
      kind = "repointed";
      score = 78;
      headline = target ? `${model} now points at ${target}` : `${model} lost its target`;
      details.unshift(repointed.oldValue ? `${slugName(repointed.oldValue, names)} → ${target}` : target);
    }
  }

  if (expiry) {
    if (score < 65) {
      kind = "expiring";
      score = 65;
      headline = expiry.newValue
        ? `${provider} will remove ${model} on ${longDate(expiry.newValue)}`
        : `${model} is no longer scheduled for removal`;
      details.unshift(expiry.oldValue && expiry.newValue ? `was ${longDate(expiry.oldValue)}` : "");
    } else {
      more.push(expiry.newValue ? `listing expires ${longDate(expiry.newValue)}` : "listing expiry removed");
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

  if (inputs) {
    const diff = listDiff(inputs.oldValue, inputs.newValue);
    more.push(`inputs: ${diff || "changed"}`);
    if (score < 25) {
      kind = "capabilities";
      score = 25;
      headline = `${model} ${diff ? diff.replace(/gained/, "now accepts").replace(/lost/, "no longer accepts") : "changed inputs"}`;
    }
  }

  if (reasoning) {
    more.push(`reasoning: ${reasoning.oldValue || "none"} → ${reasoning.newValue || "none"}`);
    if (score < 22) {
      kind = "capabilities";
      score = 22;
      headline = reasoning.newValue ? `${model} gained ${reasoning.newValue} reasoning` : `${model} lost reasoning`;
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

  if (tiers) {
    more.push(tiers.newValue ? "long-context pricing changed" : "long-context pricing removed");
    if (score < 18) {
      kind = "repriced";
      score = 18;
      headline = `${provider} changed ${model} long-context pricing`;
    }
  }

  if (cutoff) more.push(`knowledge cutoff ${cutoff.oldValue || "unknown"} → ${cutoff.newValue || "unknown"}`);
  for (const e of rest) more.push(`${e.field} changed`);
  if (!headline) headline = `${provider} changed ${model}`;

  // A rolling alias is routed, not priced: its quoted price follows whichever model it points at
  // today. Its price moves are worth recording but should not outrank a model's own decision.
  if (isAlias(first.modelId) && (kind === "repriced" || kind === "resized")) score = Math.round(score * 0.6);

  return { ...base, kind, score, headline, detail: details.filter(Boolean).join(" · "), more };
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
  return stories.filter(
    (s) => !isAlias(s.modelId) || s.kind === "listed" || s.kind === "delisted" || s.kind === "repointed" || !concrete.has(signature(s))
  );
}

/** This many repricings of one model inside a week is routing churn, not a pricing decision. */
export const VOLATILE_PER_WEEK = 6;

/**
 * Folds a model's repricings into one line when it has been repriced this often within a week.
 * A model whose price moves six times in seven days is being routed between hosts, and each
 * move is noise to a reader; one "volatile" line keeps the fact without the flood.
 */
export function foldVolatile(stories: Story[]): Story[] {
  const WEEK = 7 * 86_400_000;
  const byModel = new Map<string, Story[]>();
  for (const s of stories) {
    if (s.source || (s.kind !== "repriced" && s.kind !== "drift")) continue;
    const list = byModel.get(s.modelId);
    if (list) list.push(s);
    else byModel.set(s.modelId, [s]);
  }
  const dropped = new Set<string>();
  const replaced = new Map<string, Story>();
  for (const group of byModel.values()) {
    const ordered = [...group].sort((a, b) => b.at.localeCompare(a.at));
    let i = 0;
    while (i < ordered.length) {
      const windowEnd = Date.parse(ordered[i].at);
      const run = ordered.filter((s) => windowEnd - Date.parse(s.at) <= WEEK && Date.parse(s.at) <= windowEnd && !dropped.has(s.key));
      const priced = run.filter((s) => s.kind === "repriced");
      if (priced.length < VOLATILE_PER_WEEK) {
        i++;
        continue;
      }
      const inputs = run
        .flatMap((s) => s.events.filter((e) => e.field === "promptPrice"))
        .flatMap((e) => [Number(e.oldValue), Number(e.newValue)])
        .filter((v) => Number.isFinite(v) && v > 0);
      const low = inputs.length ? Math.min(...inputs) : NaN;
      const high = inputs.length ? Math.max(...inputs) : NaN;
      const newest = run[0];
      const model = modelName(newest.modelId, undefined);
      const count = run.reduce((n, s) => n + (s.folded ?? 1), 0);
      replaced.set(newest.key, {
        ...newest,
        kind: "drift",
        score: 6,
        folded: count,
        events: run.flatMap((s) => s.events),
        headline: `${model} price is volatile: ${count} changes in a week`,
        detail: Number.isFinite(low) && Number.isFinite(high) ? `input between ${money(String(low))} and ${money(String(high))}` : "",
        more: [],
      });
      for (const s of run.slice(1)) dropped.add(s.key);
      i += run.length;
    }
  }
  return stories.filter((s) => !dropped.has(s.key)).map((s) => replaced.get(s.key) ?? s);
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
  return sortStories(stories);
}

export function sortStories(stories: Story[]): Story[] {
  return stories.sort((a, b) => (a.at === b.at ? b.score - a.score : a.at < b.at ? 1 : -1));
}

/**
 * Stories about where a model is served from. One per (model, host, sweep). Scored below the
 * model's own stories: a host repricing is a routing fact, a provider repricing is a decision.
 */
export function hostStories(events: HostEvent[], names: Map<string, string>): Story[] {
  const groups = new Map<string, HostEvent[]>();
  for (const e of events) {
    const key = `${e.modelId}|${e.tag}|${e.at}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: Story[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const model = modelName(first.modelId, names.get(first.modelId));
    const asArchive: ArchiveEvent[] = group.map((e) => ({
      id: e.id, at: e.at, kind: e.kind, modelId: e.modelId, provider: first.host, field: e.field,
      oldValue: e.oldValue, newValue: e.newValue, source: "hosts",
    }));
    const base = { key: `hosts|${key}`, at: first.at, modelId: first.modelId, provider: first.modelId.split("/")[0], events: asArchive, source: "hosts", host: first.host, more: [] as string[] };
    const lifecycle = group.find((e) => e.kind !== "changed");
    if (lifecycle) {
      if (lifecycle.kind === "removed") {
        out.push({ ...base, kind: "unhosted", score: 32, headline: `${first.host} stopped serving ${model}`, detail: "" });
      } else {
        out.push({ ...base, kind: "hosted", score: 24, headline: `${model} is now served by ${first.host}`, detail: lifecycle.kind === "returned" ? "back after a gap" : "" });
      }
      continue;
    }
    const prices = group.filter((e) => e.field === "promptPrice" || e.field === "completionPrice");
    const others = group.filter((e) => !prices.includes(e));
    const more = others.map((e) =>
      e.field === "contextLength" || e.field === "maxCompletion"
        ? `${SIZE_LABEL[e.field]} ${contextPair(e.oldValue, e.newValue)}`
        : `${e.field} ${e.oldValue || "none"} → ${e.newValue || "none"}`
    );
    if (prices.length) {
      const moves = prices.map((e) => pct(e.oldValue, e.newValue));
      const biggest = Math.max(...moves.map(Math.abs));
      const lead = prices.find((e) => e.field === "promptPrice") ?? prices[0];
      const leadMove = pct(lead.oldValue, lead.newValue);
      const detail = prices.map((e) => `${PRICE_LABEL[e.field]} ${money(e.oldValue)} → ${money(e.newValue)}`).join(" · ");
      if (biggest < DRIFT_THRESHOLD_PCT) {
        out.push({ ...base, kind: "drift", score: 4, headline: `${first.host} moved ${model} price ${fmtPct(leadMove)}`, detail, more });
      } else {
        const allDown = moves.every((m) => m <= 0);
        const allUp = moves.every((m) => m >= 0);
        const verb = allDown ? "cut" : allUp ? "raised" : "repriced";
        out.push({
          ...base, kind: "repriced", score: 20 + Math.min(25, biggest / 2),
          headline: `${first.host} ${verb} ${model} ${prices.length > 1 ? "prices" : `${PRICE_LABEL[lead.field]} price`}${verb === "repriced" ? "" : ` ${fmtPct(Math.abs(leadMove))}`}`,
          detail, more,
        });
      }
      continue;
    }
    out.push({ ...base, kind: "other", score: 8, headline: `${first.host} changed how it serves ${model}`, detail: more.join(" · "), more: [] });
  }
  return sortStories(out);
}

/** Stories from the providers' own deprecation notices. One per (source, model, sweep). */
export function lifecycleStories(events: LifecycleEvent[]): Story[] {
  const groups = new Map<string, LifecycleEvent[]>();
  for (const e of events) {
    const key = `${e.source}|${e.modelId}|${e.at}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: Story[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const provider = providerName(first.provider);
    const model = first.modelId;
    const asArchive: ArchiveEvent[] = group.map((e) => ({
      id: e.id, at: e.at, kind: e.kind, modelId: e.key, provider: e.provider, field: e.field,
      oldValue: e.oldValue, newValue: e.newValue, source: e.source,
    }));
    const base = { key: `${first.source}|${key}`, at: first.at, modelId: first.key, provider: first.provider, events: asArchive, source: first.source, more: [] as string[] };
    const field = (name: string) => group.find((e) => e.field === name);
    const stateNow = field("state")?.newValue ?? "";
    const retires = field("retiresAt");
    const replacement = field("replacement");
    const added = group.find((e) => e.kind === "added");
    const more: string[] = [];
    if (replacement?.newValue) more.push(`replacement: ${replacement.newValue}`);

    if (added) {
      // A new row on a deprecation page: the newValue of the "added" event carries the state,
      // and the sibling rows carry the dates.
      const state = added.newValue || stateNow;
      const when = retires?.newValue;
      if (state === "retired") {
        out.push({ ...base, kind: "retired", score: 72, headline: `${provider} retired ${model}`, detail: when ? `retired ${longDate(when)}` : "", more });
      } else if (state === "deprecated") {
        out.push({
          ...base, kind: "retiring", score: 85,
          headline: when ? `${provider} will retire ${model} on ${longDate(when)}` : `${provider} deprecated ${model}`,
          detail: when ? `${Math.max(0, Math.round((Date.parse(when) - Date.parse(first.at)) / 86_400_000))} days' notice` : "retirement date to be announced",
          more,
        });
      } else {
        out.push({ ...base, kind: "other", score: 12, headline: `${provider} published a lifecycle entry for ${model}`, detail: when ? `supported until at least ${longDate(when)}` : "", more });
      }
      continue;
    }
    if (group.some((e) => e.kind === "removed")) {
      out.push({ ...base, kind: "other", score: 10, headline: `${model} left ${provider}'s deprecation page`, detail: "", more });
      continue;
    }
    const state = field("state");
    if (state?.newValue === "retired") {
      out.push({ ...base, kind: "retired", score: 72, headline: `${provider} retired ${model}`, detail: retires?.newValue ? `on ${longDate(retires.newValue)}` : "", more });
      continue;
    }
    if (state?.newValue === "deprecated") {
      out.push({
        ...base, kind: "retiring", score: 85,
        headline: retires?.newValue ? `${provider} will retire ${model} on ${longDate(retires.newValue)}` : `${provider} deprecated ${model}`,
        detail: "", more,
      });
      continue;
    }
    if (retires) {
      const moved = retires.oldValue && retires.newValue ? (retires.newValue > retires.oldValue ? "pushed back" : "brought forward") : "set";
      out.push({
        ...base, kind: "retiring", score: 70,
        headline: retires.newValue ? `${provider} ${moved} ${model}'s retirement to ${longDate(retires.newValue)}` : `${provider} dropped the retirement date for ${model}`,
        detail: retires.oldValue ? `was ${longDate(retires.oldValue)}` : "", more,
      });
      continue;
    }
    out.push({ ...base, kind: "other", score: 10, headline: `${provider} updated ${model}'s lifecycle entry`, detail: group.map((e) => `${e.field}: ${e.oldValue || "none"} → ${e.newValue || "none"}`).join(" · "), more });
  }
  return sortStories(out);
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
    const key = `${s.source ?? ""}|${s.host ?? ""}|${s.modelId}|${s.at.slice(0, 10)}`;
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
    const model = s.headline.replace(/ price (moved|drifted).*$/, "");
    s.headline = `${model} price moved ${s.folded} times, net ${signedPct(net)}`;
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
    if (!s.source || s.source === "hosts") continue;
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
    listed: 0, delisted: 0, relisted: 0, repriced: 0, resized: 0, renamed: 0, capabilities: 0,
    repointed: 0, expiring: 0, retiring: 0, retired: 0, hosted: 0, unhosted: 0, drift: 0, other: 0,
  };
  for (const s of stories) if (s.at >= since) counts[s.kind] += s.folded ?? 1;
  return counts;
}

/** Comma-separated watch terms; a story matches if any term appears in its model id, provider or headline. */
export function matchesWatch(story: Story, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = `${story.modelId} ${story.provider} ${providerName(story.provider)} ${story.headline} ${story.host ?? ""}`.toLowerCase();
  return terms.some((t) => hay.includes(t));
}
