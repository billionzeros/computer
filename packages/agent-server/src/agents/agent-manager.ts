/**
 * AgentManager — manages agents as conversations with metadata.
 *
 * An agent is just a conversation directory with an agent.json sidecar.
 * Running an agent = sending a message to its conversation.
 * Scheduling = cron check every 30s, same as before.
 *
 * This replaces the 689-line JobManager with ~200 lines.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  deleteAgentSession,
  getProjectSessionsDir,
  listProjectAgents,
  loadAgentMemory,
  saveAgentMemory,
  saveAgentMetadata,
} from '@anton/agent-config'
import { createLogger } from '@anton/logger'
import type { AgentMetadata, AgentRunRecord, AgentSession } from '@anton/protocol'
import { getNextCronTime, isValidCron } from './cron.js'

function generateSessionId(projectId: string): string {
  const suffix = `${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
  // Use -- as delimiter between prefix, projectId, and suffix
  // This avoids regex ambiguity since projectId may contain underscores
  return `agent--${projectId}--${suffix}`
}

/**
 * Callback to run an agent. Creates a fresh ephemeral session per run.
 * Returns event count, assistant summary, and the run's session ID.
 */
export type SendMessageHandler = (
  agentSessionId: string,
  content: string,
  agentInstructions: string,
  agentMemory: string | null,
) => Promise<{ eventCount: number; summary: string; runSessionId: string }>

export type AgentEventCallback = (event: AgentEvent) => void

export interface AgentEvent {
  type: 'agent_updated' | 'agent_deleted'
  agent?: AgentSession
  projectId?: string
  sessionId?: string
}

const log = createLogger('agent-manager')

export class AgentManager {
  private agents: Map<string, AgentSession> = new Map() // sessionId → AgentSession
  private running = false
  private timer: NodeJS.Timeout | null = null
  private sendMessage: SendMessageHandler | null = null
  private onEvent: AgentEventCallback

  constructor(onEvent: AgentEventCallback) {
    this.onEvent = onEvent
  }

  setSendMessageHandler(handler: SendMessageHandler): void {
    this.sendMessage = handler
  }

  // ── Loading ──────────────────────────────────────────────────────

