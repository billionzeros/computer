/**
 * AI channel: provider responses.
 */

import type { AiMessage } from '@anton/protocol'
import { useStore } from '../../store.js'
import { connectionStore } from '../connectionStore.js'
import { sessionStore } from '../sessionStore.js'
import { uiStore } from '../uiStore.js'

export function handleProviderMessage(msg: AiMessage): boolean {
  switch (msg.type) {
    case 'providers_list_response': {
      sessionStore.getState().setProviders(msg.providers, msg.defaults)
      connectionStore.getState().markSynced('providers')
      const ui = uiStore.getState()
      ui.setOnboardingLoaded(true)
      if (msg.onboarding?.completed) {
        uiStore.setState({
          onboardingCompleted: true,
          onboardingRole: msg.onboarding?.role ?? null,
        })
      }
      return true
    }

    case 'provider_set_key_response':
      if (msg.success) sessionStore.getState().sendProvidersList()
      return true

    case 'provider_set_models_response':
      if (msg.success) sessionStore.getState().sendProvidersList()
      return true

    case 'provider_set_default_response': {
      if (msg.success) {
        const ss = sessionStore.getState()
        ss.setCurrentSession(ss.currentSessionId || '', msg.provider, msg.model)
        useStore.getState().setCurrentSession(ss.currentSessionId || '', msg.provider, msg.model)
      }
      return true
    }

    default:
      return false
  }
}
