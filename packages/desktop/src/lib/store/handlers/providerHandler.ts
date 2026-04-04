/**
 * AI channel: provider responses.
 */

import type { WsPayload } from '../../connection.js'
import { useStore } from '../../store.js'
import type { WsProviderSetDefaultResponse, WsProvidersListResponse } from '../../ws-messages.js'
import { connectionStore } from '../connectionStore.js'
import { sessionStore } from '../sessionStore.js'
import { uiStore } from '../uiStore.js'

export function handleProviderMessage(msg: WsPayload): boolean {
  switch (msg.type) {
    case 'providers_list_response': {
      const m = msg as unknown as WsProvidersListResponse
      sessionStore.getState().setProviders(m.providers, m.defaults)
      connectionStore.getState().markSynced('providers')
      const ui = uiStore.getState()
      ui.setOnboardingLoaded(true)
      if (m.onboarding?.completed) {
        uiStore.setState({
          onboardingCompleted: true,
          onboardingRole: m.onboarding?.role ?? null,
        })
      }
      return true
    }

    case 'provider_set_key_response':
      if (msg.success as boolean) sessionStore.getState().sendProvidersList()
      return true

    case 'provider_set_models_response':
      if (msg.success as boolean) sessionStore.getState().sendProvidersList()
      return true

    case 'provider_set_default_response': {
      const m = msg as unknown as WsProviderSetDefaultResponse
      if (m.success) {
        const ss = sessionStore.getState()
        ss.setCurrentSession(ss.currentSessionId || '', m.provider, m.model)
        useStore.getState().setCurrentSession(ss.currentSessionId || '', m.provider, m.model)
      }
      return true
    }

    default:
      return false
  }
}
