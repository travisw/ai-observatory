#!/usr/bin/env node
/**
 * The observatory's legs.
 *
 * Fetching lives out here rather than in the capsule, so the schedule, the retries and
 * the source list can change without a redeploy, and a sweep can be run by hand from any
 * machine against any environment.
 *
 * Runs anywhere with node 18+. No dependencies, no API keys: every source is public.
 *
 *   INGEST_TOKEN=... OBSERVATORY_URL=https://ai-observatory.view.fast \
 *     node collector/fetch-and-post.mjs [models|hosts|status|sources|lifecycle|daily|backfill-litellm|all]
 */

import { CHUNK, TOKEN, callMutation, getJson, getText, sleep, withBackoff } from "./http.mjs";
import { parseAnthropic, parseCohere, parseOpenAI } from "./lifecycle.mjs";

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";

/** Statuspage-hosted providers all answer the same summary shape. */
const STATUS_PAGES = [
  { provider: "openai", url: "https://status.openai.com/api/v2/summary.json" },
  { provider: "anthropic", url: "https://status.anthropic.com/api/v2/summary.json" },
  { provider: "groq", url: "https://groqstatus.com/api/v2/summary.json" },
  { provider: "cohere", url: "https://status.cohere.com/api/v2/summary.json" },
  { provider: "replicate", url: "https://status.replicate.com/api/v2/summary.json" },
  { provider: "cerebras", url: "https://status.cerebras.ai/api/v2/summary.json" },
  { provider: "fireworks", url: "https://status.fireworks.ai/api/v2/summary.json" },
  { provider: "perplexity", url: "https://status.perplexity.com/api/v2/summary.json" },
];

/** Google publishes one feed for all of Cloud; only the Gemini and Vertex entries matter here. */
const GOOGLE_INCIDENTS = "https://status.cloud.google.com/incidents.json";

const NPM_PACKAGES = ["@anthropic-ai/sdk", "openai", "@google/generative-ai", "langchain", "ollama"];
const PYPI_PACKAGES = ["openai", "anthropic", "transformers", "langchain", "litellm", "vllm"];

/** Anonymous GitHub allows 60 requests an hour, which is ample for a daily sweep. */
const REPOS = [
  "ollama/ollama",
  "vllm-project/vllm",
  "huggingface/transformers",
  "langchain-ai/langchain",
  "ggml-org/llama.cpp",
  "openai/openai-python",
  "anthropics/anthropic-sdk-python",
];

const LITELLM_FILE = "model_prices_and_context_window.json";
const LITELLM_RAW = `https://raw.githubusercontent.com/BerriAI/litellm/main/${LITELLM_FILE}`;

/**
 * Drops the parts of an OpenRouter listing the archive never reads, so a chunk of forty
 * stays well inside the request budget. Everything the capsule diffs is kept as-is.
 */
function trimModel(raw) {
  const { default_parameters, supported_voices, links, per_request_limits, ...rest } = raw;
  if (typeof rest.description === "string") rest.description = rest.description.slice(0, 600);
  return rest;
}

async function collectModels() {
  const catalogue = await withBackoff(() => getJson(OPENROUTER_MODELS));
  const models = (catalogue?.data ?? []).map(trimModel);
  if (models.length === 0) throw new Error("openrouter returned an empty catalogue");

  // One timestamp for the whole sweep, so finalize can spot what never appeared.
  const runAt = new Date().toISOString();
  let added = 0;
  let changed = 0;

  for (let i = 0; i < models.length; i += CHUNK) {
    const result = await callMutation("ingestModels", [TOKEN, runAt, models.slice(i, i + CHUNK)]);
    added += result.added ?? 0;
    changed += result.changed ?? 0;
  }

  const closed = await callMutation("finalizeModels", [TOKEN, runAt, models.length]);
  console.log(`models: ${models.length} listed, +${added} ~${changed} -${closed.removed ?? 0}`);
}

