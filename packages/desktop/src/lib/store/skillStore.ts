/**
 * Skill domain store — manages skill packages loaded from the server.
 */

import { create } from 'zustand'
import { connection } from '../connection.js'

export interface SkillParameter {
  name: string
  label: string
  type: 'text' | 'select' | 'boolean'
  placeholder?: string
  options?: string[]
  required?: boolean
}

export interface SkillAssets {
  agents?: string[]
  scripts?: string[]
  references?: string[]
  other?: string[]
}

export interface Skill {
  name: string
  description: string
  icon?: string
  category?: string
  featured?: boolean
  prompt: string
  whenToUse?: string
  context?: 'inline' | 'fork'
  allowedTools?: string[]
  tools?: string[]
  schedule?: string
  model?: string
  source: 'builtin' | 'user' | 'project'
  skillDir?: string
  assets?: SkillAssets
  parameters?: SkillParameter[]
}

interface SkillState {
  skills: Skill[]
  loaded: boolean

  setSkills: (skills: Skill[]) => void
  requestSkills: () => void
  reset: () => void
}

export const skillStore = create<SkillState>((set) => ({
  skills: [],
  loaded: false,

  setSkills: (skills) => set({ skills, loaded: true }),

  requestSkills: () => {
    connection.sendSkillList()
  },

  reset: () => set({ skills: [], loaded: false }),
}))
