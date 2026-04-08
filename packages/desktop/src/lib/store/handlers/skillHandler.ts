/**
 * AI channel: skill list responses.
 */

import type { AiMessage } from '@anton/protocol'
import { skillStore } from '../skillStore.js'

export function handleSkillMessage(msg: AiMessage): boolean {
  switch (msg.type) {
    case 'skill_list_response': {
      skillStore.getState().setSkills(msg.skills)
      return true
    }

    default:
      return false
  }
}
