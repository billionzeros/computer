// Shared model display utilities used by ModelSelector, SettingsModal, etc.

import anthropicIcon from '../../assets/llm/anthropic_light.svg'
import antonIcon from '../../assets/llm/anton.svg'
import deepseekIcon from '../../assets/llm/deepseek.svg'
import geminiIcon from '../../assets/llm/gemini.svg'
import groqIcon from '../../assets/llm/groq.svg'
import kimiIcon from '../../assets/llm/kimi_light.svg'
import metaIcon from '../../assets/llm/meta_light.svg'
import mistralIcon from '../../assets/llm/mistral.svg'
import openaiIcon from '../../assets/llm/openai.svg'
import openrouterIcon from '../../assets/llm/openrouter_light.svg'
import xaiIcon from '../../assets/llm/xai_light.svg'

export const providerIcons: Record<string, string> = {
  anthropic: anthropicIcon,
  openai: openaiIcon,
  google: geminiIcon,
  groq: groqIcon,
  openrouter: openrouterIcon,
  mistral: mistralIcon,
  anton: antonIcon,
  deepseek: deepseekIcon,
  meta: metaIcon,
  xai: xaiIcon,
  kimi: kimiIcon,
  'claude-code': anthropicIcon,
  codex: openaiIcon,
}

export function providerDisplayName(name: string): string {
  if (name === 'claude-code') return 'Claude Code'
  if (name === 'codex') return 'ChatGPT Codex'
  if (name === 'openai') return 'OpenAI'
  if (name === 'xai') return 'xAI'
  if (name === 'openrouter') return 'OpenRouter'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export type ModelTag = 'fast' | 'balanced' | 'reasoning'

/** Rough bucket used for quick-scan badges in pickers and settings. */
export function classifyModelTag(model: string): ModelTag | null {
  const m = model.toLowerCase()
  if (/haiku|mini|flash|nano|lite|small|8b|7b|3b|groq/.test(m)) return 'fast'
  if (/opus|reason|o1|o3|o4|thinking|deepseek-r|405b|70b/.test(m)) return 'reasoning'
  if (/sonnet|gpt|claude|gemini|pro|medium|mistral|llama/.test(m)) return 'balanced'
  return null
}

/** Format model ID into a clean display name: "claude-sonnet-4-6" → "Sonnet 4.6" */
export function formatModelName(model: string): string {
  let name = model.split('/').pop() || model

  // Strip provider prefixes
  name = name
    .replace(/^claude-/, '')
    .replace(/^gpt-/, 'GPT-')
    .replace(/^o(\d)/, 'O$1')

  // Convert version dashes to dots: "4-6" → "4.6", "4-5" → "4.5"
  name = name.replace(/(\d+)-(\d+)(?=$|-)/g, '$1.$2')

  // Remove "-latest" suffix
  name = name.replace(/-latest$/, '')

  // Replace remaining dashes with spaces
  name = name.replace(/-/g, ' ')

  // Capitalize first letter of each word
  name = name.replace(/\b[a-z]/g, (c) => c.toUpperCase())

  return name
}
