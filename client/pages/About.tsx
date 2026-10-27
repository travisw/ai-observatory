import { Link } from "@spacefast/zero/client";

import { PageHead, Pill, Section } from "../components/Wire";
import type { PillTone } from "../lib/text";
import { usePageTitle } from "../lib/util";

const LEGEND: { word: string; tone: PillTone; means: string }[] = [
  { word: "new", tone: "ok", means: "A model was listed for the first time. \"Back\" means it came back after a gap." },
  { word: "retiring", tone: "bad", means: "Its maker has published a retirement date. The days left show beside it; under two weeks is marked in red." },
  { word: "expiring", tone: "bad", means: "OpenRouter will drop the listing on a published date." },
  { word: "retired", tone: "off", means: "The provider has switched it off. The page stays, with its whole history." },
  { word: "removed", tone: "bad", means: "It vanished from the catalogue without a notice we could find." },
  { word: "alias moved", tone: "warn", means: "A rolling name such as \"latest\" now answers with a different model than it did." },
  { word: "operational", tone: "ok", means: "The provider's own status page says all is well." },
  { word: "degraded", tone: "warn", means: "Degraded performance or maintenance, per the status page." },
  { word: "no reading", tone: "off", means: "The status page could not be read this time. Never counted as uptime." },
];

export function AboutPage() {
  usePageTitle("About");
  return (
    <div class="stack">
      <PageHead title="About">The changelog AI providers don't publish.</PageHead>
      <div>
        <p>
          If you build on AI models, the price and limits of the one you picked change under you, and nobody sends an email. A model gets cheaper, or dearer, or its context window shrinks, or it quietly disappears, and the only trace is a pricing page that now says something different from what it said last week.
        </p>
        <p>
          AI Observatory keeps the record. Every hour it reads the public price list for every model it can see, compares it with the one from an hour ago, and writes down anything that moved, with the time. Nothing is ever deleted. The result is a history that did not otherwise exist, written up each day as the news it is.
        </p>
      </div>

      <Section title="What the labels mean">
        <div class="tw">
          <table aria-label="Labels">
            <tbody>
              {LEGEND.map((l) => (
                <tr key={l.word}>
                  <td style={{ whiteSpace: "nowrap" }}><Pill tone={l.tone}>{l.word}</Pill></td>
                  <td>{l.means}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="What it watches">
        <ul class="plain">
          <li>Prices: input, output and cached-input, per million tokens, including the tiers some models charge for long prompts.</li>
          <li>Limits: the context window and the longest answer a model will give.</li>
          <li>Listings: new models, removed models, and models that come back.</li>
          <li>Rolling names like "latest" aliases, and which concrete model they point at today.</li>
          <li>Hosts: where a model is served from, what each host charges, and whether it is up.</li>
          <li>Retirements: the dates providers publish for switching a model off, and the replacements they recommend.</li>
          <li>Status: whether each provider says it is up right now, and its incident history.</li>
        </ul>
      </Section>

      <Section title="How a change is judged">
        <p>
          A price can move because the model's maker changed it, or because the middleman reselling it changed its margin. Two independent price lists are checked as well. When one of them recorded the same move, the change is marked confirmed, meaning the maker did it. Tiny wobbles under three percent are folded into one line per model per day, a price that goes up and comes back within a day is shown as one move, and a model repriced six or more times in a week is marked volatile rather than headlined every time.
        </p>
      </Section>

      <Section title="Sources">
        <p>
          Model listings and prices come from OpenRouter, which fronts most providers with one price list, and from each host it routes to. Cross-checks come from models.dev and LiteLLM, two open price databases. Retirement notices come from the providers' own deprecation pages. Status comes from each provider's status page. Every source is public and needs no key, so the record can keep running unattended.
        </p>
      </Section>

      <Section title="What it is not">
        <p>
          This is not a benchmark and not a recommendation. The capability score shown beside some models is the Artificial Analysis intelligence index as published by OpenRouter, included only so that price can be read against something. The product is the diff.
        </p>
      </Section>

      <p class="note">
        Take the data with you: everything on the site is available as <Link to="/api" class="acc hl">feeds, JSON, CSV and badges</Link>. The source is on <a href="https://github.com/travisw/ai-observatory" class="acc hl" target="_blank" rel="noopener">GitHub</a>.
      </p>
    </div>
  );
}
