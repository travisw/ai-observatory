/**
 * Cross-source identity.
 *
 * Every source names the same model differently: OpenRouter says `anthropic/claude-haiku-4.5`,
 * models.dev says provider `anthropic` model `claude-haiku-4-5`, LiteLLM says
 * `claude-haiku-4-5-20251001`. A canonical key lets one model's listings be laid side by side.
 * The normalisation is deliberately simple and will miss some; a miss shows as a listing with
 * no counterpart, never as a wrong match.
 */

export type SourceName = "modelsdev" | "litellm" | "openai" | "anthropic" | "cohere";

export const SOURCE_LABEL: Record<string, string> = {
  openrouter: "OpenRouter",
  modelsdev: "models.dev",
  litellm: "LiteLLM",
  hosts: "hosts",
  openai: "OpenAI's deprecation page",
  anthropic: "Anthropic's deprecation page",
  cohere: "Cohere's deprecation page",
};

/** Where a lifecycle source publishes, for the "read the notice" link. */
export const SOURCE_URL: Record<string, string> = {
  openrouter: "https://openrouter.ai/models",
  modelsdev: "https://models.dev",
  litellm: "https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json",
  openai: "https://developers.openai.com/api/docs/deprecations",
  anthropic: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
  cohere: "https://docs.cohere.com/docs/deprecations",
};

/** Provider slugs from any source, mapped to one canonical slug. */
const PROVIDER_ALIASES: Record<string, string> = {
  "mistralai": "mistral",
  "x-ai": "xai",
  "meta-llama": "meta",
  "meta_llama": "meta",
  "moonshotai": "moonshot",
  "z-ai": "zai",
  "zhipuai": "zai",
  "zhipu": "zai",
  "alibaba": "qwen",
  "dashscope": "qwen",
  "qwen_ai_platform": "qwen",
  "gemini": "google",
};

/** The first-party providers worth cross-checking, by canonical slug. */
export const FIRST_PARTY = new Set([
  "anthropic", "openai", "google", "mistral", "deepseek", "xai", "meta", "cohere", "moonshot", "zai",
  "qwen", "minimax", "perplexity", "ai21", "xiaomi", "stepfun", "inception", "upstage", "sakana",
]);

export function canonicalProvider(slug: string): string {
  const clean = slug.replace(/^~/, "").toLowerCase();
  return PROVIDER_ALIASES[clean] ?? clean;
}

/**
 * `provider/slug` with the noise removed: variant suffixes after a colon, dots as dashes, and
 * eight-digit date stamps, so a dated snapshot and its rolling name land on the same key.
 */
export function canonicalKey(provider: string, modelId: string): string {
  let slug = modelId.replace(/^~/, "").toLowerCase();
  const slash = slug.indexOf("/");
  if (slash !== -1) slug = slug.slice(slash + 1);
  slug = slug.split(":")[0];
  slug = slug.replace(/\./g, "-").replace(/-\d{8}$/, "");
  return `${canonicalProvider(provider)}/${slug}`;
}
