/**
 * Shared, dependency-free helpers. `shared/` may import nothing but its own files.
 */

export type TrackedModel = {
  modelId: string;
  provider: string;
  name: string;
  description: string;
  canonicalSlug: string;
  huggingFaceId: string;
  knowledgeCutoff: string;
  expirationDate: string;
  aliasTarget: string;
  contextLength: string;
  maxCompletion: string;
  promptPrice: string;
  completionPrice: string;
  cacheReadPrice: string;
  cacheWritePrice: string;
  tiers: string;
  modality: string;
  inputModalities: string;
  tokenizer: string;
  supportedParams: string;
  reasoning: string;
  moderated: boolean;
  aaIntelligence: string;
  aaCoding: string;
  aaAgentic: string;
};

/**
 * Fields we diff between polls. Order is fixed so the fingerprint is stable. Benchmarks and the
 * description are stored but not diffed: they move for reasons that are not the provider's decision.
 */
export const TRACKED_FIELDS = [
  "name",
  "contextLength",
  "maxCompletion",
  "promptPrice",
  "completionPrice",
  "cacheReadPrice",
  "cacheWritePrice",
  "modality",
  "tokenizer",
  "supportedParams",
  "aliasTarget",
  "expirationDate",
  "tiers",
  "knowledgeCutoff",
  "inputModalities",
  "reasoning",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/** Human labels for the console. */
export const FIELD_LABELS: Record<string, string> = {
  name: "display name",
  contextLength: "context window",
  maxCompletion: "max output",
  promptPrice: "input price",
  completionPrice: "output price",
  cacheReadPrice: "cache read price",
  cacheWritePrice: "cache write price",
  modality: "modality",
  tokenizer: "tokenizer",
  supportedParams: "parameters",
  moderated: "moderation",
  aliasTarget: "alias target",
  expirationDate: "listing expiry",
  tiers: "long-context pricing",
  knowledgeCutoff: "knowledge cutoff",
  inputModalities: "inputs",
  reasoning: "reasoning",
  quantization: "quantization",
};

/**
 * Zero has no number type yet, so every numeric arrives and is stored as a string.
 * Normalizing here keeps "0.000010" and "0.00001" from reading as a price change.
 */
export function normalizeNumeric(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return String(value);
  return String(asNumber);
}

export function providerOf(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(0, slash);
}

/** Cheap stable fingerprint so an unchanged model costs one comparison, not ten. */
export function fingerprintOf(model: TrackedModel): string {
  const parts = TRACKED_FIELDS.map((field) => String(model[field] ?? ""));
  parts.push(model.moderated ? "1" : "0");
  return parts.join("\u001f");
}

/** Price per million tokens, which is how everyone actually quotes it. */
export function perMillion(rawPerToken: string): string {
  if (!rawPerToken) return "";
  const value = Number(rawPerToken);
  if (!Number.isFinite(value) || value === 0) return "0";
  const scaled = value * 1_000_000;
  return scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(scaled >= 1 ? 2 : 3);
}

/** "$0.42", "$1.34", "$13", "$0.004": per-million price the way a pricing page writes it. */
export function money(rawPerToken: string): string {
  if (!rawPerToken) return "";
  const value = Number(rawPerToken) * 1_000_000;
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "$0";
  let text = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value >= 1 ? value.toFixed(2) : value.toFixed(3);
  while (text.includes(".") && text.endsWith("0") && text.split(".")[1].length > 2) text = text.slice(0, -1);
  if (text.endsWith(".0")) text = text.slice(0, -2);
  return `$${text}`;
}

/** Token counts for a before/after pair, with enough precision that a real change never reads as "944K → 944K". */
export function contextPair(oldValue: string, newValue: string): string {
  const a = formatContext(oldValue);
  const b = formatContext(newValue);
  if (a !== b) return `${a} → ${b}`;
  return `${Number(oldValue).toLocaleString()} → ${Number(newValue).toLocaleString()}`;
}

export function formatContext(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

/** "2026-09-09T14:03:00.000Z" to "09-09 14:03". */
export function shortTime(iso: string): string {
  if (!iso || iso.length < 16) return iso || "";
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

/** "2026-09-09T14:03:00.000Z" to "9 Sep 2026". */
export function longDate(iso: string): string {
  if (!iso || iso.length < 10) return iso || "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Whole days between two ISO stamps (either order), rounded down. */
export function daysBetween(a: string, b: string): number {
  const x = Date.parse(a.length === 10 ? `${a}T00:00:00Z` : a);
  const y = Date.parse(b.length === 10 ? `${b}T00:00:00Z` : b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.floor(Math.abs(y - x) / 86_400_000);
}

export type PriceTier = { minPromptTokens: number; prompt: string; completion: string };

/** "200000:0.0000025:0.000015;..." to structured tiers. */
export function parseTiers(raw: string): PriceTier[] {
  if (!raw) return [];
  return raw
    .split(";")
    .filter(Boolean)
    .map((part) => {
      const [min, prompt, completion] = part.split(":");
      return { minPromptTokens: Number(min), prompt: prompt ?? "", completion: completion ?? "" };
    })
    .filter((t) => Number.isFinite(t.minPromptTokens));
}

/** Blended price per million the way indexes quote it: three input tokens for every output token. */
export function blendedPerMillion(promptPrice: string, completionPrice: string): number {
  const input = Number(promptPrice) * 1_000_000;
  const output = Number(completionPrice) * 1_000_000;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return NaN;
  return (3 * input + output) / 4;
}

export function median(values: number[]): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function describeEvent(kind: string, field: string, oldValue: string, newValue: string): string {
  const label = FIELD_LABELS[field] ?? field;
  if (kind === "added") return "appeared";
  if (kind === "removed") return "disappeared";
  if (kind === "returned") return "came back";
  if (field === "promptPrice" || field === "completionPrice" || field.startsWith("cache")) {
    const before = perMillion(oldValue);
    const after = perMillion(newValue);
    const direction = Number(newValue) > Number(oldValue) ? "up" : "down";
    return `${label} ${direction} $${before} to $${after} /M`;
  }
  if (field === "contextLength" || field === "maxCompletion") {
    return `${label} ${formatContext(oldValue)} to ${formatContext(newValue)}`;
  }
  if (field === "aliasTarget") return newValue ? `now points at ${newValue}` : "alias target removed";
  if (field === "expirationDate") return newValue ? `listing expires ${newValue}` : "listing expiry removed";
  return `${label} changed`;
}