/** The fields of a hosting endpoint the archive keeps. Uptime is read live, prices are diffed. */
function trimEndpoint(e) {
  return {
    provider_name: e.provider_name ?? "",
    tag: e.tag ?? "",
    quantization: e.quantization ?? "",
    context_length: e.context_length ?? null,
    max_completion_tokens: e.max_completion_tokens ?? null,
    pricing: {
      prompt: e.pricing?.prompt ?? "",
      completion: e.pricing?.completion ?? "",
      input_cache_read: e.pricing?.input_cache_read ?? "",
    },
    status: e.status ?? 0,
    uptime_last_30m: e.uptime_last_30m ?? null,
    uptime_last_1d: e.uptime_last_1d ?? null,
  };
}

/**
 * One request per model for its hosting endpoints: which companies actually serve it, at
 * what price and quantization, and how reliably. Spaced out because it is 450-odd calls.
 */
async function collectHosts() {
  const catalogue = await withBackoff(() => getJson(OPENROUTER_MODELS));
  const ids = (catalogue?.data ?? []).map((m) => m.id).filter(Boolean);
  if (ids.length === 0) throw new Error("openrouter returned an empty catalogue");

  const runAt = new Date().toISOString();
  const HOST_CHUNK = 8;
  let batch = [];
  let models = 0;
  let endpoints = 0;
  let skipped = 0;
  const totals = { added: 0, changed: 0, removed: 0 };

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await callMutation("ingestHosts", [TOKEN, runAt, batch]);
    totals.added += result.added ?? 0;
    totals.changed += result.changed ?? 0;
    totals.removed += result.removed ?? 0;
    batch = [];
  };

  for (const id of ids) {
    await sleep(150);
    let body;
    try {
      body = await withBackoff(() => getJson(`${OPENROUTER_MODELS}/${id}/endpoints`), { attempts: 3, baseMs: 2000 });
    } catch (error) {
      // A model with no readable endpoint list is left alone rather than sent as empty,
      // which would retire every host it has.
      console.warn(`hosts: ${id} skipped (${error.message})`);
      skipped++;
      continue;
    }
    const list = (body?.data?.endpoints ?? []).map(trimEndpoint);
    batch.push({ modelId: id, endpoints: list });
    models++;
    endpoints += list.length;
    if (batch.length >= HOST_CHUNK) await flush();
  }
  await flush();
  await callMutation("finalizeHosts", [TOKEN, runAt, models, Date.now() - Date.parse(runAt)]);
  console.log(`hosts: ${models} models, ${endpoints} endpoints, ${skipped} skipped, +${totals.added} ~${totals.changed} -${totals.removed}`);
}

/**
 * Two catalogues that are not OpenRouter, so a price move can be checked against what the
 * provider's own listing says. models.dev is a maintained open database of first-party
 * listings; LiteLLM's price table is what most client libraries bill from. Both are one
 * public JSON file. The capsule decides which providers count and how ids line up.
 */
