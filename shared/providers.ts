/**
 * Provider slugs as they appear in model ids, mapped to how the company writes its own name.
 * Anything not listed falls back to a capitalised slug, which is right more often than not.
 */
const NAMES: Record<string, string> = {
  "ai21": "AI21",
  "aion-labs": "Aion Labs",
  "alibaba": "Alibaba",
  "amazon": "Amazon",
  "anthracite-org": "Anthracite",
  "anthropic": "Anthropic",
  "arcee-ai": "Arcee",
  "baidu": "Baidu",
  "bytedance": "ByteDance",
  "bytedance-seed": "ByteDance Seed",
  "cognitivecomputations": "Cognitive Computations",
  "cohere": "Cohere",
  "deepseek": "DeepSeek",
  "dots-studio": "Dots Studio",
  "fireworks": "Fireworks",
  "google": "Google",
  "gryphe": "Gryphe",
  "ibm-granite": "IBM",
  "inception": "Inception",
  "inclusionai": "inclusionAI",
  "inference-net": "Inference.net",
  "kwaipilot": "Kwaipilot",
  "liquid": "Liquid",
  "mancer": "Mancer",
  "meituan": "Meituan",
  "meta": "Meta",
  "meta-llama": "Meta",
  "microsoft": "Microsoft",
  "minimax": "MiniMax",
  "mistral": "Mistral",
  "mistralai": "Mistral",
  "moonshot": "Moonshot",
  "moonshotai": "Moonshot",
  "morph": "Morph",
  "nex-agi": "Nex AGI",
  "nousresearch": "Nous Research",
  "nvidia": "NVIDIA",
  "openai": "OpenAI",
  "openrouter": "OpenRouter",
  "perceptron": "Perceptron",
  "perplexity": "Perplexity",
  "poolside": "Poolside",
  "prism-ml": "Prism ML",
  "qwen": "Qwen",
  "rekaai": "Reka",
  "relace": "Relace",
  "sakana": "Sakana",
  "sao10k": "Sao10K",
  "stealth": "Stealth",
  "stepfun": "StepFun",
  "tencent": "Tencent",
  "thedrummer": "TheDrummer",
  "thinkingmachines": "Thinking Machines",
  "typesafe": "Typesafe",
  "unbiased": "Unbiased",
  "undi95": "Undi95",
  "upstage": "Upstage",
  "writer": "Writer",
  "x-ai": "xAI",
  "xai": "xAI",
  "xiaomi": "Xiaomi",
  "z-ai": "Z.ai",
  "zai": "Z.ai",
};

/** A leading tilde marks a rolling alias that always points at the newest model in a family. */
export function isAlias(modelId: string): boolean {
  return modelId.startsWith("~");
}

export function providerName(slug: string): string {
  const clean = slug.replace(/^~/, "");
  const known = NAMES[clean];
  if (known) return known;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * The short model name for a headline. OpenRouter names carry the provider as a prefix
 * ("DeepSeek: DeepSeek V4 Flash"), which reads twice when the provider leads the sentence.
 */
export function modelName(modelId: string, listedName?: string): string {
  if (listedName) {
    const colon = listedName.indexOf(": ");
    const bare = colon === -1 ? listedName : listedName.slice(colon + 2);
    return isAlias(modelId) ? `${bare} (alias)` : bare;
  }
  const slash = modelId.indexOf("/");
  const slug = slash === -1 ? modelId : modelId.slice(slash + 1);
  return isAlias(modelId) ? `${slug} (alias)` : slug;
}
