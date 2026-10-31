import { ImageResponse, boolean, capsule, endpoint, json, mutation, query, string, table, text } from "@spacefast/zero/server";
import { h } from "preact";

import {
  TRACKED_FIELDS,
  blendedPerMillion,
  daysBetween,
  describeEvent,
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
import { BENCHMARKS, benchmarkSpec, looseKey, looseSlug, providerFromOrg, splitVariant } from "../shared/benchmarks";
import { isAlias, modelName, providerName } from "../shared/providers";
import { FIRST_PARTY, canonicalKey, canonicalProvider } from "../shared/sources";
import {
  corroborate,
  foldAliases,
  foldDrift,
  foldFlapping,
  foldVolatile,
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

/** The later of two ISO timestamps, so an older overlapping run never winds a last-seen time back. */
function later(a: string, b: string): string {
  return a > b ? a : b;
}

/** Marks a model's hosts as no longer serving it, without events: the model's own removal is the story. */
async function retireHosts(ctx: Ctx, modelId: string) {
  const hosts = await ctx.db.hosts.withIndex("by_model", (range: any) => range.eq("modelId", modelId)).collect();
  for (const host of hosts) if (host.active === true) await ctx.db.hosts.update(host.id, { active: false });
}

/** The rows of the newest daily snapshot, from rows read newest first. One daily run writes one `at` for all its rows. */
function newestSnapshot<T extends { at: unknown }>(rows: T[]): T[] {
  const at = rows[0]?.at;
  return rows.filter((row) => row.at === at);
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
      .index("by_provider_at", ["provider", "at"])
      .index("by_field_at", ["field", "at"]),

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

    /** Where a walk longer than one collector run stopped, so the next run continues from there. */
    cursors: table({
      job: string(),
      cursor: string(),
      at: string(),
    }).index("by_job", ["job"]),

    /**
     * Published benchmark results, one row per (leaderboard, benchmark, model as the source
     * names it). `key` is the loose model key the catalogue is joined on; `rowKey` is the
     * source's own identity for the row, for upserts.
     */
    benchmarks: table({
      source: string(),
      slug: string(),
      benchmark: string(),
      key: string(),
      provider: string(),
      sourceModel: string(),
      variant: string(),
      score: string(),
      unit: string(),
      rank: string(),
      detail: string(),
      date: string(),
      url: string(),
      rowKey: string(),
      fingerprint: string(),
      firstSeenAt: string(),
      lastSeenAt: string(),
      active: boolean(),
    })
      .index("by_source", ["source"])
      .index("by_source_row", ["source", "rowKey"])
      .index("by_slug", ["slug"])
      .index("by_key", ["key"]),
  },

  queries: {
    activeModels: query(async (ctx) =>
      ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).order("asc").take(1000)
    ),
    retiredModels: query(async (ctx) =>
      ctx.db.models.withIndex("by_active", (range) => range.eq("active", false)).order("asc").take(1000)
    ),
    statuses: query(async (ctx) =>
      ctx.db.providerStatus.withIndex("by_provider").order("asc").take(50)
    ),
    /**
     * Pulse in one subscription: the newest daily snapshot of each list, and the collector's
     * recent record. Each list is cut to its own newest snapshot, so a source that failed on the
     * latest day still shows its last good one, with that snapshot's date.
     */
    pulsePage: query(async (ctx) => {
      const trending = newestSnapshot(await ctx.db.trending.withIndex("by_at").order("desc").take(50));
      const packages = newestSnapshot(await ctx.db.packages.withIndex("by_at").order("desc").take(20));
      const pypi = newestSnapshot(await ctx.db.pypi.withIndex("by_at").order("desc").take(20));
      const repos = newestSnapshot(await ctx.db.repos.withIndex("by_at").order("desc").take(20));
      const polls = await ctx.db.polls.withIndex("by_at").order("desc").take(20);
      return {
        trending: trending.sort((a, b) => Number(a.rank) - Number(b.rank)),
        packages: packages.sort((a, b) => Number(b.downloads) - Number(a.downloads)),
        pypi: pypi.sort((a, b) => Number(b.lastWeek) - Number(a.lastWeek)),
        repos: repos.sort((a, b) => Number(b.stars) - Number(a.stars)),
        polls,
      };
    }),

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
      const retiringSince = new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10);
      const retiring = (await ctx.db.lifecycle.withIndex("by_retires", (range) => range.gte("retiresAt", retiringSince)).order("asc").take(300))
        .filter((row) => row.active === true && row.state !== "active");
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
      // Projected to what the page reads: the full rows run past the response size limit.
      const slim = (row: any) => ({
        id: row.id, modelId: row.modelId, provider: row.provider, name: row.name,
        promptPrice: row.promptPrice, completionPrice: row.completionPrice, contextLength: row.contextLength,
        changeCount: row.changeCount, lastChangedAt: row.lastChangedAt, lowInput: row.lowInput, lowInputAt: row.lowInputAt,
        highInput: row.highInput, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, aliasTarget: row.aliasTarget,
        expirationDate: row.expirationDate, aaIntelligence: row.aaIntelligence, active: row.active,
      });
      const slimEvent = (e: any) => ({ id: e.id, at: e.at, kind: e.kind, modelId: e.modelId, provider: e.provider, field: e.field, oldValue: e.oldValue, newValue: e.newValue });
      return {
        models: models.map(slim), events: events.map(slimEvent), hostEvents, lifecycleEvents, sourceEvents,
        statuses, statusEvents, incidents, records, retiring, cheapest: cheapest.map(slim), freshness, sweeps: sweeps.reverse(),
      };
    }),

    /**
     * The Changes page in one subscription. Each page is 150 more archive events, newest first. Host, notice
     * and price-list events come from the same stretch of time, so no filter shows more history than was
     * loaded. `from` is where that stretch starts ("" when it reaches the start of the record) and `more`
     * says whether anything older exists.
     */
    changesPage: query(async (ctx, provider: string, pages: number) => {
      const limit = Math.max(1, Math.min(10, Math.floor(Number(pages)) || 1)) * 150;
      const archive = provider
        ? await ctx.db.events.withIndex("by_provider_at", (range) => range.eq("provider", provider)).order("desc").take(limit + 1)
        : await ctx.db.events.withIndex("by_at").order("desc").take(limit + 1);
      let more = archive.length > limit;
      const events = archive.slice(0, limit);
      let from = more && events.length ? String(events[events.length - 1].at) : "";
      // Each other kind is read from `from` on. A read that fills its cap means the stretch is shorter
      // than the archive part; it then starts where that read runs out.
      const stretch = async <T extends { at: unknown }>(read: (since: string) => Promise<T[]>, cap: number): Promise<T[]> => {
        const rows = await read(from);
        if (rows.length >= cap) {
          from = later(from, String(rows[rows.length - 1].at));
          more = true;
        }
        return rows;
      };
      const hostEvents = await stretch((since) => (since ? ctx.db.hostEvents.withIndex("by_at", (range) => range.gte("at", since)) : ctx.db.hostEvents.withIndex("by_at")).order("desc").take(1000), 1000);
      const lifecycleEvents = await stretch((since) => (since ? ctx.db.lifecycleEvents.withIndex("by_at", (range) => range.gte("at", since)) : ctx.db.lifecycleEvents.withIndex("by_at")).order("desc").take(400), 400);
      const sourceEvents = await stretch((since) => (since ? ctx.db.sourceEvents.withIndex("by_at", (range) => range.gte("at", since)) : ctx.db.sourceEvents.withIndex("by_at")).order("desc").take(400), 400);
      const within = <T extends { at: unknown }>(rows: T[]) => (from ? rows.filter((row) => String(row.at) >= from) : rows);
      return { events: within(events), hostEvents: within(hostEvents), lifecycleEvents: within(lifecycleEvents), sourceEvents: within(sourceEvents), from, more };
    }),

    /**
     * Input-price moves over the last `days`, for the catalogue's sparklines. Read through the field index
     * a page at a time, since a busy fortnight holds more events than one read. A model that moved more
     * than 40 times keeps 40 evenly spread moves and its latest, which is all a 64-pixel line can show.
     */
    priceTrail: query(async (ctx, days: number) => {
      const since = new Date(Date.now() - Math.min(Math.max(Number(days) || 90, 1), 365) * DAY).toISOString();
      const byModel = new Map<string, { at: string; oldValue: string; newValue: string }[]>();
      let cursor: string | null = null;
      for (;;) {
        const page = await ctx.db.events
          .withIndex("by_field_at", (range) => range.eq("field", "promptPrice").gte("at", since))
          .order("asc")
          .paginate({ cursor, numItems: 500 });
        for (const e of page.page) {
          if (e.kind !== "changed") continue;
          const list = byModel.get(String(e.modelId)) ?? [];
          list.push({ at: String(e.at), oldValue: String(e.oldValue), newValue: String(e.newValue) });
          byModel.set(String(e.modelId), list);
        }
        if (page.isDone || !page.continueCursor) break;
        cursor = page.continueCursor;
      }
      const out: { modelId: string; kind: string; field: string; at: string; oldValue: string; newValue: string }[] = [];
      for (const [modelId, list] of byModel) {
        const step = Math.ceil(list.length / 40);
        const keep = step <= 1 ? list : list.filter((_, i) => i % step === 0 || i === list.length - 1);
        for (const e of keep) out.push({ modelId, kind: "changed", field: "promptPrice", ...e });
      }
      return out;
    }),

    /** How many archive events each provider had in the last `days`, counted a page at a time. */
    providerChanges: query(async (ctx, days: number) => {
      const since = new Date(Date.now() - Math.min(Math.max(Number(days) || 7, 1), 90) * DAY).toISOString();
      const counts: Record<string, number> = {};
      let cursor: string | null = null;
      for (;;) {
        const page = await ctx.db.events.withIndex("by_at", (range) => range.gte("at", since)).paginate({ cursor, numItems: 500 });
        for (const e of page.page) {
          const slug = String(e.provider).replace(/^~/, "");
          counts[slug] = (counts[slug] ?? 0) + 1;
        }
        if (page.isDone || !page.continueCursor) break;
        cursor = page.continueCursor;
      }
      return counts;
    }),

    /** The model page in one subscription: the row, its archive, hosts, notices, and family. */
    modelPage: query(async (ctx, modelId: string) => {
      const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", modelId)).first();
      if (!model) {
        return { model: null, events: [], hosts: [], hostEvents: [], lifecycle: [], listings: [], sourceEvents: [], benchmarks: [], family: [] };
      }
      const events = await ctx.db.events.withIndex("by_model", (range) => range.eq("modelId", modelId)).order("asc").collect();
      const hosts = await ctx.db.hosts.withIndex("by_model", (range) => range.eq("modelId", modelId)).collect();
      const hostEvents = await ctx.db.hostEvents.withIndex("by_model", (range) => range.eq("modelId", modelId)).order("asc").collect();
      const key = canonicalKey(String(model.provider), modelId);
      const lifecycle = await ctx.db.lifecycle.withIndex("by_key", (range) => range.eq("key", key)).collect();
      const listings = await ctx.db.sourceModels.withIndex("by_key", (range) => range.eq("key", key)).collect();
      const sourceEvents = await ctx.db.sourceEvents.withIndex("by_key", (range) => range.eq("key", key)).order("asc").collect();
      const benchmarks = await benchmarksFor(ctx as unknown as Ctx, String(model.provider), modelId);

      const siblings = await ctx.db.models.withIndex("by_provider", (range) => range.eq("provider", String(model.provider))).collect();
      const aliasProvider = isAlias(modelId) ? String(model.provider).replace(/^~/, "") : `~${model.provider}`;
      const aliasSide = await ctx.db.models.withIndex("by_provider", (range) => range.eq("provider", aliasProvider)).collect();
      const stem = familyStem(modelId);
      const family = [...siblings, ...aliasSide].filter(
        (row) => row.modelId !== modelId && (familyStem(String(row.modelId)) === stem || row.aliasTarget === modelId || model.aliasTarget === row.modelId)
      );
      return { model, events, hosts, hostEvents, lifecycle, listings, sourceEvents, benchmarks, family };
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

    /**
     * Per model served by two or more hosts: how many, and the cheapest. Reads every active host a
     * page at a time, keeping only a running tally, since there are more of them than one read holds.
     */
    hostsOverview: query(async (ctx) => {
      const byModel = new Map<string, { hosts: number; cheapestHost: string; cheapestIn: string }>();
      let cursor: string | null = null;
      for (;;) {
        const page = await ctx.db.hosts.withIndex("by_active", (range) => range.eq("active", true)).paginate({ cursor, numItems: 500 });
        for (const row of page.page) {
          const modelId = String(row.modelId);
          const price = Number(row.promptPrice);
          const entry = byModel.get(modelId);
          if (!entry) {
            byModel.set(modelId, { hosts: 1, cheapestHost: String(row.host), cheapestIn: String(row.promptPrice) });
            continue;
          }
          entry.hosts++;
          const best = Number(entry.cheapestIn);
          if (price > 0 && (!(best > 0) || price < best)) {
            entry.cheapestHost = String(row.host);
            entry.cheapestIn = String(row.promptPrice);
          }
        }
        if (page.isDone || !page.continueCursor) break;
        cursor = page.continueCursor;
      }
      const out: { modelId: string; cheapestHost: string; cheapestIn: string; hosts: string }[] = [];
      for (const [modelId, entry] of byModel) {
        if (entry.hosts < 2) continue;
        out.push({ modelId, cheapestHost: entry.cheapestHost, cheapestIn: entry.cheapestIn, hosts: String(entry.hosts) });
      }
      return out;
    }),

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

    /** Every current result on one leaderboard. The client joins them to the catalogue. */
    benchmarkPage: query(async (ctx, slug: string) => {
      const rows = await ctx.db.benchmarks.withIndex("by_slug", (range) => range.eq("slug", slug)).collect();
      return { slug, rows: rows.filter((row) => row.active === true) };
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
            lastSeenAt: later(String(prior.lastSeenAt ?? ""), at),
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
          lastSeenAt: later(String(prior.lastSeenAt ?? ""), at),
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
        // Seen by this sweep or a later one. Only rows last seen before this sweep began are gone; an
        // overlapping sweep that stamped a newer time must not make them look absent.
        if (String(row.lastSeenAt ?? "") >= at) continue;
        await ctx.db.models.update(row.id, { active: false });
        await retireHosts(ctx, String(row.modelId));
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

      // Models retired before their hosts were retired with them still show hosts serving them. Clear those once.
      const cleared = await ctx.db.cursors.withIndex("by_job", (range) => range.eq("job", "retired-hosts")).first();
      if (!cleared) {
        for (const row of rows) if (row.active === false) await retireHosts(ctx, String(row.modelId));
        await ctx.db.cursors.insert({ job: "retired-hosts", cursor: "done", at });
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

    /** The last model the hosts walk read, or "" before the first run. */
    hostsCursor: mutation(async (ctx, token: string) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const row = await ctx.db.cursors.withIndex("by_job", (range) => range.eq("job", "hosts")).first();
      return { ok: true, cursor: row ? String(row.cursor) : "" };
    }),

    /** Marks the end of a hosts run so freshness can report it, and saves where the walk stopped. */
    finalizeHosts: mutation(async (ctx, token: string, runAt: string, models: number, ms: number, cursor: string) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const at = runAt || now();
      const row = await ctx.db.cursors.withIndex("by_job", (range) => range.eq("job", "hosts")).first();
      if (row) await ctx.db.cursors.update(row.id, { cursor, at });
      else await ctx.db.cursors.insert({ job: "hosts", cursor, at });
      await ctx.db.polls.insert({ at, source: "hosts", ok: true, note: `${models} models' hosts read`, ms: String(ms ?? 0) });
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
        if (row.active === false || String(row.lastSeenAt ?? "") >= at) continue;
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
      const touched = rows.filter((row) => String(row.lastSeenAt ?? "") >= at).length;
      // An empty run means the page could not be parsed, not that every notice was withdrawn.
      if (touched === 0 && rows.length > 0) {
        await ctx.db.polls.insert({ at, source: `lifecycle:${source}`, ok: false, note: "no rows this run; nothing retired", ms: String(Date.now() - started) });
        return { ok: true, removed: 0, ignored: true };
      }
      for (const row of rows) {
        if (row.active === false || String(row.lastSeenAt ?? "") >= at) continue;
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

        // A status page lists every open incident, so one stored as open but missing from a good read
        // has closed. Its last recorded update is the best end time known.
        if (indicator !== "unreachable") {
          const reported = new Set((source.incidents ?? []).map((incident) => String(incident?.id ?? "")));
          const stored = await ctx.db.incidents.withIndex("by_provider_incident", (range) => range.eq("provider", source.provider)).collect();
          for (const row of stored) {
            if (row.resolvedAt || reported.has(String(row.incidentId))) continue;
            await ctx.db.incidents.update(row.id, { resolvedAt: String(row.lastUpdateAt || at), status: "resolved" });
          }
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

    /** One page of the records rebuild. Call with the returned cursor until `done`. */
    rebuildRecords: mutation(async (ctx, token: string, cursor: string | null) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const result = await rebuildRecordsPage(ctx as unknown as Ctx, cursor ?? null);
      return { ok: true, ...result };
    }),

    /** The day's market summary, computed from the current catalogue. Idempotent per date. */
    rollupDaily: mutation(async (ctx, token: string, date?: string) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const day = date && date.length === 10 ? date : now().slice(0, 10);
      const result = await rollup(ctx, day);
      await repairOnce(ctx);
      return { ok: true, ...result };
    }),

    /**
     * One chunk of a leaderboard. Rows are upserted by the source's own naming; the loose key
     * that joins them to the catalogue is computed here so the rules live in one place.
     */
    ingestBenchmarks: mutation(async (ctx, token: string, source: string, runAt: string, rows: RawBenchmark[]) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const at = runAt || now();
      let added = 0;
      let changed = 0;

      for (const raw of rows ?? []) {
        if (!raw?.slug || !raw.sourceModel || raw.score === undefined || raw.score === "") continue;
        const { base, variant } = splitVariant(raw.sourceModel);
        const provider = providerFromOrg(raw.organization ?? "");
        const row = {
          source,
          slug: raw.slug,
          benchmark: raw.benchmark ?? raw.slug,
          key: looseKey(provider, base),
          provider,
          sourceModel: raw.sourceModel,
          variant,
          score: normalizeNumeric(raw.score),
          unit: raw.unit ?? "pct",
          rank: raw.rank ?? "",
          detail: raw.detail ?? "",
          date: raw.date ?? "",
          url: raw.url ?? "",
          rowKey: `${raw.slug}|${raw.sourceModel}`,
        };
        const fingerprint = BENCHMARK_FIELDS.map((field) => row[field]).join("|");
        const prior = await ctx.db.benchmarks.withIndex("by_source_row", (range) => range.eq("source", source).eq("rowKey", row.rowKey)).first();
        if (!prior) {
          await ctx.db.benchmarks.insert({ ...row, fingerprint, firstSeenAt: at, lastSeenAt: at, active: true });
          added++;
          continue;
        }
        if (prior.fingerprint === fingerprint && prior.active === true && prior.key === row.key) {
          await ctx.db.benchmarks.update(prior.id, { lastSeenAt: at });
          continue;
        }
        await ctx.db.benchmarks.update(prior.id, { ...row, fingerprint, lastSeenAt: at, active: true });
        changed++;
      }
      return { ok: true, added, changed };
    }),

    /** Marks a source's rows that this run did not send as gone. Nothing is deleted. */
    finalizeBenchmarks: mutation(async (ctx, token: string, source: string, runAt: string, listed: number) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const started = Date.now();
      const at = runAt || now();
      let removed = 0;
      let cursor: string | null = null;
      for (;;) {
        const page = await ctx.db.benchmarks.withIndex("by_source", (range) => range.eq("source", source)).paginate({ cursor, numItems: 200 });
        for (const row of page.page) {
          if (row.active === false || String(row.lastSeenAt ?? "") >= at) continue;
          await ctx.db.benchmarks.update(row.id, { active: false });
          removed++;
        }
        if (page.isDone || !page.continueCursor) break;
        cursor = page.continueCursor;
      }
      await ctx.db.polls.insert({ at, source, ok: true, note: `${listed} results, ${removed} gone`, ms: String(Date.now() - started) });
      return { ok: true, removed };
    }),
  },

  endpoints: {
    /** Atom feed of stories. `?watch=claude,deepseek` narrows it; so do `provider`, `model`, `kind`. */
    feed: endpoint({ method: "GET", path: "/feed.xml" }, async (raw, req) => {
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

    apiChanges: endpoint({ method: "GET", path: "/api/changes.json" }, async (raw, req) => {
      const stories = await filteredStories(raw as unknown as Ctx, req.query, 200);
      return json({ generatedAt: now(), stories: stories.map(publicStory) }, API_HEADERS);
    }),

    apiModels: endpoint({ method: "GET", path: "/api/models.json" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const includeRetired = req.query.get("retired") === "1";
      const active = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      const retired = includeRetired ? await ctx.db.models.withIndex("by_active", (range) => range.eq("active", false)).take(1000) : [];
      return json({ generatedAt: now(), models: [...active, ...retired].map(publicModel) }, API_HEADERS);
    }),

    apiModel: endpoint({ method: "GET", path: "/api/model.json" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const id = req.query.get("id") ?? "";
      const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", id)).first();
      if (!model) return json({ error: "unknown model", id }, { ...API_HEADERS, status: 404 });
      const events = await ctx.db.events.withIndex("by_model", (range) => range.eq("modelId", id)).order("asc").collect();
      const hosts = await ctx.db.hosts.withIndex("by_model", (range) => range.eq("modelId", id)).collect();
      const key = canonicalKey(String(model.provider), id);
      const lifecycle = await ctx.db.lifecycle.withIndex("by_key", (range) => range.eq("key", key)).collect();
      const listings = await ctx.db.sourceModels.withIndex("by_key", (range) => range.eq("key", key)).collect();
      const benchmarks = (await benchmarksFor(ctx, String(model.provider), id)).map(publicBenchmark);
      return json({ generatedAt: now(), model: publicModel(model), events: events.map(publicEvent), hosts, lifecycle, listings, benchmarks }, API_HEADERS);
    }),

    apiIndex: endpoint({ method: "GET", path: "/api/index.json" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const daily = await ctx.db.daily.withIndex("by_date").order("asc").take(1000);
      return json({ generatedAt: now(), method: INDEX_METHOD, daily }, API_HEADERS);
    }),

    apiStatus: endpoint({ method: "GET", path: "/api/status.json" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const since = new Date(Date.now() - 90 * DAY).toISOString();
      const statuses = await ctx.db.providerStatus.withIndex("by_provider").order("asc").take(50);
      const incidents = await ctx.db.incidents.withIndex("by_started", (range) => range.gte("startedAt", since)).order("desc").take(1000);
      return json({ generatedAt: now(), statuses, incidents }, API_HEADERS);
    }),

    apiRetiring: endpoint({ method: "GET", path: "/api/retiring.json" }, async (raw) => {
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

    apiRecords: endpoint({ method: "GET", path: "/api/records.json" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const records = await ctx.db.records.withIndex("by_key").order("asc").take(50);
      return json({ generatedAt: now(), records }, API_HEADERS);
    }),

    /** The leaderboards read, or with `?benchmark=`, every current result on one of them. */
    apiBenchmarks: endpoint({ method: "GET", path: "/api/benchmarks.json" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const slug = req.query.get("benchmark") ?? "";
      if (!slug) return json({ generatedAt: now(), benchmarks: BENCHMARKS }, API_HEADERS);
      const spec = benchmarkSpec(slug);
      if (!spec) return json({ error: "unknown benchmark", benchmark: slug, benchmarks: BENCHMARKS.map((b) => b.slug) }, { ...API_HEADERS, status: 404 });
      const rows = await ctx.db.benchmarks.withIndex("by_slug", (range) => range.eq("slug", slug)).collect();
      const results = rows.filter((row) => row.active === true).sort((a, b) => Number(b.score) - Number(a.score)).map(publicBenchmark);
      return json({ generatedAt: now(), benchmark: spec, results }, API_HEADERS);
    }),

    exportChanges: endpoint({ method: "GET", path: "/export/changes.csv" }, async (raw) => {
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

    /** Every page a crawler should know about. Model ids keep their slash, as the client's links do. */
    sitemap: endpoint({ method: "GET", path: "/sitemap.xml" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const today = now().slice(0, 10);
      const models = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      const urls: { loc: string; lastmod: string }[] = [];
      for (const path of ["/", "/changes", "/models", "/providers", "/retiring", "/status", "/price-index", "/records", "/graveyard", "/benchmarks", "/about", "/api", "/directory.html"]) {
        urls.push({ loc: `${SITE}${path}`, lastmod: today });
      }
      for (const b of BENCHMARKS) urls.push({ loc: `${SITE}/benchmarks?b=${b.slug}`, lastmod: today });
      const providers = new Set<string>();
      for (const row of models) {
        providers.add(String(row.provider).replace(/^~/, ""));
        const changed = String(row.lastChangedAt || row.lastSeenAt || "");
        urls.push({ loc: `${SITE}/model/${String(row.modelId)}`, lastmod: changed.length >= 10 ? changed.slice(0, 10) : today });
      }
      for (const slug of [...providers].sort()) urls.push({ loc: `${SITE}/provider/${slug}`, lastmod: today });
      const body = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeXml(u.loc)}</loc><lastmod>${escapeXml(u.lastmod)}</lastmod></url>`).join("\n")}
</urlset>
`;
      return text(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }),

    /** A plain HTML listing of every model and the latest changes, for crawlers that do not run scripts. */
    directory: endpoint({ method: "GET", path: "/directory.html" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const models = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      const events = await ctx.db.events.withIndex("by_at").order("desc").take(100);
      return text(directoryHtml(models as unknown as ModelRow[], events as unknown as ArchiveEvent[]), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=1800" },
      });
    }),

    /** Shields-style badge: `?model=anthropic/claude-haiku-4.5&metric=input|output|context|changed|retires`. */
    badge: endpoint({ method: "GET", path: "/badge.svg" }, async (raw, req) => {
      const ctx = raw as unknown as Ctx;
      const id = req.query.get("model") ?? "";
      const metric = req.query.get("metric") ?? "input";
      const model = await ctx.db.models.withIndex("by_model", (range) => range.eq("modelId", id)).first();
      let label = "ai observatory";
      let value = "unknown model";
      let color = "#9a958a";
      if (model) {
        const short = modelName(String(model.modelId), String(model.name));
        if (metric === "output") {
          label = `${short} · output`;
          value = `${money(String(model.completionPrice))}/M`;
          color = "#e0b84a";
        } else if (metric === "context") {
          label = `${short} · context`;
          value = `${formatContext(String(model.contextLength))} tokens`;
          color = "#e0b84a";
        } else if (metric === "changed") {
          label = `${short} · last change`;
          value = model.lastChangedAt ? `${daysBetween(String(model.lastChangedAt), now())}d ago` : "never";
          color = "#5fcf8a";
        } else if (metric === "retires") {
          const key = canonicalKey(String(model.provider), id);
          const notices = await ctx.db.lifecycle.withIndex("by_key", (range) => range.eq("key", key)).collect();
          const dated = notices.filter((n) => n.active === true && n.retiresAt).sort((a, b) => String(a.retiresAt).localeCompare(String(b.retiresAt)))[0];
          const when = dated ? String(dated.retiresAt) : String(model.expirationDate ?? "");
          label = `${short} · retires`;
          value = when ? (when > now().slice(0, 10) ? `in ${daysBetween(now(), when)}d` : "retired") : model.active ? "no date" : "removed";
          color = when ? "#f08a6a" : "#5fcf8a";
        } else {
          label = `${short} · input`;
          value = `${money(String(model.promptPrice))}/M`;
          color = "#e0b84a";
        }
        if (model.active === false) color = "#f08a6a";
      }
      return text(badgeSvg(label, value, color), { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=1800", "Access-Control-Allow-Origin": "*" } });
    }),

    ogModel: endpoint({ method: "GET", path: "/og/model.png" }, async (raw, req) => {
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

    ogStory: endpoint({ method: "GET", path: "/og/story.png" }, async (raw, req) => {
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

    ogSite: endpoint({ method: "GET", path: "/og/site.png" }, async (raw) => {
      const ctx = raw as unknown as Ctx;
      const active = await ctx.db.models.withIndex("by_active", (range) => range.eq("active", true)).take(1000);
      const providers = new Set(active.map((m) => String(m.provider).replace(/^~/, "")));
      const stories = await filteredStories(ctx, new URLSearchParams(), 6);
      const lead = stories.find((s) => !s.source && s.kind !== "drift");
      return card("AI Observatory", "The changelog AI providers don't publish", lead ? lead.headline : "", `${active.length} models · ${providers.size} providers · checked every hour`);
    }),

    /** Platform cron: the daily rollup. Guarded by CRON_SECRET so only the scheduler can run it. */
    cronRollup: endpoint({ method: "GET", path: "/cron/rollup", readOnly: false }, async (ctx, req) => {
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

/**
 * Prices below a tenth of a cent per million are routing placeholders, not list prices.
 * They are archived like any value but kept off the records board.
 */
const MIN_RECORD_PRICE = 1e-9;

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
type RawBenchmark = {
  slug?: string;
  benchmark?: string;
  sourceModel?: string;
  organization?: string;
  score?: string | number;
  unit?: string;
  rank?: string;
  detail?: string;
  date?: string;
  url?: string;
};

const SOURCE_FIELDS = ["name", "contextLength", "maxCompletion", "promptPrice", "completionPrice", "cacheReadPrice"] as const;
const BENCHMARK_FIELDS = ["benchmark", "variant", "score", "unit", "rank", "detail", "date", "url"] as const;
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
    // From an unknown size (0) is a first reading, not an increase.
    if (x > 0 && y > x) await bumpRecord(ctx, "largest-context-jump", { ...who, value: String(y - x), detail: `${formatContext(before)} → ${formatContext(after)}` }, (a, b) => a > b);
    return;
  }
  if (x < MIN_RECORD_PRICE || y < MIN_RECORD_PRICE) return;
  const move = ((y - x) / x) * 100;
  const side = field === "promptPrice" ? "input" : "output";
  const detail = `${money(before)} → ${money(after)} per million`;
  if (move < 0) await bumpRecord(ctx, `biggest-cut-${side}`, { ...who, value: String(Math.abs(move).toFixed(1)), detail }, (a, b) => a > b);
  else await bumpRecord(ctx, `biggest-raise-${side}`, { ...who, value: String(move.toFixed(1)), detail }, (a, b) => a > b);
  if (field === "promptPrice") {
    await bumpRecord(ctx, "cheapest-listed-ever", { ...who, value: after, detail: `${money(after)} per million input` }, (a, b) => a < b);
    const row = await ctx.db.models.withIndex("by_model", (range: any) => range.eq("modelId", model.modelId)).first();
    const count = Number(row?.changeCount ?? 0) + 1;
    await bumpRecord(ctx, "most-repriced", { ...who, value: String(count), detail: `${count} recorded ${count === 1 ? "change" : "changes"}` }, (a, b) => a > b);
  }
}

/**
 * Rebuilds the records board from the whole archive, one page of events per call. Needed once
 * after the board was introduced; records are kept incrementally from then on. Returns the
 * cursor to pass back in, and `done` when the archive has been walked.
 */
async function rebuildRecordsPage(ctx: Ctx, cursor: string | null) {
  if (!cursor) {
    const existing = await ctx.db.records.withIndex("by_key").take(50);
    for (const row of existing) await ctx.db.records.delete(row.id);
  }
  const models = await ctx.db.models.withIndex("by_model").take(1000);
  const byId = new Map<string, any>(models.map((m) => [String(m.modelId), m]));
  const counts = new Map<string, number>();
  const page = await ctx.db.events.withIndex("by_at").order("asc").paginate({ cursor, numItems: 500 });
  for (const e of page.page) {
    const row = byId.get(String(e.modelId));
    if (!row || isAlias(String(e.modelId))) continue;
    const model = { modelId: String(e.modelId), provider: String(e.provider) } as TrackedModel;
    if (e.kind === "added") {
      // A model that has never been repriced is still at its listing price, so its current
      // price is the price it was listed at.
      if (String(row.changeCount) === "0") {
        await noteCheapestListed(ctx, { ...model, promptPrice: String(row.promptPrice) } as TrackedModel, String(e.at));
      }
      continue;
    }
    if (e.kind === "removed") {
      const lived = daysBetween(String(row.firstSeenAt ?? e.at), String(e.at));
      if (lived >= 1) {
        await bumpRecord(ctx, "shortest-lived", { modelId: model.modelId, provider: model.provider, value: String(lived), at: String(e.at), detail: `listed ${longDate(String(row.firstSeenAt))}, removed ${longDate(String(e.at))}` }, (a, b) => a < b);
      }
      continue;
    }
    if (e.kind !== "changed") continue;
    if (e.field === "promptPrice" || e.field === "completionPrice" || e.field === "contextLength") {
      const x = Number(e.oldValue);
      const y = Number(e.newValue);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const who = { modelId: model.modelId, provider: model.provider, at: String(e.at) };
      if (e.field === "contextLength") {
        if (x > 0 && y > x) await bumpRecord(ctx, "largest-context-jump", { ...who, value: String(y - x), detail: `${formatContext(String(e.oldValue))} → ${formatContext(String(e.newValue))}` }, (a, b) => a > b);
        continue;
      }
      if (x < MIN_RECORD_PRICE || y < MIN_RECORD_PRICE) continue;
      const move = ((y - x) / x) * 100;
      if (Math.abs(move) < 3) continue;
      const side = e.field === "promptPrice" ? "input" : "output";
      const detail = `${money(String(e.oldValue))} → ${money(String(e.newValue))} per million`;
      if (move < 0) await bumpRecord(ctx, `biggest-cut-${side}`, { ...who, value: String(Math.abs(move).toFixed(1)), detail }, (a, b) => a > b);
      else await bumpRecord(ctx, `biggest-raise-${side}`, { ...who, value: String(move.toFixed(1)), detail }, (a, b) => a > b);
      if (e.field === "promptPrice") {
        await bumpRecord(ctx, "cheapest-listed-ever", { ...who, value: String(e.newValue), detail: `${money(String(e.newValue))} per million input` }, (a, b) => a < b);
        const n = (counts.get(model.modelId) ?? 0) + 1;
        counts.set(model.modelId, n);
      }
    }
  }
  // Most repriced is a property of the whole archive; the per-model counters on the rows are
  // authoritative once every row has been upgraded, so read them at the end of the walk.
  if (page.isDone) {
    let best: any = null;
    for (const m of models) {
      if (isAlias(String(m.modelId))) continue;
      if (!best || Number(m.changeCount) > Number(best.changeCount)) best = m;
    }
    if (best && Number(best.changeCount) > 0) {
      const count = Number(best.changeCount);
      await bumpRecord(ctx, "most-repriced", { modelId: String(best.modelId), provider: String(best.provider), value: String(count), at: String(best.lastChangedAt || now()), detail: `${count} recorded ${count === 1 ? "change" : "changes"}` }, (a, b) => a > b);
    }
  }
  return { cursor: page.continueCursor, done: page.isDone, walked: page.page.length };
}

async function noteCheapestListed(ctx: Ctx, model: TrackedModel, at: string) {
  if (isAlias(model.modelId) || !(Number(model.promptPrice) >= MIN_RECORD_PRICE)) return;
  await bumpRecord(ctx, "cheapest-listed-ever", { modelId: model.modelId, provider: model.provider, at, value: model.promptPrice, detail: `${money(model.promptPrice)} per million input` }, (a, b) => a < b);
}

/** Archive events on one UTC day, counted a page at a time. */
async function countEvents(ctx: Ctx, day: string): Promise<number> {
  let count = 0;
  let cursor: string | null = null;
  for (;;) {
    const page: any = await ctx.db.events
      .withIndex("by_at", (range: any) => range.gte("at", `${day}T00:00:00.000Z`).lte("at", `${day}T23:59:59.999Z`))
      .paginate({ cursor, numItems: 1000 });
    count += page.page.length;
    if (page.isDone || !page.continueCursor) return count;
    cursor = page.continueCursor;
  }
}

/**
 * Repairs to stored data that earlier code got wrong, each run once and remembered in `cursors`:
 * the context record held the new size rather than the increase, and each day's change count was
 * taken part way through the day.
 */
async function repairOnce(ctx: Ctx) {
  const done = async (job: string) => Boolean(await ctx.db.cursors.withIndex("by_job", (range: any) => range.eq("job", job)).first());
  const mark = (job: string) => ctx.db.cursors.insert({ job, cursor: "done", at: now() });

  if (!(await done("context-record"))) {
    const stale = await ctx.db.records.withIndex("by_key", (range: any) => range.eq("key", "largest-context-jump")).collect();
    for (const row of stale) await ctx.db.records.delete(row.id);
    let cursor: string | null = null;
    for (;;) {
      const page: any = await ctx.db.events.withIndex("by_field_at", (range: any) => range.eq("field", "contextLength")).paginate({ cursor, numItems: 500 });
      for (const e of page.page) {
        const x = Number(e.oldValue);
        const y = Number(e.newValue);
        if (e.kind !== "changed" || isAlias(String(e.modelId)) || !(x > 0) || !(y > x)) continue;
        await bumpRecord(ctx, "largest-context-jump", { modelId: String(e.modelId), provider: String(e.provider), value: String(y - x), at: String(e.at), detail: `${formatContext(String(e.oldValue))} → ${formatContext(String(e.newValue))}` }, (a, b) => a > b);
      }
      if (page.isDone || !page.continueCursor) break;
      cursor = page.continueCursor;
    }
    await mark("context-record");
  }

  if (!(await done("daily-changes"))) {
    const days = await ctx.db.daily.withIndex("by_date").take(1000);
    for (const row of days) await ctx.db.daily.update(row.id, { changes: String(await countEvents(ctx, String(row.date))) });
    await mark("daily-changes");
  }
}

/** The day's market summary. Written once per date and overwritten when run again. */
async function rollup(ctx: Ctx, day: string) {
  const active = await ctx.db.models.withIndex("by_active", (range: any) => range.eq("active", true)).take(1000);
  // Standard listings only: a ":batch" or ":free" variant is the same model at a different
  // tariff, and counting it twice would tilt every basket.
  const priced = active.filter((row: any) => !isAlias(String(row.modelId)) && Number(row.promptPrice) > 0 && !String(row.modelId).includes(":"));
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
  const changes = await countEvents(ctx, day);
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
    changes: String(changes),
  };
  const existing = await ctx.db.daily.withIndex("by_date", (range: any) => range.eq("date", day)).first();
  if (existing) await ctx.db.daily.update(existing.id, row);
  else await ctx.db.daily.insert(row);
  // The rollup runs part way through its day, so the day before is only complete now. Recount its changes.
  const yesterday = new Date(Date.parse(`${day}T00:00:00.000Z`) - DAY).toISOString().slice(0, 10);
  const prior = await ctx.db.daily.withIndex("by_date", (range: any) => range.eq("date", yesterday)).first();
  if (prior) await ctx.db.daily.update(prior.id, { changes: String(await countEvents(ctx, yesterday)) });

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
    const paid = rows.filter((r) => Number(r.promptPrice) > 0 && !String(r.modelId).includes(":"));
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
  const watch = (params.get("watch") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const provider = (params.get("provider") ?? "").toLowerCase();
  const model = params.get("model") ?? "";
  const kind = params.get("kind") ?? "";
  const active = await ctx.db.models.withIndex("by_active", (range: any) => range.eq("active", true)).take(1000);
  const newest = (rows: any[], n: number) => rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, n);

  // A model or provider filter reads that model's or provider's own history through its index, so it reaches
  // back past the newest events of everyone else. Watch and kind filters have no index and read a wider window.
  let events: ArchiveEvent[];
  let hostEvents: HostEvent[];
  let lifecycleEvents: LifecycleEvent[];
  let sourceEvents: any[];
  if (model) {
    const row = await ctx.db.models.withIndex("by_model", (range: any) => range.eq("modelId", model)).first();
    const key = canonicalKey(String(row?.provider ?? model.split("/")[0]), model);
    events = await ctx.db.events.withIndex("by_model", (range: any) => range.eq("modelId", model)).order("desc").take(300);
    hostEvents = await ctx.db.hostEvents.withIndex("by_model", (range: any) => range.eq("modelId", model)).order("desc").take(200);
    lifecycleEvents = await ctx.db.lifecycleEvents.withIndex("by_key", (range: any) => range.eq("key", key)).order("desc").take(100);
    sourceEvents = await ctx.db.sourceEvents.withIndex("by_key", (range: any) => range.eq("key", key)).order("desc").take(200);
  } else if (provider) {
    const slugs = new Set([provider, `~${provider}`]);
    for (const m of active) if (canonicalProvider(String(m.provider).replace(/^~/, "")) === canonicalProvider(provider)) slugs.add(String(m.provider));
    const reads: ArchiveEvent[] = [];
    for (const slug of slugs) reads.push(...(await ctx.db.events.withIndex("by_provider_at", (range: any) => range.eq("provider", slug)).order("desc").take(300)));
    events = newest(reads, 300);
    hostEvents = await ctx.db.hostEvents.withIndex("by_at").order("desc").take(1000);
    lifecycleEvents = await ctx.db.lifecycleEvents.withIndex("by_at").order("desc").take(300);
    sourceEvents = await ctx.db.sourceEvents.withIndex("by_at").order("desc").take(400);
  } else {
    const wide = watch.length > 0 || Boolean(kind);
    events = await ctx.db.events.withIndex("by_at").order("desc").take(wide ? 1000 : 300);
    hostEvents = await ctx.db.hostEvents.withIndex("by_at").order("desc").take(wide ? 400 : 100);
    lifecycleEvents = await ctx.db.lifecycleEvents.withIndex("by_at").order("desc").take(wide ? 300 : 100);
    sourceEvents = await ctx.db.sourceEvents.withIndex("by_at").order("desc").take(wide ? 400 : 200);
  }
  const names = new Map<string, string>(active.map((m: any) => [String(m.modelId), String(m.name)]));
  const keyToModel = new Map<string, string>();
  for (const m of active) {
    const id = String(m.modelId);
    if (isAlias(id)) continue;
    const key = canonicalKey(String(m.provider), id);
    const held = keyToModel.get(key);
    // A notice belongs on the plain listing, not on a ":batch" or ":free" variant of it.
    if (!held || (held.includes(":") && !id.includes(":"))) keyToModel.set(key, id);
  }
  const fromSources: ArchiveEvent[] = sourceEvents.map((r: any) => ({
    id: r.id, at: r.at, kind: r.kind, modelId: r.key, provider: r.provider, field: r.field, oldValue: r.oldValue, newValue: r.newValue, source: r.source,
  }));
  const keyOf = (s: Story) => (s.source ? s.modelId : canonicalKey(s.provider, s.modelId));
  let stories = corroborate(foldVolatile(foldFlapping(foldAliases(foldDrift(groupStories([...events, ...fromSources], names))))), keyOf)
    .filter((s) => !s.source)
    .concat(foldDrift(hostStories(hostEvents, names)), lifecycleStories(lifecycleEvents));
  for (const s of stories) if (s.source && s.source !== "hosts" && keyToModel.has(s.modelId)) s.modelId = keyToModel.get(s.modelId) as string;
  stories = sortStories(stories).filter((s) => s.kind !== "drift");

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

function publicBenchmark(row: any) {
  const { id, createdAt, updatedAt, fingerprint, rowKey, key, ...rest } = row;
  return rest;
}

/**
 * A model's current results across every leaderboard: rows filed under its loose key, plus
 * rows whose source named no organisation, which are filed under "?/slug".
 */
async function benchmarksFor(ctx: Ctx, provider: string, modelId: string) {
  const key = looseKey(provider, modelId);
  const named = await ctx.db.benchmarks.withIndex("by_key", (range) => range.eq("key", key)).collect();
  const unnamed = await ctx.db.benchmarks.withIndex("by_key", (range) => range.eq("key", `?/${looseSlug(modelId)}`)).collect();
  return [...named, ...unnamed].filter((row) => row.active === true);
}

function escapeXml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** The crawlable directory page: one table per provider, then the latest changes as a list. */
function directoryHtml(models: ModelRow[], events: ArchiveEvent[]): string {
  const byProvider = new Map<string, ModelRow[]>();
  for (const m of models) {
    const slug = String(m.provider).replace(/^~/, "");
    const list = byProvider.get(slug);
    if (list) list.push(m);
    else byProvider.set(slug, [m]);
  }
  const providers = [...byProvider.keys()].sort((a, b) => providerName(a).localeCompare(providerName(b)));
  const names = new Map(models.map((m) => [m.modelId, m.name]));
  const sections = providers
    .map((slug) => {
      const rows = byProvider
        .get(slug)!
        .sort((a, b) => a.modelId.localeCompare(b.modelId))
        .map(
          (m) => `<tr>
<td><a href="/model/${escapeXml(m.modelId)}">${escapeXml(modelName(m.modelId, m.name))}</a></td>
<td class="id">${escapeXml(m.modelId)}</td>
<td class="n">${escapeXml(money(m.promptPrice) || "—")}</td>
<td class="n">${escapeXml(money(m.completionPrice) || "—")}</td>
<td class="n">${escapeXml(formatContext(m.contextLength))}</td>
<td class="n">${escapeXml(m.lastChangedAt ? longDate(m.lastChangedAt) : "never")}</td>
</tr>`,
        )
        .join("\n");
      return `<h2 id="${escapeXml(slug)}"><a href="/provider/${escapeXml(slug)}">${escapeXml(providerName(slug))}</a> <small>${byProvider.get(slug)!.length}</small></h2>
<table>
<thead><tr><th>Model</th><th>Id</th><th class="n">Input $/M</th><th class="n">Output $/M</th><th class="n">Context</th><th class="n">Last changed</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
    })
    .join("\n");
  const changes = events
    .map((e) => {
      const name = modelName(e.modelId, names.get(e.modelId));
      return `<li><span class="n">${escapeXml(longDate(e.at))}</span> <a href="/model/${escapeXml(e.modelId)}">${escapeXml(name)}</a> ${escapeXml(describeEvent(e.kind, e.field, e.oldValue, e.newValue))}</li>`;
    })
    .join("\n");
  const description = `Every AI model listed on OpenRouter with its current price and context window, ${models.length} models from ${providers.length} providers, plus the latest recorded changes.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Observatory directory</title>
<meta name="description" content="${escapeXml(description)}">
<link rel="canonical" href="${SITE}/directory.html">
<link rel="icon" href="/favicon.svg">
<style>
body{margin:0;background:#111210;color:#ece9e0;font:14px/1.5 'IBM Plex Sans',system-ui,sans-serif}
main{max-width:1120px;margin:0 auto;padding:24px 16px 48px}
a{color:#9fb3ff;text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:28px;margin:0 0 8px}h2{font-size:16px;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.06em}
h2 small{color:#9a958a;font-weight:400;letter-spacing:0;text-transform:none}
p{color:#9a958a;max-width:66ch}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9a958a;text-align:left;font-weight:600;padding:8px 10px 6px 0;border-bottom:2px solid #ece9e0}
td{padding:6px 10px 6px 0;border-bottom:1px solid #2c2d29;vertical-align:baseline}
td:last-child,th:last-child{padding-right:0}
.n{text-align:right;font-family:'IBM Plex Mono',SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.id{color:#9a958a;font-family:'IBM Plex Mono',SFMono-Regular,Menlo,monospace;font-size:12px}
ol{padding-left:20px}ol li{padding:4px 0;border-bottom:1px solid #2c2d29}
ol .n{color:#9a958a;font-size:12px;margin-right:8px}
nav{font-size:12px;color:#9a958a;margin-bottom:16px}
</style>
</head>
<body>
<main>
<nav><a href="/">AI Observatory</a> · directory</nav>
<h1>AI Observatory directory</h1>
<p>${escapeXml(description)} Prices are per million tokens as listed on OpenRouter. Every listing is checked every hour and every change is kept; each model's page has its full history.</p>
<p>Jump to: ${providers.map((slug) => `<a href="#${escapeXml(slug)}">${escapeXml(providerName(slug))}</a>`).join(" · ")}</p>
${sections}
<h2 id="changes">Latest changes</h2>
<ol>
${changes}
</ol>
<p><a href="/">Back to the front page</a> · <a href="/feed.xml">Feed</a> · <a href="/api">API</a></p>
</main>
</body>
</html>
`;
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
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#2c2d29"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/></g>
<g text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14" fill="#ece9e0">${escapeXml(label)}</text>
<text x="${lw + vw / 2}" y="14" fill="#111210" font-weight="bold">${escapeXml(value)}</text>
</g></svg>`;
}

/** A 1200×630 share card. Intrinsic elements only; the renderer handles layout from `tw`. */
function card(title: string, line: string, sub: string, footer: string) {
  const element = h(
    "div",
    { tw: "flex flex-col w-full h-full p-16 justify-between", style: { backgroundColor: "#111210", color: "#ece9e0" } },
    h("div", { tw: "flex flex-col" },
      h("div", { tw: "text-3xl mb-6 font-bold", style: { color: "#9fb3ff", letterSpacing: "0.02em" } }, "AI OBSERVATORY"),
      h("div", { tw: "text-6xl font-bold leading-tight" }, title.length > 90 ? `${title.slice(0, 87)}…` : title),
      line ? h("div", { tw: "text-3xl mt-6", style: { color: "#9a958a" } }, line.length > 110 ? `${line.slice(0, 107)}…` : line) : null,
      sub ? h("div", { tw: "text-3xl mt-3" }, sub.length > 110 ? `${sub.slice(0, 107)}…` : sub) : null
    ),
    h("div", { tw: "flex justify-between text-2xl", style: { color: "#9a958a" } },
      h("div", {}, footer),
      h("div", {}, "ai-observatory.view.fast")
    )
  );
  return new ImageResponse(element as any, { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=3600" } });
}
