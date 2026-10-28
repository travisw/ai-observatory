/**
 * Published benchmark results: which leaderboards are read, and how their model names line
 * up with the catalogue's ids.
 *
 * Nothing is run here. Each number is copied from a public leaderboard with a link back, and
 * the only work on this side is identity: Epoch AI says `claude-haiku-5-5_max`, LMArena says
 * "Claude Haiku 5.5 (High)", OpenRouter says `anthropic/claude-haiku-4.5:batch`. A loose key
 * folds effort suffixes, thinking budgets, dotted versions and dated snapshots away so the
 * three land on one model page. The folding is deliberately simple: a miss shows as a result
 * with no model link, never as a wrong one.
 */
import { canonicalProvider } from "./sources";

export type BenchmarkUnit = "pct" | "elo" | "index";

export type BenchmarkSpec = {
  slug: string;
  name: string;
  source: "epoch" | "lmarena";
  unit: BenchmarkUnit;
  /** One plain sentence on what a high score means. */
  measures: string;
  url: string;
};

/** The leaderboards read, in the order the page offers them. */
export const BENCHMARKS: BenchmarkSpec[] = [
  { slug: "eci", name: "Epoch Capabilities Index", source: "epoch", unit: "index", measures: "One number from Epoch AI's own runs across many benchmarks; higher is more capable overall.", url: "https://epoch.ai/benchmarks/eci" },
  { slug: "arena-text", name: "LMArena text", source: "lmarena", unit: "elo", measures: "An Elo-style rating from blind head-to-head votes on chat answers, with writing style controlled for.", url: "https://lmarena.ai/leaderboard/text" },
  { slug: "gpqa-diamond", name: "GPQA Diamond", source: "epoch", unit: "pct", measures: "Graduate-level science questions written to defeat web search; percent answered correctly.", url: "https://epoch.ai/benchmarks/gpqa-diamond" },
  { slug: "swe-bench-verified", name: "SWE-bench Verified", source: "epoch", unit: "pct", measures: "Real GitHub issues fixed so the repository's tests pass; percent resolved.", url: "https://epoch.ai/benchmarks/swe-bench-verified" },
  { slug: "frontiermath-tiers-1-3", name: "FrontierMath, tiers 1 to 3", source: "epoch", unit: "pct", measures: "Unpublished research-level mathematics problems; percent solved.", url: "https://epoch.ai/benchmarks/frontiermath-tiers-1-3" },
  { slug: "otis-mock-aime", name: "OTIS Mock AIME 2024–2025", source: "epoch", unit: "pct", measures: "Competition mathematics in the style of the AIME, from problems not on the web; percent correct.", url: "https://epoch.ai/benchmarks/otis-mock-aime-2024-2025" },
  { slug: "simpleqa-verified", name: "SimpleQA Verified", source: "epoch", unit: "pct", measures: "Short factual questions with one checkable answer; percent correct, so a measure of how often a model knows rather than guesses.", url: "https://epoch.ai/benchmarks/simpleqa-verified" },
  { slug: "arc-agi-2", name: "ARC-AGI-2", source: "epoch", unit: "pct", measures: "Visual puzzles that need a new rule inferred from a few examples; percent solved.", url: "https://epoch.ai/benchmarks/arc-agi-2" },
  { slug: "hle", name: "Humanity's Last Exam", source: "epoch", unit: "pct", measures: "Expert-written questions across many fields, built to be hard for models; percent correct.", url: "https://epoch.ai/benchmarks/hle" },
];

export const BENCHMARK_SOURCE: Record<string, { label: string; url: string; licence: string }> = {
  epoch: { label: "Epoch AI", url: "https://epoch.ai/benchmarks", licence: "CC BY 4.0" },
  lmarena: { label: "LMArena", url: "https://lmarena.ai/leaderboard", licence: "CC BY 4.0" },
};

export function benchmarkSpec(slug: string): BenchmarkSpec | undefined {
  return BENCHMARKS.find((b) => b.slug === slug);
}

