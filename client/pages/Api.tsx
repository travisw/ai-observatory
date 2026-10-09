/**
 * Everything the site knows, as feeds, JSON, CSV and badges.
 */
import { CodeBlock } from "@spacefast/zero/kit";

import { Card, Prose, Section } from "../components/bits";
import { usePageTitle } from "../lib/util";

const BASE = "https://ai-observatory.view.fast";
const EXAMPLE = "anthropic/claude-haiku-4.5";

function Row(props: { path: string; what: string }) {
  return (
    <li class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-4 py-2 text-sm last:border-0">
      <a href={props.path} class="font-mono text-accent hover:underline">{props.path}</a>
      <span class="text-ink-muted">{props.what}</span>
    </li>
  );
}

export function ApiPage() {
  usePageTitle("API and feeds");
  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">API and feeds</h1>
        <p class="max-w-2xl text-sm text-ink-muted">No key, no account. Responses are cached for five minutes and allow cross-origin requests. Please link back when you publish something built on them.</p>
      </div>

      <Section title="Feeds" hint="Atom, for any feed reader or a Slack RSS app">
        <Card padded={false}>
          <ul>
            <Row path="/feed.xml" what="every change" />
            <Row path="/feed.xml?watch=claude,deepseek" what="only models matching these terms (comma-separated model ids, providers or words)" />
            <Row path={`/feed.xml?model=${EXAMPLE}`} what="one model" />
            <Row path="/feed.xml?provider=anthropic" what="one provider" />
            <Row path="/feed.xml?kind=prices" what="one kind: prices, listings, context, lifecycle, hosts" />
          </ul>
        </Card>
      </Section>

      <Section title="JSON" hint="the same data the pages use">
        <Card padded={false}>
          <ul>
            <Row path="/api/changes.json" what="recent changes as stories, same filters as the feed" />
            <Row path="/api/models.json" what="every listed model with its current numbers" />
            <Row path={`/api/model.json?id=${EXAMPLE}`} what="one model: current row, every change, hosts, lifecycle, other listings" />
            <Row path="/api/index.json" what="the token price index, daily" />
            <Row path="/api/status.json" what="provider status and incidents" />
            <Row path="/api/retiring.json" what="announced retirements and listing expiries" />
            <Row path="/api/records.json" what="the records board" />
            <Row path="/export/changes.csv" what="the newest thousand changes as CSV" />
          </ul>
        </Card>
        <Prose>
          <p>Prices in JSON are dollars per token, as the sources publish them; multiply by a million for the usual per-million figure. Times are UTC in ISO 8601.</p>
        </Prose>
        <CodeBlock language="bash" code={`curl -s '${BASE}/api/model.json?id=${EXAMPLE}' | jq '.model.promptPrice'`} />
      </Section>

      <Section title="Badges" hint="an SVG for a README or a docs page">
        <div class="flex flex-wrap items-center gap-3">
          {["input", "output", "context", "changed", "retires"].map((metric) => (
            <img key={metric} src={`/badge.svg?model=${EXAMPLE}&metric=${metric}`} alt={`${metric} badge for ${EXAMPLE}`} height={20} />
          ))}
        </div>
        <CodeBlock language="markdown" code={`![input price](${BASE}/badge.svg?model=${EXAMPLE}&metric=input)`} />
        <Prose>
          <p>Metrics: <code class="font-mono">input</code>, <code class="font-mono">output</code> (price per million), <code class="font-mono">context</code>, <code class="font-mono">changed</code> (how long since the last change), <code class="font-mono">retires</code> (days until a published retirement date, or "no date").</p>
        </Prose>
      </Section>

      <Section title="Share cards" hint="a 1200×630 image for any model">
        <Card>
          <img src={`/og/model.png?id=${EXAMPLE}`} alt={`Share card for ${EXAMPLE}`} class="w-full max-w-xl rounded-lg border border-line" />
        </Card>
        <CodeBlock language="html" code={`<img src="${BASE}/og/model.png?id=${EXAMPLE}" alt="…">`} />
      </Section>

      <Section title="Links that mean something" hint="every view is an address">
        <Card padded={false}>
          <ul>
            <Row path="/changes?kind=prices&provider=openai" what="filtered record" />
            <Row path="/compare?m=anthropic/claude-haiku-4.5,deepseek/deepseek-v4.1-flash" what="a comparison" />
            <Row path="/time-machine?at=2026-09-15" what="the catalogue on a day" />
            <Row path={`/model/${EXAMPLE}?range=30d`} what="a model page with the chart range set" />
          </ul>
        </Card>
      </Section>
    </div>
  );
}
