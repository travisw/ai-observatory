/**
 * Graveyard: models that were listed and then were not, by the month they left.
 */
import { useMemo } from "preact/hooks";
import { Link, useQuery } from "@spacefast/zero/client";

import { isAlias, modelName, providerName } from "../../shared/providers";
import { canonicalKey } from "../../shared/sources";
import type { GraveyardData, ModelRow, RetiringData } from "../../shared/types";
import { Chip, DayRow, Empty, PageHead, Section, Skeleton, Stat } from "../components/Wire";
import { keyIndex } from "../lib/stories";
import { dayShort, shortName } from "../lib/text";
import { DAY, daysUntil, isLoading, longDate, modelHref, monthLabel, plural, providerHref, usePageTitle } from "../lib/util";

function lifespan(from: string, to: string): string {
  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY));
  if (days < 1) return "under a day";
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

export function GraveyardPage() {
  usePageTitle("Graveyard");
  const data = useQuery<GraveyardData>("graveyard");
  const retiring = useQuery<RetiringData>("retiring");
  const active = useQuery<ModelRow[]>("activeModels");
  const keys = useMemo(() => keyIndex(active ?? []), [active]);
  if (isLoading(data)) return <Skeleton />;

  const retired = data.retired.filter((m) => !isAlias(m.modelId));
  const byKey = new Map(data.lifecycle.map((l) => [l.key, l]));
  const next = isLoading(retiring) ? null : retiring.lifecycle.filter((l) => l.state === "deprecated" && l.retiresAt && l.retiresNote !== "not sooner than" && daysUntil(l.retiresAt) >= 0).sort((a, b) => a.retiresAt.localeCompare(b.retiresAt))[0] ?? null;
  const lifespans = retired.map((m) => (Date.parse(m.lastSeenAt) - Date.parse(m.firstSeenAt)) / DAY).filter((d) => d > 0).sort((a, b) => a - b);
  const medianLife = lifespans.length ? lifespans[Math.floor(lifespans.length / 2)] : null;
  const official = data.lifecycle.filter((l) => !retired.some((m) => canonicalKey(m.provider, m.modelId) === l.key));
  const byMonth = new Map<string, typeof retired>();
  for (const m of retired) {
    const key = m.lastSeenAt.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(m);
    else byMonth.set(key, [m]);
  }

  return (
    <div class="stack">
      <PageHead title="Graveyard" action={<Chip to="/retiring">Retirements</Chip>}>
        {plural(retired.length, "model")} that were listed and then quietly weren't.{medianLife ? ` The typical one lasted ${plural(Math.round(medianLife), "day")}.` : ""} Rolling aliases are not buried; they move on to the next model in their family.
      </PageHead>

      <div class="stats">
        <Stat value={String(retired.length)} label="removed from the catalogue" tone="rise" />
        <Stat value={medianLife ? `${Math.round(medianLife)} days` : "—"} label="typical time listed" />
        {next ? (
          <Stat value={shortName(next.modelId)} label={`next to retire · in ${daysUntil(next.retiresAt)} days`} href="/retiring" tone={daysUntil(next.retiresAt) <= 30 ? "rise" : ""} />
        ) : (
          <Stat value="none announced" label="next to retire" tone="soft" />
        )}
      </div>

      {retired.length === 0 ? (
        <Empty>Nobody here yet. Models that leave the catalogue are recorded on this page.</Empty>
      ) : (
        <div class="tw">
          <table aria-label="Removed models by month">
            <thead><tr><th>Model</th><th>Provider</th><th>First seen</th><th>Last seen</th><th class="n">Listed for</th></tr></thead>
            <tbody>
              {[...byMonth.entries()].map(([month, list]) => (
                <>
                  <DayRow key={month} span={5}>{monthLabel(month)} <span class="soft" style={{ fontWeight: 400 }}>· {plural(list.length, "model")}</span></DayRow>
                  {list.map((m) => {
                    const notice = byKey.get(canonicalKey(m.provider, m.modelId));
                    const successor = notice?.replacement ? keys.get(canonicalKey(m.provider, notice.replacement)) : undefined;
                    const heir = (active ?? []).find((a) => a.aliasTarget && canonicalKey(a.provider, a.aliasTarget) === canonicalKey(m.provider, m.modelId));
                    return (
                      <tr key={m.id} data-feed-row>
                        <td>
                          <Link to={modelHref(m.modelId)} class="hl">{shortName(m.modelId, m.name)}</Link>
                          <span class="who">
                            {notice ? `Retired by ${providerName(notice.provider)}${notice.retiresAt ? ` on ${longDate(notice.retiresAt)}` : ""}.` : "Removed without a notice we could find."}
                            {successor ? <> Replaced by <Link to={modelHref(successor)} class="hl acc">{modelName(successor)}</Link>.</> : notice?.replacement ? ` Replaced by ${notice.replacement}.` : heir ? <> The name <Link to={modelHref(heir.modelId)} class="hl acc">{modelName(heir.modelId, heir.name)}</Link> lives on.</> : ""}
                          </span>
                        </td>
                        <td class="soft small"><Link to={providerHref(m.provider)} class="hl">{providerName(m.provider)}</Link></td>
                        <td class="when" title={longDate(m.firstSeenAt)}>{dayShort(m.firstSeenAt)} {m.firstSeenAt.slice(0, 4)}</td>
                        <td class="when" title={longDate(m.lastSeenAt)}>{dayShort(m.lastSeenAt)} {m.lastSeenAt.slice(0, 4)}</td>
                        <td class="n">{lifespan(m.firstSeenAt, m.lastSeenAt)}</td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {official.length ? (
        <Section title="Retired by notice" hint="on the providers' own pages, never listed here">
          <div class="tw">
            <table aria-label="Retired by notice">
              <thead><tr><th>Provider</th><th>Model</th><th class="n">Retired</th></tr></thead>
              <tbody>
                {official.sort((a, b) => (b.retiresAt || "").localeCompare(a.retiresAt || "")).map((l) => (
                  <tr key={l.id} class="dim">
                    <td class="small"><Link to={providerHref(l.provider)} class="hl">{providerName(l.provider)}</Link></td>
                    <td class="mono small">{l.modelId}</td>
                    <td class="n when">{l.retiresAt ? longDate(l.retiresAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
