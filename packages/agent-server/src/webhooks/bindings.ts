/**
 * Webhook bindings — maps a channel/chat to project + preferences.
 *
 * Persisted in ~/.anton/webhook-bindings.json so project associations
 * and model overrides survive server restarts. The binding key is derived
 * from the session ID but stripped of the per-thread suffix so the binding
 * is channel-level.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAntonDir } from '@anton/agent-config'

const BINDINGS_PATH = join(getAntonDir(), 'webhook-bindings.json')

export interface Binding {
  projectId: string
  /** Model override — if set, new sessions use this instead of config default. */
  model?: string
}

type BindingsMap = Record<string, Binding>

function loadBindings(): BindingsMap {
  if (!existsSync(BINDINGS_PATH)) return {}
  try {
    const raw = JSON.parse(readFileSync(BINDINGS_PATH, 'utf-8'))
    // Migrate legacy format: bare string values → Binding objects
    const result: BindingsMap = {}
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        result[key] = { projectId: value }
      } else {
        result[key] = value as Binding
      }
    }
    return result
  } catch {
    return {}
  }
}

function saveBindings(bindings: BindingsMap): void {
  writeFileSync(BINDINGS_PATH, JSON.stringify(bindings, null, 2), 'utf-8')
}

/** Get the full binding for a binding key. */
export function getBinding(bindingKey: string): Binding | undefined {
  return loadBindings()[bindingKey]
}

/** Save a project binding for a binding key. */
export function saveBinding(bindingKey: string, projectId: string): void {
  const bindings = loadBindings()
  const existing = bindings[bindingKey]
  bindings[bindingKey] = { ...existing, projectId }
  saveBindings(bindings)
}

/** Save a model override for a binding key. */
export function saveModelOverride(bindingKey: string, model: string): void {
  const bindings = loadBindings()
  const existing = bindings[bindingKey]
  if (!existing) return // no binding yet, nothing to attach to
  existing.model = model
  saveBindings(bindings)
}

/** Clear the model override for a binding key. */
export function clearModelOverride(bindingKey: string): void {
  const bindings = loadBindings()
  const existing = bindings[bindingKey]
  if (!existing) return
  existing.model = undefined
  saveBindings(bindings)
}

/** Remove a binding entirely. */
export function removeBinding(bindingKey: string): void {
  const bindings = loadBindings()
  delete bindings[bindingKey]
  saveBindings(bindings)
}

/**
 * Extract a channel-level binding key from a session ID.
 *
 * Session IDs include thread-level suffixes that change per conversation.
 * We strip those to get a stable key so the binding covers the whole
 * channel/DM, not just one thread.
 *
 * Examples:
 *   "slack:dm:T123:C456:ts123"      → "slack:dm:T123:C456"
 *   "slack:thread:T123:C456:ts123"  → "slack:thread:T123:C456"
 *   "telegram-12345"                → "telegram-12345"
 */
export function extractBindingKey(sessionId: string): string {
  // Slack: "slack:{type}:{teamId}:{channel}:{threadTs}" → drop last segment
  if (sessionId.startsWith('slack:')) {
    const parts = sessionId.split(':')
    if (parts.length >= 5) {
      return parts.slice(0, 4).join(':')
    }
    return sessionId
  }

  // Telegram: "telegram-{chatId}" — already chat-level, no stripping needed
  return sessionId
}
