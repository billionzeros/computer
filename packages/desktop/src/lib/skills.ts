import { connection } from './connection.js'
import { useStore } from './store.js'
import { type Skill, skillStore } from './store/skillStore.js'

export type { Skill, SkillParameter } from './store/skillStore.js'

/**
 * Get all skills from the store.
 * Falls back to empty array if not yet loaded.
 */
export function getSkills(): Skill[] {
  return skillStore.getState().skills
}

/**
 * Find a skill by its slash command (derived from name).
 */
export function findSkillByCommand(command: string): Skill | undefined {
  const cmd = command.startsWith('/') ? command.slice(1) : command
  return getSkills().find((s) => {
    const skillCmd = s.name.toLowerCase().replace(/\s+/g, '-')
    return skillCmd === cmd
  })
}

/**
 * Get the slash command string for a skill.
 */
export function getSkillCommand(skill: Skill): string {
  return `/${skill.name.toLowerCase().replace(/\s+/g, '-')}`
}

/**
 * Execute a skill by sending its prompt as a new conversation.
 */
export function executeSkill(skill: Skill, params: Record<string, string> = {}) {
  let prompt = skill.prompt

  // Substitute parameters
  for (const [key, value] of Object.entries(params)) {
    prompt = prompt.replace(`{${key}}`, value || '')
  }
  // Clean up unfilled placeholders
  prompt = prompt
    .replace(/\{[^}]+\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Prepend base directory if available
  if (skill.skillDir) {
    prompt = `Base directory for this skill: ${skill.skillDir}\n\n${prompt}`
    prompt = prompt.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skill.skillDir)
  }

  const store = useStore.getState()
  const convId = store.newConversation(skill.name)

  store.addMessage({
    id: `user_${Date.now()}`,
    role: 'user',
    content: prompt,
    timestamp: Date.now(),
  })

  connection.sendAiMessage(prompt)
  return convId
}
