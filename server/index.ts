import { ImageResponse, boolean, capsule, endpoint, json, mutation, query, string, table, text } from "@spacefast/zero/server";
import { h } from "preact";

import {
  TRACKED_FIELDS,
  blendedPerMillion,
  daysBetween,
  fingerprintOf,
  formatContext,
  longDate,
  median,
  money,
  normalizeNumeric,
  providerOf,
  type TrackedField,
  type TrackedModel,
} from "../shared/model";
import { isAlias, modelName, providerName } from "../shared/providers";
import { FIRST_PARTY, canonicalKey, canonicalProvider } from "../shared/sources";
import {
  corroborate,
  foldAliases,
  foldDrift,
  foldFlapping,
  groupStories,
  hostStories,
  lifecycleStories,
  matchesWatch,
  sortStories,
  storyDelta,
  type Story,
} from "../shared/stories";
import type { ArchiveEvent, HostEvent, LifecycleEvent, ModelRow } from "../shared/types";

/**
 * The capsule does not fetch anything. Collection runs on a schedule outside the app
 * (see `collector/fetch-and-post.mjs`) and writes in through the mutations below, which
 * keeps the schedule, the retries and the source list changeable without a redeploy.
 *
 * Everything that makes this an archive lives here: the schema, the diffing, the
 * history, the public feeds, and the console.
 */
const now = () => new Date().toISOString();
const DAY = 86_400_000;
const SITE = "https://ai-observatory.view.fast";

/** Rows written before the v2 columns existed are upgraded in place on their next sweep. */
const SCHEMA_VERSION = "2";

/** Shared secret so only the collector can append to the archive. */
function allowed(ctx: { env: Record<string, string | undefined> }, token: string): boolean {
  const expected = ctx.env.INGEST_TOKEN;
  return Boolean(expected) && token === expected;
}

