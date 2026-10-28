#!/usr/bin/env node
/**
 * The collector by hand, from any machine with node 18+, against any environment.
 *
 *   INGEST_TOKEN=... OBSERVATORY_URL=https://ai-observatory.view.fast \
 *     node collector/fetch-and-post.mjs [sweep|slow|daily|benchmarks|once|models|hosts|status|sources|lifecycle|backfill-litellm|rebuild-records]
 *
 * The scheduled runs are the worker in `handler.mjs`; this is the same code with a prompt.
 */

import { makeContext } from "./http.mjs";
import { JOBS, SCHEDULES, runJobs } from "./jobs.mjs";

const requested = process.argv[2] ?? "once";
const names = SCHEDULES[requested] ?? (JOBS[requested] ? [requested] : null);
if (!names) {
  console.error(`unknown job: ${requested}`);
  process.exit(2);
}
if (!process.env.INGEST_TOKEN) {
  console.error("INGEST_TOKEN is required.");
  process.exit(2);
}

const context = makeContext({
  base: process.env.OBSERVATORY_URL,
  token: process.env.INGEST_TOKEN,
  githubToken: process.env.GITHUB_TOKEN,
});
const results = await runJobs(context, names);
process.exit(results.every((r) => r.ok) ? 0 : 1);
