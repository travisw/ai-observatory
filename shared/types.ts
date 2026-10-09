/**
 * Row shapes as the client sees them. Every table field is a string or boolean; numbers and
 * dates travel as strings (ISO 8601 UTC for dates, dollars per token for prices).
 */

export type ModelRow = {
  id: string;
  modelId: string;
  provider: string;
  name: string;
  description: string;
  canonicalSlug: string;
  huggingFaceId: string;
  knowledgeCutoff: string;
  /** OpenRouter's own expiry for the listing, "YYYY-MM-DD" or "". */
  expirationDate: string;
  /** The concrete slug a rolling alias currently resolves to, or "". */
  aliasTarget: string;
  contextLength: string;
  maxCompletion: string;
  promptPrice: string;
  completionPrice: string;
  cacheReadPrice: string;
  cacheWritePrice: string;
  /** Long-context price tiers: "minPromptTokens:prompt:completion;..." or "". */
  tiers: string;
  modality: string;
  inputModalities: string;
  tokenizer: string;
  supportedParams: string;
  /** "mandatory" | "optional" | "". */
  reasoning: string;
  moderated: boolean;
  aaIntelligence: string;
  aaCoding: string;
  aaAgentic: string;
  lowInput: string;
  lowInputAt: string;
  highInput: string;
  highInputAt: string;
  lowOutput: string;
  highOutput: string;
  changeCount: string;
  lastChangedAt: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
};

export type EventKind = "added" | "removed" | "returned" | "changed";

export type ArchiveEvent = {
  id: string;
  at: string;
  kind: EventKind | string;
  modelId: string;
  provider: string;
  field: string;
  oldValue: string;
  newValue: string;
  /** Absent for the OpenRouter archive; set for rows from another catalogue. */
  source?: string;
};

export type HostRow = {
  id: string;
  modelId: string;
  host: string;
  tag: string;
  quantization: string;
  contextLength: string;
  maxCompletion: string;
  promptPrice: string;
  completionPrice: string;
  cacheReadPrice: string;
  uptime1d: string;
  uptime30m: string;
  status: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
};

export type HostEvent = {
  id: string;
  at: string;
  modelId: string;
  host: string;
  tag: string;
  kind: EventKind | string;
  field: string;
  oldValue: string;
  newValue: string;
};

export type LifecycleRow = {
  id: string;
  source: string;
  provider: string;
  modelId: string;
  key: string;
  /** "active" | "deprecated" | "retired". */
  state: string;
  deprecatedAt: string;
  retiresAt: string;
  retiresNote: string;
  replacement: string;
  sourceUrl: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
};

export type LifecycleEvent = {
  id: string;
  at: string;
  source: string;
  provider: string;
  modelId: string;
  key: string;
  kind: EventKind | string;
  field: string;
  oldValue: string;
  newValue: string;
};

export type StatusRow = { id: string; provider: string; indicator: string; description: string; checkedAt: string };
export type StatusEvent = { id: string; at: string; provider: string; oldIndicator: string; newIndicator: string; description: string };

export type IncidentRow = {
  id: string;
  provider: string;
  incidentId: string;
  name: string;
  impact: string;
  status: string;
  startedAt: string;
  resolvedAt: string;
  lastUpdateAt: string;
  url: string;
};

export type DailyRow = {
  id: string;
  date: string;
  listed: string;
  providers: string;
  aliases: string;
  free: string;
  medianIn: string;
  medianOut: string;
  frontierIn: string;
  frontierOut: string;
  frontierN: string;
  midIn: string;
  midOut: string;
  midN: string;
  budgetIn: string;
  budgetOut: string;
  budgetN: string;
  cheapestFrontierIn: string;
  cheapestFrontierId: string;
  changes: string;
};

export type ProviderDailyRow = { id: string; date: string; provider: string; listed: string; medianIn: string; medianOut: string };

export type RecordRow = { id: string; key: string; modelId: string; provider: string; value: string; at: string; detail: string };

export type SourceListing = {
  id: string;
  source: string;
  key: string;
  sourceId: string;
  provider: string;
  name: string;
  contextLength: string;
  maxCompletion: string;
  promptPrice: string;
  completionPrice: string;
  cacheReadPrice: string;
  releaseDate: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
};

export type SourceEventRow = {
  id: string;
  at: string;
  source: string;
  kind: string;
  key: string;
  sourceId: string;
  provider: string;
  field: string;
  oldValue: string;
  newValue: string;
};

export type PollRow = { id: string; at: string; source: string; ok: boolean; note: string; ms: string };
export type TrendRow = { id: string; at: string; rank: string; modelId: string; likes: string; downloads: string };
export type PkgRow = { id: string; at: string; pkg: string; downloads: string };
export type PypiRow = { id: string; at: string; pkg: string; lastDay: string; lastWeek: string; lastMonth: string };
export type RepoRow = { id: string; at: string; repo: string; stars: string; forks: string; openIssues: string };

export type Page<T> = { page: T[]; continueCursor: string | null; isDone: boolean };

export type ModelPageData = {
  model: ModelRow | null;
  events: ArchiveEvent[];
  hosts: HostRow[];
  hostEvents: HostEvent[];
  lifecycle: LifecycleRow[];
  listings: SourceListing[];
  sourceEvents: SourceEventRow[];
  family: ModelRow[];
};

export type ProviderPageData = {
  models: ModelRow[];
  events: ArchiveEvent[];
  status: StatusRow | null;
  statusEvents: StatusEvent[];
  incidents: IncidentRow[];
  lifecycle: LifecycleRow[];
  daily: ProviderDailyRow[];
};

export type StatusPageData = { statuses: StatusRow[]; statusEvents: StatusEvent[]; incidents: IncidentRow[] };
export type RetiringData = { lifecycle: LifecycleRow[]; expiring: ModelRow[] };
export type GraveyardData = { retired: ModelRow[]; lifecycle: LifecycleRow[] };
export type CatalogueAtData = { at: string; models: ModelRow[] };
export type HostsOverviewRow = { modelId: string; cheapestHost: string; cheapestIn: string; hosts: string };
export type CompareData = { models: ModelRow[]; events: ArchiveEvent[]; lifecycle: LifecycleRow[] };

export type HomePageData = {
  models: ModelRow[];
  /** Last 90 days, newest first, at most 1000. */
  events: ArchiveEvent[];
  hostEvents: HostEvent[];
  lifecycleEvents: LifecycleEvent[];
  sourceEvents: SourceEventRow[];
  statuses: StatusRow[];
  statusEvents: StatusEvent[];
  incidents: IncidentRow[];
  records: RecordRow[];
  cheapest: ModelRow[];
  freshness: Record<string, string>;
  sweeps: { at: string; listed: number }[];
};