  /** Load all agents from all projects on startup */
  loadAll(projectIds: string[]): void {
    for (const projectId of projectIds) {
      const agents = listProjectAgents(projectId)
      for (const agent of agents) {
        // Reset running state (process gone after restart)
        if (agent.agent.status === 'running') {
          agent.agent.status = 'idle'
          saveAgentMetadata(agent.projectId, agent.sessionId, agent.agent)
        }
        // Recompute nextRunAt for scheduled agents
        if (agent.agent.schedule?.cron && agent.agent.status !== 'paused') {
          const next = getNextCronTime(agent.agent.schedule.cron)
          agent.agent.nextRunAt = next ? next.getTime() : null
        }
        this.agents.set(agent.sessionId, agent)
      }
    }
    if (this.agents.size > 0) {
      log.info({ count: this.agents.size }, 'agents loaded')
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────

  createAgent(
    projectId: string,
    spec: {
      name: string
      description?: string
      instructions: string
      schedule?: string // cron expression
      originConversationId?: string
    },
  ): AgentSession {
    const sessionId = generateSessionId(projectId)
    const now = Date.now()

    // Validate cron if provided
    if (spec.schedule && !isValidCron(spec.schedule)) {
      throw new Error(`Invalid cron expression: ${spec.schedule}`)
    }

    const agent: AgentMetadata = {
      name: spec.name,
      description: spec.description ?? '',
      instructions: spec.instructions,
      schedule: spec.schedule ? { cron: spec.schedule } : undefined,
      originConversationId: spec.originConversationId,
      tokenBudget: {
        perRun: 200_000, // default 200k
        monthly: 0, // unlimited
        usedThisMonth: 0,
      },
      status: 'idle',
      lastRunAt: null,
      nextRunAt: spec.schedule ? (getNextCronTime(spec.schedule)?.getTime() ?? null) : null,
      runCount: 0,
      createdAt: now,
    }

    // Create conversation directory
    const dir = join(getProjectSessionsDir(projectId), sessionId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // Save agent.json
    saveAgentMetadata(projectId, sessionId, agent)

    const session: AgentSession = {
      sessionId,
      projectId,
      agent,
      title: spec.name,
      lastActiveAt: now,
    }

    this.agents.set(sessionId, session)
    return session
  }

  deleteAgent(sessionId: string): boolean {
    const agent = this.agents.get(sessionId)
    if (!agent) return false

    // Remove from disk (conversation directory + agent.json)
    deleteAgentSession(agent.projectId, sessionId)
    this.agents.delete(sessionId)
    return true
  }

  getAgent(sessionId: string): AgentSession | undefined {
    return this.agents.get(sessionId)
  }

  listAgents(projectId: string): AgentSession[] {
    return Array.from(this.agents.values()).filter((a) => a.projectId === projectId)
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async runAgent(
    sessionId: string,
    trigger: 'cron' | 'manual' = 'manual',
  ): Promise<AgentSession | undefined> {
    const entry = this.agents.get(sessionId)
    if (!entry) return undefined
    if (entry.agent.status === 'running') return entry // already running

    if (!this.sendMessage) {
      log.error({ agent: entry.agent.name }, 'no sendMessage handler set')
      return undefined
    }

    // Start a run record
    const runRecord: AgentRunRecord = {
      startedAt: Date.now(),
      completedAt: null,
      status: 'success',
      trigger,
    }

    // Update status
    entry.agent.status = 'running'
    saveAgentMetadata(entry.projectId, sessionId, entry.agent)
    this.emitUpdate(entry)

    try {
      // Load agent memory from previous runs
      const agentMemory = loadAgentMemory(entry.projectId, sessionId)

      // Build trigger message
      const isFirstRun = entry.agent.runCount === 0
      const now = new Date()
      const timestamp = `${now.toISOString().replace('T', ' ').slice(0, 19)} UTC`
      const message = isFirstRun
        ? `[Run #1 — ${timestamp}] This is your first run. Execute your instructions. Build any scripts or tooling you need, then deliver results.\n\nIMPORTANT: At the end of your run, write a concise summary of what you did and what you built (file paths, script names, key outcomes). This will be saved as your memory for future runs.`
        : `[Run #${entry.agent.runCount + 1} — ${timestamp}] Scheduled run. Your instructions and memory from previous runs are in your system prompt. Re-use existing scripts and tooling. Execute your task and deliver results.\n\nIMPORTANT: At the end of your run, write a concise summary of what you did. This will be saved as your memory for future runs.`

      // Each run creates a fresh session — no accumulated context bloat
      const result = await this.sendMessage(
        sessionId,
        message,
        entry.agent.instructions,
        agentMemory,
      )
      runRecord.runSessionId = result.runSessionId

      // Check if the LLM actually ran
      if (result.eventCount === 0) {
        log.warn({ agent: entry.agent.name }, '0 events produced — run failed silently')
        entry.agent.status = 'error'
        entry.agent.lastRunAt = Date.now()
        runRecord.status = 'error'
        runRecord.error =
          'No events produced — LLM may not have been called. Check API key or session state.'
      } else {
        // Run completed successfully
        entry.agent.status = 'idle'
        entry.agent.lastRunAt = Date.now()
        entry.agent.runCount++
        runRecord.status = 'success'

        // Save the assistant's summary as agent memory for next run
        if (result.summary) {
          const memory = result.summary.slice(0, 2000)
          saveAgentMemory(entry.projectId, sessionId, memory)
        }
      }
    } catch (err) {
      // Note: runRecord.runSessionId may be undefined here if sendMessage threw.
      // This is acceptable — failed runs with no session have no logs to view.
      log.error({ agent: entry.agent.name, err }, 'agent run error')
      entry.agent.status = 'error'
      entry.agent.lastRunAt = Date.now()
      runRecord.status = 'error'
      runRecord.error = err instanceof Error ? err.message : String(err)
    }

    // Finalize run record
    runRecord.completedAt = Date.now()
    runRecord.durationMs = runRecord.completedAt - runRecord.startedAt

    // Append to run history (cap at 20)
    if (!entry.agent.runHistory) entry.agent.runHistory = []
    entry.agent.runHistory.push(runRecord)
    if (entry.agent.runHistory.length > 20) {
      entry.agent.runHistory = entry.agent.runHistory.slice(-20)
    }

    // Recompute next run
    if (entry.agent.schedule?.cron) {
      const next = getNextCronTime(entry.agent.schedule.cron)
      entry.agent.nextRunAt = next ? next.getTime() : null
    }

    saveAgentMetadata(entry.projectId, sessionId, entry.agent)
    this.emitUpdate(entry)
    return entry
  }

  stopAgent(sessionId: string): AgentSession | undefined {
    const entry = this.agents.get(sessionId)
    if (!entry) return undefined

    entry.agent.status = 'idle'
    saveAgentMetadata(entry.projectId, sessionId, entry.agent)
    this.emitUpdate(entry)
    return entry
  }

  pauseAgent(sessionId: string): AgentSession | undefined {
    const entry = this.agents.get(sessionId)
    if (!entry) return undefined

    entry.agent.status = 'paused'
    entry.agent.nextRunAt = null
    saveAgentMetadata(entry.projectId, sessionId, entry.agent)
    this.emitUpdate(entry)
    return entry
  }

  resumeAgent(sessionId: string): AgentSession | undefined {
    const entry = this.agents.get(sessionId)
    if (!entry) return undefined

    entry.agent.status = 'idle'
    if (entry.agent.schedule?.cron) {
      const next = getNextCronTime(entry.agent.schedule.cron)
      entry.agent.nextRunAt = next ? next.getTime() : null
    }
    saveAgentMetadata(entry.projectId, sessionId, entry.agent)
    this.emitUpdate(entry)
    return entry
  }

  // ── Scheduling ───────────────────────────────────────────────────

  start(): void {
    this.running = true
    this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    const now = Date.now()

    // Collect due agents first, then run sequentially (avoids concurrent metadata writes)
    const due: string[] = []
    for (const entry of this.agents.values()) {
      if (entry.agent.status === 'paused') continue
      if (!entry.agent.schedule?.cron) continue
      if (!entry.agent.nextRunAt || now < entry.agent.nextRunAt) continue
      if (entry.agent.status === 'running') continue
      due.push(entry.sessionId)
    }

    for (const sessionId of due) {
      const entry = this.agents.get(sessionId)
      if (!entry || entry.agent.status === 'running') continue // double-check before running
      log.info({ agent: entry.agent.name }, 'cron trigger')
      await this.runAgent(sessionId, 'cron')
    }

    this.timer = setTimeout(() => this.tick(), 30_000)
  }

  // ── Events ───────────────────────────────────────────────────────

  private emitUpdate(entry: AgentSession): void {
    this.onEvent({ type: 'agent_updated', agent: entry })
  }

  // ── Shutdown ─────────────────────────────────────────────────────

  shutdown(): void {
    this.stop()
  }
}
