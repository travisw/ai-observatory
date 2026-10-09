/**
 * Every provider's status with a 90-day bar, and the incident log beneath.
 */
import { Link, useQuery } from "@spacefast/zero/client";
import { Badge, EmptyState, Skeleton } from "@spacefast/zero/kit";

import { providerName } from "../../shared/providers";
import type { ModelRow, StatusPageData } from "../../shared/types";
import { Card, ProviderLink, Section } from "../components/bits";
import { UptimeBar } from "../components/UptimeBar";
import { uptimeDays, uptimePct } from "../lib/series";
import { ago, dayLabel, isLoading, plural, providerHref, usePageTitle } from "../lib/util";

export function StatusPage() {
  usePageTitle("Status");
  const data = useQuery<StatusPageData>("statusPage");
  const models = useQuery<ModelRow[]>("activeModels");
  const loading = isLoading(data);
  const providers = [...new Set((models ?? []).map((m) => m.provider.replace(/^~/, "")))].sort((a, b) => providerName(a).localeCompare(providerName(b)));
  const tracked = new Set(loading ? [] : data.statuses.map((s) => s.provider));

  if (loading) return <div class="flex flex-col gap-3"><Skeleton class="h-10 w-1/3" /><Skeleton class="h-40 w-full" /></div>;

  const incidents = data.incidents.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const byDay = new Map<string, typeof incidents>();
  for (const i of incidents) {
    const day = i.startedAt.slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(i);
    else byDay.set(day, [i]);
  }

  return (
    <div class="flex flex-col gap-10">
      <Section title="Is it up right now" hint="from each provider's own status page, checked every half hour">
        <Card padded={false}>
          <ul class="divide-y divide-line">
            {data.statuses.map((s) => {
              const days = uptimeDays(s, data.statusEvents.filter((e) => e.provider === s.provider), data.incidents.filter((i) => i.provider === s.provider), 90);
              const pct = uptimePct(days);
              const tone = s.indicator === "none" ? "success" : s.indicator === "minor" ? "warning" : s.indicator === "major" || s.indicator === "critical" ? "danger" : "neutral";
              const word = s.indicator === "none" ? "up" : s.indicator === "minor" ? "degraded" : s.indicator === "major" || s.indicator === "critical" ? "outage" : s.indicator === "unreachable" ? "status page unreachable" : s.indicator;
              return (
                <li key={s.id} class="grid items-center gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[12rem_1fr_8rem]">
                  <div class="flex flex-col">
                    <ProviderLink slug={s.provider} class="text-base font-medium text-ink" />
                    <span class="text-xs text-ink-muted">{s.description || word} · checked {ago(s.checkedAt)}</span>
                  </div>
                  <UptimeBar days={days} label={providerName(s.provider)} />
                  <div class="flex items-center gap-2 md:justify-end">
                    <Badge tone={tone}>{word}</Badge>
                    {pct !== null ? <span class="font-mono text-xs tabular-nums text-ink-muted">{pct.toFixed(1)}%</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <p class="text-xs text-ink-muted">
          Only providers with a machine-readable status page are checked. Hollow bars mean no record for that day, never an assumption of uptime.
        </p>
      </Section>

      <Section title="Incidents" hint={incidents.length ? `${plural(incidents.length, "incident")} in 90 days` : "last 90 days"}>
        <Card padded={false} class="px-4">
          {incidents.length === 0 ? (
            <EmptyState title="No incidents recorded" description="Incident history fills as status pages report them." />
          ) : (
            [...byDay.entries()].map(([day, list]) => (
              <div key={day}>
                <h3 class="border-b border-line py-1.5 text-xs font-medium text-ink-muted">{dayLabel(day)}</h3>
                <ul>
                  {list.map((i) => (
                    <li key={i.id} class="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm last:border-0">
                      <ProviderLink slug={i.provider} class="w-28 shrink-0 text-ink-muted" />
                      <Badge tone={i.impact === "critical" || i.impact === "major" ? "danger" : i.impact === "minor" ? "warning" : "neutral"}>{i.impact || "incident"}</Badge>
                      {i.url ? <a href={i.url} target="_blank" rel="noopener" class="text-ink hover:text-accent">{i.name}</a> : <span class="text-ink">{i.name}</span>}
                      <span class="ml-auto font-mono text-xs text-ink-muted">
                        {i.resolvedAt ? `${Math.max(1, Math.round((Date.parse(i.resolvedAt) - Date.parse(i.startedAt)) / 60000))} min` : i.status === "resolved" ? "resolved" : `ongoing · started ${ago(i.startedAt)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Card>
      </Section>

      <Section title="All providers" hint={`${providers.length} with models listed`}>
        <ul class="flex flex-wrap gap-2">
          {providers.map((p) => (
            <li key={p}>
              <Link to={providerHref(p)} class={`inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm hover:border-ink-muted ${tracked.has(p) ? "text-ink" : "text-ink-muted"}`}>
                {tracked.has(p) ? <span class="inline-block size-1.5 rounded-full bg-success" aria-hidden="true" /> : null}
                {providerName(p)}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
