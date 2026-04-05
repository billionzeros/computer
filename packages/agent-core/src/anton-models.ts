/**
 * Anton (GRU) model catalog.
 *
 * GRU is a LiteLLM proxy at gru.huddle01.io/v1 that exposes 30+ models
 * through a single OpenAI-compatible endpoint. All models use the
 * "openai-completions" API type so the pi-ai SDK streams them identically
 * to OpenRouter models — just with a different baseUrl and API key.
 *
 * The pi-ai SDK's model registry is hardcoded at build time and has no
 * public registerModel() API, so we maintain our own lookup here and
 * session.ts falls back to it when the built-in registry returns nothing.
 */

const ANTON_BASE_URL = 'https://gru.huddle01.io/v1'

interface AntonModelDef {
  id: string
  name: string
  reasoning: boolean
  input: readonly string[]
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow: number
  maxTokens: number
}

const ANTON_MODELS: AntonModelDef[] = [
  // ── OpenAI ──────────────────────────────────────────────────
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 2.5, output: 15, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  },
  {
    id: 'gpt-5.4-pro',
    name: 'GPT-5.4 Pro',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 2, output: 8, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.4, output: 1.6, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  },
  {
    id: 'gpt-4.1-nano',
    name: 'GPT-4.1 Nano',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.1, output: 0.4, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  },
  {
    id: 'o3',
    name: 'o3',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 2, output: 8, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 100_000,
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.1, output: 4.4, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 100_000,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  },

  // ── Anthropic ───────────────────────────────────────────────
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 5, output: 25, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_000,
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_000,
  },
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 16_000,
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 1, output: 5, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_192,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_000,
  },

  // ── Google ──────────────────────────────────────────────────
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 2, output: 12, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.25, output: 1.5, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 1.25, output: 10, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },

  // ── DeepSeek ────────────────────────────────────────────────
  {
    id: 'deepseek-v3.2',
    name: 'DeepSeek V3.2',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.299, output: 0.437, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.299, output: 0.437, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },

  // ── xAI / Grok ─────────────────────────────────────────────
  {
    id: 'grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 3.795, output: 18.975, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  },
  {
    id: 'grok-3-mini',
    name: 'Grok 3 Mini',
    reasoning: true,
    input: ['text'],
    cost: { input: 0.391, output: 1.955, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  },

  // ── Qwen ────────────────────────────────────────────────────
  {
    id: 'qwen3-235b',
    name: 'Qwen3 235B',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.0816, output: 0.115, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },
  {
    id: 'qwen-2.5-coder-32b',
    name: 'Qwen 2.5 Coder 32B',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.138, output: 0.8625, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },

  // ── MiniMax ─────────────────────────────────────────────────
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.23, output: 1.38, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 16_384,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.345, output: 1.38, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 16_384,
  },

  // ── Kimi / Moonshot ─────────────────────────────────────────
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    reasoning: false,
    input: ['text'],
    cost: { input: 1.38, output: 6.9, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },

  // ── Meta / Llama ────────────────────────────────────────────
  {
    id: 'llama-4-maverick',
    name: 'Llama 4 Maverick',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0.1725, output: 0.69, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.115, output: 0.46, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },

  // ── Mistral ─────────────────────────────────────────────────
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    reasoning: false,
    input: ['text'],
    cost: { input: 2.3, output: 6.9, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  },
  {
    id: 'codestral',
    name: 'Codestral',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.345, output: 1.035, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 8_192,
  },
]

// Build a lookup map once at import time
const antonModelMap = new Map<string, ReturnType<typeof buildModelEntry>>()

function buildModelEntry(def: AntonModelDef) {
  return {
    id: def.id,
    name: def.name,
    api: 'openai-completions' as const,
    provider: 'anton',
    baseUrl: ANTON_BASE_URL,
    reasoning: def.reasoning,
    input: def.input,
    cost: def.cost,
    contextWindow: def.contextWindow,
    maxTokens: def.maxTokens,
  }
}

for (const def of ANTON_MODELS) {
  antonModelMap.set(def.id, buildModelEntry(def))
}

/**
 * Look up an anton model by ID.
 * Returns a Model-compatible object or undefined if not found.
 */
// biome-ignore lint/suspicious/noExplicitAny: matches pi-ai's Model<Api> shape
export function getAntonModel(modelId: string): any | undefined {
  return antonModelMap.get(modelId)
}

/** Return all anton model IDs (used by DEFAULT_PROVIDERS). */
export function getAntonModelIds(): string[] {
  return ANTON_MODELS.map((m) => m.id)
}
