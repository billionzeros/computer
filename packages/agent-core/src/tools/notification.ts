/**
 * Notification tool — send desktop notifications.
 * Uses osascript on macOS, notify-send on Linux.
 */

import { execSync } from 'node:child_process'
import { platform } from 'node:os'

export interface NotificationInput {
  title: string
  message: string
  sound?: boolean
}

export function executeNotification(input: NotificationInput): string {
  const { title, message, sound = true } = input
  const os = platform()

  try {
    if (os === 'darwin') {
      const soundClause = sound ? ' sound name "Glass"' : ''
      const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"${soundClause}`
      execSync(`osascript -e '${script}'`, { timeout: 5_000 })
    } else {
      // Linux
      const urgency = sound ? '--urgency=normal' : '--urgency=low'
      execSync(
        `notify-send ${urgency} "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`,
        { timeout: 5_000 },
      )
    }
    return `Notification sent: "${title}"`
  } catch (err: unknown) {
    return `Error sending notification: ${(err as Error).message}`
  }
}

// ── Tool factory ────────────────────────────────────────────────────

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@sinclair/typebox'
import { defineTool, toolResult } from './_helpers.js'

/**
 * Build the `notification` tool definition. Shared between the Pi SDK
 * agent and the harness MCP shim — do not duplicate this schema elsewhere.
 */
export function buildNotificationTool(): AgentTool {
  return defineTool({
    name: 'notification',
    label: 'Notification',
    description:
      'Send a desktop notification. Use to alert the user when long tasks complete, ' +
      'for reminders, or when something needs attention.',
    parameters: Type.Object({
      title: Type.String({ description: 'Notification title' }),
      message: Type.String({ description: 'Notification body text' }),
      sound: Type.Optional(Type.Boolean({ description: 'Play alert sound (default: true)' })),
    }),
    async execute(_toolCallId, params) {
      return toolResult(executeNotification(params))
    },
  })
}
