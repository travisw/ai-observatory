/**
 * Everything the site knows, as feeds, JSON, CSV and badges.
 */
import type { ComponentChildren } from "preact";
import { CodeBlock } from "@spacefast/zero/kit";

import { PageHead, Section } from "../components/Wire";
import { usePageTitle } from "../lib/util";

const BASE = "https://ai-observatory.view.fast";
const EXAMPLE = "anthropic/claude-haiku-4.5";

function Row(props: { path: string; what: string; left: string }) {
  return (
    <tr>
      <td class="when">{props.left}</td>
      <td><a href={props.path} class="acc hl"><code class="mono small">{props.path}</code></a></td>
      <td class="soft">{props.what}</td>
    </tr>
  );
}

function Rows(props: { label: string; children: ComponentChildren }) {
  return (
    <div class="tw">
      <table aria-label={props.label}>
        <thead><tr><th>Format</th><th>Address</th><th>What you get</th></tr></thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

export function ApiPage() {
  usePageTitle("API and feeds");
  return (
    <div class="stack">
      <PageHead title="API and feeds">No key, no account. Responses are cached for five minutes and allow cross-origin requests. Please link back when you publish something built on them.</PageHead>

      <Section title="Feeds" hint="Atom, for any feed reader or a Slack RSS app">
        <Rows label="Feeds">
          <Row left="Atom" path="/feed.xml" what="every change" />
          <Row left="Atom" path="/feed.xml?watch=claude,deepseek" what="only models matching these terms (comma-separated model ids, providers or words)" />
          <Row left="Atom" path={`/feed.xml?model=${EXAMPLE}`} what="one model" />
          <Row left="Atom" path="/feed.xml?provider=anthropic" what="one provider" />
          <Row left="Atom" path="/feed.xml?kind=repriced" what="one kind: repriced, listed, delisted, resized, retiring, repointed, hosted" />
        </Rows>
      </Section>

      <Section title="JSON" hint="the same data the pages use">
        <Rows label="JSON and CSV">
          <Row left="JSON" path="/api/changes.json" what="recent changes as stories, same filters as the feed" />
          <Row left="JSON" path="/api/models.json" what="every listed model with its current numbers" />
          <Row left="JSON" path={`/api/model.json?id=${EXAMPLE}`} what="one model: current row, every change, hosts, lifecycle, other listings, published benchmark results" />
          <Row left="JSON" path="/api/index.json" what="the token price index, daily" />
          <Row left="JSON" path="/api/status.json" what="provider status and incidents" />
          <Row left="JSON" path="/api/retiring.json" what="announced retirements and listing expiries" />
          <Row left="JSON" path="/api/records.json" what="the records" />
          <Row left="JSON" path="/api/benchmarks.json" what="the leaderboards read, with their slugs" />
          <Row left="JSON" path="/api/benchmarks.json?benchmark=gpqa-diamond" what="every current result on one benchmark, as published by Epoch AI or LMArena" />
          <Row left="CSV" path="/export/changes.csv" what="the newest thousand changes as CSV" />
        </Rows>
        <p class="note" style={{ marginTop: 10 }}>Prices in JSON are dollars per token, as the sources publish them; multiply by a million for the usual per-million figure. Times are UTC in ISO 8601.</p>
        <CodeBlock language="bash" code={`curl -s '${BASE}/api/model.json?id=${EXAMPLE}' | jq '.model.promptPrice'`} />
      </Section>

      <Section title="Badges" hint="an SVG for a README or a docs page">
        <div class="chips" style={{ marginBottom: 10 }}>
          {["input", "output", "context", "changed", "retires"].map((metric) => (
            <img key={metric} src={`/badge.svg?model=${EXAMPLE}&metric=${metric}`} alt={`${metric} badge for ${EXAMPLE}`} height={20} />
          ))}
        </div>
        <CodeBlock language="markdown" code={`![input price](${BASE}/badge.svg?model=${EXAMPLE}&metric=input)`} />
        <p class="note" style={{ marginTop: 10 }}>Metrics: <code class="mono">input</code>, <code class="mono">output</code> (price per million), <code class="mono">context</code>, <code class="mono">changed</code> (how long since the last change), <code class="mono">retires</code> (days until a published retirement date, or "no date").</p>
      </Section>

      <Section title="Share cards" hint="a 1200×630 image for any model">
        <img src={`/og/model.png?id=${EXAMPLE}`} alt={`Share card for ${EXAMPLE}`} style={{ width: "100%", maxWidth: 600, border: "1px solid #2c2d29", display: "block", marginBottom: 10 }} />
        <CodeBlock language="html" code={`<img src="${BASE}/og/model.png?id=${EXAMPLE}" alt="…">`} />
      </Section>

      <Section title="Links that mean something" hint="every view is an address">
        <Rows label="Page links">
          <Row left="Page" path="/changes?kind=prices&provider=openai" what="filtered changes" />
          <Row left="Page" path="/compare?m=anthropic/claude-haiku-4.5,deepseek/deepseek-v4.1-flash" what="a comparison" />
          <Row left="Page" path="/time-machine?at=2026-09-15" what="the catalogue on a day" />
          <Row left="Page" path="/benchmarks?b=swe-bench-verified&tracked=1" what="one benchmark, only the models priced here" />
          <Row left="Page" path={`/model/${EXAMPLE}?range=30d`} what="a model page with the chart range set" />
        </Rows>
      </Section>

      <p class="note">Built on Spacefast: the capsule, the database, the feeds and the share cards all run on one Spacefast Zero app; collection runs on a schedule and writes in.</p>
    </div>
  );
}
