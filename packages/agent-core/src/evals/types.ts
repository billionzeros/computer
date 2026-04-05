/**
 * Shared types for the Anton eval harness.
 */

/** A single test case in an eval dataset. */
export interface EvalCase {
  /** User message / task description sent to the agent. */
  input: string
  /** Expected output text (for factuality scoring). */
  expected?: string
  /** Expected first tool the agent should call (for tool selection scoring). */
  expectedTool?: string
  /** Acceptable alternative tools (scored lower than exact match). */
  acceptableTools?: string[]
  /** Whether the agent should refuse this request (for safety scoring). */
  expectedRefusal?: boolean
  /** Freeform metadata for filtering and analysis. */
  metadata?: Record<string, unknown>
  /** Tags for grouping eval cases (e.g. "filesystem", "web", "dangerous"). */
  tags?: string[]
}

/** A named collection of eval cases. */
export interface EvalDataset {
  name: string
  description: string
  cases: EvalCase[]
}

// ── Workflow eval types ─────────────────────────────────────────────

/** A workflow-specific eval case with structured expectations. */
export interface WorkflowEvalCase extends EvalCase {
  /** Workflow ID (e.g. "lead-qualification"). */
  workflowId?: string
  /** Agent key within the workflow (e.g. "lead-scanner"). */
  agentKey?: string
  /** Expected extracted fields — scored by fraction found in output. */
  expectedFields?: Record<string, string>
  /** Expected score range [min, max] — scored by proximity. */
  expectedScoreRange?: [number, number]
  /** Expected classification tier (e.g. "hot", "warm", "cool", "skip"). */
  expectedTier?: string
  /** Quality criteria the output should satisfy (for LLM-as-judge scoring). */
  qualityCriteria?: string[]
}

/** Result from a workflow eval with parsed structured data. */
export interface WorkflowEvalResult extends EvalResult {
  /** Fields parsed from the agent's output. */
  parsedFields?: Record<string, string>
  /** Score parsed from the agent's output. */
  parsedScore?: number
  /** Tier parsed from the agent's output. */
  parsedTier?: string
}

// ── Base eval types ─────────────────────────────────────────────────

/** Result from running a single eval case through the agent. */
export interface EvalResult {
  /** The user input that was sent. */
  input: string
  /** The agent's text response. */
  output: string
  /** Name of the first tool the agent called (if any). */
  firstToolCall?: string
  /** All tool calls made during this eval run. */
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>
  /** Whether the agent produced an error. */
  hadError: boolean
  /** Raw session events for deep analysis. */
  events: Array<{ type: string; [key: string]: unknown }>
}
