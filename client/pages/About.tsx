import { Link } from "@spacefast/zero/client";

import { Prose } from "../components/bits";
import { usePageTitle } from "../lib/util";

export function AboutPage() {
  usePageTitle("About");
  return (
    <div class="flex flex-col gap-8">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">About</h1>
        <p class="max-w-2xl text-base text-ink-muted">The changelog AI providers don't publish.</p>
      </div>
      <Prose>
        <p>
          If you build on AI models, the price and limits of the one you picked change under you, and nobody sends an email. A model gets cheaper, or dearer, or its context window shrinks, or it quietly disappears, and the only trace is a pricing page that now says something different from what it said last week.
        </p>
        <p>
          AI Observatory keeps the record. Every half hour it reads the public price list for every model it can see, compares it with the one from half an hour ago, and writes down anything that moved, with the time. Nothing is ever deleted. The result is a history that did not otherwise exist.
        </p>
        <h2 class="pt-2 text-lg font-semibold text-ink">What it watches</h2>
        <ul class="list-disc space-y-1 pl-5">
          <li>Prices: input, output and cached-input, per million tokens, including the tiers some models charge for long prompts.</li>
          <li>Limits: the context window and the longest answer a model will give.</li>
          <li>Listings: new models, removed models, and models that come back.</li>
          <li>Rolling names like "latest" aliases, and which concrete model they point at today.</li>
          <li>Hosts: where a model is served from, what each host charges, and whether it is up.</li>
          <li>Retirements: the dates providers publish for switching a model off, and the replacements they recommend.</li>
          <li>Status: whether each provider says it is up right now, and its incident history.</li>
        </ul>
        <h2 class="pt-2 text-lg font-semibold text-ink">How a change is judged</h2>
        <p>
          A price can move because the model's maker changed it, or because the middleman reselling it changed its margin. Two independent price lists are checked as well. When one of them recorded the same move, the change is marked confirmed, meaning the maker did it. Tiny wobbles under three percent are folded into one line per model per day, and a price that goes up and comes back within a day is shown as one flip, not two headlines.
        </p>
        <h2 class="pt-2 text-lg font-semibold text-ink">Sources</h2>
        <p>
          Model listings and prices come from OpenRouter, which fronts most providers with one price list, and from each host it routes to. Cross-checks come from models.dev and LiteLLM, two open price databases. Retirement notices come from the providers' own deprecation pages. Status comes from each provider's status page. Every source is public and needs no key, so the record can keep running unattended.
        </p>
        <h2 class="pt-2 text-lg font-semibold text-ink">What it is not</h2>
        <p>
          This is not a benchmark and not a recommendation. The capability score shown beside some models is the Artificial Analysis intelligence index as published by OpenRouter, included only so that price can be read against something. The product is the diff.
        </p>
        <h2 class="pt-2 text-lg font-semibold text-ink">Take the data with you</h2>
        <p>
          Everything on the site is available as <Link to="/api" class="text-accent hover:underline">RSS feeds, JSON, CSV and badges</Link>. The source is on <a href="https://github.com/travisw/ai-observatory" class="text-accent hover:underline" target="_blank" rel="noopener">GitHub</a>.
        </p>
      </Prose>
    </div>
  );
}
