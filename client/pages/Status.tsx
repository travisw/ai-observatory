/**
 * Status: 90 days per provider, and the incidents beneath, by day.
 */
import { Link, useQuery } from "@spacefast/zero/client";

import { providerName } from "../../shared/providers";
import type { ModelRow, StatusPageData } from "../../shared/types";
import { Chip, DayRow, Empty, PageHead, Pill, Section, Skeleton, UptimeStrip } from "../components/Wire";
import { uptimeDays, uptimeSummary } from "../lib/series";
import { hm, statusRemark, statusWord } from "../lib/text";
import { ago, dayLabel, isLoading, plural, providerHref, usePageTitle } from "../lib/util";

/** "14 min", "resolved", "ongoing · 2h ago": how an incident ended, or that it has not. */
function duration(i: StatusPageData["incidents"][number]): string {
  if (i.resolvedAt) return `${Math.max(1, Math.round((Date.parse(i.resolvedAt) - Date.parse(i.startedAt)) / 60000))} min`;
  if (i.status === "resolved") return "resolved";
  return `ongoing · started ${ago(i.startedAt)}`;
}

function impactClass(impact: string): string {
  return impact === "critical" || impact === "major" ? "rise" : impact === "minor" ? "warn" : "soft";
}

export function StatusPage() {
  usePageTitle("Status");
  const data = useQuery<StatusPageData>("statusPage");
  const models = useQuery<ModelRow[]>("activeModels");
  const loading = isLoading(data);
  const providers = [...new Set((models ?? []).map((m) => m.provider.replace(/^~/, "")))].sort((a, b) => providerName(a).localeCompare(providerName(b)));
  const tracked = new Set(loading ? [] : data.statuses.map((s) => s.provider));

  if (loading) return <Skeleton />;

  const incidents = data.incidents.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const byDay = new Map<string, typeof incidents>();
  for (const i of incidents) {
    const day = i.startedAt.slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(i);
    else byDay.set(day, [i]);
  }

  return (
    <div class="stack">
      <PageHead title="Status" action={<><Chip to="/providers">All providers</Chip><Chip href="/api/status.json">JSON</Chip></>}>
        From each provider's own status page, checked every half hour. A dim day is one with no record, never an assumption of uptime.
      </PageHead>

      <Section title="Last 90 days">
        <div class="tw">
          <table aria-label="Provider status over 90 days">
            <thead><tr><th>Provider</th><th>Status</th><th>Note</th><th>Last 90 days</th><th class="n">Incident days</th></tr></thead>
            <tbody>
              {data.statuses.map((s) => {
                const days = uptimeDays(s, data.statusEvents.filter((e) => e.provider === s.provider), data.incidents.filter((inc) => inc.provider === s.provider), 90);
                const sum = uptimeSummary(days);
                const word = statusWord(s.indicator);
                return (
                  <tr key={s.id} data-feed-row>
                    <td><Link to={providerHref(s.provider)} class="hl">{providerName(s.provider)}</Link><span class="who" style={{ whiteSpace: "nowrap" }}>checked {ago(s.checkedAt)}</span></td>
                    <td><Pill tone={word.tone}>{word.word}</Pill></td>
                    <td class="soft small">{statusRemark(s.indicator, s.description)}</td>
                    <td><UptimeStrip days={days} label={`${providerName(s.provider)} over the last 90 days`} /></td>
                    <td class={`n ${sum.incidentDays ? "warn" : "soft"}`}>{sum.recorded ? `${sum.incidentDays} of ${sum.recorded}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p class="note" style={{ marginTop: 8 }}>Amber is a degraded day, coral a day with an outage; incident days are counted out of days with a record.</p>
      </Section>

      <Section title="Incidents" hint={incidents.length ? `${plural(incidents.length, "incident")} in 90 days` : "last 90 days"}>
        {incidents.length === 0 ? (
          <Empty>No incidents recorded. This fills in as status pages report them.</Empty>
        ) : (
          <div class="tw">
            <table aria-label="Incidents">
              <thead><tr><th>Time</th><th>Provider</th><th>Incident</th><th class="n">Lasted</th></tr></thead>
              <tbody>
                {[...byDay.entries()].map(([day, list]) => (
                  <>
                    <DayRow key={day} span={4}>{dayLabel(day)}</DayRow>
                    {list.map((i) => (
                      <tr key={i.id} data-feed-row>
                        <td class="when">{hm(i.startedAt)}</td>
                        <td><Link to={providerHref(i.provider)} class="hl">{providerName(i.provider)}</Link></td>
                        <td>
                          {i.url ? <a href={i.url} target="_blank" rel="noopener" class="hl">{i.name}</a> : i.name}
                          <span class="who">{i.impact || "incident"}</span>
                        </td>
                        <td class={`n ${impactClass(i.impact)}`}>{duration(i)}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Every provider" hint={isLoading(models) ? undefined : `${providers.length} with models listed`}>
        <div class="chips">
          {providers.map((p) => (
            <Chip key={p} to={providerHref(p)} class={tracked.has(p) ? "" : "soft"} title={tracked.has(p) ? "Status page tracked" : "No status page tracked"}>{providerName(p)}</Chip>
          ))}
        </div>
      </Section>
    </div>
  );
}
