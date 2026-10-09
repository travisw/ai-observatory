/**
 * Transport shared by every collector job: polite fetching with backoff, and the one
 * call shape the capsule accepts.
 */

export const BASE = process.env.OBSERVATORY_URL ?? "https://ai-observatory.view.fast";
export const TOKEN = process.env.INGEST_TOKEN;

// A real browser UA gets us past the basic bot check some status pages front with.
export const HEADERS = {
  accept: "application/json, text/markdown;q=0.9, */*;q=0.8",
  "user-agent": "Mozilla/5.0 (compatible; ai-observatory collector; +https://ai-observatory.view.fast)",
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getText(url, headers = {}) {
  const res = await fetch(url, { headers: { ...HEADERS, ...headers } });
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

/** Retries on 429/5xx with exponential backoff; gives up after `attempts`. */
export async function withBackoff(fn, { attempts = 5, baseMs = 4000 } = {}) {
  let delay = baseMs;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error.status === 429 || (error.status >= 500 && error.status < 600);
      if (!retryable || i >= attempts) throw error;
      await sleep(delay);
      delay *= 2;
    }
  }
}

/** Calls a capsule mutation over the same transport the browser uses. */
export async function callMutation(name, args) {
  const res = await fetch(`${BASE}/__zero/run`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ op: "mutation.run", name, args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} -> ${res.status} ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text);
  const result = parsed?.result ?? parsed?.data ?? parsed;
  if (result?.ok === false) throw new Error(`${name} -> ${result.error ?? "rejected"}`);
  return result;
}

/** Chunked: the whole catalogue in one request exceeds the runtime's budget. */
export const CHUNK = 40;
