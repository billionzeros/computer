/**
 * Conversation mirror for harness sessions.
 *
 * Every harness turn is mirrored into Anton's on-disk conversation store
 * (~/.anton/conversations/<id>/messages.jsonl or per-project equivalent)
 * in the same Pi-SDK-compatible shape Session writes. This makes Anton
 * the source of truth for harness conversation history:
 *
 *   • Provider switching works — the new CLI gets replayed context
 *     from our mirror rather than depending on the old CLI's tape.
 *   • Export / audit works — harness conversations appear alongside
 *     Pi SDK ones in the desktop UI.
 *   • CLI session-tape loss is recoverable — Anton's record is the
 *     authoritative one; --resume is a performance cache only.
 *
 * This module is split into a PURE synthesizer and a thin side-effectful
 * writer, so unit tests can exercise the synthesis logic without
 * touching disk.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type SessionMessage,
  type SessionMeta,
  getConversationDir,
  getProjectSessionsDir,
} from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { SessionEvent } from '../session.js'

const log = createLogger('harness-mirror')

// ── Content block shape (Pi SDK / pi-ai compatible) ────────────────
// We keep the block definitions local to this module so the mirror
// output matches pi-ai Message exactly without importing private types.

interface TextBlock {
  type: 'text'
  text: string
}
interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}
interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

type AssistantBlock = TextBlock | ThinkingBlock | ToolUseBlock

// ── Pure synthesizer ───────────────────────────────────────────────

/**
 * Turn a user message plus the stream of SessionEvents a harness turn
 * produced into an ordered list of SessionMessages ready to append to
 * messages.jsonl.
 *
 * Event → message rules:
 *   • text/thinking/tool_call events accumulate into an assistant
 *     message whose content is an array of ContentBlocks.
 *   • A tool_result event closes the current assistant message and
 *     opens a role:'tool' message. Consecutive tool_results batch into
 *     the same tool message.
 *   • Anything else (tool_call after a tool_result, more text) opens
 *     a new assistant message.
 *   • 'done' and 'error' events do not contribute content but mark the
 *     end of the turn — caller should stop feeding us after 'done'.
 */
export function synthesizeHarnessTurn(
  userMessage: string,
  events: SessionEvent[],
  timestamp = Date.now(),
): SessionMessage[] {
  const messages: SessionMessage[] = []

  // 1. The user's message comes first.
  messages.push({
    role: 'user',
    timestamp,
    content: [{ type: 'text', text: userMessage } satisfies TextBlock],
  })

  // 2. Walk the event stream, batching into alternating assistant/tool
  //    messages as described above.
  let pendingAssistant: AssistantBlock[] | null = null
  let pendingToolResults: ToolResultBlock[] | null = null

  const flushAssistant = () => {
    if (pendingAssistant && pendingAssistant.length > 0) {
      messages.push({
        role: 'assistant',
        timestamp: Date.now(),
        // Our block types are stricter than SessionMessage['content']
        // (which allows any Record<string, unknown>); cast through unknown.
        content: pendingAssistant as unknown as SessionMessage['content'],
      })
    }
    pendingAssistant = null
  }
  const flushTool = () => {
    if (pendingToolResults && pendingToolResults.length > 0) {
      messages.push({
        role: 'tool',
        timestamp: Date.now(),
        content: pendingToolResults as unknown as SessionMessage['content'],
      })
    }
    pendingToolResults = null
  }

  for (const ev of events) {
    switch (ev.type) {
      case 'text': {
        if (pendingToolResults) flushTool()
        if (!pendingAssistant) pendingAssistant = []
        pendingAssistant.push({ type: 'text', text: ev.content })
        break
      }
      case 'thinking': {
        if (pendingToolResults) flushTool()
        if (!pendingAssistant) pendingAssistant = []
        pendingAssistant.push({ type: 'thinking', thinking: ev.text })
        break
      }
      case 'tool_call': {
        if (pendingToolResults) flushTool()
        if (!pendingAssistant) pendingAssistant = []
        pendingAssistant.push({
          type: 'tool_use',
          id: ev.id,
          name: ev.name,
          input: ev.input,
        })
        break
      }
      case 'tool_result': {
        if (pendingAssistant) flushAssistant()
        if (!pendingToolResults) pendingToolResults = []
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: ev.id,
          content: ev.output,
          ...(ev.isError ? { is_error: true } : {}),
        })
        break
      }
      default:
        // done / error / title_update / compaction / tasks_update / …
        // — metadata, not persisted into message content.
        break
    }
  }

  flushAssistant()
  flushTool()

  return messages
}

