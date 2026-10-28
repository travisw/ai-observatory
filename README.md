# AI Observatory

The changelog AI providers don't publish.

Live: **https://ai-observatory.view.fast/**

Providers change prices, context limits, aliases and availability without announcing it, and
edit their docs in place. This site checks every hour, writes down what moved, and keeps
the record forever. It is built entirely on Spacefast: a Zero capsule for the archive and the
site, and a small worker on a second space that collects on a schedule and writes in through
the capsule's mutations.

## What it tracks

| Signal | Source | Cadence |
|---|---|---|
| Catalogue, prices, context, long-context tiers, alias targets, expiry dates, capability flags for ~460 models | OpenRouter `/api/v1/models` | 1 h |
| Which hosts serve each model, at what price, quantization and uptime | OpenRouter `/api/v1/models/{id}/endpoints` | 6 h |
| First-party price lists, for cross-checking | models.dev, LiteLLM | 6 h |
| Deprecation and retirement notices | OpenAI, Anthropic and Cohere deprecation pages; LiteLLM and models.dev flags | 6 h |
| Provider status and incidents | Statuspage JSON for OpenAI, Anthropic, Groq, Cohere, Cerebras, Fireworks, Perplexity, Replicate; Google Cloud incidents | 1 h |
| Market summary (median prices, frontier / mid / budget baskets) | computed from the archive | daily |
| Open-weights attention, SDK downloads, repo stars | Hugging Face, npm, PyPI, GitHub | daily |
| Published benchmark results (GPQA Diamond, SWE-bench Verified, FrontierMath, ARC-AGI-2, Humanity's Last Exam, and more) | Epoch AI's benchmarking hub (one zip of CSVs, CC BY 4.0); the LMArena text leaderboard (Hugging Face dataset, CC BY 4.0) | daily |

Every source is public and keyless. Nothing is ever deleted: a model that leaves the catalogue
keeps its history, and a notice that disappears from a deprecation page is recorded as withdrawn.

## What you get

- **Stories.** Each sweep's raw rows are grouped into one headline per model: "DeepSeek cut V4
  Flash input price 56%", "Anthropic will retire claude-sonnet-4-5 on 30 Nov 2026", "DeepSeek
  Pro Latest now points at a different model". Ranked by how much they matter; exchange-rate
  wobble and prices that flip back within a day are folded away.
- **Per-model pages** with step charts of every price, hosts and their markup, first-party
  listings side by side, lifecycle notices, and the full timeline.
- **Provider pages**, **compare**, **status with 90-day history**, a **retirement calendar**, the
  **graveyard**, a **records page**, a daily **token price index**, and a **time machine** that
  rebuilds the catalogue as of any date.
- **Benchmarks.** Published results from Epoch AI and LMArena, one benchmark at a time, with the
  price tracked here beside each score, and each model's results on its own page. Nothing is run
  here; a loose model key folds effort suffixes, dotted versions and dated snapshots so a source's
  name lands on the right model page, and a name it cannot place is shown without a link rather
  than guessed.
- **Feeds and data.** `/feed.xml` (Atom, filterable with `?watch=claude,deepseek`), JSON at
  `/api/*.json`, CSV at `/export/changes.csv`, badges at `/badge.svg?model=…`, share cards at
  `/og/*.png`. All documented at `/api` on the site.

## Architecture

The capsule (`server/index.ts`) owns the schema, the diffing, the records, the daily rollup,
the public endpoints and the console queries. `shared/` holds the story builder and formatting
helpers used by both the capsule and the browser. The client (`client/`) is a Preact app on the
Zero kit and charts.

Collection runs separately in `collector/`, a Spacefast Functions worker on its own space
(`ai-observatory-collector`, with its own `sf.jsonc` and crons), and writes in through
mutations. It is a worker rather than part of the capsule because the catalogues it reads are
several megabytes each, more than the capsule runtime will hold in memory. Keeping collection
outside the app also means the schedule, the retries and the source list can change without
redeploying the site, and any job can be run by hand against any environment.

The worker answers `/collect/sweep`, `/collect/slow`, `/collect/daily` and `/collect/benchmarks`
for the scheduler, and any single job name. It accepts a request only with the scheduler's own `x-spacefast-cron`
header or the space's `CRON_SECRET` as a bearer token. `INGEST_TOKEN` on the collector space
must match the one on the observatory.

Sweeps are chunked so each request stays small, and every chunk in a sweep shares one
timestamp, so the finalize step can tell what was absent from the whole sweep rather than
merely missing from one chunk. A sweep that returns far fewer models than are known is
recorded and ignored rather than retiring half the archive.

The daily market rollup runs on the platform's own scheduler (`crons` in `sf.jsonc`, hitting
`/cron/rollup` with the `CRON_SECRET` bearer token) and is also run by the daily collector job.

## Running the collector

On the platform, a scheduled job can be run now:

```sh
sf crons run collect-sweep --space ai-observatory-collector --header "authorization: Bearer $CRON_SECRET"
```

By hand, from any machine with node 18+, against any environment:

```sh
INGEST_TOKEN=... OBSERVATORY_URL=https://ai-observatory.view.fast \
  node collector/fetch-and-post.mjs [sweep|slow|daily|benchmarks|once|models|hosts|status|sources|lifecycle]
```

`backfill-litellm` replays the weekly history of LiteLLM's price file (back to 2023) into the
first-party archive, and `rebuild-records` reseeds the records page from the archive. Both are
manual, run once by hand, and never reachable from the worker.

To deploy the worker: `cd collector && sf publish`. No dependencies. The publish writes its bundle
under `collector/__spacefast/`, which git ignores; remove that directory before publishing the
site from the repo root, or the site publish tries to upload it and is refused.

## Development

```sh
npm install
sf dev          # local capsule with an in-memory database
sf publish      # deploy
sf db migrate   # apply schema changes
```

`sf dev` reads server variables from a local `.env.server`. `sf publish` uploads that file's
entries to the space as secrets and replaces what is stored there, so delete a local-dev
`.env.server` before publishing. The real `INGEST_TOKEN` and `CRON_SECRET` live only on the
platform, set with `sf env set`.

`AGENTS.md` is the guide for coding agents working in this capsule.
