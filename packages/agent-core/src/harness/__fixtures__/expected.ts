/**
 * Expected SessionEvent[] for each NDJSON fixture. Kept inline so the
 * check script doesn't depend on Vitest / Jest / snapshots.
 *
 * Whenever you capture a new fixture, append it here and add an entry to
 * the `cases` array in check.ts.
 */

import type { SessionEvent } from '../../session.js'

export const claudeSimpleExpected: SessionEvent[] = [
  { type: 'text', content: 'Hello! How can I help?' },
  {
    type: 'done',
    usage: {
      inputTokens: 120,
      outputTokens: 8,
      totalTokens: 128,
      cacheReadTokens: 50,
      cacheWriteTokens: 70,
    },
  },
]

export const claudeToolCallExpected: SessionEvent[] = [
  { type: 'thinking', text: 'I should list the files.' },
  {
    type: 'tool_call',
    id: 'toolu_1',
    name: 'Bash',
    input: { command: 'ls' },
  },
  // The `user` event carrying the tool_result is not parsed by ClaudeAdapter
  // today (only assistant/system/result branches exist). If that changes,
  // this fixture will flag it as a diff.
  { type: 'text', content: 'Two files.' },
  {
    type: 'done',
    usage: {
      inputTokens: 150,
      outputTokens: 44,
      totalTokens: 194,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  },
]

export const claudeErrorExpected: SessionEvent[] = [
  { type: 'error', message: 'authentication failed', code: 'not_authed' },
  {
    type: 'done',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  },
]

export const codexSimpleExpected: SessionEvent[] = [
  { type: 'text', content: 'Hello from Codex.' },
  {
    type: 'done',
    usage: {
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
      cacheReadTokens: 30,
      cacheWriteTokens: 0,
    },
  },
]

export const codexToolCallExpected: SessionEvent[] = [
  {
    type: 'tool_call',
    id: 'cmd_1',
    name: 'shell',
    input: { command: 'ls' },
  },
  {
    type: 'tool_result',
    id: 'cmd_1',
    output: 'file1.txt\nfile2.txt',
    isError: false,
  },
  {
    type: 'tool_call',
    id: 'mcp_1',
    name: 'anton:memory_save',
    input: { key: 'notes', value: 'x' },
  },
  {
    type: 'tool_result',
    id: 'mcp_1',
    output: 'saved',
    isError: false,
  },
  { type: 'text', content: 'Done.' },
  {
    type: 'done',
    usage: {
      inputTokens: 200,
      outputTokens: 10,
      totalTokens: 210,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  },
]

export const codexErrorExpected: SessionEvent[] = [
  { type: 'error', message: 'stream error: 401 Unauthorized', code: 'not_authed' },
]
