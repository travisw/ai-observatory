import { boolean, capsule, mutation, query, string, table } from "@spacefast/zero/server";

import {
  TRACKED_FIELDS,
  fingerprintOf,
  normalizeNumeric,
  providerOf,
  type TrackedField,
  type TrackedModel,
} from "../shared/model";

/**
 * The capsule does not fetch anything. Collection runs on a schedule outside the app
 * (see `collector/fetch-and-post.mjs`) and writes in through the mutations below, which
 * keeps the schedule, the retries and the source list changeable without a redeploy.
 *
 * Everything that makes this an archive lives here: the schema, the diffing, the
 * history, and the console.
 */
const now = () => new Date().toISOString();

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
      contextLength: string(),
      maxCompletion: string(),
      promptPrice: string(),
      completionPrice: string(),
      cacheReadPrice: string(),
      cacheWritePrice: string(),
      modality: string(),
      tokenizer: string(),
      supportedParams: string(),
      moderated: boolean(),
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
      .index("by_kind", ["kind"]),

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
    }).index("by_at", ["at"]),

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
      ctx.db.models.withIndex("by_model").order("asc").take(500)
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

        if (prior.fingerprint === fingerprint && prior.active === true) {
          await ctx.db.models.update(prior.id, {
            lastSeenAt: at,
            ...(correctedFirstSeen ? { firstSeenAt: correctedFirstSeen } : {}),
          });
          continue;
        }

        // A row per changed field, so the archive stays queryable by field.
        for (const field of TRACKED_FIELDS) {
          const before = String(prior[field] ?? "");
          const after = String(model[field as TrackedField] ?? "");
          if (before === after) continue;
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

    ingestStatus: mutation(async (ctx, token: string, providers: StatusReport[]) => {
      if (!allowed(ctx, token)) return { ok: false, error: "unauthorized" };
      const started = Date.now();
      const at = now();
      let transitions = 0;

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
          continue;
        }

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

      await ctx.db.polls.insert({
        at,
        source: "status",
        ok: true,
        note: `${(providers ?? []).length} checked, ${transitions} transitions`,
        ms: String(Date.now() - started),
      });
      return { ok: true, transitions };
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
  },
});

type RawModel = {
  id?: string;
  name?: string;
  context_length?: number;
  architecture?: { modality?: string; tokenizer?: string };
  pricing?: Record<string, string>;
  top_provider?: { max_completion_tokens?: number; is_moderated?: boolean };
  supported_parameters?: string[];
  created?: number;
};

type StatusReport = { provider: string; indicator: string; description?: string };
type PackageReport = { pkg: string; downloads?: number };
type PypiReport = { pkg: string; lastDay?: number; lastWeek?: number; lastMonth?: number };
type RepoReport = { repo: string; stars?: number; forks?: number; openIssues?: number };
type HfModel = { id?: string; likes?: number; downloads?: number };

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
  return {
    modelId,
    provider: providerOf(modelId),
    name: raw.name ?? modelId,
    contextLength: normalizeNumeric(raw.context_length),
    maxCompletion: normalizeNumeric(raw.top_provider?.max_completion_tokens),
    promptPrice: normalizeNumeric(pricing.prompt),
    completionPrice: normalizeNumeric(pricing.completion),
    cacheReadPrice: normalizeNumeric(pricing.input_cache_read),
    cacheWritePrice: normalizeNumeric(pricing.input_cache_write),
    modality: raw.architecture?.modality ?? "",
    tokenizer: raw.architecture?.tokenizer ?? "",
    supportedParams: (raw.supported_parameters ?? []).slice().sort().join(","),
    moderated: raw.top_provider?.is_moderated === true,
  };
}
