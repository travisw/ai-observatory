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
 *   INGEST_TOKEN=... OBSERVATORY_URL=https://ai-observatory.view.fast node collector/fetch-and-post.mjs [models|status|sources|daily|all]
 */

const BASE = process.env.OBSERVATORY_URL ?? "https://ai-observatory.view.fast";
const TOKEN = process.env.INGEST_TOKEN;

const STATUS_PAGES = [
  { provider: "openai", url: "https://status.openai.com/api/v2/status.json" },
  { provider: "anthropic", url: "https://status.anthropic.com/api/v2/status.json" },
  { provider: "groq", url: "https://groqstatus.com/api/v2/status.json" },
  { provider: "replicate", url: "https://status.replicate.com/api/v2/status.json" },
  { provider: "cohere", url: "https://status.cohere.com/api/v2/status.json" },
];

const NPM_PACKAGES = [
  "@anthropic-ai/sdk",
  "openai",
  "@google/generative-ai",
  "langchain",
  "ollama",
];

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

// A real browser UA gets us past the basic bot check some status pages front with.
const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; ai-observatory collector; +https://ai-observatory.view.fast)",
};

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const err = new Error(`${url} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  // Some hosts answer 200 with an HTML challenge page. Surface that as a clear
  // failure rather than a JSON parse error.
  if (text.trimStart().startsWith("<")) throw new Error(`${url} -> HTML instead of JSON`);
  return JSON.parse(text);
}

/** Retries on 429/5xx with exponential backoff; gives up after `attempts`. */
async function withBackoff(fn, { attempts = 5, baseMs = 4000 } = {}) {
  let delay = baseMs;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error.status === 429 || (error.status >= 500 && error.status < 600);
      if (!retryable || i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

/** Calls a capsule mutation over the same transport the browser uses. */
async function callMutation(name, args) {
  const res = await fetch(`${BASE}/__zero/run`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ op: "mutation.run", name, args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} -> ${res.status} ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text);
  const result = parsed?.result ?? parsed;
  if (result?.ok === false) throw new Error(`${name} -> ${result.error ?? "rejected"}`);
  return result;
}

/** Chunked: the whole 430-model catalogue in one request exceeds the runtime's budget. */
const CHUNK = 40;

async function collectModels() {
  const catalogue = await getJson("https://openrouter.ai/api/v1/models");
  const models = catalogue?.data ?? [];
  if (models.length === 0) throw new Error("openrouter returned an empty catalogue");

  // One timestamp for the whole sweep, so finalize can spot what never appeared.
  const runAt = new Date().toISOString();
  let added = 0;
  let changed = 0;

  for (let i = 0; i < models.length; i += CHUNK) {
    const slice = models.slice(i, i + CHUNK);
    const result = await callMutation("ingestModels", [TOKEN, runAt, slice]);
    added += result.added ?? 0;
    changed += result.changed ?? 0;
  }

  const closed = await callMutation("finalizeModels", [TOKEN, runAt, models.length]);
  console.log(
    `models: ${models.length} listed, +${added} ~${changed} -${closed.removed ?? 0}`
  );
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
  },
  litellm: {
    url: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    providers: [
      "anthropic", "openai", "gemini", "mistral", "deepseek", "xai", "meta", "meta_llama", "cohere", "moonshot",
      "zai", "dashscope", "minimax", "perplexity", "ai21",
    ],
    rows(body) {
      const out = [];
      for (const [id, model] of Object.entries(body ?? {})) {
        if (id === "sample_spec" || !this.providers.includes(model?.litellm_provider)) continue;
        if (!["chat", "responses", "completion"].includes(model.mode)) continue;
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
  },
};

/** Dollars per million to dollars per token without the float noise (0.1 / 1e6 is not 1e-7). */
function perToken(perMillion) {
  return Number((Number(perMillion) / 1e6).toPrecision(10));
}

async function collectSources() {
  for (const [source, spec] of Object.entries(SOURCES)) {
    const body = await withBackoff(() => getJson(spec.url));
    // Shortest id first: when several ids collapse to one key, the rolling name wins.
    const rows = spec.rows(body).sort((a, b) => a.sourceId.length - b.sourceId.length);
    if (rows.length === 0) throw new Error(`${source} returned no usable rows`);

    const runAt = new Date().toISOString();
    let added = 0;
    let changed = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const result = await callMutation("ingestSource", [TOKEN, source, runAt, rows.slice(i, i + CHUNK)]);
      added += result.added ?? 0;
      changed += result.changed ?? 0;
    }
    const closed = await callMutation("finalizeSource", [TOKEN, source, runAt, rows.length]);
    console.log(`${source}: ${rows.length} rows sent, +${added} ~${changed} -${closed.removed ?? 0}`);
  }
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
      });
    } catch (error) {
      // Record the outage of the status page itself rather than dropping the provider,
      // so a gap in coverage is visible in the archive instead of silent.
      console.warn(`status: ${source.provider} unreachable (${error.message})`);
      providers.push({ provider: source.provider, indicator: "unreachable", description: error.message });
    }
  }
  await callMutation("ingestStatus", [TOKEN, providers]);
  console.log(`status: ${providers.length} providers read`);
}

async function collectDaily() {
  let trending = [];
  try {
    trending = await getJson(
      "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=25"
    );
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
  console.log(
    `daily: ${trending.length} trending, ${packages.length} npm, ${pypi.length} pypi, ${repos.length} repos`
  );
}

const JOBS = { models: collectModels, status: collectStatus, sources: collectSources, daily: collectDaily };

async function main() {
  if (!TOKEN) {
    console.error("INGEST_TOKEN is required.");
    process.exit(2);
  }
  const requested = process.argv[2] ?? "all";
  const names = requested === "all" ? Object.keys(JOBS) : [requested];

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

main();