const SOURCES = {
  modelsdev: {
    url: "https://models.dev/api.json",
    // First-party listings only. The rest of models.dev is gateways relisting these.
    providers: [
      "anthropic", "openai", "google", "mistral", "deepseek", "xai", "meta", "cohere", "moonshotai", "zai",
      "alibaba", "minimax", "perplexity", "ai21", "xiaomi", "stepfun", "inception", "upstage", "sakana",
    ],
    rows(body) {
      const out = [];
      for (const provider of this.providers) {
        for (const [id, model] of Object.entries(body?.[provider]?.models ?? {})) {
          const cost = model?.cost ?? {};
          const outputs = model?.modalities?.output ?? [];
          if (cost.input === undefined || !outputs.includes("text")) continue;
          out.push({
            provider,
            sourceId: id,
            name: model.name ?? id,
            contextLength: model?.limit?.context,
            maxCompletion: model?.limit?.output,
            promptPrice: perToken(cost.input),
            completionPrice: perToken(cost.output),
            cacheReadPrice: cost.cache_read === undefined ? "" : perToken(cost.cache_read),
            releaseDate: model.release_date ?? "",
          });
        }
      }
      return out;
    },
    /** Models the catalogue itself marks as deprecated. No dates: models.dev records the state only. */
    lifecycle(body) {
      const out = [];
      for (const provider of this.providers) {
        for (const [id, model] of Object.entries(body?.[provider]?.models ?? {})) {
          if (model?.status !== "deprecated") continue;
          out.push({ provider, modelId: id, state: "deprecated", deprecatedAt: "", retiresAt: "", retiresNote: "", replacement: "", sourceUrl: "https://models.dev" });
        }
      }
      return out;
    },
  },
  litellm: {
    url: LITELLM_RAW,
    providers: [
      "anthropic", "openai", "gemini", "mistral", "deepseek", "xai", "meta", "meta_llama", "cohere", "moonshot",
      "zai", "dashscope", "minimax", "perplexity", "ai21",
    ],
    modes: ["chat", "responses", "completion"],
    rows(body) {
      const out = [];
      for (const [id, model] of Object.entries(body ?? {})) {
        if (id === "sample_spec" || !this.providers.includes(model?.litellm_provider)) continue;
        if (!this.modes.includes(model.mode)) continue;
        if (model.input_cost_per_token === undefined) continue;
        out.push({
          provider: model.litellm_provider,
          sourceId: id,
          name: id.includes("/") ? id.slice(id.indexOf("/") + 1) : id,
          contextLength: model.max_input_tokens,
          maxCompletion: model.max_output_tokens,
          promptPrice: model.input_cost_per_token,
          completionPrice: model.output_cost_per_token,
          cacheReadPrice: model.cache_read_input_token_cost ?? "",
          releaseDate: "",
        });
      }
      return out;
    },
    /** Entries carrying a shutdown date. Fine-tune ids are skipped; they are not catalogue models. */
    lifecycle(body) {
      const today = new Date().toISOString().slice(0, 10);
      const out = [];
      for (const [id, model] of Object.entries(body ?? {})) {
        if (id === "sample_spec" || id.startsWith("ft:") || !this.providers.includes(model?.litellm_provider)) continue;
        if (!this.modes.includes(model.mode) || !model.deprecation_date) continue;
        const retiresAt = String(model.deprecation_date);
        out.push({
          provider: model.litellm_provider,
          modelId: id,
          state: retiresAt < today ? "retired" : "deprecated",
          deprecatedAt: "",
          retiresAt,
          retiresNote: "",
          replacement: "",
          sourceUrl: LITELLM_RAW,
        });
      }
      return out;
    },
  },
};

/** Dollars per million to dollars per token without the float noise (0.1 / 1e6 is not 1e-7). */
function perToken(perMillion) {
  return Number((Number(perMillion) / 1e6).toPrecision(10));
}

/** Sends one catalogue's rows as a sweep stamped `runAt`, which may be historical during a backfill. */
async function ingestSourceRows(source, rows, runAt) {
  let added = 0;
  let changed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const result = await callMutation("ingestSource", [TOKEN, source, runAt, rows.slice(i, i + CHUNK)]);
    added += result.added ?? 0;
    changed += result.changed ?? 0;
  }
  const closed = await callMutation("finalizeSource", [TOKEN, source, runAt, rows.length]);
  return { added, changed, removed: closed.removed ?? 0 };
}

async function collectSources() {
  for (const [source, spec] of Object.entries(SOURCES)) {
    const body = await withBackoff(() => getJson(spec.url));
    // Shortest id first: when several ids collapse to one key, the rolling name wins.
    const rows = spec.rows(body).sort((a, b) => a.sourceId.length - b.sourceId.length);
    if (rows.length === 0) throw new Error(`${source} returned no usable rows`);
    const result = await ingestSourceRows(source, rows, new Date().toISOString());
    console.log(`${source}: ${rows.length} rows sent, +${result.added} ~${result.changed} -${result.removed}`);
  }
}

