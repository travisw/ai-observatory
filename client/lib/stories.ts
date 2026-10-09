/**
 * Assembles stories from every archive the capsule keeps, so each page composes them the same way.
 */
import { canonicalKey } from "../../shared/sources";
import {
  corroborate,
  foldAliases,
  foldDrift,
  foldFlapping,
  foldVolatile,
  groupStories,
  hostStories,
  lifecycleStories,
  sortStories,
  storyDelta,
  type Story,
} from "../../shared/stories";
import type { ArchiveEvent, HostEvent, LifecycleEvent, ModelRow, SourceEventRow } from "../../shared/types";

export { storyDelta };

/** Rows from the other catalogues, in the archive's shape. The canonical key stands in for the model id. */
export function asArchive(rows: SourceEventRow[] | undefined): ArchiveEvent[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    modelId: r.key,
    provider: r.provider,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    source: r.source,
  }));
}

/** The cross-source key of a story: lifecycle and catalogue stories already carry it as their model id. */
export function keyOf(story: Story): string {
  return story.source && story.source !== "hosts" ? story.modelId : canonicalKey(story.provider, story.modelId);
}

export function nameIndex(models: Pick<ModelRow, "modelId" | "name">[] | undefined): Map<string, string> {
  return new Map((models ?? []).map((m) => [m.modelId, m.name]));
}

/** Canonical key → tracked model id, so a story from another source can link to the model page. */
export function keyIndex(models: Pick<ModelRow, "modelId" | "provider">[] | undefined): Map<string, string> {
  return new Map((models ?? []).map((m) => [canonicalKey(m.provider, m.modelId), m.modelId]));
}

/** Where a story links: its model page when we track that model, nowhere otherwise. */
export function storyHref(story: Story, keys: Map<string, string>): string | null {
  if (!story.source || story.source === "hosts") return `/model/${encodeURIComponent(story.modelId).replace(/%2F/g, "/")}`;
  const tracked = keys.get(story.modelId);
  return tracked ? `/model/${encodeURIComponent(tracked).replace(/%2F/g, "/")}` : null;
}

export type StoryInputs = {
  events?: ArchiveEvent[];
  sourceEvents?: SourceEventRow[];
  hostEvents?: HostEvent[];
  lifecycleEvents?: LifecycleEvent[];
  names: Map<string, string>;
};

/** Every story, newest first, with the noise folded and cross-source confirmations marked. */
export function assembleStories(input: StoryInputs): Story[] {
  const archive = [...(input.events ?? []), ...asArchive(input.sourceEvents)];
  // Volatile models (six or more repricings in a week) collapse to one dim line after the flap fold.
  const base = corroborate(foldVolatile(foldFlapping(foldAliases(foldDrift(groupStories(archive, input.names))))), keyOf);
  const hosts = input.hostEvents?.length ? hostStories(input.hostEvents, input.names) : [];
  const lifecycle = input.lifecycleEvents?.length ? lifecycleStories(input.lifecycleEvents) : [];
  return sortStories([...base, ...hosts, ...lifecycle]);
}

/** Whether a delta is good news for a buyer: cheaper prices, bigger context. */
export function deltaIsGood(story: Story, delta: number): boolean {
  const priced = story.events.some((e) => e.field === "promptPrice" || e.field === "completionPrice");
  if (!priced && story.events.some((e) => e.field === "contextLength" || e.field === "maxCompletion")) return delta > 0;
  return delta < 0;
}

export type Tone = "success" | "warning" | "danger" | "accent" | "muted";

export function storyTone(story: Story): Tone {
  const delta = storyDelta(story);
  switch (story.kind) {
    case "listed":
    case "relisted":
    case "hosted":
      return "success";
    case "delisted":
    case "expiring":
    case "retiring":
    case "retired":
      return "danger";
    case "repointed":
    case "unhosted":
      return "warning";
    case "repriced":
    case "resized":
      if (delta === null) return "accent";
      return deltaIsGood(story, delta) ? "success" : "warning";
    case "drift":
    case "renamed":
    case "capabilities":
      return "muted";
    default:
      return "accent";
  }
}

export function storyGlyph(story: Story): string {
  switch (story.kind) {
    case "listed":
      return "+";
    case "delisted":
      return "−";
    case "relisted":
      return "↩";
    case "repriced": {
      const delta = storyDelta(story);
      return delta === null ? "$" : delta < 0 ? "▼" : "▲";
    }
    case "resized": {
      const delta = storyDelta(story);
      return delta === null ? "⇔" : delta > 0 ? "⤒" : "⤓";
    }
    case "repointed":
      return "⇢";
    case "expiring":
    case "retiring":
      return "⏳";
    case "retired":
      return "✝";
    case "hosted":
      return "⊕";
    case "unhosted":
      return "⊖";
    case "drift":
      return "~";
    case "renamed":
      return "✎";
    case "capabilities":
      return "⚙";
    default:
      return "•";
  }
}

/** Plain words for a story kind, for chips and filters. */
export const KIND_LABEL: Record<string, string> = {
  listed: "New",
  delisted: "Removed",
  relisted: "Back",
  repriced: "Price",
  resized: "Context",
  renamed: "Rename",
  capabilities: "Capabilities",
  repointed: "Alias moved",
  expiring: "Expiring",
  retiring: "Retiring",
  retired: "Retired",
  hosted: "New host",
  unhosted: "Host gone",
  drift: "Small moves",
  other: "Other",
};

/** Filter-chip groups as the URL spells them. */
export const KIND_GROUPS: Record<string, { label: string; kinds: string[] }> = {
  prices: { label: "Prices", kinds: ["repriced"] },
  listings: { label: "Listings", kinds: ["listed", "delisted", "relisted"] },
  context: { label: "Context", kinds: ["resized"] },
  lifecycle: { label: "Retirements", kinds: ["expiring", "retiring", "retired", "repointed"] },
  hosts: { label: "Hosts", kinds: ["hosted", "unhosted"] },
  small: { label: "Small moves", kinds: ["drift", "renamed", "capabilities", "other"] },
};

export function kindInGroup(kind: string, group: string): boolean {
  const spec = KIND_GROUPS[group];
  return spec ? spec.kinds.includes(kind) : true;
}
