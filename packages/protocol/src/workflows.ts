// ── Workflow types ──────────────────────────────────────────────────
//
// A workflow is a directory-based automation package that ships with
// agent prompts, scripts, templates, and config. Installing a workflow
// creates a regular agent with richer context.

// ── Manifest (workflow.json) ────────────────────────────────────────

/** The workflow manifest — declares everything the workflow needs to run */
export interface WorkflowManifest {
  /** Unique identifier (kebab-case, e.g. "lead-qualification") */
  id: string
  /** Display name */
  name: string
  /** Short description of what this workflow does */
  description: string
  /** Semver version */
  version: string
  /** Author name */
  author: string
  /** Category for registry browsing */
  category: string

  /** Which connectors this workflow uses */
  connectors: {
    /** Must be connected before workflow can run */
    required: string[]
    /** Enhances the workflow but not required */
    optional: string[]
  }

  /** Code execution requirements */
  runtime?: {
    /** Needs Python 3.x available */
    python?: boolean
    /** Pip packages the scripts need */
    packages?: string[]
    /** Needs Node.js available */
    node?: boolean
  }

  /** Setup questions asked once during install */
  inputs: WorkflowInput[]

  /** How this workflow gets triggered */
  trigger: {
    /** "schedule" = cron, "manual" = user-triggered only */
    type: 'schedule' | 'manual'
    /** Cron expression (required if type is "schedule") */
    schedule?: string
    /** Human-readable description of the trigger */
    description?: string
  }

  /** Agent definitions — one main orchestrator + optional sub-agents */
  agents: Record<string, WorkflowAgentRef>

  /** Relative paths to template/reference files loaded into agent context */
  resources: string[]

  /**
   * Hooks — pre/post automation on workflow events.
   * Injected into the orchestrator's instructions so the agent
   * knows to run them at the right time.
   */
  hooks?: WorkflowHook[]

  /**
   * When to suggest this workflow — written for the AI, not for humans.
   * Include trigger phrases, scenarios, and keywords so the LLM knows
   * when to recommend this workflow to the user. Injected into system prompt.
   */
  whenToUse?: string

  /**
   * Bootstrap agent — runs ONCE on install as an interactive conversation.
   * Sets up the workflow: creates sheets, tests connectors, collects ICP,
   * does a dry run. Replaces static install forms with an AI-guided onboarding.
   * If not specified, workflow uses static inputs from manifest.inputs instead.
   */
  bootstrap?: {
    /** Path to the bootstrap agent prompt (e.g. "agents/bootstrap.md") */
    file: string
    /** Description shown to user before bootstrap starts */
    description?: string
  }

  /**
   * Preference learning — core pattern for all workflows.
   * During bootstrap, the workflow collects the user's taste/style preferences
   * (e.g. email tone, formality, content style). These are stored in memory
   * and refined over time based on feedback and outcomes.
   *
   * Each entry defines a preference dimension the workflow should learn.
   * The bootstrap agent uses these to guide its onboarding questions.
   * The orchestrator agent uses stored preferences to adapt its behavior.
   */
  preferences?: WorkflowPreference[]
}

// ── Hooks ───────────────────────────────────────────────────────────

/**
 * Hooks are pre/post automation that run around workflow steps.
 * They're defined in the manifest and injected into the orchestrator's
 * instructions so the agent knows to execute them at the right time.
 *
 * Unlike Claude Code's hooks (which are tool-level event handlers),
 * Anton's hooks are declared in the manifest and executed by the agent
 * as part of its workflow — they're instructions, not runtime interceptors.
 * This keeps the system simple: the agent reads the hooks and follows them.
 */
export interface WorkflowHook {
  /** When this hook runs */
  event:
    | 'beforeEmailSend'
    | 'afterLeadScored'
    | 'beforeSheetUpdate'
    | 'afterRun'
    | 'onError'
    | string
  /** What type of hook */
  type: 'script' | 'validate' | 'notify' | 'log'
  /** For script hooks: command to run */
  command?: string
  /** For notify hooks: which channel (slack, email) */
  channel?: string
  /** Condition for the hook to execute (e.g. "score >= 80") */
  condition?: string
  /** Message template for notify/log hooks */
  message?: string
  /** What to do if the hook fails: "skip" (skip the step) | "abort" (stop the run) | "continue" (ignore) */
  failAction?: 'skip' | 'abort' | 'continue'
}

/** A single setup question in the workflow install wizard */
export interface WorkflowInput {
  /** Unique ID used as config key (e.g. "target_sheet") */
  id: string
  /** Input type */
  type: 'text' | 'textarea' | 'number' | 'secret' | 'select'
  /** Display label */
  label: string
  /** Help text shown below the input */
  description?: string
  /** Whether this input is required */
  required?: boolean
  /** Default value */
  default?: string | number | boolean
  /** Options for select type */
  options?: { label: string; value: string }[]
}

/** Reference to an agent prompt file in the workflow directory */
export interface WorkflowAgentRef {
  /** Relative path to the .md file (e.g. "agents/orchestrator.md") */
  file: string
  /** "main" = orchestrator, "sub" = loaded as reference in orchestrator context */
  role: 'main' | 'sub'
  /** Which connectors this agent uses (for documentation, not enforcement) */
  connectors?: string[]
  /** Which scripts this agent may run */
  scripts?: string[]
}

// ── Installed workflow state ────────────────────────────────────────

/** Metadata about a workflow installed in a project */
export interface InstalledWorkflow {
  /** Workflow ID (matches manifest.id) */
  workflowId: string
  /** Project this workflow is installed in */
  projectId: string
  /** The agent session created for this workflow */
  agentSessionId: string
  /** Timestamp of installation */
  installedAt: number
  /** User's answers to manifest.inputs */
  userConfig: Record<string, unknown>
  /** Copy of the manifest at install time */
  manifest: WorkflowManifest
  /** Whether bootstrap setup has been completed */
  bootstrapped: boolean
}

/** A preference dimension the workflow learns from the user */
export interface WorkflowPreference {
  /** Unique ID (e.g. "email_tone", "content_style") */
  id: string
  /** What this preference controls */
  label: string
  /** How to collect this during bootstrap — show samples, ask questions, etc. */
  bootstrapPrompt: string
  /** Example values to show the user during onboarding */
  examples?: string[]
}

// ── Registry types ──────────────────────────────────────────────────

/** Lightweight entry for browsing the workflow registry */
export interface WorkflowRegistryEntry {
  id: string
  name: string
  description: string
  category: string
  connectors: string[]
  runtime?: { python?: boolean; node?: boolean }
  version: string
  author: string
  featured?: boolean
}
