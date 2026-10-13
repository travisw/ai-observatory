/**
 * Short words and dates the way the pages print them. Hand-formatted so every runtime agrees.
 */
import { longDate } from "../../shared/model";
import { modelName } from "../../shared/providers";
import { daysUntil } from "./util";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Oct" from an ISO date or stamp. */
export function dayShort(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "9 Oct 2026". */
export function dayYear(iso: string): string {
  return longDate(iso);
}

/** "14:03" from a stamp. */
export function hm(iso: string): string {
  return iso.length >= 16 ? iso.slice(11, 16) : "";
}

/** Today's rows show the time, older ones the date. */
export function when(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10) === today ? hm(iso) : dayShort(iso);
}

/** "−37%", "+3.2%", "+99×" for the very large: signed, never bare. */
export function pct(value: number): string {
  const abs = Math.abs(value);
  const text = abs >= 1000 ? `${Math.round(abs / 100)}×` : abs >= 10 ? `${Math.round(abs)}%` : abs >= 1 ? `${abs.toFixed(1)}%` : `${abs.toFixed(1)}%`;
  return `${value < 0 ? "−" : "+"}${text}`;
}

export function shortName(modelId: string, name?: string): string {
  return modelName(modelId, name).replace(/ \(alias\)$/, "");
}

export type PillTone = "ok" | "warn" | "bad" | "off" | "soon" | undefined;

/** A provider's status indicator as one plain word. */
export function statusWord(indicator: string): { word: string; tone: PillTone } {
  switch (indicator) {
    case "none":
      return { word: "operational", tone: "ok" };
    case "minor":
      return { word: "degraded", tone: "warn" };
    case "maintenance":
      return { word: "maintenance", tone: "warn" };
    case "major":
      return { word: "outage", tone: "bad" };
    case "critical":
      return { word: "major outage", tone: "bad" };
    case "unreachable":
      return { word: "no reading", tone: "off" };
    default:
      return { word: "no reading", tone: "off" };
  }
}

/** Status-page prose, shortened. */
export function statusRemark(indicator: string, description: string): string {
  if (indicator === "unreachable") return "status page not reachable";
  const text = description || "";
  if (/all systems operational/i.test(text)) return "all systems operational";
  return text.replace(/\.$/, "").toLowerCase();
}

/** "12d", "today", "gone": how long until a retirement date. */
export function daysLeft(retiresAt: string): { text: string; tone: PillTone } {
  const days = daysUntil(retiresAt);
  if (!Number.isFinite(days)) return { text: "", tone: "off" };
  if (days < 0) return { text: "retired", tone: "off" };
  if (days === 0) return { text: "today", tone: "soon" };
  return { text: `${days}d`, tone: days <= 14 ? "soon" : undefined };
}

/** Line colours for charts with several series, in order of use. */
export const CHART_STROKES = ["#ece9e0", "#9fb3ff", "#5fcf8a", "#f08a6a", "#e0b84a", "#d59bff"];
