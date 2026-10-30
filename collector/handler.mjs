/**
 * The collector as a Spacefast worker. The platform's scheduler (see `sf.jsonc` beside this
 * file) asks for `/collect/sweep`, `/collect/hosts`, `/collect/slow`, `/collect/daily` and
 * `/collect/benchmarks`; `sf crons run` runs any of them by hand.
 *
 * A request is honoured when it carries the scheduler's own `x-spacefast-cron` header or the
 * space's `CRON_SECRET` as a bearer token. The ingest token never leaves the space: it is read
 * from the environment here and sent only to the observatory's mutations.
 */

import { makeContext } from "./http.mjs";
import { BY_HAND_ONLY, JOBS, SCHEDULES, runJobs } from "./jobs.mjs";

/**
 * The platform ends a worker request after 30 seconds. A job that can stop part way (the
 * hosts walk) stops reading at this mark, leaving room for its last fetch's retries and its
 * closing writes.
 */
const READ_UNTIL_MS = 18_000;

function authorized(request, env) {
  if (request.headers.has("x-spacefast-cron")) return true;
  const secret = env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = /^\/collect\/([a-z-]+)$/.exec(url.pathname);
    if (!match) return new Response("Not found", { status: 404 });
    if (!authorized(request, env)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const target = match[1];
    const names = SCHEDULES[target] ?? (JOBS[target] && !BY_HAND_ONLY.has(target) ? [target] : null);
    if (!names) return Response.json({ ok: false, error: `unknown job: ${target}` }, { status: 404 });

    const lines = [];
    const log = (line) => {
      lines.push(line);
      console.log(line);
    };
    const started = Date.now();
    let results;
    try {
      const context = makeContext({
        base: env.OBSERVATORY_URL,
        token: env.INGEST_TOKEN,
        githubToken: env.GITHUB_TOKEN,
        deadline: started + READ_UNTIL_MS,
        log,
      });
      results = await runJobs(context, names);
    } catch (error) {
      return Response.json({ ok: false, target, error: error.message, log: lines }, { status: 500 });
    }
    const ok = results.every((r) => r.ok);
    // A failed job answers 500 so the scheduler records the run as a failure.
    return Response.json({ ok, target, ms: Date.now() - started, results, log: lines }, { status: ok ? 200 : 500 });
  },
};
