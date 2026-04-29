/**
 * `skill` — load an Anton skill's full SKILL.md body on demand.
 *
 * Mirrors Claude Code's SkillTool shape: the prompt carries only a compact
 * metadata listing, and this tool expands the selected skill into the
 * conversation when the model decides it is relevant.
 */

import { type SkillConfig, buildSkillPrompt, loadSkills } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'

const log = createLogger('skill-tool')

export interface SkillToolDeps {
  getSkills?: () => SkillConfig[]
}

function normalizeSkillName(name: string): string {
  return name
    .trim()
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

function skillAliases(skill: SkillConfig): Set<string> {
  const aliases = new Set<string>()
  const add = (value: string | undefined) => {
    if (!value) return
    const normalized = normalizeSkillName(value)
    if (normalized) aliases.add(normalized)
  }
  add(skill.name)
  if (skill.skillDir) {
    const parts = skill.skillDir.split(/[\\/]+/).filter(Boolean)
    add(parts.at(-1))
  }
  return aliases
}

function findSkill(skills: SkillConfig[], requested: string): SkillConfig | undefined {
  const normalized = normalizeSkillName(requested)
  return skills.find((skill) => skillAliases(skill).has(normalized))
}

function listAvailableSkills(skills: SkillConfig[]): string {
  const names = skills
    .filter((skill) => !skill.disableModelInvocation)
    .map((skill) => skill.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 80)
  if (names.length === 0) return 'No model-invocable skills are installed.'
  const suffix =
    skills.length > names.length ? `\n...and ${skills.length - names.length} more.` : ''
  return `Available skills:\n${names.map((name) => `- ${name}`).join('\n')}${suffix}`
}

function applyArguments(prompt: string, args: string | undefined): string {
  const value = args ?? ''
  return prompt.replace(/\$ARGUMENTS/g, value)
}

export function buildSkillTool(deps: SkillToolDeps = {}): AgentTool {
  return defineTool({
    name: 'skill',
    label: 'Skill',
    description:
      'Load and execute an Anton skill by name. Use this before responding when the user request matches an available skill or references a slash command. The tool returns the full SKILL.md instructions for the selected skill.',
    parameters: Type.Object({
      skill: Type.String({
        description:
          'Skill name, with or without a leading slash. Examples: "docx", "/docx", "review-pr".',
      }),
      args: Type.Optional(
        Type.String({
          description:
            'Optional arguments to pass into the skill. Replaces $ARGUMENTS in the skill body when present.',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      let skills: SkillConfig[]
      try {
        skills = deps.getSkills?.() ?? loadSkills()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn({ err: message }, 'skill load failed')
        return toolResult(`Failed to load skills: ${message}`, true)
      }

      const skill = findSkill(skills, params.skill)
      if (!skill) {
        log.warn({ requested: params.skill, available: skills.length }, 'skill not found')
        return toolResult(`Unknown skill: ${params.skill}\n\n${listAvailableSkills(skills)}`, true)
      }
      if (skill.disableModelInvocation) {
        log.warn({ skill: skill.name }, 'skill blocked: model invocation disabled')
        return toolResult(`Skill "${skill.name}" is not available for model invocation.`, true)
      }

      const prompt = applyArguments(buildSkillPrompt(skill), params.args)
      const header =
        skill.context === 'fork'
          ? `Skill "${skill.name}" loaded. It is marked context=fork; delegate to a sub-agent if that is available, otherwise follow these instructions inline.`
          : `Skill "${skill.name}" loaded. Follow these instructions before continuing.`
      const argsLine = params.args ? `\nArguments: ${params.args}` : ''

      log.info(
        {
          skill: skill.name,
          source: skill.source,
          context: skill.context ?? 'inline',
          args: params.args,
          promptChars: prompt.length,
        },
        'skill invoked',
      )

      return toolResult(`${header}${argsLine}\n\n${prompt}`)
    },
  })
}
