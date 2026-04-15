/**
 * Prompt templates for context compaction.
 *
 * Used when the conversation exceeds the context window threshold
 * and older messages need to be summarized.
 */

export const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to condense a conversation between a user and an AI assistant into a concise but complete summary that preserves all information needed to continue the work.

Rules:
- Preserve ALL file paths, function names, variable names, URLs, and command outputs mentioned
- Preserve the sequence of actions taken and their outcomes (success/failure)
- Note any errors encountered and how they were resolved
- Note the current state of work: what is done, what remains
- Preserve user preferences, constraints, and decisions made
- Be concise — aim for less than 20% of the original length
- Use bullet points and structured formatting
- Do NOT add commentary or opinions — just summarize what happened`

export const COMPACTION_USER_PROMPT_PREFIX =
  'Summarize the following conversation. Preserve all important context needed to continue the work seamlessly.'

export const COMPACTION_CUSTOM_INSTRUCTIONS_PREFIX =
  'Additional instructions for what to focus on in this summary:'

/**
 * Build the full user prompt for the compaction LLM call.
 */
export function buildCompactionUserPrompt(
  serializedMessages: string,
  customInstructions?: string,
): string {
  let prompt = COMPACTION_USER_PROMPT_PREFIX

  if (customInstructions) {
    prompt += `\n\n${COMPACTION_CUSTOM_INSTRUCTIONS_PREFIX}\n${customInstructions}`
  }

  prompt += `\n\n<conversation>\n${serializedMessages}\n</conversation>`

  return prompt
}