export default capsule({
  name: "AI Observatory",

  schema: {
    /** Current known state of every model, one row per model id. */
    models: table({
      modelId: string(),
      provider: string(),
      name: string(),
      description: string(),
      canonicalSlug: string(),
      huggingFaceId: string(),
      knowledgeCutoff: string(),
      expirationDate: string(),
      aliasTarget: string(),
      contextLength: string(),
      maxCompletion: string(),
      promptPrice: string(),
      completionPrice: string(),
      cacheReadPrice: string(),
      cacheWritePrice: string(),
      tiers: string(),
      modality: string(),
      inputModalities: string(),
      tokenizer: string(),
      supportedParams: string(),
      reasoning: string(),
      moderated: boolean(),
      aaIntelligence: string(),
      aaCoding: string(),
      aaAgentic: string(),
      lowInput: string(),
      lowInputAt: string(),
      highInput: string(),
      highInputAt: string(),
      lowOutput: string(),
      highOutput: string(),
      changeCount: string(),
      lastChangedAt: string(),
      schemaVersion: string(),
      fingerprint: string(),
      firstSeenAt: string(),
      lastSeenAt: string(),
      active: boolean(),
    })
      .index("by_model", ["modelId"])
      .index("by_provider", ["provider"])
      .index("by_active", ["active"]),

    /** The archive. Every detected change, kept forever. This is the product. */
    events: table({
      at: string(),
      kind: string(),
      modelId: string(),
      provider: string(),
      field: string(),
      oldValue: string(),
      newValue: string(),
    })
      .index("by_at", ["at"])
      .index("by_model", ["modelId"])
      .index("by_kind", ["kind"])
      .index("by_provider_at", ["provider", "at"]),

    /** Where each model is served from, one row per (model, host endpoint). */
    hosts: table({
      modelId: string(),
      host: string(),
      tag: string(),
      quantization: string(),
      contextLength: string(),
      maxCompletion: string(),
      promptPrice: string(),
      completionPrice: string(),
      cacheReadPrice: string(),
      uptime1d: string(),
      uptime30m: string(),
      status: string(),
      fingerprint: string(),
      firstSeenAt: string(),
      lastSeenAt: string(),
      active: boolean(),
    })
      .index("by_model", ["modelId"])
      .index("by_model_tag", ["modelId", "tag"])
      .index("by_active", ["active"]),

    hostEvents: table({
      at: string(),
      modelId: string(),
      host: string(),
      tag: string(),
      kind: string(),
      field: string(),
      oldValue: string(),
      newValue: string(),
    })
      .index("by_at", ["at"])
      .index("by_model", ["modelId"]),

    /** What the providers' own deprecation notices say, one row per (source, model). */
    lifecycle: table({
      source: string(),
      provider: string(),
      modelId: string(),
      key: string(),
      state: string(),
      deprecatedAt: string(),
      retiresAt: string(),
      retiresNote: string(),
      replacement: string(),
      sourceUrl: string(),
      fingerprint: string(),
      firstSeenAt: string(),
      lastSeenAt: string(),
      active: boolean(),
    })
      .index("by_key", ["key"])
      .index("by_source", ["source"])
      .index("by_source_model", ["source", "modelId"])
      .index("by_provider", ["provider"])
      .index("by_state", ["state"])
      .index("by_retires", ["retiresAt"]),

    lifecycleEvents: table({
      at: string(),
      source: string(),
      provider: string(),
      modelId: string(),
      key: string(),
      kind: string(),
      field: string(),
      oldValue: string(),
      newValue: string(),
    })
      .index("by_at", ["at"])
      .index("by_key", ["key"]),

    /** Latest status per provider, overwritten in place. */
    providerStatus: table({
      provider: string(),
      indicator: string(),
      description: string(),
      checkedAt: string(),
    }).index("by_provider", ["provider"]),

    /** Only written when a provider's indicator actually changes. */
    statusEvents: table({
      at: string(),
      provider: string(),
      oldIndicator: string(),
      newIndicator: string(),
      description: string(),
    })
      .index("by_at", ["at"])
      .index("by_provider_at", ["provider", "at"]),

    /** Incidents as the providers' status pages report them, upserted by id. */
    incidents: table({
      provider: string(),
      incidentId: string(),
      name: string(),
      impact: string(),
      status: string(),
      startedAt: string(),
      resolvedAt: string(),
      lastUpdateAt: string(),
      url: string(),
    })
      .index("by_provider_incident", ["provider", "incidentId"])
      .index("by_provider_started", ["provider", "startedAt"])
      .index("by_started", ["startedAt"]),

    /** One row per day: the state of the market, so trends do not need the whole archive replayed. */
    daily: table({
      date: string(),
      listed: string(),
      providers: string(),
      aliases: string(),
      free: string(),
      medianIn: string(),
      medianOut: string(),
      frontierIn: string(),
      frontierOut: string(),
      frontierN: string(),
      midIn: string(),
      midOut: string(),
      midN: string(),
      budgetIn: string(),
      budgetOut: string(),
      budgetN: string(),
      cheapestFrontierIn: string(),
      cheapestFrontierId: string(),
      changes: string(),
    }).index("by_date", ["date"]),

    providerDaily: table({
      date: string(),
      provider: string(),
      listed: string(),
      medianIn: string(),
      medianOut: string(),
    })
      .index("by_provider_date", ["provider", "date"])
      .index("by_date", ["date"]),

    /** All-time records, kept up to date as events are written. */
    records: table({
      key: string(),
      modelId: string(),
      provider: string(),
      value: string(),
      at: string(),
      detail: string(),
    }).index("by_key", ["key"]),

    /** Daily snapshot of what the open-weights world is looking at. */
    trending: table({
      at: string(),
      rank: string(),
      modelId: string(),
      likes: string(),
      downloads: string(),
    }).index("by_at", ["at"]),

    /** Daily weekly-download counts for the major client SDKs. */
    packages: table({
      at: string(),
      pkg: string(),
      downloads: string(),
    }).index("by_at", ["at"]),

    /** Daily PyPI downloads. The python side of adoption moves differently to npm. */
    pypi: table({
      at: string(),
      pkg: string(),
      lastDay: string(),
      lastWeek: string(),
      lastMonth: string(),
    }).index("by_at", ["at"]),

    /** Daily stars and open issues for the repos the ecosystem is actually built on. */
    repos: table({
      at: string(),
      repo: string(),
      stars: string(),
      forks: string(),
      openIssues: string(),
    }).index("by_at", ["at"]),

    /**
     * What other catalogues say about the same models. One row per (source, model), keyed
     * for matching against the OpenRouter row. Prices are per token, like `models`.
     */
    sourceModels: table({
      source: string(),
      key: string(),
      sourceId: string(),
      provider: string(),
      name: string(),
      contextLength: string(),
      maxCompletion: string(),
      promptPrice: string(),
      completionPrice: string(),
      cacheReadPrice: string(),
      releaseDate: string(),
      fingerprint: string(),
      firstSeenAt: string(),
      lastSeenAt: string(),
      active: boolean(),
    })
      .index("by_source", ["source"])
      .index("by_source_key", ["source", "key"])
      .index("by_key", ["key"]),

    /** Changes seen at the other catalogues, same shape as `events` plus the source. */
    sourceEvents: table({
      at: string(),
      source: string(),
      kind: string(),
      key: string(),
      sourceId: string(),
      provider: string(),
      field: string(),
      oldValue: string(),
      newValue: string(),
    })
      .index("by_at", ["at"])
      .index("by_key", ["key"])
      .index("by_source", ["source"]),

    /** Run log, so the console can be honest about gaps in its own history. */
    polls: table({
      at: string(),
      source: string(),
      ok: boolean(),
      note: string(),
      ms: string(),
    }).index("by_at", ["at"]),
  },

  queries: {
    recentEvents: query(async (ctx) =>
      ctx.db.events.withIndex("by_at").order("desc").take(60)
    ),
    activeModels: query(async (ctx) =>
      ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).order("asc").take(1000)
    ),
    retiredModels: query(async (ctx) =>
      ctx.db.models.withIndex("by_active", (range) => range.eq("active", false)).order("asc").take(1000)
    ),
    statuses: query(async (ctx) =>
      ctx.db.providerStatus.withIndex("by_provider").order("asc").take(50)
    ),
    statusHistory: query(async (ctx) =>
      ctx.db.statusEvents.withIndex("by_at").order("desc").take(30)
    ),
    latestTrending: query(async (ctx) =>
      ctx.db.trending.withIndex("by_at").order("desc").take(25)
    ),
    latestPackages: query(async (ctx) =>
      ctx.db.packages.withIndex("by_at").order("desc").take(20)
    ),
    latestPypi: query(async (ctx) =>
      ctx.db.pypi.withIndex("by_at").order("desc").take(20)
    ),
    latestRepos: query(async (ctx) =>
      ctx.db.repos.withIndex("by_at").order("desc").take(20)
    ),
    recentPolls: query(async (ctx) =>
      ctx.db.polls.withIndex("by_at").order("desc").take(20)
    ),

    /**
     * Everything the home page needs in one subscription, so a first visit is one request
     * rather than a dozen fired at once.
     */
    homePage: query(async (ctx) => {
      const since90 = new Date(Date.now() - 90 * DAY).toISOString();
      const models = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).order("asc").take(1000);
      const events = await ctx.db.events.withIndex("by_at", (range) => range.gte("at", since90)).order("desc").take(1000);
      const hostEvents = await ctx.db.hostEvents.withIndex("by_at").order("desc").take(200);
      const lifecycleEvents = await ctx.db.lifecycleEvents.withIndex("by_at").order("desc").take(200);
      const sourceEvents = await ctx.db.sourceEvents.withIndex("by_at").order("desc").take(200);
      const statuses = await ctx.db.providerStatus.withIndex("by_provider").order("asc").take(50);
      const statusEvents = await ctx.db.statusEvents.withIndex("by_at", (range) => range.gte("at", since90)).order("desc").take(1000);
      const incidents = await ctx.db.incidents.withIndex("by_started", (range) => range.gte("startedAt", since90)).order("desc").take(1000);
      const records = await ctx.db.records.withIndex("by_key").order("asc").take(50);
      const polls = await ctx.db.polls.withIndex("by_at").order("desc").take(400);
      const freshness: Record<string, string> = {};
      const sweeps: { at: string; listed: number }[] = [];
      for (const row of polls) {
        const source = String(row.source);
        if (row.ok === true && !freshness[source]) freshness[source] = String(row.at);
        if (source === "models" && row.ok === true) {
          const match = /(\d+) listed/.exec(String(row.note ?? ""));
          if (match) sweeps.push({ at: String(row.at), listed: Number(match[1]) });
        }
      }
      const cheapest = models
        .filter(
          (row) =>
            !isAlias(String(row.modelId)) &&
            Number(row.changeCount) > 0 &&
            Number(row.promptPrice) > 0 &&
            row.lowInput !== "" &&
            Number(row.promptPrice) <= Number(row.lowInput) &&
            Number(row.highInput) > Number(row.lowInput)
        )
        .sort((a, b) => String(b.lowInputAt).localeCompare(String(a.lowInputAt)))
        .slice(0, 50);
      return { models, events, hostEvents, lifecycleEvents, sourceEvents, statuses, statusEvents, incidents, records, cheapest, freshness, sweeps: sweeps.reverse() };
    }),

    /** Paged archive, newest first. `cursor` is null for the first page. */
    eventsPage: query(async (ctx, cursor: string | null) =>
      ctx.db.events.withIndex("by_at").order("desc").paginate({ cursor: cursor ?? null, numItems: 150 })
    ),

    eventsByProvider: query(async (ctx, provider: string, cursor: string | null) =>
      ctx.db.events
        .withIndex("by_provider_at", (range) => range.eq("provider", provider))
        .order("desc")
        .paginate({ cursor: cursor ?? null, numItems: 150 })
    ),

    /** Everything since a moment, newest first, capped at the runtime's page size. */
    eventsSince: query(async (ctx, sinceIso: string) =>
      ctx.db.events.withIndex("by_at", (range) => range.gte("at", sinceIso)).order("desc").take(1000)
    ),

    recentHostEvents: query(async (ctx) =>
      ctx.db.hostEvents.withIndex("by_at").order("desc").take(200)
    ),
    recentLifecycleEvents: query(async (ctx) =>
      ctx.db.lifecycleEvents.withIndex("by_at").order("desc").take(200)
    ),

    /** Catalogue size at each successful sweep, oldest first, for the trend line. */
    sweepSizes: query(async (ctx) => {
      const rows = await ctx.db.polls.withIndex("by_at").order("desc").take(400);
      const out: { at: string; listed: number }[] = [];
      for (const row of rows) {
        if (row.source !== "models" || row.ok !== true) continue;
        const match = /(\d+) listed/.exec(String(row.note ?? ""));
        if (match) out.push({ at: String(row.at), listed: Number(match[1]) });
      }
      return out.reverse();
    }),

    /** Everything that ever happened to one model, oldest first, plus its current row. */
    modelHistory: query(async (ctx, modelId: string) => {
      const model = await ctx.db.models
        .withIndex("by_model", (range) => range.eq("modelId", modelId))
        .first();
      const events = await ctx.db.events
        .withIndex("by_model", (range) => range.eq("modelId", modelId))
        .order("asc")
        .collect();
      return { model, events };
    }),

    /** The model page in one subscription: the row, its archive, hosts, notices, and family. */
    modelPage: query(async (ctx, modelId: string) => {
      const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", modelId)).first();
      if (!model) {
        return { model: null, events: [], hosts: [], hostEvents: [], lifecycle: [], listings: [], sourceEvents: [], family: [] };
      }
      const events = await ctx.db.events.withIndex("by_model", (range) => range.eq("modelId", modelId)).order("asc").collect();
      const hosts = await ctx.db.hosts.withIndex("by_model", (range) => range.eq("modelId", modelId)).collect();
      const hostEvents = await ctx.db.hostEvents.withIndex("by_model", (range) => range.eq("modelId", modelId)).order("asc").collect();
      const key = canonicalKey(String(model.provider), modelId);
      const lifecycle = await ctx.db.lifecycle.withIndex("by_key", (range) => range.eq("key", key)).collect();
      const listings = await ctx.db.sourceModels.withIndex("by_key", (range) => range.eq("key", key)).collect();
      const sourceEvents = await ctx.db.sourceEvents.withIndex("by_key", (range) => range.eq("key", key)).order("asc").collect();

      const siblings = await ctx.db.models.withIndex("by_provider", (range) => range.eq("provider", String(model.provider))).collect();
      const aliasProvider = isAlias(modelId) ? String(model.provider).replace(/^~/, "") : `~${model.provider}`;
      const aliasSide = await ctx.db.models.withIndex("by_provider", (range) => range.eq("provider", aliasProvider)).collect();
      const stem = familyStem(modelId);
      const family = [...siblings, ...aliasSide].filter(
        (row) => row.modelId !== modelId && (familyStem(String(row.modelId)) === stem || row.aliasTarget === modelId || model.aliasTarget === row.modelId)
      );
      return { model, events, hosts, hostEvents, lifecycle, listings, sourceEvents, family };
    }),

    providerPage: query(async (ctx, slug: string) => {
      const models = [
        ...(await ctx.db.models.withIndex("by_provider", (range) => range.eq("provider", slug)).collect()),
        ...(await ctx.db.models.withIndex("by_provider", (range) => range.eq("provider", `~${slug}`)).collect()),
      ];
      const events = await ctx.db.events.withIndex("by_provider_at", (range) => range.eq("provider", slug)).order("desc").take(500);
      const canonical = canonicalProvider(slug);
      const since = new Date(Date.now() - 90 * DAY).toISOString();
      const statuses = await ctx.db.providerStatus.withIndex("by_provider").order("asc").take(50);
      const status = statuses.find((s) => canonicalProvider(String(s.provider)) === canonical) ?? null;
      const statusProvider = status ? String(status.provider) : canonical;
      const statusEvents = await ctx.db.statusEvents
        .withIndex("by_provider_at", (range) => range.eq("provider", statusProvider).gte("at", since))
        .order("desc")
        .take(500);
      const incidents = await ctx.db.incidents
        .withIndex("by_provider_started", (range) => range.eq("provider", statusProvider).gte("startedAt", since))
        .order("desc")
        .take(300);
      const lifecycle = await ctx.db.lifecycle.withIndex("by_provider", (range) => range.eq("provider", canonical)).collect();
      const dailySince = new Date(Date.now() - 120 * DAY).toISOString().slice(0, 10);
      const daily = await ctx.db.providerDaily
        .withIndex("by_provider_date", (range) => range.eq("provider", canonical).gte("date", dailySince))
        .order("asc")
        .take(200);
      return { models, events, status, statusEvents, incidents, lifecycle, daily };
    }),

    compareModels: query(async (ctx, ids: string[]) => {
      const picked = (ids ?? []).slice(0, 4);
      const models: unknown[] = [];
      const events: unknown[] = [];
      const lifecycle: unknown[] = [];
      for (const id of picked) {
        const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", id)).first();
        if (!model) continue;
        models.push(model);
        events.push(...(await ctx.db.events.withIndex("by_model", (range) => range.eq("modelId", id)).order("asc").collect()));
        const key = canonicalKey(String(model.provider), id);
        lifecycle.push(...(await ctx.db.lifecycle.withIndex("by_key", (range) => range.eq("key", key)).collect()));
      }
      return { models, events, lifecycle };
    }),

    statusPage: query(async (ctx) => {
      const since = new Date(Date.now() - 90 * DAY).toISOString();
      const statuses = await ctx.db.providerStatus.withIndex("by_provider").order("asc").take(50);
      const statusEvents = await ctx.db.statusEvents.withIndex("by_at", (range) => range.gte("at", since)).order("desc").take(1000);
      const incidents = await ctx.db.incidents.withIndex("by_started", (range) => range.gte("startedAt", since)).order("desc").take(1000);
      return { statuses, statusEvents, incidents };
    }),

    dailyStats: query(async (ctx, days: number) => {
      const since = new Date(Date.now() - Math.min(Math.max(days || 90, 1), 1000) * DAY).toISOString().slice(0, 10);
      return ctx.db.daily.withIndex("by_date", (range) => range.gte("date", since)).order("asc").take(1000);
    }),

    providerDaily: query(async (ctx, provider: string, days: number) => {
      const since = new Date(Date.now() - Math.min(Math.max(days || 90, 1), 1000) * DAY).toISOString().slice(0, 10);
      return ctx.db.providerDaily
        .withIndex("by_provider_date", (range) => range.eq("provider", canonicalProvider(provider)).gte("date", since))
        .order("asc")
        .take(1000);
    }),

    records: query(async (ctx) => {
      const stored = await ctx.db.records.withIndex("by_key").order("asc").take(50);
      // Longest unchanged is a property of the present, so it is computed, not stored.
      const active = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      let best: { modelId: string; provider: string; since: string } | null = null;
      for (const row of active) {
        if (isAlias(String(row.modelId)) || !(Number(row.promptPrice) > 0)) continue;
        const since = String(row.lastChangedAt || row.firstSeenAt || "");
        if (!since) continue;
        if (!best || since < best.since) best = { modelId: String(row.modelId), provider: String(row.provider), since };
      }
      const out = stored.map((r) => ({ ...r }));
      if (best) {
        out.push({
          id: "computed-longest-unchanged",
          key: "longest-unchanged",
          modelId: best.modelId,
          provider: best.provider,
          value: String(daysBetween(best.since, now())),
          at: best.since,
          detail: `unchanged since ${longDate(best.since)}`,
          createdAt: "",
          updatedAt: "",
        });
      }
      return out;
    }),

    cheapestEver: query(async (ctx) => {
      const active = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      return active
        .filter(
          (row) =>
            !isAlias(String(row.modelId)) &&
            Number(row.changeCount) > 0 &&
            Number(row.promptPrice) > 0 &&
            row.lowInput !== "" &&
            Number(row.promptPrice) <= Number(row.lowInput) &&
            Number(row.highInput) > Number(row.lowInput)
        )
        .sort((a, b) => String(b.lowInputAt).localeCompare(String(a.lowInputAt)))
        .slice(0, 50);
    }),

    retiring: query(async (ctx) => {
      const since = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
      const rows = await ctx.db.lifecycle.withIndex("by_retires", (range) => range.gte("retiresAt", since)).order("asc").take(1000);
      const lifecycle = rows.filter((row) => row.active === true && row.state !== "active");
      const active = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      const expiring = active.filter((row) => String(row.expirationDate ?? "") !== "").sort((a, b) => String(a.expirationDate).localeCompare(String(b.expirationDate)));
      return { lifecycle, expiring };
    }),

    graveyard: query(async (ctx) => {
      const retired = (await ctx.db.models.withIndex("by_active", (range) => range.eq("active", false)).take(1000))
        .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
      const lifecycle = await ctx.db.lifecycle.withIndex("by_state", (range) => range.eq("state", "retired")).take(1000);
      return { retired, lifecycle };
    }),

    /**
     * The catalogue as it stood at a moment, rebuilt by walking the archive backwards from
     * today. Every event is reversible: a change knows its old value, an arrival knows it was
     * not there before, a removal knows it was.
     */
    catalogueAt: query(async (ctx, iso: string) => {
      const at = iso && iso.length >= 10 ? (iso.length === 10 ? `${iso}T23:59:59.999Z` : iso) : now();
      const rows = await ctx.db.models.withIndex("by_model").order("asc").take(1000);
      const state = new Map<string, Record<string, unknown>>(rows.map((row) => [String(row.modelId), { ...row }]));
      let cursor: string | null = null;
      let walked = 0;
      // Newest first, so each reversal lands on the state the event changed from.
      while (walked < 8000) {
        const page = await ctx.db.events
          .withIndex("by_at", (range) => range.gt("at", at))
          .order("desc")
          .paginate({ cursor, numItems: 1000 });
        for (const e of page.page) {
          const row = state.get(String(e.modelId));
          if (!row) continue;
          if (e.kind === "added") row.active = false;
          else if (e.kind === "removed") row.active = true;
          else if (e.kind === "returned") row.active = false;
          else if (e.kind === "changed") row[String(e.field)] = e.oldValue;
        }
        walked += page.page.length;
        if (page.isDone || !page.continueCursor) break;
        cursor = page.continueCursor;
      }
      const models = [...state.values()].filter((row) => row.active === true && String(row.firstSeenAt ?? "") <= at);
      return { at, models, walked };
    }),

    hostsOverview: query(async (ctx) => {
      const rows = await ctx.db.hosts.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      const byModel = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = byModel.get(String(row.modelId));
        if (list) list.push(row);
        else byModel.set(String(row.modelId), [row]);
      }
      const out: { modelId: string; cheapestHost: string; cheapestIn: string; hosts: string }[] = [];
      for (const [modelId, list] of byModel) {
        if (list.length < 2) continue;
        const priced = list.filter((row) => Number(row.promptPrice) > 0).sort((a, b) => Number(a.promptPrice) - Number(b.promptPrice));
        const cheapest = priced[0] ?? list[0];
        out.push({ modelId, cheapestHost: String(cheapest.host), cheapestIn: String(cheapest.promptPrice), hosts: String(list.length) });
      }
      return out;
    }),

    /** Other catalogues' listings for one canonical key, with everything that changed there. */
    crossSources: query(async (ctx, key: string) => {
      const listings = await ctx.db.sourceModels
        .withIndex("by_key", (range) => range.eq("key", key))
        .collect();
      const events = await ctx.db.sourceEvents
        .withIndex("by_key", (range) => range.eq("key", key))
        .order("asc")
        .collect();
      return { listings, events };
    }),

    recentSourceEvents: query(async (ctx) =>
      ctx.db.sourceEvents.withIndex("by_at").order("desc").take(200)
    ),

    /** Most recent successful run per source, so the console can say how fresh it is. */
    freshness: query(async (ctx) => {
      const recent = await ctx.db.polls.withIndex("by_at").order("desc").take(60);
      const latest: Record<string, string> = {};
      for (const row of recent) {
        const source = String(row.source);
        if (row.ok === true && !latest[source]) latest[source] = String(row.at);
      }
      return latest;
    }),
  },

  mutations: {
    /**
     * Ingests one chunk of an OpenRouter sweep and records what moved.
     *
     * The collector reaches this over the same /__zero/run transport the browser uses,
     * so ingest and the console share one code path and one set of guarantees.
     */
    ingestModels: mutation(async (ctx, token: string, runAt: string, data: RawModel[]) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const at = runAt || now();
      let added = 0;
      let changed = 0;

      const existingRows = await ctx.db.models.withIndex("by_model").collect();
      const existing = new Map(existingRows.map((row) => [String(row.modelId), row]));

      for (const raw of data ?? []) {
        const model = toTracked(raw);
        if (!model.modelId) continue;
        const fingerprint = fingerprintOf(model);
        const prior = existing.get(model.modelId);

        if (!prior) {
          // OpenRouter carries the model's own listing date, so the archive starts with
          // real first-seen dates instead of a flat wall at whenever we happened to boot.
          const listed = firstSeenFrom(raw.created, at);
          await ctx.db.models.insert({
            ...model,
            lowInput: model.promptPrice,
            lowInputAt: at,
            highInput: model.promptPrice,
            highInputAt: at,
            lowOutput: model.completionPrice,
            highOutput: model.completionPrice,
            changeCount: "0",
            lastChangedAt: "",
            schemaVersion: SCHEMA_VERSION,
            fingerprint,
            firstSeenAt: listed,
            lastSeenAt: at,
            active: true,
          });
          await ctx.db.events.insert({
            at,
            kind: "added",
            modelId: model.modelId,
            provider: model.provider,
            field: "",
            oldValue: "",
            newValue: model.name,
          });
          await noteCheapestListed(ctx, model, at);
          added++;
          continue;
        }

        // Correct first-seen against the source's own listing date. Self-healing rather
        // than insert-only, so rows written before this existed get fixed on the next
        // sweep instead of leaving the archive with a flat wall at whenever we booted.
        const listedAt = firstSeenFrom(raw.created, "");
        const storedFirstSeen = String(prior.firstSeenAt ?? "");
        const correctedFirstSeen =
          listedAt && (!storedFirstSeen || listedAt < storedFirstSeen) ? listedAt : null;

        // A row from before the v2 columns existed: fill them from its own archive rather than
        // writing a flood of "changed from nothing" events for fields that were simply unrecorded.
        const upgrading = String(prior.schemaVersion ?? "") !== SCHEMA_VERSION;
        const upgrade = upgrading ? await v2Columns(ctx, prior) : {};

        if (prior.fingerprint === fingerprint && prior.active === true && !upgrading) {
          await ctx.db.models.update(prior.id, {
            lastSeenAt: at,
            ...untracked(model),
            ...(correctedFirstSeen ? { firstSeenAt: correctedFirstSeen } : {}),
          });
          continue;
        }

        // A row per changed field, so the archive stays queryable by field.
        let changesHere = 0;
        const stats: Record<string, string> = {};
        for (const field of TRACKED_FIELDS) {
          const before = String(prior[field] ?? "");
          const after = String(model[field as TrackedField] ?? "");
          if (before === after) continue;
          if (upgrading && before === "" && NEW_FIELDS.has(field)) continue;
          await ctx.db.events.insert({
            at,
            kind: "changed",
            modelId: model.modelId,
            provider: model.provider,
            field,
            oldValue: before,
            newValue: after,
          });
          changed++;
          changesHere++;
          if (field === "promptPrice" || field === "completionPrice" || field === "contextLength") {
            await noteRecords(ctx, model, field, before, after, at);
          }
        }
        if (changesHere > 0) {
          const base = upgrading ? { ...prior, ...upgrade } : prior;
          Object.assign(stats, priceExtremes(base, model, at));
          stats.changeCount = String(Number(base.changeCount ?? 0) + changesHere);
          stats.lastChangedAt = at;
        }

        if (prior.active === false) {
          await ctx.db.events.insert({
            at,
            kind: "returned",
            modelId: model.modelId,
            provider: model.provider,
            field: "",
            oldValue: "",
            newValue: model.name,
          });
        }

        await ctx.db.models.update(prior.id, {
          ...model,
          ...upgrade,
          ...stats,
          schemaVersion: SCHEMA_VERSION,
          fingerprint,
          lastSeenAt: at,
          active: true,
          ...(correctedFirstSeen ? { firstSeenAt: correctedFirstSeen } : {}),
        });
      }

      return { ok: true, added, changed };
    }),

    /** Closes a sweep: anything active that this sweep never touched has left the catalogue. */
    finalizeModels: mutation(async (ctx, token: string, runAt: string, listed: number) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const started = Date.now();
      const at = runAt || now();
      let removed = 0;

      const rows = await ctx.db.models.withIndex("by_model").collect();
      // A sweep that saw far fewer models than we know about is a broken fetch, not a purge.
      // Record the run and leave the catalogue alone rather than retiring half the archive.
      const known = rows.filter((row) => row.active === true).length;
      if (known > 50 && listed < known * 0.8) {
        await ctx.db.polls.insert({ at, source: "models", ok: false, note: `${listed} listed, below ${known} known; sweep ignored`, ms: String(Date.now() - started) });
        return { ok: true, removed: 0, ignored: true };
      }
      for (const row of rows) {
        if (row.active === false) continue;
        if (String(row.lastSeenAt ?? "") === at) continue;
        await ctx.db.models.update(row.id, { active: false });
        await ctx.db.events.insert({
          at,
          kind: "removed",
          modelId: String(row.modelId),
          provider: String(row.provider),
          field: "",
          oldValue: String(row.name ?? ""),
          newValue: "",
        });
        const lived = daysBetween(String(row.firstSeenAt ?? at), at);
        if (lived >= 1 && !isAlias(String(row.modelId))) {
          await bumpRecord(ctx, "shortest-lived", { modelId: String(row.modelId), provider: String(row.provider), value: String(lived), at, detail: `listed ${longDate(String(row.firstSeenAt))}, removed ${longDate(at)}` }, (a, b) => a < b);
        }
        removed++;
      }

      await ctx.db.polls.insert({
        at,
        source: "models",
        ok: true,
        note: `${listed} listed, ${removed} retired`,
        ms: String(Date.now() - started),
      });
      return { ok: true, removed };
    }),

    /**
     * Ingests the hosts serving a batch of models. Each model's list is complete, so a host
     * missing from it has stopped serving that model. Uptime is a reading, not a change, and
     * is refreshed in place without an event.
     */
    ingestHosts: mutation(async (ctx, token: string, runAt: string, data: { modelId: string; endpoints: RawEndpoint[] }[]) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const at = runAt || now();
      let added = 0;
      let changed = 0;
      let removed = 0;

      for (const entry of data ?? []) {
        if (!entry?.modelId || !Array.isArray(entry.endpoints)) continue;
        const modelId = entry.modelId;
        const existingRows = await ctx.db.hosts.withIndex("by_model", (range) => range.eq("modelId", modelId)).collect();
        const existing = new Map(existingRows.map((row) => [String(row.tag), row]));
        const bootstrap = existingRows.length === 0;
        const seen = new Set<string>();

        for (const raw of entry.endpoints) {
          const host = toHost(modelId, raw);
          if (!host.tag || seen.has(host.tag)) continue;
          seen.add(host.tag);
          const fingerprint = HOST_FIELDS.map((f) => host[f]).join("|");
          const prior = existing.get(host.tag);
          if (!prior) {
            await ctx.db.hosts.insert({ ...host, fingerprint, firstSeenAt: at, lastSeenAt: at, active: true });
            if (!bootstrap) {
              await ctx.db.hostEvents.insert({ at, modelId, host: host.host, tag: host.tag, kind: "added", field: "", oldValue: "", newValue: host.host });
            }
            added++;
            continue;
          }
          if (prior.fingerprint === fingerprint && prior.active === true) {
            await ctx.db.hosts.update(prior.id, { lastSeenAt: at, uptime1d: host.uptime1d, uptime30m: host.uptime30m, status: host.status });
            continue;
          }
          for (const field of HOST_FIELDS) {
            const before = String(prior[field] ?? "");
            const after = host[field];
            if (before === after) continue;
            await ctx.db.hostEvents.insert({ at, modelId, host: host.host, tag: host.tag, kind: "changed", field, oldValue: before, newValue: after });
            changed++;
          }
          if (prior.active === false) {
            await ctx.db.hostEvents.insert({ at, modelId, host: host.host, tag: host.tag, kind: "returned", field: "", oldValue: "", newValue: host.host });
          }
          await ctx.db.hosts.update(prior.id, { ...host, fingerprint, lastSeenAt: at, active: true });
        }

        for (const row of existingRows) {
          if (row.active === false || seen.has(String(row.tag))) continue;
          await ctx.db.hosts.update(row.id, { active: false });
          await ctx.db.hostEvents.insert({ at, modelId, host: String(row.host), tag: String(row.tag), kind: "removed", field: "", oldValue: String(row.host), newValue: "" });
          removed++;
        }
      }

      return { ok: true, added, changed, removed };
    }),

    /** Marks the end of a hosts run so freshness can report it. */
    finalizeHosts: mutation(async (ctx, token: string, runAt: string, models: number, ms: number) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      await ctx.db.polls.insert({ at: runAt || now(), source: "hosts", ok: true, note: `${models} models' hosts read`, ms: String(ms ?? 0) });
      return { ok: true };
    }),

    /**
     * Ingests one chunk of another catalogue. Same diff-and-record shape as `ingestModels`,
     * kept separate because these rows are keyed for matching rather than by their own id.
     */
    ingestSource: mutation(async (ctx, token: string, source: string, runAt: string, data: SourceListing[]) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const at = runAt || now();
      let added = 0;
      let changed = 0;

      const existingRows = await ctx.db.sourceModels
        .withIndex("by_source", (range) => range.eq("source", source))
        .collect();
      const existing = new Map(existingRows.map((row) => [String(row.key), row]));
      // The first sweep of a source is a snapshot, not a set of arrivals. Rows are stored but
      // no "added" events are written, since every later chunk of that run sees only rows
      // stamped with this run's time.
      const bootstrap = existingRows.every((row) => String(row.firstSeenAt ?? "") === at);

      for (const raw of data ?? []) {
        if (!raw.sourceId || !raw.provider) continue;
        const provider = canonicalProvider(raw.provider);
        if (!FIRST_PARTY.has(provider)) continue;
        const key = canonicalKey(raw.provider, raw.sourceId);
        const listing = {
          source,
          key,
          sourceId: raw.sourceId,
          provider,
          name: raw.name ?? "",
          contextLength: normalizeNumeric(raw.contextLength),
          maxCompletion: normalizeNumeric(raw.maxCompletion),
          promptPrice: normalizeNumeric(raw.promptPrice),
          completionPrice: normalizeNumeric(raw.completionPrice),
          cacheReadPrice: normalizeNumeric(raw.cacheReadPrice),
          releaseDate: raw.releaseDate ?? "",
        };
        const fingerprint = SOURCE_FIELDS.map((field) => listing[field]).join("|");
        const prior = existing.get(key);

        // Several ids can share a key (a dated snapshot and its rolling name). The collector
        // sends the shortest id first and the rest are skipped for this sweep.
        if (prior && String(prior.lastSeenAt ?? "") === at) continue;

        if (!prior) {
          const row = await ctx.db.sourceModels.insert({ ...listing, fingerprint, firstSeenAt: at, lastSeenAt: at, active: true });
          existing.set(key, row);
          if (!bootstrap) {
            await ctx.db.sourceEvents.insert({
              at, source, kind: "added", key, sourceId: listing.sourceId, provider,
              field: "", oldValue: "", newValue: listing.name,
            });
          }
          added++;
          continue;
        }

        if (prior.fingerprint === fingerprint && prior.active === true) {
          const row = await ctx.db.sourceModels.update(prior.id, { lastSeenAt: at });
          if (row) existing.set(key, row);
          continue;
        }

        for (const field of SOURCE_FIELDS) {
          const before = String(prior[field] ?? "");
          const after = listing[field];
          if (before === after) continue;
          await ctx.db.sourceEvents.insert({
            at, source, kind: "changed", key, sourceId: listing.sourceId, provider,
            field, oldValue: before, newValue: after,
          });
          changed++;
        }
        if (prior.active === false) {
          await ctx.db.sourceEvents.insert({
            at, source, kind: "returned", key, sourceId: listing.sourceId, provider,
            field: "", oldValue: "", newValue: listing.name,
          });
        }
        const row = await ctx.db.sourceModels.update(prior.id, { ...listing, fingerprint, lastSeenAt: at, active: true });
        if (row) existing.set(key, row);
      }

      return { ok: true, added, changed };
    }),

    finalizeSource: mutation(async (ctx, token: string, source: string, runAt: string, listed: number) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const started = Date.now();
      const at = runAt || now();
      let removed = 0;

      const rows = await ctx.db.sourceModels
        .withIndex("by_source", (range) => range.eq("source", source))
        .collect();
      for (const row of rows) {
        if (row.active === false || String(row.lastSeenAt ?? "") === at) continue;
        await ctx.db.sourceModels.update(row.id, { active: false });
        await ctx.db.sourceEvents.insert({
          at, source, kind: "removed", key: String(row.key), sourceId: String(row.sourceId), provider: String(row.provider),
          field: "", oldValue: String(row.name ?? ""), newValue: "",
        });
        removed++;
      }

      await ctx.db.polls.insert({
        at,
        source,
        ok: true,
        note: `${listed} listed, ${removed} retired`,
        ms: String(Date.now() - started),
      });
      return { ok: true, removed };
    }),

    /** Clears a source so its history can be replayed from the beginning. Call until `done`. */
    resetSource: mutation(async (ctx, token: string, source: string) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      let deleted = 0;
      const models = await ctx.db.sourceModels.withIndex("by_source", (range) => range.eq("source", source)).take(200);
      for (const row of models) {
        await ctx.db.sourceModels.delete(row.id);
        deleted++;
      }
      const events = await ctx.db.sourceEvents.withIndex("by_source", (range) => range.eq("source", source)).take(400);
      for (const row of events) {
        await ctx.db.sourceEvents.delete(row.id);
        deleted++;
      }
      return { ok: true, deleted, done: models.length === 0 && events.length === 0 };
    }),

    /** One chunk of a deprecation page, diffed against what it said last time. */
    ingestLifecycle: mutation(async (ctx, token: string, source: string, runAt: string, rows: RawLifecycle[]) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const at = runAt || now();
      let added = 0;
      let changed = 0;

      const existingRows = await ctx.db.lifecycle.withIndex("by_source", (range) => range.eq("source", source)).collect();
      const existing = new Map(existingRows.map((row) => [String(row.modelId), row]));
      const bootstrap = existingRows.every((row) => String(row.firstSeenAt ?? "") === at);

      for (const raw of rows ?? []) {
        if (!raw?.modelId || !raw.provider) continue;
        const provider = canonicalProvider(raw.provider);
        const entry = {
          source,
          provider,
          modelId: raw.modelId,
          key: canonicalKey(raw.provider, raw.modelId),
          state: raw.state || "active",
          deprecatedAt: raw.deprecatedAt ?? "",
          retiresAt: raw.retiresAt ?? "",
          retiresNote: raw.retiresNote ?? "",
          replacement: raw.replacement ?? "",
          sourceUrl: raw.sourceUrl ?? "",
        };
        const fingerprint = LIFECYCLE_FIELDS.map((f) => entry[f]).join("|");
        const prior = existing.get(entry.modelId);
        if (prior && String(prior.lastSeenAt ?? "") === at) continue;

        if (!prior) {
          const row = await ctx.db.lifecycle.insert({ ...entry, fingerprint, firstSeenAt: at, lastSeenAt: at, active: true });
          existing.set(entry.modelId, row);
          if (!bootstrap) {
            // One event for the arrival carrying the state, and siblings for the dates, so a
            // reader can tell "deprecated on arrival, retiring in November" from the rows.
            await ctx.db.lifecycleEvents.insert({ at, source, provider, modelId: entry.modelId, key: entry.key, kind: "added", field: "state", oldValue: "", newValue: entry.state });
            for (const field of ["retiresAt", "deprecatedAt", "replacement"] as const) {
              if (entry[field]) await ctx.db.lifecycleEvents.insert({ at, source, provider, modelId: entry.modelId, key: entry.key, kind: "changed", field, oldValue: "", newValue: entry[field] });
            }
          }
          added++;
          continue;
        }
        if (prior.fingerprint === fingerprint && prior.active === true) {
          const row = await ctx.db.lifecycle.update(prior.id, { lastSeenAt: at });
          if (row) existing.set(entry.modelId, row);
          continue;
        }
        for (const field of LIFECYCLE_FIELDS) {
          const before = String(prior[field] ?? "");
          const after = entry[field];
          if (before === after) continue;
          await ctx.db.lifecycleEvents.insert({ at, source, provider, modelId: entry.modelId, key: entry.key, kind: "changed", field, oldValue: before, newValue: after });
          changed++;
        }
        const row = await ctx.db.lifecycle.update(prior.id, { ...entry, fingerprint, lastSeenAt: at, active: true });
        if (row) existing.set(entry.modelId, row);
      }
      return { ok: true, added, changed };
    }),

    finalizeLifecycle: mutation(async (ctx, token: string, source: string, runAt: string) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const started = Date.now();
      const at = runAt || now();
      let removed = 0;
      const rows = await ctx.db.lifecycle.withIndex("by_source", (range) => range.eq("source", source)).collect();
      const touched = rows.filter((row) => String(row.lastSeenAt ?? "") === at).length;
      // An empty run means the page could not be parsed, not that every notice was withdrawn.
      if (touched === 0 && rows.length > 0) {
        await ctx.db.polls.insert({ at, source: `lifecycle:${source}`, ok: false, note: "no rows this run; nothing retired", ms: String(Date.now() - started) });
        return { ok: true, removed: 0, ignored: true };
      }
      for (const row of rows) {
        if (row.active === false || String(row.lastSeenAt ?? "") === at) continue;
        await ctx.db.lifecycle.update(row.id, { active: false });
        await ctx.db.lifecycleEvents.insert({ at, source, provider: String(row.provider), modelId: String(row.modelId), key: String(row.key), kind: "removed", field: "", oldValue: String(row.state), newValue: "" });
        removed++;
      }
      await ctx.db.polls.insert({ at, source: `lifecycle:${source}`, ok: true, note: `${touched} entries, ${removed} withdrawn`, ms: String(Date.now() - started) });
      return { ok: true, removed };
    }),

    ingestStatus: mutation(async (ctx, token: string, providers: StatusReport[]) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const started = Date.now();
      const at = now();
      let transitions = 0;
      let incidentsSeen = 0;

      for (const source of providers ?? []) {
        const indicator = source.indicator || "unknown";
        const description = source.description ?? "";
        const prior = await ctx.db.providerStatus
          .withIndex("by_provider", (range) => range.eq("provider", source.provider))
          .first();

        if (!prior) {
          await ctx.db.providerStatus.insert({
            provider: source.provider,
            indicator,
            description,
            checkedAt: at,
          });
        } else {
          if (prior.indicator !== indicator) {
            await ctx.db.statusEvents.insert({
              at,
              provider: source.provider,
              oldIndicator: String(prior.indicator ?? ""),
              newIndicator: indicator,
              description,
            });
            transitions++;
          }
          await ctx.db.providerStatus.update(prior.id, { indicator, description, checkedAt: at });
        }

        for (const incident of source.incidents ?? []) {
          if (!incident?.id) continue;
          incidentsSeen++;
          const row = {
            provider: source.provider,
            incidentId: String(incident.id),
            name: incident.name ?? "",
            impact: incident.impact ?? "",
            status: incident.status ?? "",
            startedAt: incident.createdAt ?? at,
            resolvedAt: incident.resolvedAt ?? "",
            lastUpdateAt: incident.updatedAt ?? at,
            url: incident.url ?? "",
          };
          const existing = await ctx.db.incidents
            .withIndex("by_provider_incident", (range) => range.eq("provider", source.provider).eq("incidentId", row.incidentId))
            .first();
          if (existing) await ctx.db.incidents.update(existing.id, row);
          else await ctx.db.incidents.insert(row);
        }
      }

      await ctx.db.polls.insert({
        at,
        source: "status",
        ok: true,
        note: `${(providers ?? []).length} checked, ${transitions} transitions, ${incidentsSeen} incidents`,
        ms: String(Date.now() - started),
      });
      return { ok: true, transitions, incidents: incidentsSeen };
    }),

    ingestDaily: mutation(
      async (
        ctx,
        token: string,
        trending: HfModel[],
        packages: PackageReport[],
        pypi: PypiReport[],
        repos: RepoReport[]
      ) => {
        if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
        const started = Date.now();
        const at = now();

        const rows = trending ?? [];
        for (let i = 0; i < rows.length; i++) {
          await ctx.db.trending.insert({
            at,
            rank: String(i + 1),
            modelId: rows[i].id ?? "",
            likes: String(rows[i].likes ?? 0),
            downloads: String(rows[i].downloads ?? 0),
          });
        }

        for (const entry of packages ?? []) {
          await ctx.db.packages.insert({
            at,
            pkg: entry.pkg,
            downloads: String(entry.downloads ?? 0),
          });
        }

        for (const entry of pypi ?? []) {
          await ctx.db.pypi.insert({
            at,
            pkg: entry.pkg,
            lastDay: String(entry.lastDay ?? 0),
            lastWeek: String(entry.lastWeek ?? 0),
            lastMonth: String(entry.lastMonth ?? 0),
          });
        }

        for (const entry of repos ?? []) {
          await ctx.db.repos.insert({
            at,
            repo: entry.repo,
            stars: String(entry.stars ?? 0),
            forks: String(entry.forks ?? 0),
            openIssues: String(entry.openIssues ?? 0),
          });
        }

        await ctx.db.polls.insert({
          at,
          source: "daily",
          ok: true,
          note: `${rows.length} trending, ${(packages ?? []).length} npm, ${(pypi ?? []).length} pypi, ${(repos ?? []).length} repos`,
          ms: String(Date.now() - started),
        });
        return {
          ok: true,
          trending: rows.length,
          packages: (packages ?? []).length,
          pypi: (pypi ?? []).length,
          repos: (repos ?? []).length,
        };
      }
    ),

    /** The day's market summary, computed from the current catalogue. Idempotent per date. */
    rollupDaily: mutation(async (ctx, token: string, date?: string) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const day = date && date.length === 10 ? date : now().slice(0, 10);
      const result = await rollup(ctx, day);
      return { ok: true, ...result };
    }),
  },

  endpoints: {
    /** Atom feed of stories. `?watch=claude,deepseek` narrows it; so do `provider`, `model`, `kind`. */
    feed: endpoint({ method: "GET", path: "/feed.xml", mode: "read" }, async (raw, req) => {
      const stories = await filteredStories(raw as unknown as Ctx, req.query, 60);
      const updated = stories[0]?.at ?? now();
      const self = `${SITE}/feed.xml${req.query.toString() ? `?${req.query.toString()}` : ""}`;
      const entries = stories
        .map((s) => {
          const link = s.source && s.source !== "hosts" ? `${SITE}/retiring` : `${SITE}/model/${s.modelId}`;
          const summary = [s.detail, ...s.more].filter(Boolean).join(" · ");
          return `  <entry>
    <id>tag:ai-observatory.view.fast,2026:${escapeXml(s.key)}</id>
    <title>${escapeXml(s.headline)}</title>
    <link href="${escapeXml(link)}"/>
    <updated>${escapeXml(s.at)}</updated>
    <category term="${escapeXml(s.kind)}"/>
    <summary>${escapeXml(summary || s.headline)}</summary>
  </entry>`;
        })
        .join("\n");
      const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>AI Observatory</title>
  <subtitle>The changelog AI providers don't publish</subtitle>
  <link href="${escapeXml(self)}" rel="self"/>
  <link href="${SITE}/"/>
  <id>${SITE}/</id>
  <updated>${escapeXml(updated)}</updated>
${entries}
</feed>
`;
      return text(body, { headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=600" } });
    }),

    apiChanges: endpoint({ method: "GET", path: "/api/changes.json", mode: "read" }, async (raw, req) => {
      const stories = await filteredStories(raw as unknown as Ctx, req.query, 200);
      return json({ generatedAt: now(), stories: stories.map(publicStory) }, API_HEADERS);
    }),

    apiModels: endpoint({ method: "GET", path: "/api/models.json", mode: "read" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const includeRetired = req.query.get("retired") === "1";
      const active = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      const retired = includeRetired ? await ctx.db.models.withIndex("by_active", (range) => range.eq("active", false)).take(1000) : [];
      return json({ generatedAt: now(), models: [...active, ...retired].map(publicModel) }, API_HEADERS);
    }),

    apiModel: endpoint({ method: "GET", path: "/api/model.json", mode: "read" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const id = req.query.get("id") ?? "";
      const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", id)).first();
      if (!model) return json({ error: "unknown model", id }, { ...API_HEADERS, status: 404 });
      const events = await ctx.db.events.withIndex("by_model", (range) => range.eq("modelId", id)).order("asc").collect();
      const hosts = await ctx.db.hosts.withIndex("by_model", (range) => range.eq("modelId", id)).collect();
      const key = canonicalKey(String(model.provider), id);
      const lifecycle = await ctx.db.lifecycle.withIndex("by_key", (range) => range.eq("key", key)).collect();
      const listings = await ctx.db.sourceModels.withIndex("by_key", (range) => range.eq("key", key)).collect();
      return json({ generatedAt: now(), model: publicModel(model), events: events.map(publicEvent), hosts, lifecycle, listings }, API_HEADERS);
    }),

    apiIndex: endpoint({ method: "GET", path: "/api/index.json", mode: "read" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const daily = await ctx.db.daily.withIndex("by_date").order("asc").take(1000);
      return json({ generatedAt: now(), method: INDEX_METHOD, daily }, API_HEADERS);
    }),

    apiStatus: endpoint({ method: "GET", path: "/api/status.json", mode: "read" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const since = new Date(Date.now() - 90 * DAY).toISOString();
      const statuses = await ctx.db.providerStatus.withIndex("by_provider").order("asc").take(50);
      const incidents = await ctx.db.incidents.withIndex("by_started", (range) => range.gte("startedAt", since)).order("desc").take(1000);
      return json({ generatedAt: now(), statuses, incidents }, API_HEADERS);
    }),

    apiRetiring: endpoint({ method: "GET", path: "/api/retiring.json", mode: "read" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const since = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
      const rows = await ctx.db.lifecycle.withIndex("by_retires", (range) => range.gte("retiresAt", since)).order("asc").take(1000);
      const active = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      return json({
        generatedAt: now(),
        lifecycle: rows.filter((row) => row.active === true && row.state !== "active"),
        expiring: active.filter((row) => String(row.expirationDate ?? "") !== "").map(publicModel),
      }, API_HEADERS);
    }),

    apiRecords: endpoint({ method: "GET", path: "/api/records.json", mode: "read" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const records = await ctx.db.records.withIndex("by_key").order("asc").take(50);
      return json({ generatedAt: now(), records }, API_HEADERS);
    }),

    exportChanges: endpoint({ method: "GET", path: "/export/changes.csv", mode: "read" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const events = await ctx.db.events.withIndex("by_at").order("desc").take(1000);
      const lines = ["at,kind,model,provider,field,old_value,new_value"];
      for (const e of events) {
        lines.push([e.at, e.kind, e.modelId, e.provider, e.field, e.oldValue, e.newValue].map(csvCell).join(","));
      }
      return text(lines.join("\n") + "\n", {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"ai-observatory-changes.csv\"", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
      });
    }),

    /** Shields-style badge: `?model=anthropic/claude-haiku-4.5&metric=input|output|context|changed|retires`. */
    badge: endpoint({ method: "GET", path: "/badge.svg", mode: "read" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const id = req.query.get("model") ?? "";
      const metric = req.query.get("metric") ?? "input";
      const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", id)).first();
      let label = "ai observatory";
      let value = "unknown model";
      let color = "#8a94a8";
      if (model) {
        const short = modelName(String(model.modelId), String(model.name));
        if (metric === "output") {
          label = `${short} · output`;
          value = `${money(String(model.completionPrice))}/M`;
          color = "#6ea8ff";
        } else if (metric === "context") {
          label = `${short} · context`;
          value = `${formatContext(String(model.contextLength))} tokens`;
          color = "#6ea8ff";
        } else if (metric === "changed") {
          label = `${short} · last change`;
          value = model.lastChangedAt ? `${daysBetween(String(model.lastChangedAt), now())}d ago` : "never";
          color = "#3ddc84";
        } else if (metric === "retires") {
          const key = canonicalKey(String(model.provider), id);
          const notices = await ctx.db.lifecycle.withIndex("by_key", (range) => range.eq("key", key)).collect();
          const dated = notices.filter((n) => n.active === true && n.retiresAt).sort((a, b) => String(a.retiresAt).localeCompare(String(b.retiresAt)))[0];
          const when = dated ? String(dated.retiresAt) : String(model.expirationDate ?? "");
          label = `${short} · retires`;
          value = when ? (when > now().slice(0, 10) ? `in ${daysBetween(now(), when)}d` : "retired") : model.active ? "no date" : "removed";
          color = when ? "#ff5c5c" : "#3ddc84";
        } else {
          label = `${short} · input`;
          value = `${money(String(model.promptPrice))}/M`;
          color = "#6ea8ff";
        }
        if (model.active === false) color = "#ff5c5c";
      }
      return text(badgeSvg(label, value, color), { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=1800", "Access-Control-Allow-Origin": "*" } });
    }),

    ogModel: endpoint({ method: "GET", path: "/og/model.png", mode: "read" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const id = req.query.get("id") ?? "";
      const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", id)).first();
      if (!model) return card("AI Observatory", "Unknown model", id, "");
      const events = await ctx.db.events.withIndex("by_model", (range) => range.eq("modelId", id)).order("desc").take(400);
      const stories = sortStories(groupStories(events as ArchiveEvent[], new Map([[id, String(model.name)]])));
      const latest = stories.find((s) => s.kind !== "drift");
      const title = `${providerName(String(model.provider))} ${modelName(id, String(model.name))}`;
      const price = `${money(String(model.promptPrice))} in · ${money(String(model.completionPrice))} out per million tokens · ${formatContext(String(model.contextLength))} context`;
      const sub = latest ? `${latest.headline} (${longDate(latest.at)})` : `No changes since ${longDate(String(model.firstSeenAt))}`;
      return card(title, price, sub, model.active ? `${Number(model.changeCount ?? 0)} changes on record` : "No longer listed");
    }),

    ogStory: endpoint({ method: "GET", path: "/og/story.png", mode: "read" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const id = req.query.get("model") ?? "";
      const at = req.query.get("at") ?? "";
      const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", id)).first();
      const events = await ctx.db.events.withIndex("by_model", (range) => range.eq("modelId", id)).order("desc").take(400);
      const names = new Map([[id, String(model?.name ?? id)]]);
      const stories = groupStories(events as ArchiveEvent[], names);
      const story = stories.find((s) => s.at === at) ?? stories[0];
      if (!story) return card("AI Observatory", "No story found", id, "");
      const delta = storyDelta(story);
      return card(story.headline, [story.detail, ...story.more].filter(Boolean).join(" · "), `${longDate(story.at)}${delta === null ? "" : ` · ${delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(0)}%`}`, "ai-observatory.view.fast");
    }),

    ogSite: endpoint({ method: "GET", path: "/og/site.png", mode: "read" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const active = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      const providers = new Set(active.map((m) => String(m.provider).replace(/^~/, "")));
      const stories = await filteredStories(ctx, new URLSearchParams(), 6);
      const lead = stories.find((s) => !s.source && s.kind !== "drift");
      return card("AI Observatory", "The changelog AI providers don't publish", lead ? lead.headline : "", `${active.length} models · ${providers.size} providers · checked every 30 minutes`);
    }),

    /** Platform cron: the daily rollup. Guarded by CRON_SECRET so only the scheduler can run it. */
    cronRollup: endpoint({ method: "GET", path: "/cron/rollup", mode: "write" }, async (ctx, req) => {
      const secret = ctx.env.CRON_SECRET;
      const header = req.headers.get("authorization") ?? "";
      if (!secret || header !== `Bearer ${secret}`) return json({ ok: false, error: "unauthorized" }, { status: 401 });
      const result = await rollup(ctx, now().slice(0, 10));
      return json({ ok: true, ...result });
    }),
  },
});

const API_HEADERS = { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } };

const INDEX_METHOD =
  "Per day, over active models that are not rolling aliases and not free: blended price = (3 × input + output) / 4 per million tokens. " +
  "Frontier = the 15 highest Artificial Analysis intelligence scores, mid = the next 30, budget = the rest with a score. Each tier reports its median.";

/** Fields written for the first time by v2. A blank before-value on an old row is not a change. */
const NEW_FIELDS = new Set<string>(["aliasTarget", "expirationDate", "tiers", "knowledgeCutoff", "inputModalities", "reasoning"]);

type RawModel = {
  id?: string;
  name?: string;
  description?: string;
  canonical_slug?: string;
  hugging_face_id?: string | null;
  knowledge_cutoff?: string | null;
  expiration_date?: string | null;
  alias_target?: { slug?: string; name?: string } | null;
  context_length?: number;
  architecture?: { modality?: string; tokenizer?: string; input_modalities?: string[] };
  pricing?: Record<string, unknown> & { overrides?: { min_prompt_tokens?: number; prompt?: string; completion?: string }[] };
  top_provider?: { max_completion_tokens?: number; is_moderated?: boolean };
  supported_parameters?: string[];
  reasoning?: { mandatory?: boolean } | null;
  benchmarks?: { artificial_analysis?: { intelligence_index?: number | null; coding_index?: number | null; agentic_index?: number | null } | null } | null;
  created?: number;
};

type RawEndpoint = {
  provider_name?: string;
  tag?: string;
  quantization?: string | null;
  context_length?: number;
  max_completion_tokens?: number | null;
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
  status?: number;
  uptime_last_30m?: number | null;
  uptime_last_1d?: number | null;
};

type SourceListing = {
  sourceId: string;
  provider: string;
  name?: string;
  contextLength?: number | string;
  maxCompletion?: number | string;
  promptPrice?: number | string;
  completionPrice?: number | string;
  cacheReadPrice?: number | string;
  releaseDate?: string;
};

type RawLifecycle = {
  provider: string;
  modelId: string;
  state?: string;
  deprecatedAt?: string;
  retiresAt?: string;
  retiresNote?: string;
  replacement?: string;
  sourceUrl?: string;
};

/** What is diffed between sweeps of another catalogue. */
const SOURCE_FIELDS = ["name", "contextLength", "maxCompletion", "promptPrice", "completionPrice", "cacheReadPrice"] as const;
const HOST_FIELDS = ["host", "quantization", "contextLength", "maxCompletion", "promptPrice", "completionPrice", "cacheReadPrice"] as const;
const LIFECYCLE_FIELDS = ["state", "deprecatedAt", "retiresAt", "retiresNote", "replacement"] as const;

type StatusReport = {
  provider: string;
  indicator: string;
  description?: string;
  incidents?: { id: string; name?: string; impact?: string; status?: string; createdAt?: string; resolvedAt?: string; updatedAt?: string; url?: string }[];
};
type PackageReport = { pkg: string; downloads?: number };
type PypiReport = { pkg: string; lastDay?: number; lastWeek?: number; lastMonth?: number };
type RepoReport = { repo: string; stars?: number; forks?: number; openIssues?: number };
type HfModel = { id?: string; likes?: number; downloads?: number };

/** Loosely typed table access for helpers and endpoints, which do not get the schema-typed db. */
type LooseRange = {
  eq(field: string, value: unknown): LooseRange;
  gt(field: string, value: unknown): LooseRange;
  gte(field: string, value: unknown): LooseRange;
  lt(field: string, value: unknown): LooseRange;
  lte(field: string, value: unknown): LooseRange;
};
type LooseQuery = {
  order(direction: "asc" | "desc"): LooseQuery;
  collect(): Promise<any[]>;
  take(count: number): Promise<any[]>;
  first(): Promise<any>;
  paginate(options: { cursor: string | null; numItems: number }): Promise<{ page: any[]; continueCursor: string | null; isDone: boolean }>;
};
type LooseTable = {
  get(id: string): Promise<any>;
  withIndex(index: string, range?: (query: LooseRange) => LooseRange): LooseQuery;
  insert(value: any): Promise<any>;
  update(id: string, patch: any): Promise<any>;
  delete(id: string): Promise<boolean>;
};
type AnyDb = Record<string, LooseTable>;
type Ctx = { db: AnyDb; env: Record<string, string | undefined> };

/** Unix seconds to ISO, falling back to the sweep time when the source omits it. */
function firstSeenFrom(created: number | undefined, fallback: string): string {
  if (!created || !Number.isFinite(created)) return fallback;
  const ms = created * 1000;
  if (ms <= 0 || ms > Date.now() + 86_400_000) return fallback;
  return new Date(ms).toISOString();
}

function toTracked(raw: RawModel): TrackedModel {
  const modelId = raw.id ?? "";
  const pricing = raw.pricing ?? {};
  const tiers = (pricing.overrides ?? [])
    .filter((t) => Number.isFinite(Number(t?.min_prompt_tokens)))
    .sort((a, b) => Number(a.min_prompt_tokens) - Number(b.min_prompt_tokens))
    .map((t) => `${Number(t.min_prompt_tokens)}:${normalizeNumeric(t.prompt)}:${normalizeNumeric(t.completion)}`)
    .join(";");
  const aa = raw.benchmarks?.artificial_analysis ?? null;
  const score = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "" : String(value));
  return {
    modelId,
    provider: providerOf(modelId),
    name: raw.name ?? modelId,
    description: String(raw.description ?? "").slice(0, 600),
    canonicalSlug: raw.canonical_slug ?? "",
    huggingFaceId: raw.hugging_face_id ?? "",
    knowledgeCutoff: raw.knowledge_cutoff ?? "",
    expirationDate: raw.expiration_date ?? "",
    aliasTarget: raw.alias_target?.slug ?? "",
    contextLength: normalizeNumeric(raw.context_length),
    maxCompletion: normalizeNumeric(raw.top_provider?.max_completion_tokens),
    promptPrice: normalizeNumeric(pricing.prompt),
    completionPrice: normalizeNumeric(pricing.completion),
    cacheReadPrice: normalizeNumeric(pricing.input_cache_read),
    cacheWritePrice: normalizeNumeric(pricing.input_cache_write),
    tiers,
    modality: raw.architecture?.modality ?? "",
    inputModalities: (raw.architecture?.input_modalities ?? []).slice().sort().join(","),
    tokenizer: raw.architecture?.tokenizer ?? "",
    supportedParams: (raw.supported_parameters ?? []).slice().sort().join(","),
    reasoning: raw.reasoning ? (raw.reasoning.mandatory ? "mandatory" : "optional") : "",
    moderated: raw.top_provider?.is_moderated === true,
    aaIntelligence: score(aa?.intelligence_index),
    aaCoding: score(aa?.coding_index),
    aaAgentic: score(aa?.agentic_index),
  };
}

/** The columns refreshed on every sweep without being part of the fingerprint. */
function untracked(model: TrackedModel) {
  return {
    description: model.description,
    canonicalSlug: model.canonicalSlug,
    huggingFaceId: model.huggingFaceId,
    aaIntelligence: model.aaIntelligence,
    aaCoding: model.aaCoding,
    aaAgentic: model.aaAgentic,
  };
}

function toHost(modelId: string, raw: RawEndpoint) {
  const pricing = raw.pricing ?? {};
  const reading = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? "" : String(value));
  return {
    modelId,
    host: raw.provider_name ?? "",
    tag: raw.tag ?? "",
    quantization: raw.quantization ?? "",
    contextLength: normalizeNumeric(raw.context_length),
    maxCompletion: normalizeNumeric(raw.max_completion_tokens),
    promptPrice: normalizeNumeric(pricing.prompt),
    completionPrice: normalizeNumeric(pricing.completion),
    cacheReadPrice: normalizeNumeric(pricing.input_cache_read),
    uptime1d: reading(raw.uptime_last_1d),
    uptime30m: reading(raw.uptime_last_30m),
    status: reading(raw.status),
  };
}

/** "provider/name-version" families: the id's first two dash-separated tokens after the slash. */
function familyStem(modelId: string): string {
  const clean = modelId.replace(/^~/, "");
  const slash = clean.indexOf("/");
  const slug = (slash === -1 ? clean : clean.slice(slash + 1)).split(":")[0];
  const parts = slug.split("-");
  return `${clean.slice(0, slash === -1 ? 0 : slash)}/${parts.slice(0, 2).join("-")}`;
}

/**
 * Fills the v2 statistics columns for a row written before they existed, from its own
 * archive, so "cheapest ever" and the records board are right from the first sweep.
 */
async function v2Columns(ctx: Ctx, prior: Record<string, unknown>) {
  const events = await ctx.db.events.withIndex("by_model", (range: any) => range.eq("modelId", String(prior.modelId))).order("asc").collect();
  let lowInput = Number(prior.promptPrice);
  let lowInputAt = String(prior.firstSeenAt ?? "");
  let highInput = lowInput;
  let highInputAt = lowInputAt;
  let lowOutput = Number(prior.completionPrice);
  let highOutput = lowOutput;
  let changeCount = 0;
  let lastChangedAt = "";
  for (const e of events) {
    if (e.kind !== "changed") continue;
    changeCount++;
    lastChangedAt = String(e.at);
    const values = [Number(e.oldValue), Number(e.newValue)];
    if (e.field === "promptPrice") {
      for (const v of values) {
        if (!Number.isFinite(v)) continue;
        if (v < lowInput) { lowInput = v; lowInputAt = String(e.at); }
        if (v > highInput) { highInput = v; highInputAt = String(e.at); }
      }
    }
    if (e.field === "completionPrice") {
      for (const v of values) {
        if (!Number.isFinite(v)) continue;
        if (v < lowOutput) lowOutput = v;
        if (v > highOutput) highOutput = v;
      }
    }
  }
  const str = (v: number) => (Number.isFinite(v) ? String(v) : "");
  return {
    lowInput: str(lowInput), lowInputAt, highInput: str(highInput), highInputAt,
    lowOutput: str(lowOutput), highOutput: str(highOutput),
    changeCount: String(changeCount), lastChangedAt,
  };
}

/** New extremes after a sweep that changed something. */
function priceExtremes(base: Record<string, unknown>, model: TrackedModel, at: string) {
  const out: Record<string, string> = {};
  const input = Number(model.promptPrice);
  const output = Number(model.completionPrice);
  const low = Number(base.lowInput);
  const high = Number(base.highInput);
  if (Number.isFinite(input)) {
    if (!Number.isFinite(low) || base.lowInput === "" || input < low) { out.lowInput = model.promptPrice; out.lowInputAt = at; }
    if (!Number.isFinite(high) || base.highInput === "" || input > high) { out.highInput = model.promptPrice; out.highInputAt = at; }
  }
  if (Number.isFinite(output)) {
    const lowO = Number(base.lowOutput);
    const highO = Number(base.highOutput);
    if (!Number.isFinite(lowO) || base.lowOutput === "" || output < lowO) out.lowOutput = model.completionPrice;
    if (!Number.isFinite(highO) || base.highOutput === "" || output > highO) out.highOutput = model.completionPrice;
  }
  return out;
}

async function bumpRecord(
  ctx: Ctx,
  key: string,
  candidate: { modelId: string; provider: string; value: string; at: string; detail: string },
  better: (candidate: number, current: number) => boolean
) {
  const current = await ctx.db.records.withIndex("by_key", (range: any) => range.eq("key", key)).first();
  if (!current) {
    await ctx.db.records.insert({ key, ...candidate });
    return;
  }
  if (better(Number(candidate.value), Number(current.value))) await ctx.db.records.update(current.id, candidate);
}

async function noteRecords(ctx: Ctx, model: TrackedModel, field: string, before: string, after: string, at: string) {
  if (isAlias(model.modelId)) return;
  const x = Number(before);
  const y = Number(after);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const who = { modelId: model.modelId, provider: model.provider, at };
  if (field === "contextLength") {
    if (y > x) await bumpRecord(ctx, "largest-context-jump", { ...who, value: String(y), detail: `${formatContext(before)} → ${formatContext(after)}` }, (a, b) => a > b);
    return;
  }
  if (x <= 0 || y <= 0) return;
  const move = ((y - x) / x) * 100;
  const side = field === "promptPrice" ? "input" : "output";
  const detail = `${money(before)} → ${money(after)} per million`;
  if (move < 0) await bumpRecord(ctx, `biggest-cut-${side}`, { ...who, value: String(Math.abs(move).toFixed(1)), detail }, (a, b) => a > b);
  else await bumpRecord(ctx, `biggest-raise-${side}`, { ...who, value: String(move.toFixed(1)), detail }, (a, b) => a > b);
  if (field === "promptPrice") {
    await bumpRecord(ctx, "cheapest-listed-ever", { ...who, value: after, detail: `${money(after)} per million input` }, (a, b) => a < b);
    const row = await ctx.db.models.withIndex("by_model", (range: any) => range.eq("modelId", model.modelId)).first();
    const count = Number(row?.changeCount ?? 0) + 1;
    await bumpRecord(ctx, "most-repriced", { ...who, value: String(count), detail: `${count} recorded changes` }, (a, b) => a > b);
  }
}

async function noteCheapestListed(ctx: Ctx, model: TrackedModel, at: string) {
  if (isAlias(model.modelId) || !(Number(model.promptPrice) > 0)) return;
  await bumpRecord(ctx, "cheapest-listed-ever", { modelId: model.modelId, provider: model.provider, at, value: model.promptPrice, detail: `${money(model.promptPrice)} per million input` }, (a, b) => a < b);
}

/** The day's market summary. Written once per date and overwritten when run again. */
async function rollup(ctx: Ctx, day: string) {
  const active = await ctx.db.models.withIndex("by_active", (range: any) => range.eq("active", true)).take(1000);
  const priced = active.filter((row: any) => !isAlias(String(row.modelId)) && Number(row.promptPrice) > 0 && !String(row.modelId).endsWith(":free"));
  const providers = new Set(active.map((row: any) => String(row.provider).replace(/^~/, "")));
  const inputs = priced.map((row: any) => Number(row.promptPrice) * 1_000_000);
  const outputs = priced.map((row: any) => Number(row.completionPrice) * 1_000_000);
  const scored = priced
    .filter((row: any) => row.aaIntelligence !== "" && Number.isFinite(Number(row.aaIntelligence)))
    .sort((a: any, b: any) => Number(b.aaIntelligence) - Number(a.aaIntelligence));
  const tier = (rows: any[]) => ({
    in: median(rows.map((row) => Number(row.promptPrice) * 1_000_000)),
    out: median(rows.map((row) => Number(row.completionPrice) * 1_000_000)),
    n: rows.length,
  });
  const frontier = scored.slice(0, 15);
  const mid = scored.slice(15, 45);
  const budget = scored.slice(45);
  const cheapestFrontier = frontier.slice().sort((a: any, b: any) => blendedPerMillion(a.promptPrice, a.completionPrice) - blendedPerMillion(b.promptPrice, b.completionPrice))[0];
  const dayStart = `${day}T00:00:00.000Z`;
  const dayEnd = `${day}T23:59:59.999Z`;
  const changes = await ctx.db.events.withIndex("by_at", (range: any) => range.gte("at", dayStart).lte("at", dayEnd)).take(1000);
  const num = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : "");
  const f = tier(frontier);
  const m = tier(mid);
  const b = tier(budget);
  const row = {
    date: day,
    listed: String(active.length),
    providers: String(providers.size),
    aliases: String(active.filter((r: any) => isAlias(String(r.modelId))).length),
    free: String(active.filter((r: any) => String(r.modelId).endsWith(":free") || Number(r.promptPrice) === 0).length),
    medianIn: num(median(inputs)),
    medianOut: num(median(outputs)),
    frontierIn: num(f.in), frontierOut: num(f.out), frontierN: String(f.n),
    midIn: num(m.in), midOut: num(m.out), midN: String(m.n),
    budgetIn: num(b.in), budgetOut: num(b.out), budgetN: String(b.n),
    cheapestFrontierIn: cheapestFrontier ? num(Number(cheapestFrontier.promptPrice) * 1_000_000) : "",
    cheapestFrontierId: cheapestFrontier ? String(cheapestFrontier.modelId) : "",
    changes: String(changes.length),
  };
  const existing = await ctx.db.daily.withIndex("by_date", (range: any) => range.eq("date", day)).first();
  if (existing) await ctx.db.daily.update(existing.id, row);
  else await ctx.db.daily.insert(row);

  const byProvider = new Map<string, any[]>();
  for (const r of active) {
    if (isAlias(String(r.modelId))) continue;
    const slug = canonicalProvider(String(r.provider));
    const list = byProvider.get(slug);
    if (list) list.push(r);
    else byProvider.set(slug, [r]);
  }
  let providerRows = 0;
  for (const [provider, rows] of byProvider) {
    const paid = rows.filter((r) => Number(r.promptPrice) > 0);
    const entry = {
      date: day,
      provider,
      listed: String(rows.length),
      medianIn: num(median(paid.map((r) => Number(r.promptPrice) * 1_000_000))),
      medianOut: num(median(paid.map((r) => Number(r.completionPrice) * 1_000_000))),
    };
    const prior = await ctx.db.providerDaily.withIndex("by_provider_date", (range: any) => range.eq("provider", provider).eq("date", day)).first();
    if (prior) await ctx.db.providerDaily.update(prior.id, entry);
    else await ctx.db.providerDaily.insert(entry);
    providerRows++;
  }
  await ctx.db.polls.insert({ at: now(), source: "rollup", ok: true, note: `${day}: ${priced.length} priced, ${providerRows} providers`, ms: "0" });
  return { date: day, priced: priced.length, providers: providerRows };
}

/** Recent stories across the archive, host events and lifecycle notices, filtered by query params. */
async function filteredStories(ctx: Ctx, params: URLSearchParams, limit: number): Promise<Story[]> {
  const events = (await ctx.db.events.withIndex("by_at").order("desc").take(300)) as ArchiveEvent[];
  const hostEvents = (await ctx.db.hostEvents.withIndex("by_at").order("desc").take(100)) as HostEvent[];
  const lifecycleEvents = (await ctx.db.lifecycleEvents.withIndex("by_at").order("desc").take(100)) as LifecycleEvent[];
  const sourceEvents = await ctx.db.sourceEvents.withIndex("by_at").order("desc").take(200);
  const active = await ctx.db.models.withIndex("by_active", (range: any) => range.eq("active", true)).take(1000);
  const names = new Map<string, string>(active.map((m: any) => [String(m.modelId), String(m.name)]));
  const keyToModel = new Map<string, string>(active.map((m: any) => [canonicalKey(String(m.provider), String(m.modelId)), String(m.modelId)]));
  const fromSources: ArchiveEvent[] = sourceEvents.map((r: any) => ({
    id: r.id, at: r.at, kind: r.kind, modelId: r.key, provider: r.provider, field: r.field, oldValue: r.oldValue, newValue: r.newValue, source: r.source,
  }));
  const keyOf = (s: Story) => (s.source ? s.modelId : canonicalKey(s.provider, s.modelId));
  let stories = corroborate(foldFlapping(foldAliases(foldDrift(groupStories([...events, ...fromSources], names)))), keyOf)
    .filter((s) => !s.source)
    .concat(foldDrift(hostStories(hostEvents, names)), lifecycleStories(lifecycleEvents));
  for (const s of stories) if (s.source && s.source !== "hosts" && keyToModel.has(s.modelId)) s.modelId = keyToModel.get(s.modelId) as string;
  stories = sortStories(stories).filter((s) => s.kind !== "drift");

  const watch = (params.get("watch") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const provider = (params.get("provider") ?? "").toLowerCase();
  const model = params.get("model") ?? "";
  const kind = params.get("kind") ?? "";
  return stories
    .filter((s) => matchesWatch(s, watch))
    .filter((s) => !provider || canonicalProvider(s.provider) === canonicalProvider(provider))
    .filter((s) => !model || s.modelId === model)
    .filter((s) => !kind || s.kind === kind)
    .slice(0, limit);
}

function publicStory(s: Story) {
  return {
    at: s.at, kind: s.kind, model: s.modelId, provider: s.provider, headline: s.headline, detail: s.detail, more: s.more,
    source: s.source ?? "openrouter", host: s.host ?? null, confirmedBy: s.confirmedBy ?? [], delta: storyDelta(s),
    url: s.source && s.source !== "hosts" ? `${SITE}/retiring` : `${SITE}/model/${s.modelId}`,
    changes: s.events.map(publicEvent),
  };
}

function publicEvent(e: any) {
  return { at: e.at, kind: e.kind, model: e.modelId, provider: e.provider, field: e.field, oldValue: e.oldValue, newValue: e.newValue };
}

function publicModel(row: any) {
  const { id, createdAt, updatedAt, fingerprint, schemaVersion, ...rest } = row;
  return rest as ModelRow;
}

function escapeXml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A flat badge in the shields.io idiom, sized by character count since no font metrics are available. */
function badgeSvg(label: string, value: string, color: string): string {
  const width = (s: string) => Math.round(s.length * 6.6 + 12);
  const lw = width(label);
  const vw = width(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
<title>${escapeXml(label)}: ${escapeXml(value)}</title>
<clipPath id="r"><rect width="${lw + vw}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#2b3244"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14" fill="#fff">${escapeXml(label)}</text>
<text x="${lw + vw / 2}" y="14" fill="#0b0e14" font-weight="bold">${escapeXml(value)}</text>
</g></svg>`;
}

/** A 1200×630 share card. Intrinsic elements only; the renderer handles layout from `tw`. */
function card(title: string, line: string, sub: string, footer: string) {
  const element = h(
    "div",
    { tw: "flex flex-col w-full h-full p-16 justify-between", style: { backgroundColor: "#0b0e14", color: "#e7ebf3" } },
    h("div", { tw: "flex flex-col" },
      h("div", { tw: "text-3xl mb-6", style: { color: "#6ea8ff" } }, "AI Observatory"),
      h("div", { tw: "text-6xl font-bold leading-tight" }, title.length > 90 ? `${title.slice(0, 87)}…` : title),
      line ? h("div", { tw: "text-3xl mt-6", style: { color: "#8a94a8" } }, line.length > 110 ? `${line.slice(0, 107)}…` : line) : null,
      sub ? h("div", { tw: "text-3xl mt-3" }, sub.length > 110 ? `${sub.slice(0, 107)}…` : sub) : null
    ),
    h("div", { tw: "flex justify-between text-2xl", style: { color: "#8a94a8" } },
      h("div", {}, footer),
      h("div", {}, "ai-observatory.view.fast")
    )
  );
  return new ImageResponse(element as any, { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=3600" } });
}
