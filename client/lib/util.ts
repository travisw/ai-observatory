/**
 * Small helpers shared by every page: time words, links, URL state, local storage.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "@spacefast/zero/client";

import { providerName } from "../../shared/providers";

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** Model ids contain a slash. Encoding it (%2F) gets a 403 from the edge, so keep it raw. */
export function modelHref(modelId: string): string {
  return `/model/${encodeURIComponent(modelId).replace(/%2F/g, "/")}`;
}

export function providerHref(slug: string): string {
  return `/provider/${encodeURIComponent(slug.replace(/^~/, ""))}`;
}

export function compareHref(ids: string[]): string {
  return `/compare?m=${ids.map((id) => encodeURIComponent(id)).join(",")}`;
}

/** How long ago an ISO timestamp was, in the fewest words. */
export function ago(iso: string | undefined | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Days from now until an ISO date, negative when past. */
export function daysUntil(iso: string): number {
  return Math.ceil((Date.parse(iso) - Date.now()) / DAY);
}

/** "in 41 days", "tomorrow", "12 days ago". */
export function countdown(iso: string): string {
  const days = daysUntil(iso);
  if (!Number.isFinite(days)) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days} days`;
  return `${-days} days ago`;
}

export function dayLabel(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  const day = iso.slice(0, 10);
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return longDate(day);
}

/** "14 Mar 2026" from an ISO date or timestamp. Blank in, blank out. */
export function longDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "23 Oct": for rows already grouped under a month heading. */
export function dayMonth(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

export function monthLabel(iso: string): string {
  const date = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export function clockTime(iso: string): string {
  return iso.length >= 16 ? iso.slice(11, 16) : "";
}

export function pctChange(oldValue: string | number, newValue: string | number): number | null {
  const before = Number(oldValue);
  const after = Number(newValue);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (before === 0) return after === 0 ? 0 : null;
  return ((after - before) / before) * 100;
}

/** "−56%", "+3.2%": signed, never bare. */
export function signedPct(value: number): string {
  const abs = Math.abs(value);
  const text = abs >= 10 ? `${Math.round(abs)}%` : `${abs.toFixed(1)}%`;
  return `${value < 0 ? "−" : "+"}${text}`;
}

export function plural(n: number, word: string, pluralWord?: string): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord ?? `${word}s`}`;
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Per-million price as a number, or null when the field is blank. */
export function perM(rawPerToken: string): number | null {
  if (!rawPerToken) return null;
  const value = Number(rawPerToken) * 1_000_000;
  return Number.isFinite(value) ? value : null;
}

/** Reads URL search params and re-renders on navigation. */
export function useSearchParams(): URLSearchParams {
  const location = useLocation();
  return useMemo(() => new URLSearchParams(location.search), [location.search]);
}

/** An ISO timestamp for N days ago, frozen for the component's life so a live query is not re-opened every render. */
export function useSince(days: number): string {
  return useMemo(() => new Date(Date.now() - days * DAY).toISOString(), [days]);
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · AI Observatory` : "AI Observatory";
  }, [title]);
}

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage disabled: the setting lasts for this visit only.
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** Animates a number from 0 to `target` once, unless the reader asked for less motion. */
export function useCountUp(target: number, ms = 400): number {
  const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
  useEffect(() => {
    if (prefersReducedMotion() || target === 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) * (1 - t);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

export function copyText(text: string): Promise<boolean> {
  try {
    return navigator.clipboard.writeText(text).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function titleCaseProvider(slug: string): string {
  return providerName(slug);
}

/** Groups rows by a key, keeping first-seen order of keys. */
export function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  }
  return out;
}

export function isLoading(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}
