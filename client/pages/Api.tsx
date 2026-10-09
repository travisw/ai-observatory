/**
 * Everything the site knows, as feeds, JSON, CSV and badges.
 */
import { CodeBlock } from "@spacefast/zero/kit";

import { LogLine, LogSection, Marquee, Plaque } from "../components/Log";
import { usePageTitle } from "../lib/util";

const BASE = "https://ai-observatory.view.fast";
const EXAMPLE = "anthropic/claude-haiku-4.5";

function Row(props: { path: string; what: string; left: string }) {
  return (
    <LogLine left={<span class="uppercase">{props.left}</span>}>
      <a href={props.path} class="font-mono text-xs text-accent hover:underline">{props.path}</a>
      <span class="ml-3 text-sm text-ink-muted">{props.what}</span>
    </LogLine>
  );
}

export function ApiPage() {
  usePageTitle("API and feeds");
  return (
    <div class="flex flex-col gap-8">
      <Marquee title="API and feeds">No key, no account. Responses are cached for five minutes and allow cross-origin requests. Please link back when you publish something built on them.</Marquee>

      <LogSection title="Feeds" hint="Atom, for any feed reader or a Slack RSS app">
        <ul>
          <Row left="ATOM" path="/feed.xml" what="every change" />
          <Row left="ATOM" path="/feed.xml?watch=claude,deepseek" what="only models matching these terms (comma-separated model ids, providers or words)" />
          <Row left="ATOM" path={`/feed.xml?model=${EXAMPLE}`} what="one model" />
          <Row left="ATOM" path="/feed.xml?provider=anthropic" what="one provider" />
          <Row left="ATOM" path="/feed.xml?kind=repriced" what="one kind: repriced, listed, delisted, resized, retiring, repointed, hosted" />
        </ul>
      </LogSection>

      <LogSection title="JSON" hint="the same data the pages use">
        <ul>
          <Row left="JSON" path="/api/changes.json" what="recent changes as stories, same filters as the feed" />
          <Row left="JSON" path="/api/models.json" what="every listed model with its current numbers" />
          <Row left="JSON" path={`/api/model.json?id=${EXAMPLE}`} what="one model: current row, every change, hosts, lifecycle, other listings" />
          <Row left="JSON" path="/api/index.json" what="the token price index, daily" />
          <Row left="JSON" path="/api/status.json" what="provider status and incidents" />
          <Row left="JSON" path="/api/retiring.json" what="announced retirements and listing expiries" />
          <Row left="JSON" path="/api/records.json" what="the records board" />
          <Row left="CSV" path="/export/changes.csv" what="the newest thousand changes as CSV" />
        </ul>
        <p class="text-sm text-ink-muted">Prices in JSON are dollars per token, as the sources publish them; multiply by a million for the usual per-million figure. Times are UTC in ISO 8601.</p>
        <CodeBlock language="bash" code={`curl -s '${BASE}/api/model.json?id=${EXAMPLE}' | jq '.model.promptPrice'`} />
      </LogSection>

      <LogSection title="Badges" hint="an SVG for a README or a docs page">
        <div class="flex flex-wrap items-center gap-3">
          {["input", "output", "context", "changed", "retires"].map((metric) => (
            <img key={metric} src={`/badge.svg?model=${EXAMPLE}&metric=${metric}`} alt={`${metric} badge for ${EXAMPLE}`} height={20} />
          ))}
        </div>
        <CodeBlock language="markdown" code={`![input price](${BASE}/badge.svg?model=${EXAMPLE}&metric=input)`} />
        <p class="text-sm text-ink-muted">Metrics: <code class="font-mono">input</code>, <code class="font-mono">output</code> (price per million), <code class="font-mono">context</code>, <code class="font-mono">changed</code> (how long since the last change), <code class="font-mono">retires</code> (days until a published retirement date, or "no date").</p>
      </LogSection>

      <LogSection title="Share cards" hint="a 1200×630 image for any model">
        <img src={`/og/model.png?id=${EXAMPLE}`} alt={`Share card for ${EXAMPLE}`} class="w-full max-w-xl rounded-sm border border-line" />
        <CodeBlock language="html" code={`<img src="${BASE}/og/model.png?id=${EXAMPLE}" alt="…">`} />
      </LogSection>

      <LogSection title="Links that mean something" hint="every view is an address">
        <ul>
          <Row left="PAGE" path="/changes?kind=prices&provider=openai" what="filtered log" />
          <Row left="PAGE" path="/compare?m=anthropic/claude-haiku-4.5,deepseek/deepseek-v4.1-flash" what="a comparison" />
          <Row left="PAGE" path="/time-machine?at=2026-09-15" what="the catalogue on a day" />
          <Row left="PAGE" path={`/model/${EXAMPLE}?range=30d`} what="a model page with the chart range set" />
        </ul>
      </LogSection>

      <Plaque><span class="text-[11px] font-bold uppercase tracking-[0.3em] text-accent">Built on Spacefast</span><span class="ml-3 text-sm">The capsule, the database, the feeds and the share cards all run on one Spacefast Zero app; collection runs on a schedule and writes in.</span></Plaque>
    </div>
  );
}
