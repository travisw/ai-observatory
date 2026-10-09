/**
 * Words and dates the way the boards spell them: short, uppercase, in the flap alphabet.
 */
import { modelName } from "../../shared/providers";
import type { FlapTone } from "../components/Flap";
import { daysUntil } from "./util";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "09 OCT" from an ISO date or stamp. */
export function boardDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

/** "09 OCT 26" for the time machine's six cells. */
export function boardDateYear(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

export function boardTime(iso: string): string {
  return iso.length >= 16 ? iso.slice(11, 16) : "";
}

/** Today's rows show the time, older ones the date, like a real board. */
export function boardWhen(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10) === today ? boardTime(iso) : boardDate(iso);
}

/** "▲ +64%" / "▼ -43%" with a plain hyphen, since the flap wheel has no minus sign. */
export function boardPct(value: number): string {
  const abs = Math.abs(value);
  const text = abs >= 1000 ? `${Math.round(abs / 100)}X` : abs >= 10 ? `${Math.round(abs)}%` : `${abs.toFixed(1)}%`;
  return `${value < 0 ? "▼ -" : "▲ +"}${text}`;
}

export function shortName(modelId: string, name?: string): string {
  return modelName(modelId, name).replace(/ \(alias\)$/, "");
}

export const STATUS_WORD: Record<string, { word: string; tone: FlapTone }> = {
  none: { word: "ON TIME", tone: "success" },
  minor: { word: "DELAYED", tone: "warning" },
  maintenance: { word: "DELAYED", tone: "warning" },
  major: { word: "CANCELLED", tone: "danger" },
  critical: { word: "CANCELLED", tone: "danger" },
};

export function statusWord(indicator: string): { word: string; tone: FlapTone } {
  return STATUS_WORD[indicator] ?? { word: "NO INFO", tone: "muted" };
}

/** Status-page prose shortened to board length. */
export function remarkWord(indicator: string, description: string): string {
  if (indicator === "unreachable") return "NO READING";
  const text = (description || "").toUpperCase();
  if (text.includes("ALL SYSTEMS OPERATIONAL")) return "ALL SYSTEMS GO";
  if (text.includes("PARTIALLY DEGRADED")) return "PARTLY DEGRADED";
  if (text.includes("DEGRADED PERFORMANCE")) return "DEGRADED";
  if (text.includes("MAJOR OUTAGE")) return "MAJOR OUTAGE";
  if (text.includes("UNDER MAINTENANCE")) return "MAINTENANCE";
  return text;
}

export function departureStatus(retiresAt: string): { word: string; tone: FlapTone } {
  const days = daysUntil(retiresAt);
  if (days < 0) return { word: "DEPARTED", tone: "danger" };
  if (days <= 30) return { word: "FINAL CALL", tone: "warning" };
  return { word: "BOARDING", tone: "success" };
}

/** Eight hues for the sky chart, cycling by provider. Cream first so the busiest provider reads as the board does. */
export const SKY_PALETTE = ["#f3e9cf", "#ffb000", "#7df0a1", "#ff5a4a", "#7fb7ff", "#d59bff", "#5ee7df", "#ff8bd1"];

export const CHART_STROKES = ["#f3e9cf", "#ffb000", "#7df0a1", "#ff5a4a", "#7fb7ff", "#d59bff"];