/** The pages where providers announce retirements, read as markdown. */
const DEPRECATION_PAGES = [
  { source: "openai", url: "https://developers.openai.com/api/docs/deprecations.md", parse: parseOpenAI },
  { source: "anthropic", url: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md", parse: parseAnthropic },
  { source: "cohere", url: "https://docs.cohere.com/docs/deprecations.md", parse: parseCohere },
];

async function ingestLifecycleRows(source, rows, runAt) {
  let added = 0;
  let changed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const result = await callMutation("ingestLifecycle", [TOKEN, source, runAt, rows.slice(i, i + CHUNK)]);
    added += result.added ?? 0;
    changed += result.changed ?? 0;
  }
  const closed = await callMutation("finalizeLifecycle", [TOKEN, source, runAt]);
  console.log(`lifecycle ${source}: ${rows.length} rows, +${added} ~${changed} -${closed.removed ?? 0}`);
}

/**
 * Retirement dates from everyone who publishes them. One source failing is logged and the
 * rest still land, since the pages are independent and any of them can be redesigned.
 */
async function collectLifecycle() {
  let failed = 0;
  const runAt = new Date().toISOString();

  for (const [source, spec] of Object.entries(SOURCES)) {
    try {
      const body = await withBackoff(() => getJson(spec.url));
      await ingestLifecycleRows(source, spec.lifecycle(body), runAt);
    } catch (error) {
      console.error(`lifecycle ${source}: FAILED ${error.message}`);
      failed++;
    }
  }

  for (const page of DEPRECATION_PAGES) {
    try {
      const text = await withBackoff(() => getText(page.url, { accept: "text/markdown, text/plain;q=0.9, */*;q=0.5" }));
      if (text.trimStart().startsWith("<")) throw new Error(`${page.url} -> HTML instead of markdown`);
      await ingestLifecycleRows(page.source, page.parse(text, page.url), runAt);
    } catch (error) {
      console.error(`lifecycle ${page.source}: FAILED ${error.message}`);
      failed++;
    }
  }
  if (failed > 0) throw new Error(`${failed} lifecycle source(s) failed`);
}

/** Statuspage's incident record, in the archive's shape. */
function statuspageIncident(i) {
  return {
    id: String(i.id ?? ""),
    name: i.name ?? "",
    impact: i.impact ?? "none",
    status: i.status ?? "",
    createdAt: i.started_at ?? i.created_at ?? "",
    resolvedAt: i.resolved_at ?? "",
    updatedAt: i.updated_at ?? "",
    url: i.shortlink ?? "",
  };
}

const GOOGLE_IMPACT = { SERVICE_OUTAGE: "major", SERVICE_DISRUPTION: "minor", SERVICE_INFORMATION: "none" };

/** Google's feed is Cloud-wide; keep the Gemini and Vertex entries from the last 30 days. */
function googleStatus(list) {
  const since = Date.now() - 30 * 86_400_000;
  const relevant = (Array.isArray(list) ? list : []).filter((i) =>
    (i.affected_products ?? []).some((p) => /vertex|gemini/i.test(p?.title ?? "")) &&
    Date.parse(i.begin ?? "") >= since
  );
  const incidents = relevant.map((i) => ({
    id: String(i.id ?? i.number ?? ""),
    name: (i.external_desc ?? "").slice(0, 200),
    impact: GOOGLE_IMPACT[i.status_impact] ?? "minor",
    status: i.end ? "resolved" : "investigating",
    createdAt: i.begin ?? "",
    resolvedAt: i.end ?? "",
    updatedAt: i.modified ?? "",
    url: i.uri ? `https://status.cloud.google.com/${i.uri}` : "",
  }));
  const open = incidents.filter((i) => !i.resolvedAt);
  const worst = open.some((i) => i.impact === "major") ? "major" : open.length ? "minor" : "none";
  return {
    provider: "google",
    indicator: worst,
    description: open.length ? open[0].name : "All Systems Operational",
    incidents,
  };
}

