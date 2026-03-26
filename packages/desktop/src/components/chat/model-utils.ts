// Shared model display utilities used by ModelSelector, SettingsModal, etc.

import anthropicIcon from '../../assets/llm/anthropic_light.svg'
import deepseekIcon from '../../assets/llm/deepseek.svg'
import geminiIcon from '../../assets/llm/gemini.svg'
import kimiIcon from '../../assets/llm/kimi_light.svg'
import metaIcon from '../../assets/llm/meta_light.svg'
import mistralIcon from '../../assets/llm/mistral.svg'
import openrouterIcon from '../../assets/llm/openrouter_light.svg'
import xaiIcon from '../../assets/llm/xai_light.svg'

export const providerIcons: Record<string, string> = {
  anthropic: anthropicIcon,
  google: geminiIcon,
  openrouter: openrouterIcon,
  mistral: mistralIcon,
  deepseek: deepseekIcon,
  meta: metaIcon,
  xai: xaiIcon,
  kimi: kimiIcon,
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
