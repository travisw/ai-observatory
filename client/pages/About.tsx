import { Link } from "@spacefast/zero/client";

import { FlapText, type FlapTone } from "../components/Flap";
import { LogSection, Marquee, Plaque } from "../components/Log";
import { usePageTitle } from "../lib/util";

const LEGEND: { word: string; tone: FlapTone; means: string }[] = [
  { word: "ARRIVED", tone: "success", means: "A model was listed for the first time. RETURNED means it came back after a gap." },
  { word: "BOARDING", tone: "success", means: "Its maker has published a retirement date more than 30 days away. Build on it with that date in mind." },
  { word: "FINAL CALL", tone: "warning", means: "Retirement is within 30 days, or OpenRouter will drop the listing within 30 days." },
  { word: "DEPARTED", tone: "danger", means: "The provider has switched it off. The page stays, with its whole history." },
  { word: "CANCELLED", tone: "danger", means: "It vanished from the catalogue without a notice we could find." },
  { word: "REROUTED", tone: "warning", means: "A rolling name such as \"latest\" now answers with a different model than it did." },
  { word: "ON TIME", tone: "success", means: "The provider's own status page says all is well." },
  { word: "DELAYED", tone: "warning", means: "Degraded performance or maintenance, per the status page." },
  { word: "NO READING", tone: "muted", means: "The status page could not be read this time. Never counted as uptime." },
];

export function AboutPage() {
  usePageTitle("About");
  return (
    <div class="flex flex-col gap-8">
      <Marquee title="About">The changelog AI providers don't publish.</Marquee>
      <div class="flex max-w-3xl flex-col gap-3 text-[15px] leading-relaxed text-ink">
        <p>
          If you build on AI models, the price and limits of the one you picked change under you, and nobody sends an email. A model gets cheaper, or dearer, or its context window shrinks, or it quietly disappears, and the only trace is a pricing page that now says something different from what it said last week.
        </p>
        <p>
          AI Observatory keeps the record. Every half hour it reads the public price list for every model it can see, compares it with the one from half an hour ago, and writes down anything that moved, with the time. Nothing is ever deleted. The result is a history that did not otherwise exist, shown the way an airport shows arrivals and departures: on a board that flips when something changes.
        </p>
      </div>

      <LogSection title="How to read the board" hint="what the status words mean">
        <ul class="flex flex-col">
          {LEGEND.map((l, i) => (
            <li key={l.word} class="flex flex-wrap items-center gap-4 border-b border-dotted border-line py-2 last:border-0">
              <FlapText text={l.word} width={10} size="sm" tone={l.tone} delay={i * 40} />
              <span class="text-sm text-ink">{l.means}</span>
            </li>
          ))}
        </ul>
      </LogSection>

      <LogSection title="What it watches">
        <ul class="flex max-w-3xl flex-col gap-1 text-[15px] leading-relaxed text-ink">
          <li>Prices: input, output and cached-input, per million tokens, including the tiers some models charge for long prompts.</li>
          <li>Limits: the context window and the longest answer a model will give.</li>
          <li>Listings: new models, removed models, and models that come back.</li>
          <li>Rolling names like "latest" aliases, and which concrete model they point at today.</li>
          <li>Hosts: where a model is served from, what each host charges, and whether it is up.</li>
          <li>Retirements: the dates providers publish for switching a model off, and the replacements they recommend.</li>
          <li>Status: whether each provider says it is up right now, and its incident history.</li>
        </ul>
      </LogSection>

      <LogSection title="How a change is judged">
        <p class="max-w-3xl text-[15px] leading-relaxed text-ink">
          A price can move because the model's maker changed it, or because the middleman reselling it changed its margin. Two independent price lists are checked as well. When one of them recorded the same move, the change is marked confirmed, meaning the maker did it. Tiny wobbles under three percent are folded into one line per model per day, a price that goes up and comes back within a day is shown as one flip, and a model repriced six or more times in a week is marked volatile rather than headlined every time.
        </p>
      </LogSection>

      <LogSection title="Sources">
        <p class="max-w-3xl text-[15px] leading-relaxed text-ink">
          Model listings and prices come from OpenRouter, which fronts most providers with one price list, and from each host it routes to. Cross-checks come from models.dev and LiteLLM, two open price databases. Retirement notices come from the providers' own deprecation pages. Status comes from each provider's status page. Every source is public and needs no key, so the record can keep running unattended.
        </p>
      </LogSection>

      <LogSection title="What it is not">
        <p class="max-w-3xl text-[15px] leading-relaxed text-ink">
          This is not a benchmark and not a recommendation. The capability score shown beside some models is the Artificial Analysis intelligence index as published by OpenRouter, included only so that price can be read against something. The product is the diff.
        </p>
      </LogSection>

      <Plaque>
        <span class="text-[11px] font-bold uppercase tracking-[0.3em] text-accent">Take the data with you</span>
        <span class="ml-3 text-sm">Everything on the site is available as <Link to="/api" class="text-accent hover:underline">RSS feeds, JSON, CSV and badges</Link>. The source is on <a href="https://github.com/travisw/ai-observatory" class="text-accent hover:underline" target="_blank" rel="noopener">GitHub</a>.</span>
      </Plaque>
    </div>
  );
}
