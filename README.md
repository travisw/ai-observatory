# AI Observatory

A public, machine-kept record of what the AI providers changed, and when.

Live: **https://ai-observatory.view.fast/**

Most provider APIs are "now" APIs. They report the current state and keep either nothing
or a short rolling window. This polls them on a schedule and never deletes anything, so a
history accumulates that does not otherwise exist.

Providers move prices, context windows and capability flags without announcements, and
edit their docs in place. The archive timestamps it instead.

## What it tracks

| Signal | Source | Cadence |
|---|---|---|
| Model catalogue, pricing, context, modality, capability flags across ~58 providers | OpenRouter | 30 min |
| Provider incidents | OpenAI, Anthropic, Groq, Replicate, Cohere status pages | 30 min |
| Open-weights attention | Hugging Face trending | daily |
| SDK adoption | npm and PyPI download counts | daily |
| Ecosystem pull | GitHub stars, forks, open issues | daily |

Every source is public and keyless. The observatory has to run unattended indefinitely,
and anything needing a rotating credential eventually stops.

## What counts as a change

Each sweep is diffed against the last known state, and only movement is written:

- a model appears, or quietly disappears, or comes back
- input, output, or cache pricing moves
- the context window or max output changes
- modality, tokenizer, or supported parameters change

Rows are retired, never deleted. A model that leaves the catalogue keeps its history.

First-seen dates come from the source's own listing date rather than from whenever the
collector happened to start, so the archive has a past rather than a flat wall at day one.

## Architecture

The capsule (`server/index.ts`) owns the schema, the diffing, and the console. Collection
runs separately in `collector/fetch-and-post.mjs` on a GitHub Actions schedule and writes
into the capsule through mutations.

Keeping collection outside the app means the schedule, the retries, and the source list
can change without redeploying, and the collector can be run by hand from any machine
against any environment.

Catalogue sweeps are chunked so each request stays small. Every chunk in a sweep shares
one timestamp, so the finalize step can tell what was absent from the whole sweep rather
than merely missing from one chunk.

## Running the collector

```sh
INGEST_TOKEN=... OBSERVATORY_URL=https://ai-observatory.view.fast \
  node collector/fetch-and-post.mjs [models|status|daily|all]
```

No dependencies. Node 18+.

## Development

```sh
npm install
sf dev          # local capsule with an in-memory database
sf publish      # deploy
sf db migrate   # apply schema changes
```

`AGENTS.md` is the guide for coding agents working in this capsule.
