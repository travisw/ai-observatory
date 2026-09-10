/**
 * Shared, dependency-free helpers. `shared/` may import nothing but its own files.
 */

export type TrackedModel = {
  modelId: string;
  provider: string;
  name: string;
  contextLength: string;
  maxCompletion: string;
  promptPrice: string;
  completionPrice: string;
  cacheReadPrice: string;
  cacheWritePrice: string;
  modality: string;
  tokenizer: string;
  supportedParams: string;
  moderated: boolean;
};

/** Fields we diff between polls. Order is fixed so the fingerprint is stable. */
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
  return parts.join("");
}

/** Price per million tokens, which is how everyone actually quotes it. */
export function perMillion(rawPerToken: string): string {
  if (!rawPerToken) return "";
  const value = Number(rawPerToken);
  if (!Number.isFinite(value) || value === 0) return "0";
  const scaled = value * 1_000_000;
  return scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(scaled >= 1 ? 2 : 3);
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
  return `${label} changed`;
}
