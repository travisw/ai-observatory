/**
 * Where models go when they leave: born, died, how long they lasted, and what took their place.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";
import { EmptyState, Skeleton } from "@spacefast/zero/kit";

import { providerName, isAlias } from "../../shared/providers";
import { canonicalKey } from "../../shared/sources";
import type { GraveyardData, ModelRow, RetiringData } from "../../shared/types";
import { Card, ModelLink, ProviderLink, Section } from "../components/bits";
import { keyIndex } from "../lib/stories";
import { DAY, countdown, daysUntil, isLoading, longDate, plural, usePageTitle } from "../lib/util";

function lifespan(from: string, to: string): string {
  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY));
  if (days < 1) return "less than a day";
  if (days < 60) return plural(days, "day");
  if (days < 730) return plural(Math.round(days / 30), "month");
  return `${(days / 365).toFixed(1)} years`;
}

export function GraveyardPage() {
  usePageTitle("Graveyard");
  const data = useQuery<GraveyardData>("graveyard");
  const retiring = useQuery<RetiringData>("retiring");
  const active = useQuery<ModelRow[]>("activeModels");
  const keys = useMemo(() => keyIndex(active ?? []), [active]);
  if (isLoading(data)) return <div class="flex flex-col gap-3"><Skeleton class="h-10 w-1/3" /><Skeleton class="h-40 w-full" /></div>;

  const retired = data.retired.filter((m) => !isAlias(m.modelId));
  const byKey = new Map(data.lifecycle.map((l) => [l.key, l]));
  const next = isLoading(retiring) ? null : retiring.lifecycle.filter((l) => l.state === "deprecated" && l.retiresAt && l.retiresNote !== "not sooner than" && daysUntil(l.retiresAt) >= 0).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt))[0] ?? null;
  const lifespans = retired.map((m) => (Date.parse(m.lastSeenAt) - Date.parse(m.firstSeenAt)) / DAY).filter((d) => d > 0).sort((a, b) => a - b);
  const medianLife = lifespans.length ? lifespans[Math.floor(lifespans.length / 2)] : null;
  const official = data.lifecycle.filter((l) => !retired.some((m) => canonicalKey(m.provider, m.modelId) === l.key));

  return (
    <div class="flex flex-col gap-10">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Graveyard</h1>
        <p class="max-w-2xl text-sm text-ink-muted">
          {plural(retired.length, "model")} that were listed and then quietly weren't.{medianLife ? ` The typical one lasted ${plural(Math.round(medianLife), "day")}.` : ""}
          {next ? <> Next funeral: <span class="text-ink">{next.modelId}</span>, {countdown(next.retiresAt)} (<Link to="/retiring" class="text-accent hover:underline">see who else</Link>).</> : null}
        </p>
      </div>

      {retired.length === 0 ? (
        <EmptyState title="Nobody here yet" description="Models that leave the catalogue are laid to rest on this page." />
      ) : (
        <Section title="Delisted" hint="most recent first">
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {retired.map((m) => {
              const notice = byKey.get(canonicalKey(m.provider, m.modelId));
              const successor = notice?.replacement ? keys.get(canonicalKey(m.provider, notice.replacement)) : undefined;
              const heir = (active ?? []).find((a) => a.aliasTarget && canonicalKey(a.provider, a.aliasTarget) === canonicalKey(m.provider, m.modelId));
              return (
                <li key={m.id}>
                  <Card class="flex h-full flex-col gap-1">
                    <span class="text-xs text-ink-muted"><ProviderLink slug={m.provider} class="text-ink-muted" /></span>
                    <ModelLink modelId={m.modelId} name={m.name} class="text-base font-medium text-ink" />
                    <span class="font-mono text-xs tabular-nums text-ink-muted">{longDate(m.firstSeenAt)} – {longDate(m.lastSeenAt)}</span>
                    <span class="text-sm text-ink">Lived {lifespan(m.firstSeenAt, m.lastSeenAt)}.</span>
                    <span class="text-xs text-ink-muted">
                      {notice ? `Retired by ${providerName(notice.provider)}${notice.retiresAt ? ` on ${longDate(notice.retiresAt)}` : ""}.` : "Delisted without a notice we could find."}
                      {successor ? <> Survived by <ModelLink modelId={successor} class="text-accent" />.</> : notice?.replacement ? ` Survived by ${notice.replacement}.` : heir ? <> The name <ModelLink modelId={heir.modelId} class="text-accent" /> lives on.</> : ""}
                    </span>
                  </Card>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {official.length ? (
        <Section title="Retired by notice" hint="on the providers' own pages, never listed here">
          <Card padded={false}>
            <ul class="columns-1 sm:columns-2">
              {official.sort((a, b) => (b.retiresAt || "").localeCompare(a.retiresAt || "")).map((l) => (
                <li key={l.id} class="flex items-center gap-2 break-inside-avoid border-b border-line px-4 py-1.5 text-sm">
                  <span class="font-mono text-xs text-ink">{l.modelId}</span>
                  <span class="ml-auto text-xs text-ink-muted">{providerName(l.provider)}{l.retiresAt ? ` · ${longDate(l.retiresAt)}` : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}
      <p class="text-xs text-ink-muted">Rolling aliases are not buried; they move on to the next model in their family.</p>
    </div>
  );
}
