import type { Conversation } from './conversations.js'
import { projectStore } from './store/projectStore.js'
import { sessionStore } from './store/sessionStore.js'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      () => {
        window.clearTimeout(timeout)
        resolve(null)
      },
    )
  })
}

function serverHasMessageSession(sessionId: string): boolean {
  const ss = sessionStore.getState()
  const ps = projectStore.getState()
  return [...ss.sessions, ...ps.projectSessions].some(
    (session) => session.id === sessionId && session.messageCount > 0,
  )
}

function hasSessionNotFoundError(conv: Conversation): boolean {
  return conv.messages.some((m) => m.isError && /Session not found(?: on server)?/i.test(m.content))
}

export async function ensureSessionReadyForSend(opts: {
  conv: Conversation
  projectId?: string
  provider: string
  model: string
  timeoutMs?: number
}): Promise<boolean> {
  const { conv, projectId, provider, model, timeoutMs = 10_000 } = opts
  const ss = sessionStore.getState()
  const state = ss.getSessionState(conv.sessionId)
  const shouldCreate =
    conv.pendingCreation ||
    state.pendingCreation ||
    (!serverHasMessageSession(conv.sessionId) &&
      (conv.messages.length === 0 || hasSessionNotFoundError(conv)))

  if (!shouldCreate) return true

  const waitPromise = state.resolver
    ? new Promise<void>((resolve) => {
        const existing = state.resolver
        ss.updateSessionState(conv.sessionId, {
          resolver: () => {
            existing?.()
            resolve()
          },
        })
      })
    : (() => {
        const pending = ss.registerPendingSession(conv.sessionId)
        ss.createSession(conv.sessionId, {
          provider,
          model,
          projectId,
        })
        return pending
      })()

  const ready = await withTimeout(
    waitPromise.then(() => true),
    timeoutMs,
  )

  if (!ready) {
    ss.updateSessionState(conv.sessionId, {
      isStreaming: false,
      resolver: undefined,
      status: 'error',
    })
    return false
  }

  return true
}
