/**
 * Transport shared by every collector job: polite fetching with backoff, and the one call
 * shape the capsule accepts. Plain `fetch` throughout, so the same code runs as a worker
 * on Spacefast and under node from any machine.
 */

// A real browser UA gets us past the basic bot check some status pages front with.
export const HEADERS = {
  accept: "application/json, text/markdown;q=0.9, */*;q=0.8",
  "user-agent": "Mozilla/5.0 (compatible; ai-observatory collector; +https://ai-observatory.view.fast)",
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A request that hangs is abandoned after this long, so one slow host cannot hold up a whole worker run. */
export const FETCH_TIMEOUT_MS = 8_000;

export async function getText(url, headers = {}) {
  const res = await fetch(url, { headers: { ...HEADERS, ...headers }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error(`${url} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

export async function getJson(url, headers = {}) {
  const text = await getText(url, headers);
  // Some hosts answer 200 with an HTML challenge page. Surface that as a clear
  // failure rather than a JSON parse error.
  if (text.trimStart().startsWith("<")) throw new Error(`${url} -> HTML instead of JSON`);
  return JSON.parse(text);
}

/**
 * Retries on 429/5xx with exponential backoff; gives up after `attempts`, or rather than wait past
 * `deadline` (a worker request is cut off at 30 seconds, so a retry it cannot finish is no use).
 */
export async function withBackoff(fn, { attempts = 3, baseMs = 2000, deadline = Infinity } = {}) {
  let delay = baseMs;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error.status === 429 || (error.status >= 500 && error.status < 600);
      if (!retryable || i >= attempts || Date.now() + delay > deadline) throw error;
      await sleep(delay);
      delay *= 2;
    }
  }
}

/** Chunked: the whole catalogue in one request exceeds the capsule's request budget. */
export const CHUNK = 40;

/**
 * What every job needs from its surroundings: where the observatory is, the token its
 * ingest mutations check, and somewhere to write a line of progress.
 */
export function makeContext({ base = "https://ai-observatory.view.fast", token, githubToken = "", deadline = Infinity, log = console.log }) {
  if (!token) throw new Error("INGEST_TOKEN is required.");
  return {
    githubToken,
    /** When a job that can stop part way should stop. The worker's requests are cut off; a run by hand is not. */
    deadline,
    log,
    /** Calls a capsule mutation over the same transport the browser uses. The token goes first, as every ingest mutation expects. */
    async mutate(name, ...args) {
      const res = await fetch(`${base}/__zero/run`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ op: "mutation.run", name, args: [token, ...args] }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${name} -> ${res.status} ${text.slice(0, 200)}`);
      const parsed = JSON.parse(text);
      const result = parsed?.result ?? parsed?.data ?? parsed;
      if (result?.ok === false) throw new Error(`${name} -> ${result.error ?? "rejected"}`);
      return result;
    },
  };
}