async function collectStatus() {
  const providers = [];
  for (const source of STATUS_PAGES) {
    try {
      const body = await getJson(source.url);
      providers.push({
        provider: source.provider,
        indicator: body?.status?.indicator ?? "unknown",
        description: body?.status?.description ?? "",
        incidents: (body?.incidents ?? []).map(statuspageIncident),
      });
    } catch (error) {
      // Record the outage of the status page itself rather than dropping the provider,
      // so a gap in coverage is visible in the archive instead of silent.
      console.warn(`status: ${source.provider} unreachable (${error.message})`);
      providers.push({ provider: source.provider, indicator: "unreachable", description: error.message, incidents: [] });
    }
  }
  try {
    providers.push(googleStatus(await getJson(GOOGLE_INCIDENTS)));
  } catch (error) {
    console.warn(`status: google unreachable (${error.message})`);
    providers.push({ provider: "google", indicator: "unreachable", description: error.message, incidents: [] });
  }
  await callMutation("ingestStatus", [TOKEN, providers]);
  console.log(`status: ${providers.length} providers read`);
}

async function collectDaily() {
  let trending = [];
  try {
    trending = await getJson("https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=25");
  } catch (error) {
    console.warn(`daily: hugging face unavailable (${error.message})`);
  }

  const packages = [];
  for (const pkg of NPM_PACKAGES) {
    try {
      const body = await getJson(`https://api.npmjs.org/downloads/point/last-week/${pkg}`);
      packages.push({ pkg, downloads: body?.downloads ?? 0 });
    } catch (error) {
      console.warn(`daily: ${pkg} unavailable (${error.message})`);
    }
  }

  const pypi = [];
  for (const pkg of PYPI_PACKAGES) {
    // pypistats 429s on bursts. Backoff rather than a fixed sleep, since the limit
    // window is longer than any polite pause and this is a once-a-day job with time.
    try {
      const body = await withBackoff(() => getJson(`https://pypistats.org/api/packages/${pkg}/recent`));
      pypi.push({
        pkg,
        lastDay: body?.data?.last_day ?? 0,
        lastWeek: body?.data?.last_week ?? 0,
        lastMonth: body?.data?.last_month ?? 0,
      });
    } catch (error) {
      console.warn(`daily: pypi ${pkg} unavailable (${error.message})`);
    }
  }

  const repos = [];
  for (const repo of REPOS) {
    try {
      const body = await getJson(`https://api.github.com/repos/${repo}`);
      repos.push({
        repo,
        stars: body?.stargazers_count ?? 0,
        forks: body?.forks_count ?? 0,
        openIssues: body?.open_issues_count ?? 0,
      });
    } catch (error) {
      console.warn(`daily: repo ${repo} unavailable (${error.message})`);
    }
  }

  await callMutation("ingestDaily", [TOKEN, trending, packages, pypi, repos]);
  console.log(`daily: ${trending.length} trending, ${packages.length} npm, ${pypi.length} pypi, ${repos.length} repos`);

  const rollup = await callMutation("rollupDaily", [TOKEN]);
  console.log(`rollup: ${JSON.stringify(rollup)}`);
}

