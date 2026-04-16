/**
 * Background memory extraction for harness sessions.
 *
 * Pi SDK sessions get this for free via `session.maybeExtractMemories()`
 * which runs fire-and-forget after every turn. Harness sessions don't
 * maintain an in-memory Session instance, so we read the mirrored
 * messages.jsonl instead and feed the same extractMemories() pipeline.
 *
 * Flow:
 *   1. Read messages.jsonl → AgentMessage[] (mirror shape is
 *      pi-ai-compatible already, so this is a straight JSON.parse)
 *   2. Slice off anything before sinceIndex (the caller keeps a cursor
 *      in memory, advanced after each successful extraction)
 *   3. Delegate to the existing extractMemories() which calls a cheap
 *      LLM to pull out durable memories and writes them to disk
 *   4. Return the new cursor value (messages.length) so the caller
 *      can advance it
 *
 * Designed to be fire-and-forget from the server's onTurnEnd hook.
 * Errors are logged and swallowed — a failed extraction should never
 * affect the user-facing turn.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConversationDir, getProjectSessionsDir } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { type ExtractionResult, extractMemories } from '../memory-extraction.js'

const log = createLogger('harness-memory-extract')

/**
 * Load a harness session's full message history from messages.jsonl
 * in pi-ai AgentMessage shape. Silently returns [] if the mirror
 * doesn't exist yet.
 */
function readMirrorAsAgentMessages(sessionId: string, projectId?: string): AgentMessage[] {
  const dir = projectId
    ? join(getProjectSessionsDir(projectId), sessionId)
    : getConversationDir(sessionId)
  const path = join(dir, 'messages.jsonl')
  if (!existsSync(path)) return []

  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    log.warn({ err, sessionId }, 'failed to read messages.jsonl for extraction')
    return []
  }

  const out: AgentMessage[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const m = JSON.parse(t)
      if (m && typeof m === 'object' && typeof m.role === 'string') {
        out.push(m as AgentMessage)
      }
    } catch {
      // mirror is append-only JSONL; a malformed line means someone
      // scribbled by hand or a partial write — skip it.
    }
  }
  return out
}

export interface ExtractHarnessMemoriesOpts {
  sessionId: string
  projectId?: string
  /**
   * Starting index — only messages at or after this index are considered
   * for extraction. The caller maintains the cursor (typically in memory)
   * and advances it after each successful run.
   */
  sinceIndex: number
  /** Provider name (e.g. 'anthropic', 'openai') used for picking a cheap extractor model. */
  provider: string
  /** Resolved Pi SDK Model to fall back to if no cheap extractor matches the provider. */
  fallbackModel: Model<Api>
  /** API-key resolver, same contract as Pi SDK's session extraction. */
  getApiKey: (provider: string) => string | undefined
}

export interface HarnessExtractionResult extends ExtractionResult {
  /**
   * The new cursor value — equals the total message count after
   * extraction. The caller should store this and pass it as
   * `sinceIndex` on the next call.
   */
  newCursor: number
}

/**
 * Run memory extraction over a harness session's recent turns.
 * Reads the mirror, calls the shared extractMemories pipeline, and
 * returns both the result and the advanced cursor.
 *
 * Safe to fire-and-forget — no turn-blocking work happens here.
 */
export async function extractHarnessMemoriesFromMirror(
  opts: ExtractHarnessMemoriesOpts,
): Promise<HarnessExtractionResult> {
  const messages = readMirrorAsAgentMessages(opts.sessionId, opts.projectId)
  if (messages.length === 0) {
    return { memories: [], skipped: true, reason: 'no messages on disk', newCursor: 0 }
  }
  if (messages.length <= opts.sinceIndex) {
    return {
      memories: [],
      skipped: true,
      reason: 'no new messages since last extraction',
      newCursor: messages.length,
    }
  }

  const result = await extractMemories({
    messages,
    sinceIndex: opts.sinceIndex,
    projectId: opts.projectId,
    provider: opts.provider,
    fallbackModel: opts.fallbackModel,
    getApiKey: opts.getApiKey,
  })

  return { ...result, newCursor: messages.length }
}
