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
import type { RoutineMetadata, RoutineRunRecord, RoutineSession } from '@anton/protocol'
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
 *
 * `provider`/`model` come from the routine's metadata. When unset the
 * handler falls back to `config.defaults`. The handler is responsible
 * for branching on provider type (Pi SDK vs harness CLI).
 */
export type SendMessageHandler = (
  agentSessionId: string,
  content: string,
  agentInstructions: string,
  agentMemory: string | null,
  provider?: string,
  model?: string,
) => Promise<{ eventCount: number; summary: string; runSessionId: string }>

export type AgentEventCallback = (event: AgentEvent) => void

export interface AgentEvent {
  type: 'routine_updated' | 'routine_deleted'
  routine?: RoutineSession
  projectId?: string
  sessionId?: string
}

const log = createLogger('agent-manager')

export class AgentManager {
  private agents: Map<string, RoutineSession> = new Map() // sessionId → RoutineSession
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
      provider?: string
      model?: string
      workflowId?: string
      workflowAgentKey?: string
    },
  ): RoutineSession {
    const sessionId = generateSessionId(projectId)
    const now = Date.now()

    // Validate cron if provided
    if (spec.schedule && !isValidCron(spec.schedule)) {
      throw new Error(`Invalid cron expression: ${spec.schedule}`)
    }

    const agent: RoutineMetadata = {
      name: spec.name,
      description: spec.description ?? '',
      instructions: spec.instructions,
      provider: spec.provider,
      model: spec.model,
      workflowId: spec.workflowId,
      workflowAgentKey: spec.workflowAgentKey,
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

    const session: RoutineSession = {
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

  updateAgent(
    sessionId: string,
    patch: {
      name?: string
      description?: string
      instructions?: string
      schedule?: string | null
      provider?: string | null
      model?: string | null
    },
  ): RoutineSession | undefined {
    const entry = this.agents.get(sessionId)
    if (!entry) return undefined

    if (patch.name !== undefined) entry.agent.name = patch.name
    if (patch.description !== undefined) entry.agent.description = patch.description
    if (patch.instructions !== undefined) entry.agent.instructions = patch.instructions

    // Tri-state: undefined = no change, null = clear to default, string = set.
    if (patch.provider !== undefined) {
      entry.agent.provider = patch.provider ?? undefined
    }
    if (patch.model !== undefined) {
      entry.agent.model = patch.model ?? undefined
    }

    if (patch.schedule !== undefined) {
      if (patch.schedule === null || patch.schedule === '') {
        entry.agent.schedule = undefined
        entry.agent.nextRunAt = null
      } else {
        if (!isValidCron(patch.schedule)) {
          throw new Error(`Invalid cron expression: ${patch.schedule}`)
        }
        entry.agent.schedule = { cron: patch.schedule }
        if (entry.agent.status !== 'paused') {
          const next = getNextCronTime(patch.schedule)
          entry.agent.nextRunAt = next ? next.getTime() : null
        }
      }
    }

    if (patch.name !== undefined) entry.title = patch.name

    saveAgentMetadata(entry.projectId, sessionId, entry.agent)
    this.emitUpdate(entry)
    return entry
  }

  getAgent(sessionId: string): RoutineSession | undefined {
    return this.agents.get(sessionId)
  }

  listAgents(projectId: string): RoutineSession[] {
    return Array.from(this.agents.values()).filter((a) => a.projectId === projectId)
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async runAgent(
    sessionId: string,
    trigger: 'cron' | 'manual' = 'manual',
  ): Promise<RoutineSession | undefined> {
    const entry = this.agents.get(sessionId)
    if (!entry) return undefined
    if (entry.agent.status === 'running') return entry // already running

    if (!this.sendMessage) {
      log.error({ agent: entry.agent.name }, 'no sendMessage handler set')
      return undefined
    }

    // Start a run record
    const runRecord: RoutineRunRecord = {
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

      // Each run creates a fresh session — no accumulated context bloat.
      // Pass the routine's pinned provider/model so harness-only models
      // (e.g. codex/gpt-5.4) land on the CLI path instead of Pi SDK.
      const result = await this.sendMessage(
        sessionId,
        message,
        entry.agent.instructions,
        agentMemory,
        entry.agent.provider,
        entry.agent.model,
      )
      runRecord.runSessionId = result.runSessionId

      // Check if the LLM actually ran
      if (result.eventCount === 0) {
        log.warn(
          { agent: entry.agent.name, provider: entry.agent.provider, model: entry.agent.model },
          '0 events produced — run failed silently',
        )
        entry.agent.status = 'error'
        entry.agent.lastRunAt = Date.now()
        runRecord.status = 'error'
        runRecord.error = entry.agent.provider
          ? `No events produced on ${entry.agent.provider}/${entry.agent.model}. Check provider credentials or confirm the CLI/API is reachable.`
          : 'No events produced — LLM may not have been called. Check API key or session state.'
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

  stopAgent(sessionId: string): RoutineSession | undefined {
    const entry = this.agents.get(sessionId)
    if (!entry) return undefined

    entry.agent.status = 'idle'
    saveAgentMetadata(entry.projectId, sessionId, entry.agent)
    this.emitUpdate(entry)
    return entry
  }

  pauseAgent(sessionId: string): RoutineSession | undefined {
    const entry = this.agents.get(sessionId)
    if (!entry) return undefined

    entry.agent.status = 'paused'
    entry.agent.nextRunAt = null
    saveAgentMetadata(entry.projectId, sessionId, entry.agent)
    this.emitUpdate(entry)
    return entry
  }

  resumeAgent(sessionId: string): RoutineSession | undefined {
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

  private emitUpdate(entry: RoutineSession): void {
    this.onEvent({ type: 'routine_updated', routine: entry })
  }

  // ── Shutdown ─────────────────────────────────────────────────────

  shutdown(): void {
    this.stop()
  }
}