/** "2024-W07" for a date, ISO week numbering. */
function isoWeek(iso) {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Replays LiteLLM's price table from its git history, one commit per week, so first-party
 * price history starts in 2023 rather than on the day this collector first ran. Manual and
 * run once: it wipes the source and rebuilds it in order, ending on the live file.
 */
async function backfillLitellm() {
  const spec = SOURCES.litellm;
  const auth = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

  const commits = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/BerriAI/litellm/commits?path=${LITELLM_FILE}&per_page=100&page=${page}`;
    const list = await withBackoff(() => getJson(url, auth));
    if (!Array.isArray(list) || list.length === 0) break;
    for (const c of list) commits.push({ sha: c.sha, at: c.commit?.committer?.date ?? c.commit?.author?.date });
    if (list.length < 100) break;
  }
  if (commits.length === 0) throw new Error("backfill: no commits found");

  // Last commit of each ISO week, oldest first. The API lists newest first, so the first
  // commit seen per week is the one to keep.
  const perWeek = new Map();
  for (const c of commits) {
    if (!c.at) continue;
    const week = isoWeek(c.at);
    if (!perWeek.has(week)) perWeek.set(week, c);
  }
  const weekly = [...perWeek.values()].sort((a, b) => a.at.localeCompare(b.at));
  console.log(`backfill: ${commits.length} commits, ${weekly.length} weekly samples from ${weekly[0].at.slice(0, 10)}`);

  for (;;) {
    const result = await callMutation("resetSource", [TOKEN, "litellm"]);
    if (result.done) break;
  }
  console.log("backfill: litellm source reset");

  let done = 0;
  for (const c of weekly) {
    let rows;
    try {
      const body = await withBackoff(() => getJson(`https://raw.githubusercontent.com/BerriAI/litellm/${c.sha}/${LITELLM_FILE}`));
      rows = spec.rows(body).sort((a, b) => a.sourceId.length - b.sourceId.length);
    } catch (error) {
      // Early revisions are hand-edited and some do not parse; a missing week is a gap, not a failure.
      console.warn(`backfill: ${c.sha.slice(0, 7)} (${c.at.slice(0, 10)}) skipped (${error.message})`);
      continue;
    }
    if (rows.length === 0) {
      console.warn(`backfill: ${c.sha.slice(0, 7)} (${c.at.slice(0, 10)}) had no first-party rows`);
      continue;
    }
    const result = await ingestSourceRows("litellm", rows, new Date(c.at).toISOString());
    done++;
    if (done % 10 === 0) console.log(`backfill: ${done}/${weekly.length} weeks replayed, at ${c.at.slice(0, 10)} (+${result.added} ~${result.changed} -${result.removed})`);
  }

  const body = await withBackoff(() => getJson(spec.url));
  const rows = spec.rows(body).sort((a, b) => a.sourceId.length - b.sourceId.length);
  const result = await ingestSourceRows("litellm", rows, new Date().toISOString());
  console.log(`backfill: finished on the live file, ${rows.length} rows, +${result.added} ~${result.changed} -${result.removed}`);
}

export { SOURCES, googleStatus, isoWeek, statuspageIncident, trimEndpoint, trimModel };

/** Walks the whole archive once to seed the records board. Manual, like the backfill. */
async function rebuildRecords() {
  let cursor = null;
  let walked = 0;
  for (;;) {
    const result = await callMutation("rebuildRecords", [TOKEN, cursor]);
    walked += result.walked ?? 0;
    if (result.done || !result.cursor) break;
    cursor = result.cursor;
  }
  console.log(`records: rebuilt from ${walked} events`);
}

const JOBS = {
  models: collectModels,
  hosts: collectHosts,
  status: collectStatus,
  sources: collectSources,
  lifecycle: collectLifecycle,
  daily: collectDaily,
  "backfill-litellm": backfillLitellm,
  "rebuild-records": rebuildRecords,
};

/** `all` is the scheduled set; the backfill only ever runs when named. */
const SCHEDULED = ["models", "status", "sources", "lifecycle", "hosts", "daily"];

async function main() {
  if (!TOKEN) {
    console.error("INGEST_TOKEN is required.");
    process.exit(2);
  }
  const requested = process.argv[2] ?? "all";
  const names = requested === "all" ? SCHEDULED : [requested];

  let failed = 0;
  for (const name of names) {
    const job = JOBS[name];
    if (!job) {
      console.error(`unknown job: ${name}`);
      process.exit(2);
    }
    try {
      await job();
    } catch (error) {
      // Keep going: a broken source should not stop the others from being archived.
      console.error(`${name}: FAILED ${error.message}`);
      failed++;
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

// Only run when invoked directly, so the shaping helpers can be imported by tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
