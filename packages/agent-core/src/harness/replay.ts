/**
 * Replay seed — compacts a harness session's prior messages.jsonl into
 * a string the new provider can read on the first turn after a
 * provider-switch.
 *
 * Use case: the user switches a harness conversation from Codex to
 * Claude Code (or vice versa). The old CLI's internal --resume tape
 * is worthless to the new CLI, so we replay from our own mirror. The
 * seed is prepended as a <system-reminder># Prior Conversation block
 * on the first turn of the new provider; subsequent turns rely on the
 * new provider's own --resume.
 *
 * Format choices:
 *   • Readable text with XML framing. Claude leans on XML; Codex
 *     tolerates it fine. Both see structured sections as distinct.
 *   • Tool results are truncated aggressively (default 400 chars each).
 *     Full results live in the mirror if anyone needs to recover them.
 *   • Messages are walked oldest → newest. If the combined size
 *     exceeds `maxChars`, we drop OLDER turns first and prepend a
 *     "[earlier history omitted]" marker. The most recent turns are
 *     what matter most for continuation.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConversationDir, getProjectSessionsDir } from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import { systemReminder } from '../prompt-layers.js'

const log = createLogger('harness-replay')

export interface BuildReplaySeedOpts {
  sessionId: string
  projectId?: string
  /** Truncation cap per tool_result (chars). Default 400. */
  toolResultMaxChars?: number
  /** Overall cap on the rendered seed. Older turns drop first. Default 12000. */
  maxChars?: number
}

/**
 * Read messages.jsonl for a harness session and render a compact
 * prior-conversation block suitable for injection into a new
 * provider's system prompt. Returns empty string if no history exists
 * (first turn ever, or mirror files missing).
 */
export function buildReplaySeed(opts: BuildReplaySeedOpts): string {
  const { sessionId, projectId } = opts
  const toolResultMax = opts.toolResultMaxChars ?? 400
  const maxChars = opts.maxChars ?? 12_000

  const dir = projectId
    ? join(getProjectSessionsDir(projectId), sessionId)
    : getConversationDir(sessionId)
  const msgsPath = join(dir, 'messages.jsonl')
  if (!existsSync(msgsPath)) return ''

  let raw: string
  try {
    raw = readFileSync(msgsPath, 'utf-8')
  } catch (err) {
    log.warn({ err, sessionId }, 'failed to read messages.jsonl for replay')
    return ''
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return ''

  // Parse once; format per turn. A "turn" = one user message plus the
  // following assistant+tool messages up to the next user message.
  interface Msg {
    role: string
    content: unknown
  }
  const msgs: Msg[] = []
  for (const line of lines) {
    try {
      const m = JSON.parse(line) as Msg
      if (typeof m.role === 'string') msgs.push(m)
    } catch {
      // skip malformed lines — mirror is append-only, any corruption is
      // a bug elsewhere but shouldn't block the replay.
    }
  }
  if (msgs.length === 0) return ''

  // Group into turns
  type Turn = { user?: Msg; assistantAndTools: Msg[] }
  const turns: Turn[] = []
  let cur: Turn | null = null
  for (const m of msgs) {
    if (m.role === 'user') {
      if (cur) turns.push(cur)
      cur = { user: m, assistantAndTools: [] }
    } else if (cur) {
      cur.assistantAndTools.push(m)
    }
    // Orphaned assistant/tool before the first user is ignored —
    // shouldn't happen with our mirror, but defensive.
  }
  if (cur) turns.push(cur)
  if (turns.length === 0) return ''

  // Render each turn to text
  const renderedTurns = turns.map((turn, idx) => renderTurn(turn, idx + 1, toolResultMax))

  // Fit within maxChars, dropping oldest turns first
  let combined = renderedTurns.join('\n\n')
  let omitted = 0
  let working = renderedTurns.slice()
  while (combined.length > maxChars && working.length > 1) {
    working = working.slice(1)
    omitted++
    combined = working.join('\n\n')
  }

  const header =
    omitted > 0
      ? `This session has prior history from an earlier provider. ${omitted} older turn(s) omitted for length; most recent turns follow.`
      : 'This session has prior history from an earlier provider. All prior turns follow.'

  const body = `${header}\n\n${combined}\n\nContinue the conversation from here. Anton's memory, project context, and connected services are the same as before — the mirror preserves them across providers.`

  return systemReminder('Prior Conversation', body)
}

// ── Turn rendering ─────────────────────────────────────────────────

interface Msg {
  role: string
  content: unknown
}

interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  name?: string
  input?: unknown
  id?: string
  tool_use_id?: string
  content?: string
  is_error?: boolean
}

function renderTurn(
  turn: { user?: Msg; assistantAndTools: Msg[] },
  index: number,
  toolResultMax: number,
): string {
  const parts: string[] = [`<turn index="${index}">`]

  if (turn.user) {
    const text = extractText(turn.user.content)
    if (text) parts.push(`  <user>${escapeXml(text)}</user>`)
  }

  // Pair assistant messages with any following tool messages
  const toolUseNames = new Map<string, string>()
  for (const m of turn.assistantAndTools) {
    const blocks = asBlocks(m.content)
    if (m.role === 'assistant') {
      const lines: string[] = []
      for (const b of blocks) {
        if (b.type === 'thinking' && b.thinking) {
          lines.push(`    [thinking] ${oneLine(b.thinking, 200)}`)
        } else if (b.type === 'text' && b.text) {
          lines.push(`    ${oneLine(b.text, 500)}`)
        } else if (b.type === 'tool_use' && b.id && b.name) {
          toolUseNames.set(b.id, b.name)
          const inp = b.input ? oneLine(JSON.stringify(b.input), 200) : ''
          lines.push(`    [tool_call ${b.name}${inp ? ` input=${inp}` : ''} id=${b.id}]`)
        }
      }
      if (lines.length > 0) {
        parts.push('  <assistant>')
        parts.push(lines.join('\n'))
        parts.push('  </assistant>')
      }
    } else if (m.role === 'tool') {
      for (const b of blocks) {
        if (b.type === 'tool_result' && b.tool_use_id) {
          const name = toolUseNames.get(b.tool_use_id) ?? '?'
          const out = typeof b.content === 'string' ? truncate(b.content, toolResultMax) : ''
          const flag = b.is_error ? ' error' : ''
          parts.push(`  <tool_result for="${name}"${flag}>${escapeXml(out)}</tool_result>`)
        }
      }
    }
  }

  parts.push('</turn>')
  return parts.join('\n')
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  const blocks = asBlocks(content)
  return blocks
    .filter(
      (b): b is ContentBlock & { type: 'text'; text: string } =>
        b.type === 'text' && typeof b.text === 'string',
    )
    .map((b) => b.text)
    .join('\n')
}

function asBlocks(content: unknown): ContentBlock[] {
  if (Array.isArray(content)) {
    return content.filter((c): c is ContentBlock => typeof c === 'object' && c !== null)
  }
  return []
}

function oneLine(s: string, max: number): string {
  return truncate(s.replace(/\s+/g, ' ').trim(), max)
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}… [${s.length - max} more chars]`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
