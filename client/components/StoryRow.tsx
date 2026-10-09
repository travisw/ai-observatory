/**
 * One story in a feed: glyph square, headline, detail, proof sparkline, delta chip, time.
 * The same anatomy serves the home page, the record and the model timeline.
 */
import { Link } from "@spacefast/zero/client";
import { Sparkline } from "@spacefast/zero/charts";
import { Icon } from "@spacefast/zero/kit";

import { isAlias } from "../../shared/providers";
import { SOURCE_LABEL } from "../../shared/sources";
import type { Story } from "../../shared/stories";
import { deltaIsGood, storyDelta, storyGlyph, storyTone } from "../lib/stories";
import { ago, clockTime } from "../lib/util";
import { DeltaChip, Glyph, toneText } from "./bits";

function SourceTag({ story }: { story: Story }) {
  if (story.source === "hosts") {
    return <span class="rounded border border-line px-1 text-[11px] text-ink-muted">host</span>;
  }
  if (story.source) {
    return <span class="rounded border border-line px-1 text-[11px] text-ink-muted" title={SOURCE_LABEL[story.source] ?? story.source}>at {SOURCE_LABEL[story.source]?.split("'")[0] ?? story.source}</span>;
  }
  if (story.confirmedBy?.length) {
    return (
      <span class="inline-flex items-center gap-0.5 text-[11px] text-accent" title={`Another price list recorded the same move within a week: ${story.confirmedBy.map((s) => SOURCE_LABEL[s] ?? s).join(", ")}`}>
        <Icon name="circle-check" size="sm" label="Confirmed by another price list" />
        confirmed
      </span>
    );
  }
  return null;
}

export type StoryRowProps = {
  story: Story;
  /** null means no link; undefined means link to the model page. */
  href?: string | null;
  spark?: number[];
  relative?: boolean;
  compact?: boolean;
  showMore?: boolean;
  tabIndex?: number;
};

export function StoryRow({ story, href, spark, relative = false, compact = false, showMore = false }: StoryRowProps) {
  const tone = storyTone(story);
  const delta = storyDelta(story);
  const headline = href ? (
    <Link to={href} class={`${compact ? "text-sm" : "text-base"} font-medium text-ink hover:text-accent`}>{story.headline}</Link>
  ) : (
    <span class={`${compact ? "text-sm" : "text-base"} font-medium text-ink`}>{story.headline}</span>
  );
  const extra = showMore ? [story.detail, ...story.more].filter(Boolean).join(" · ") : story.detail;
  return (
    <li class={`flex items-start gap-3 border-b border-line last:border-0 ${compact ? "py-2" : "py-3"}`} data-feed-row>
      <Glyph glyph={storyGlyph(story)} tone={tone} size={compact ? "sm" : "md"} />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {headline}
          {!story.source || story.source === "hosts" ? (isAlias(story.modelId) ? <span class="rounded border border-line px-1 text-[11px] text-ink-muted" title="A rolling name that always points at the newest model in its family">alias</span> : null) : null}
          <SourceTag story={story} />
          {story.folded && story.folded > 1 ? <span class="text-[11px] text-ink-muted">{story.folded} moves folded</span> : null}
        </div>
        {extra || (!showMore && story.more.length) ? (
          <p class={`mt-0.5 font-mono text-xs tabular-nums text-ink-muted ${showMore ? "" : "truncate"}`} title={showMore ? undefined : story.more.join(" · ")}>
            {extra}
            {!showMore && story.more.length ? <span class="opacity-70">{extra ? " · " : ""}+{story.more.length} more</span> : null}
          </p>
        ) : null}
      </div>
      {spark && spark.length > 1 ? (
        <span class="hidden shrink-0 sm:inline-flex" title="Input price, last 90 days">
          <Sparkline values={spark} width={96} height={24} />
          <span class="sr-only">Input price over the last 90 days: {spark[0].toFixed(2)} to {spark[spark.length - 1].toFixed(2)} dollars per million tokens.</span>
        </span>
      ) : null}
      {delta !== null && (story.kind === "repriced" || story.kind === "resized") ? (
        <DeltaChip value={delta} good={deltaIsGood(story, delta)} size={compact ? "sm" : "md"} title={story.detail} />
      ) : null}
      <time class={`shrink-0 font-mono text-xs tabular-nums ${toneText("muted")}`} dateTime={story.at} title={story.at.replace("T", " ").slice(0, 16) + " UTC"}>
        {relative ? ago(story.at) : clockTime(story.at)}
      </time>
    </li>
  );
}
