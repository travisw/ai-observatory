/**
 * The shell: masthead, navigation, keyboard shortcuts, the ⌘K palette, and the route table.
 * Each page lives in `pages/`; shared pieces in `components/Wire.tsx`; data shaping in `lib/`.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { Link, Route, Router, Routes, useLocation, useNavigate, useQuery } from "@spacefast/zero/client";

import { Palette, type PaletteMode } from "./components/Palette";
import { ShortcutSheet } from "./components/ShortcutSheet";
import { WireStyles } from "./components/Wire";
import { clearFreshness } from "./lib/freshness";
import { PALETTE_EVENT } from "./lib/palette";
import { useWatchlist } from "./lib/watch";
import { hm } from "./lib/text";
import { ago } from "./lib/util";
import { AboutPage } from "./pages/About";
import { ApiPage } from "./pages/Api";
import { BenchmarksPage } from "./pages/Benchmarks";
import { ChangesPage } from "./pages/Changes";
import { ComparePage } from "./pages/Compare";
import { GraveyardPage } from "./pages/Graveyard";
import { HomePage } from "./pages/Home";
import { ModelPage } from "./pages/Model";
import { ModelsPage } from "./pages/Models";
import { PriceIndexPage } from "./pages/PriceIndex";
import { ProviderPage } from "./pages/Provider";
import { ProvidersPage } from "./pages/Providers";
import { PulsePage } from "./pages/Pulse";
import { RecordsPage } from "./pages/Records";
import { RetiringPage } from "./pages/Retiring";
import { StatusPage } from "./pages/Status";
import { TimeMachinePage } from "./pages/TimeMachine";

const PRIMARY = [
  { to: "/", label: "Today", match: (p: string) => p === "/" },
  { to: "/changes", label: "Changes", match: (p: string) => p === "/changes" || p.startsWith("/model/") },
  { to: "/models", label: "Models", match: (p: string) => p === "/models" || p === "/catalog" || p === "/compare" },
  { to: "/providers", label: "Providers", match: (p: string) => p.startsWith("/provider") },
  { to: "/retiring", label: "Retirements", match: (p: string) => p === "/retiring" || p === "/graveyard" },
  { to: "/status", label: "Status", match: (p: string) => p === "/status" },
  { to: "/benchmarks", label: "Benchmarks", match: (p: string) => p === "/benchmarks" },
  { to: "/index", label: "Index", match: (p: string) => p === "/index" },
];

const MORE = [
  { to: "/compare", label: "Compare" },
  { to: "/records", label: "Records" },
  { to: "/graveyard", label: "Graveyard" },
  { to: "/time-machine", label: "Time machine" },
  { to: "/pulse", label: "Pulse" },
  { to: "/api", label: "API & feeds" },
  { to: "/about", label: "About" },
];

/** "Checked 17:02 UTC" for pages that do not carry the stamp themselves. */
function Checked() {
  const latest = useQuery<Record<string, string>>("freshness");
  const models = Array.isArray(latest) ? undefined : latest?.models;
  if (!models) return null;
  const stale = Date.now() - Date.parse(models) > 3 * 3600 * 1000;
  return (
    <span class={`small ${stale ? "warn" : "soft"}`} title={`Last check ${ago(models)}${stale ? ", overdue" : ""}`}>
      checked <b class="mono" style={{ fontWeight: 500 }}>{hm(models)}</b> UTC
    </span>
  );
}

function Nav(props: { pathname: string; onSearch: () => void; watching: number }) {
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [more]);
  const inMore = MORE.some((m) => props.pathname === m.to);
  return (
    <nav class="main" aria-label="Main">
      {PRIMARY.map((item) => (
        <Link key={item.to} to={item.to} class={item.match(props.pathname) ? "on" : ""} aria-current={item.match(props.pathname) ? "page" : undefined}>{item.label}</Link>
      ))}
      <span class="menu" ref={moreRef}>
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more ? "true" : "false"} class={inMore ? "on" : ""}>More ▾</button>
        {more ? (
          <div role="menu">
            {MORE.map((m) => <Link key={m.to} to={m.to} role="menuitem" onClick={() => setMore(false)}>{m.label}</Link>)}
          </div>
        ) : null}
      </span>
      <button type="button" onClick={props.onSearch} aria-label="Search">Search <kbd>⌘K</kbd></button>
      {props.watching > 0 ? <Link to="/changes?watch=1" title="Changes to models you watch">★ {props.watching}</Link> : null}
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
        if (e.key === "c") navigate("/changes");
        else if (e.key === "m") navigate("/models");
        else if (e.key === "s") navigate("/status");
        else if (e.key === "h") navigate("/");
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

  const home = location.pathname === "/";

  return (
    <div class="wire" style={{ minHeight: "100dvh" }}>
      <WireStyles />
      <a href="#main" class="skip">Skip to content</a>
      <div class="wrap">
        <header class="top">
          <Link to="/" class="brand" aria-label="AI Observatory, home">
            AI Observatory
            <small>The changelog AI providers don't publish</small>
          </Link>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 18px" }}>
            <Nav pathname={location.pathname} onSearch={() => setPalette({ kind: "navigate" })} watching={watchlist.length} />
            {home ? null : <Checked />}
          </div>
        </header>
        <main id="main" style={{ minWidth: 0 }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/changes" element={<ChangesPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/catalog" element={<ModelsPage />} />
            <Route path="/model/*id" element={<ModelPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/provider/:slug" element={<ProviderPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/retiring" element={<RetiringPage />} />
            <Route path="/graveyard" element={<GraveyardPage />} />
            <Route path="/records" element={<RecordsPage />} />
            <Route path="/benchmarks" element={<BenchmarksPage />} />
            <Route path="/index" element={<PriceIndexPage />} />
            <Route path="/time-machine" element={<TimeMachinePage />} />
            <Route path="/pulse" element={<PulsePage />} />
            <Route path="/ecosystem" element={<PulsePage />} />
            <Route path="/signals" element={<PulsePage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/api" element={<ApiPage />} />
            <Route path="*rest" element={<div class="stack"><h1>Not found</h1><p class="deck">No page at this address. <Link to="/">Back to today</Link>.</p></div>} />
          </Routes>
        </main>
        <footer class="foot">
          <span>Every listing checked every hour and compared with the last reading. Nothing is deleted.</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <Link to="/about">About</Link>
            <Link to="/api">API & feeds</Link>
            <a href="/feed.xml">Feed</a>
            <a href="https://github.com/travisw/ai-observatory" target="_blank" rel="noopener">Source</a>
            <button type="button" onClick={() => setSheet(true)}>Shortcuts <kbd>?</kbd></button>
          </span>
        </footer>
      </div>
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
