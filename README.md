# AI Observatory

The changelog AI providers don't publish.

Live: **https://ai-observatory.view.fast/**

Providers change prices, context limits, aliases and availability without announcing it, and
edit their docs in place. This site checks every half hour, writes down what moved, and keeps
the record forever. It is built entirely on Spacefast Zero; collection runs on GitHub Actions
and writes in through the capsule's mutations.

## What it tracks

| Signal | Source | Cadence |
|---|---|---|
| Catalogue, prices, context, long-context tiers, alias targets, expiry dates, capability flags for ~460 models | OpenRouter `/api/v1/models` | 30 min |
| Which hosts serve each model, at what price, quantization and uptime | OpenRouter `/api/v1/models/{id}/endpoints` | 6 h |
| First-party price lists, for cross-checking | models.dev, LiteLLM | 6 h |
| Deprecation and retirement notices | OpenAI, Anthropic and Cohere deprecation pages; LiteLLM and models.dev flags | 6 h |
| Provider status and incidents | Statuspage JSON for OpenAI, Anthropic, Groq, Cohere, Cerebras, Fireworks, Perplexity, Replicate; Google Cloud incidents | 30 min |
| Market summary (median prices, frontier / mid / budget baskets) | computed from the archive | daily |
| Open-weights attention, SDK downloads, repo stars | Hugging Face, npm, PyPI, GitHub | daily |

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
  **graveyard**, a **records board**, a daily **token price index**, and a **time machine** that
  rebuilds the catalogue as of any date.
- **Feeds and data.** `/feed.xml` (Atom, filterable with `?watch=claude,deepseek`), JSON at
  `/api/*.json`, CSV at `/export/changes.csv`, badges at `/badge.svg?model=…`, share cards at
  `/og/*.png`. All documented at `/api` on the site.

## Architecture

The capsule (`server/index.ts`) owns the schema, the diffing, the records, the daily rollup,
the public endpoints and the console queries. `shared/` holds the story builder and formatting
helpers used by both the capsule and the browser. The client (`client/`) is a Preact app on the
Zero kit and charts.

Collection runs separately in `collector/` on a GitHub Actions schedule and writes in through
mutations. Keeping collection outside the app means the schedule, the retries and the source
list can change without redeploying, and any job can be run by hand against any environment.

Sweeps are chunked so each request stays small, and every chunk in a sweep shares one
timestamp, so the finalize step can tell what was absent from the whole sweep rather than
merely missing from one chunk. A sweep that returns far fewer models than are known is
recorded and ignored rather than retiring half the archive.

The daily market rollup runs on the platform's own scheduler (`crons` in `sf.jsonc`, hitting
`/cron/rollup` with the `CRON_SECRET` bearer token) and is also run by the daily collector job.

## Running the collector

```sh
INGEST_TOKEN=... OBSERVATORY_URL=https://ai-observatory.view.fast \
  node collector/fetch-and-post.mjs [models|hosts|status|sources|lifecycle|daily|all]
```

`backfill-litellm` replays the weekly history of LiteLLM's price file (back to 2023) into the
first-party archive. It is manual, run once, and never scheduled.

No dependencies. Node 18+.

## Development

```sh
npm install
sf dev          # local capsule with an in-memory database
sf publish      # deploy
sf db migrate   # apply schema changes
```

`AGENTS.md` is the guide for coding agents working in this capsule.
