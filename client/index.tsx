/**
 * The shell: header, navigation, keyboard shortcuts, the ⌘K palette, and the route table.
 * Each page lives in `pages/`; shared atoms in `components/`; data shaping in `lib/`.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { Link, Route, Router, Routes, useLocation, useNavigate, useQuery } from "@spacefast/zero/client";
import { EmptyState, Icon, Kbd } from "@spacefast/zero/kit";

import { Palette, type PaletteMode } from "./components/Palette";
import { ShortcutSheet } from "./components/ShortcutSheet";
import { clearFreshness, useProvidedFreshness } from "./lib/freshness";
import { PALETTE_EVENT } from "./lib/palette";
import { useWatchlist } from "./lib/watch";
import { ago, prefersReducedMotion } from "./lib/util";
import { AboutPage } from "./pages/About";
import { ApiPage } from "./pages/Api";
import { ChangesPage } from "./pages/Changes";
import { ComparePage } from "./pages/Compare";
import { GraveyardPage } from "./pages/Graveyard";
import { HomePage } from "./pages/Home";
import { ModelPage } from "./pages/Model";
import { ModelsPage } from "./pages/Models";
import { PriceIndexPage } from "./pages/PriceIndex";
import { ProviderPage } from "./pages/Provider";
import { PulsePage } from "./pages/Pulse";
import { RecordsPage } from "./pages/Records";
import { RetiringPage } from "./pages/Retiring";
import { StatusPage } from "./pages/Status";
import { TimeMachinePage } from "./pages/TimeMachine";

const PRIMARY = [
  { to: "/", label: "Changes", match: (p: string) => p === "/" || p === "/changes" || p.startsWith("/model/") },
  { to: "/models", label: "Models", match: (p: string) => p === "/models" || p === "/catalog" },
  { to: "/status", label: "Providers", match: (p: string) => p.startsWith("/provider/") || p === "/status" },
  { to: "/retiring", label: "Retiring", match: (p: string) => p === "/retiring" },
];

const MORE = [
  { to: "/compare", label: "Compare" },
  { to: "/records", label: "Records" },
  { to: "/index", label: "Price index" },
  { to: "/graveyard", label: "Graveyard" },
  { to: "/time-machine", label: "Time machine" },
  { to: "/pulse", label: "Pulse" },
  { to: "/api", label: "API & feeds" },
  { to: "/about", label: "About" },
];

/** "checked 12m ago", flashing once when a new sweep lands. */
function FreshnessStamp({ models }: { models: string | undefined }) {
  const [pulse, setPulse] = useState(false);
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previous.current && models && models !== previous.current && !prefersReducedMotion()) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1200);
      return () => clearTimeout(t);
    }
    previous.current = models;
  }, [models]);
  const stale = models ? Date.now() - Date.parse(models) > 3 * 3600 * 1000 : false;
  return (
    <span class={`inline-flex items-center gap-1.5 font-mono text-xs tabular-nums ${stale ? "text-warning" : "text-ink-muted"} ${pulse ? "animate-pulse text-accent" : ""}`} title={models ? `Last check ${models.replace("T", " ").slice(0, 16)} UTC` : undefined}>
      <span class={`inline-block size-1.5 rounded-full ${stale ? "bg-warning" : "bg-success"}`} aria-hidden="true" />
      {models ? `checked ${ago(models)}` : "connecting…"}
      {stale ? " · overdue" : ""}
    </span>
  );
}

/** Subscribes to the freshness query itself: for pages that do not already load it. */
function FreshnessLive() {
  const latest = useQuery<Record<string, string>>("freshness");
  return <FreshnessStamp models={Array.isArray(latest) ? undefined : latest?.models} />;
}

/** Takes the stamp from the page's own data: the home page loads it inside its one subscription. */
function FreshnessProvided() {
  return <FreshnessStamp models={useProvidedFreshness()} />;
}