// ── Side-effectful writer ──────────────────────────────────────────

export interface HarnessSessionInitOpts {
  sessionId: string
  projectId?: string
  provider: string
  model: string
  createdAt?: number
}

/**
 * Create the conversation directory and a baseline meta.json if the
 * session's on-disk state doesn't exist yet. Safe to call on every
 * turn — it's a no-op once the files are in place. Call before the
 * first appendHarnessTurn for the session.
 */
export function ensureHarnessSessionInit(opts: HarnessSessionInitOpts): void {
  const dir = resolveSessionDir(opts.sessionId, opts.projectId)
  mkdirSync(dir, { recursive: true })

  const metaPath = join(dir, 'meta.json')
  if (existsSync(metaPath)) return

  const now = opts.createdAt ?? Date.now()
  const meta: SessionMeta = {
    id: opts.sessionId,
    title: '',
    provider: opts.provider,
    model: opts.model,
    createdAt: now,
    lastActiveAt: now,
    messageCount: 0,
    archived: false,
    tags: [],
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

  const msgsPath = join(dir, 'messages.jsonl')
  if (!existsSync(msgsPath)) {
    writeFileSync(msgsPath, '', 'utf-8')
  }

  log.info(
    { sessionId: opts.sessionId, projectId: opts.projectId ?? null, provider: opts.provider },
    'Initialized harness session on disk',
  )
}

export interface AppendHarnessTurnOpts {
  sessionId: string
  projectId?: string
  messages: SessionMessage[]
  /** First assistant-text snippet. Used to populate meta.json title on the first turn only. */
  firstTitle?: string
}

/**
 * Append a synthesized turn's messages to messages.jsonl and update
 * meta.json (messageCount, lastActiveAt, title if still empty).
 *
 * Returns false if the session directory is missing — callers should
 * call `ensureHarnessSessionInit` first. This is append-only; it does
 * NOT rewrite the existing file, so large conversations stay cheap.
 */
export function appendHarnessTurn(opts: AppendHarnessTurnOpts): boolean {
  const dir = resolveSessionDir(opts.sessionId, opts.projectId)
  if (!existsSync(dir)) {
    log.warn({ sessionId: opts.sessionId }, 'append called but session dir missing')
    return false
  }

  const msgsPath = join(dir, 'messages.jsonl')
  if (opts.messages.length > 0) {
    const lines = opts.messages.map((m) => JSON.stringify(m)).join('\n')
    appendFileSync(msgsPath, `${lines}\n`, 'utf-8')
  }

  const metaPath = join(dir, 'meta.json')
  if (existsSync(metaPath)) {
    try {
      const meta: SessionMeta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      meta.messageCount = (meta.messageCount ?? 0) + opts.messages.length
      meta.lastActiveAt = Date.now()
      if (!meta.title && opts.firstTitle) {
        meta.title = opts.firstTitle.slice(0, 60).split('\n')[0]
      }
      writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch (err) {
      log.warn({ err, sessionId: opts.sessionId }, 'failed to update meta.json')
    }
  }

  return true
}

// ── Internal helpers ───────────────────────────────────────────────

function resolveSessionDir(sessionId: string, projectId?: string): string {
  if (projectId) {
    return join(getProjectSessionsDir(projectId), sessionId)
  }
  return getConversationDir(sessionId)
}
