/**
 * The full status board, 90 days per provider, and the incident log beneath, by day.
 */
import { Link, useQuery } from "@spacefast/zero/client";

import { providerName } from "../../shared/providers";
import type { ModelRow, StatusPageData } from "../../shared/types";
import { Board, ColumnHeads, FlapRow, Sign } from "../components/Flap";
import { BoardEmpty, LogDay, LogLine, LogSection, Marquee, PageSkeleton } from "../components/Log";
import { boardTime, remarkWord, statusWord } from "../lib/board";
import { uptimeDays, uptimeSummary } from "../lib/series";
import { ago, dayLabel, isLoading, plural, providerHref, usePageTitle } from "../lib/util";
import { UptimeStrip } from "./Home";

export function StatusPage() {
  usePageTitle("Status");
  const data = useQuery<StatusPageData>("statusPage");
  const models = useQuery<ModelRow[]>("activeModels");
  const loading = isLoading(data);
  const providers = [...new Set((models ?? []).map((m) => m.provider.replace(/^~/, "")))].sort((a, b) => providerName(a).localeCompare(providerName(b)));
  const tracked = new Set(loading ? [] : data.statuses.map((s) => s.provider));

  if (loading) return <PageSkeleton />;

  const incidents = data.incidents.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const byDay = new Map<string, typeof incidents>();
  for (const i of incidents) {
    const day = i.startedAt.slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(i);
    else byDay.set(day, [i]);
  }

  return (
    <div class="flex flex-col gap-8">
      <Marquee title="Status" action={<><Sign to="/providers">All providers</Sign><Sign href="/api/status.json">JSON</Sign></>}>
        From each provider's own status page, checked every half hour. A dim day is one with no record, never an assumption of uptime.
      </Marquee>

      <Board label="Status" hint="last 90 days">
        <ColumnHeads columns={[{ label: "Provider", width: 11, sticky: true }, { label: "Status", width: 9 }, { label: "Remarks", width: 16 }, { label: "Last 90 days", width: 48 }, { label: "Days", width: 6, align: "right" }]} />
        {data.statuses.map((s, i) => {
          const days = uptimeDays(s, data.statusEvents.filter((e) => e.provider === s.provider), data.incidents.filter((inc) => inc.provider === s.provider), 90);
          const sum = uptimeSummary(days);
          const spec = statusWord(s.indicator);
          const remarks = remarkWord(s.indicator, s.description);
          return (
            <FlapRow
              key={s.id}
              href={providerHref(s.provider)}
              label={`${providerName(s.provider)}: ${spec.word.toLowerCase()}. ${remarks}. ${sum.recorded === 0 ? "No record yet" : `${sum.incidentDays} incident days of ${sum.recorded} recorded`}. Checked ${ago(s.checkedAt)}.`}
              delay={i * 40}
              columns={[
                { text: providerName(s.provider), width: 11, sticky: true },
                { text: spec.word, width: 9, tone: spec.tone },
                { text: remarks, width: 16, tone: "muted" },
                { text: "", width: 48, render: <UptimeStrip days={days} label={`${providerName(s.provider)} over the last 90 days`} /> },
                { text: sum.recorded ? `${sum.incidentDays}/${sum.recorded}` : "-", width: 6, align: "right", tone: sum.incidentDays ? "warning" : "muted" },
              ]}
            />
          );
        })}
        <p class="px-3 py-2 text-xs text-ink-muted">Amber is a degraded day, red a day with an outage; "days" is incident days out of recorded days.</p>
      </Board>

      <LogSection title="Incidents" hint={incidents.length ? `${plural(incidents.length, "incident")} in 90 days` : "last 90 days"}>
        {incidents.length === 0 ? (
          <BoardEmpty>No incidents recorded. The log fills as status pages report them.</BoardEmpty>
        ) : (
          [...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <LogDay>{dayLabel(day)}</LogDay>
              <ul>
                {list.map((i) => (
                  <LogLine
                    key={i.id}
                    left={boardTime(i.startedAt)}
                    right={<span class={i.impact === "critical" || i.impact === "major" ? "text-danger" : i.impact === "minor" ? "text-warning" : "text-ink-muted"}>{i.resolvedAt ? `${Math.max(1, Math.round((Date.parse(i.resolvedAt) - Date.parse(i.startedAt)) / 60000))} MIN` : i.status === "resolved" ? "RESOLVED" : `ONGOING · STARTED ${ago(i.startedAt).toUpperCase()}`}</span>}
                  >
                    <Link to={providerHref(i.provider)} class="mr-2 text-ink-muted hover:text-accent">{providerName(i.provider)}</Link>
                    <span class="mr-2 text-[10px] uppercase tracking-[0.2em] text-ink-muted">{i.impact || "incident"}</span>
                    {i.url ? <a href={i.url} target="_blank" rel="noopener" class="hover:text-accent">{i.name}</a> : i.name}
                  </LogLine>
                ))}
              </ul>
            </div>
          ))
        )}
      </LogSection>

      <LogSection title="Every provider" hint={isLoading(models) ? undefined : `${providers.length} with models listed`}>
        <ul class="flex flex-wrap gap-1.5">
          {providers.map((p) => (
            <li key={p}><Sign to={providerHref(p)} active={false} class={tracked.has(p) ? "text-ink" : ""}>{providerName(p)}</Sign></li>
          ))}
        </ul>
      </LogSection>
    </div>
  );
}