function Nav(props: { pathname: string; onSearch: () => void; watching: number }) {
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [more]);
  const inMore = MORE.some((m) => props.pathname === m.to);
  return (
    <nav class="flex flex-wrap items-center gap-1 text-sm" aria-label="Main">
      {PRIMARY.map((item) => {
        const active = item.match(props.pathname);
        return (
          <Link key={item.to} to={item.to} class={`rounded-md px-2.5 py-1.5 ${active ? "bg-ink/10 text-ink" : "text-ink-muted hover:text-ink"}`} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
      <div class="relative" ref={moreRef}>
        <button type="button" class={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 ${inMore ? "bg-ink/10 text-ink" : "text-ink-muted hover:text-ink"}`} onClick={() => setMore((v) => !v)} aria-expanded={more} aria-haspopup="menu">
          More <Icon name="chevron-down" size="sm" />
        </button>
        {more ? (
          <div class="absolute right-0 z-40 mt-1 flex min-w-44 flex-col rounded-lg border border-line bg-surface py-1 shadow-xl" role="menu">
            {MORE.map((m) => (
              <Link key={m.to} to={m.to} class="px-3 py-1.5 text-sm text-ink hover:bg-ink/5" role="menuitem" onClick={() => setMore(false)}>{m.label}</Link>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" class="ml-1 inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-ink-muted hover:border-ink-muted hover:text-ink" onClick={props.onSearch} aria-label="Search">
        <Icon name="search" size="sm" />
        <span class="hidden sm:inline">Search</span>
        <span class="hidden sm:inline-flex gap-0.5"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
      </button>
      {props.watching > 0 ? (
        <Link to="/changes?watch=1" class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-ink-muted hover:text-ink" title="Changes to models you watch">
          <Icon name="star" size="sm" /> {props.watching}
        </Link>
      ) : null}
    </nav>
  );
}

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [sheet, setSheet] = useState(false);
  const [watchlist] = useWatchlist();
  const pending = useRef<string>("");

  // The route's model id, so the palette can offer "copy id" and "compare" for the page in view.
  const currentModelId = location.pathname.startsWith("/model/") ? decodeURIComponent(location.pathname.slice("/model/".length)) : undefined;

  useEffect(() => {
    const onPalette = (e: Event) => setPalette((e as CustomEvent<PaletteMode>).detail);
    window.addEventListener(PALETTE_EVENT, onPalette);
    return () => window.removeEventListener(PALETTE_EVENT, onPalette);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => (p ? null : { kind: "navigate" }));
        return;
      }
      if (typing || palette || sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); setPalette({ kind: "navigate" }); return; }
      if (e.key === "?") { e.preventDefault(); setSheet(true); return; }
      if (e.key === "g") { pending.current = "g"; setTimeout(() => { pending.current = ""; }, 800); return; }
      if (pending.current === "g") {
        pending.current = "";
        if (e.key === "c") navigate("/");
        else if (e.key === "m") navigate("/models");
        else if (e.key === "s") navigate("/status");
        return;
      }
      if (e.key === "j" || e.key === "k") {
        const rows = [...document.querySelectorAll<HTMLElement>("[data-feed-row]")];
        if (rows.length === 0) return;
        e.preventDefault();
        const current = rows.findIndex((r) => r.contains(document.activeElement));
        const next = e.key === "j" ? Math.min(rows.length - 1, current + 1) : Math.max(0, current - 1);
        const link = rows[next].querySelector<HTMLElement>("a") ?? rows[next];
        link.tabIndex = link.tabIndex >= 0 ? link.tabIndex : 0;
        link.focus();
        rows[next].scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette, sheet, navigate]);

  // Scroll to the top on every route change, since the browser only does this for full loads.
  useEffect(() => { window.scrollTo(0, 0); if (location.pathname !== "/") clearFreshness(); }, [location.pathname]);

  return (
    <div class="min-h-dvh bg-canvas text-ink">
      <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1 focus:text-canvas">Skip to content</a>
      <header class="border-b border-line">
        <div class="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div class="flex items-baseline gap-3">
            <Link to="/" class="text-base font-semibold tracking-tight text-ink hover:text-accent">
              <span class="mr-1.5 inline-block size-2.5 rounded-full bg-accent align-middle" aria-hidden="true" />
              AI Observatory
            </Link>
            {location.pathname === "/" ? <FreshnessProvided /> : <FreshnessLive />}
          </div>
          <Nav pathname={location.pathname} onSearch={() => setPalette({ kind: "navigate" })} watching={watchlist.length} />
        </div>
      </header>
      <main id="main" class="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/changes" element={<ChangesPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/catalog" element={<ModelsPage />} />
          <Route path="/model/*id" element={<ModelPage />} />
          <Route path="/provider/:slug" element={<ProviderPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/retiring" element={<RetiringPage />} />
          <Route path="/graveyard" element={<GraveyardPage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/index" element={<PriceIndexPage />} />
          <Route path="/time-machine" element={<TimeMachinePage />} />
          <Route path="/pulse" element={<PulsePage />} />
          <Route path="/ecosystem" element={<PulsePage />} />
          <Route path="/signals" element={<PulsePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/api" element={<ApiPage />} />
          <Route path="*rest" element={<EmptyState title="Not found" description="No page at this address." icon="search" />} />
        </Routes>
      </main>
      <footer class="border-t border-line">
        <div class="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-ink-muted sm:px-6">
          <span>AI Observatory · the changelog AI providers don't publish</span>
          <span class="flex flex-wrap gap-3">
            <Link to="/about" class="hover:text-ink">About</Link>
            <Link to="/api" class="hover:text-ink">API & feeds</Link>
            <a href="/feed.xml" class="hover:text-ink">RSS</a>
            <a href="https://github.com/travisw/ai-observatory" class="hover:text-ink" target="_blank" rel="noopener">Source</a>
            <button type="button" class="hover:text-ink" onClick={() => setSheet(true)}>Shortcuts <Kbd>?</Kbd></button>
          </span>
        </div>
      </footer>
      <Palette open={palette !== null} onClose={() => setPalette(null)} mode={palette ?? { kind: "navigate" }} currentModelId={currentModelId} />
      <ShortcutSheet open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}

export function App() {
  return (
    <Router>
      <Shell />
    </Router>
  );
}
