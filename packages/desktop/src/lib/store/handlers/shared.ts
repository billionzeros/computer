/**
 * Shared utilities for message handlers.
 * Provides session routing helpers used by all AI channel handlers.
 */

import type { ChatMessage } from '../types.js'
import type { WsPayload } from '../../connection.js'

export interface MessageContext {
  /** Session ID from the message, if any */
  msgSessionId: string | undefined
  /** Whether this message is for the currently active conversation */
  isForActiveSession: boolean
  /** Add a message to the correct conversation (active or by sessionId) */
  addMsg: (msg: ChatMessage) => void
  /** Append text to the current assistant message in the correct conversation */
  appendText: (content: string) => void
  /** The raw WS payload */
  msg: WsPayload
}