/** How a leaderboard names a company, mapped to the provider slug the catalogue uses. */
const ORGS: Record<string, string> = {
  "openai": "openai",
  "anthropic": "anthropic",
  "google deepmind": "google",
  "google": "google",
  "deepseek": "deepseek",
  "meta ai": "meta",
  "meta": "meta",
  "xai": "xai",
  "z.ai (zhipu ai)": "zai",
  "zhipu ai": "zai",
  "alibaba": "qwen",
  "moonshot": "moonshot",
  "moonshot ai": "moonshot",
  "mistral ai": "mistral",
  "xiaomi": "xiaomi",
  "minimax": "minimax",
  "microsoft": "microsoft",
  "microsoft research": "microsoft",
  "nvidia": "nvidia",
  "cohere": "cohere",
  "amazon": "amazon",
  "baidu": "baidu",
  "bytedance": "bytedance",
  "bytedance seed": "bytedance",
  "thinking machines": "thinkingmachines",
  "thinky": "thinkingmachines",
  "01.ai": "01-ai",
  "databricks": "databricks",
  "perplexity": "perplexity",
  "ai21 labs": "ai21",
  "tencent": "tencent",
  "stepfun": "stepfun",
  "inception": "inception",
  "liquid ai": "liquid",
  "ibm": "ibm-granite",
  "nous research": "nousresearch",
};

/** A leaderboard's organisation text ("Z.ai (Zhipu AI),Tsinghua University") to a provider slug, or "" when unknown. */
export function providerFromOrg(org: string): string {
  const first = (org ?? "").split(",")[0].trim().toLowerCase();
  if (!first) return "";
  const known = ORGS[first];
  if (known) return known;
  return canonicalProvider(first.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
}

/** Epoch AI's run settings ride on the id: `gpt-5.5_xhigh`, `claude-opus-4-6_32K`. */
const EFFORT_SUFFIX = /_(low|medium|high|xhigh|max|minimal|none|unknown|default)$/i;
const BUDGET_SUFFIX = /_(\d+k)$/i;

/** Words inside LMArena's parentheses that describe a setting rather than a date: "(High, 32K, 20251101)". */
const SETTING_WORDS = new Set(["low", "medium", "high", "xhigh", "max", "minimal", "thinking", "reasoning", "non-thinking", "nonthinking", "instant", "default"]);

/** Source ids that fold to nothing the catalogue knows under the rules below. Source form on the left, catalogue form on the right. */
const ALIASES: Record<string, string> = {
  "muse-wonder-1-0": "muse-wonder",
};

/** The model name with its run setting split off: ("gpt-5.5_xhigh") → base "gpt-5.5", variant "xhigh". */
export function splitVariant(name: string): { base: string; variant: string } {
  let base = name.trim();
  const parts: string[] = [];
  const effort = EFFORT_SUFFIX.exec(base);
  if (effort) {
    parts.push(effort[1].toLowerCase());
    base = base.slice(0, effort.index);
  }
  const budget = BUDGET_SUFFIX.exec(base);
  if (budget) {
    parts.push(budget[1].toLowerCase());
    base = base.slice(0, budget.index);
  }
  const paren = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(base);
  if (paren) {
    base = paren[1];
    for (const word of paren[2].split(",").map((w) => w.trim().toLowerCase())) {
      if (SETTING_WORDS.has(word) || /^\d+k$/.test(word)) parts.push(word);
    }
  }
  return { base, variant: parts.join(" ") };
}

const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4}|\d{2}-\d{2})$/;
const STAGE_SUFFIX = /-(preview|instruct|it)$/;

/**
 * A model name from any source reduced to the slug the catalogue would use: lowercase, provider
 * and OpenRouter variant stripped, dots and spaces as dashes, dated snapshots and the words
 * "preview", "instruct" and "it" dropped from the end.
 */
export function looseSlug(name: string): string {
  let s = splitVariant(name).base.replace(/^~/, "");
  if (s.includes("/")) s = s.slice(s.lastIndexOf("/") + 1);
  s = s.split(":")[0].toLowerCase();
  // Fireworks-style ids spell a dot as "p": glm-4p6 is GLM-4.6.
  s = s.replace(/(\d)p(\d)/g, "$1-$2");
  s = s.replace(/[\s_.]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  for (let i = 0; i < 2; i++) s = s.replace(DATE_SUFFIX, "").replace(STAGE_SUFFIX, "");
  return ALIASES[s] ?? s;
}

/** `provider/slug`, with "?" for the provider when the source did not name one. */
export function looseKey(provider: string, name: string): string {
  return `${canonicalProvider(provider) || "?"}/${looseSlug(name)}`;
}

/** The score as the page prints it: "94.3%", "1517", "168.8". */
export function scoreText(score: string, unit: string): string {
  const value = Number(score);
  if (!Number.isFinite(value)) return score || "";
  if (unit === "pct") return `${value.toFixed(1)}%`;
  if (unit === "elo") return value.toFixed(0);
  return value.toFixed(1);
}
