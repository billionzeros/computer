/**
 * HarnessAdapter — interface for CLI-based LLM providers.
 *
 * Each adapter knows how to spawn, configure, and parse output from
 * a specific CLI tool (e.g. `claude`, `chatgpt`).
 */

import type { SessionEvent } from '../session.js'

export interface SpawnOpts {
  message: string
  mcpConfigPath?: string
  model?: string
  resumeSessionId?: string
  systemPrompt?: string
  maxBudgetUsd?: number
  cwd?: string
  /** Path to the MCP shim script (for adapters that register MCP inline) */
  shimPath?: string
  /** Unix socket path for MCP IPC (for adapters that register MCP inline) */
  socketPath?: string
  /** Session ID for MCP IPC (for adapters that register MCP inline) */
  sessionId?: string
}

export interface EnvOpts {
  socketPath: string
  sessionId: string
}

export interface DetectResult {
  installed: boolean
  version?: string
  auth?: {
    loggedIn: boolean
    email?: string
    subscriptionType?: string
    authMethod?: string
  }
}

export interface HarnessAdapter {
  /** Unique identifier for this adapter (e.g. 'claude-code') */
  readonly id: string
  /** Human-readable name (e.g. 'Claude Code') */
  readonly name: string
  /** CLI command to spawn (e.g. 'claude') */
  readonly command: string

  /** Check if the CLI is installed and return its version */
  detect(): Promise<DetectResult>

  /** Build the argument array for spawning the CLI process */
  buildSpawnArgs(opts: SpawnOpts): string[]

  /** Build environment variables for the CLI process */
  buildEnv(opts: EnvOpts): Record<string, string>

  /** Parse a single NDJSON line into zero or more SessionEvents */
  parseEvent(line: string): SessionEvent[]

  /** Extract the CLI's internal session ID from a parsed event (for --resume) */
  extractSessionId(event: unknown): string | null
}
