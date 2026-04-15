#!/usr/bin/env node
/**
 * Anton eval CLI entry point.
 *
 * Usage:
 *   pnpm eval                  — run all eval suites
 *   pnpm eval:tools            — run tool selection evals
 *   pnpm eval:safety           — run safety evals
 *   pnpm eval:quality          — run response quality evals
 *   pnpm eval:code             — run code generation evals
 *   pnpm eval:planning         — run task planning evals
 *   pnpm eval:context          — run context awareness evals
 *   pnpm eval:autonomy         — run autonomous orchestration evals
 *   pnpm eval:chat             — run all chat evals (code + planning + context)
 *   pnpm eval -- --dry-run     — validate datasets without running
 *
 * Requires:
 *   BRAINTRUST_API_KEY (env var or config)
 *   A provider API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 */

import { loadConfig } from '@anton/agent-config'
import { initTracing } from '../tracing.js'
import { autonomousOrchestrationDataset } from './datasets/autonomous-orchestration.js'
import { codeGenerationDataset } from './datasets/chat-code-generation.js'
import { contextAwarenessDataset } from './datasets/chat-context-awareness.js'
import { taskPlanningDataset } from './datasets/chat-task-planning.js'
import { multiStepPlanningDataset } from './datasets/multi-step-planning.js'
import { responseQualityDataset } from './datasets/response-quality.js'
import { safetyDataset } from './datasets/safety.js'
import { toolSelectionDataset } from './datasets/tool-selection.js'
import { trajectoryEfficiencyDataset } from './datasets/trajectory-efficiency.js'
import { leadScannerDataset } from './datasets/workflow-lead-scanner.js'
import { leadScorerDataset } from './datasets/workflow-lead-scorer.js'
import { outreachWriterDataset } from './datasets/workflow-outreach-writer.js'
import { runBraintrustEval } from './runner.js'
import { scoreAutonomousTrajectory } from './scorers/autonomous-orchestration.js'
import { scoreCodeGeneration, scoreCodeQuality } from './scorers/chat-code-generation.js'
import { scoreContextAwareness } from './scorers/chat-context-awareness.js'
import { scoreTaskPlanning } from './scorers/chat-task-planning.js'
import { scoreEfficiency } from './scorers/efficiency.js'
import { scoreFactuality, scoreKeywordOverlap } from './scorers/factuality.js'
import { scorePerToolBreakdown } from './scorers/per-tool-breakdown.js'
import { scoreSafety } from './scorers/safety.js'
import { scoreToolSelection } from './scorers/tool-selection.js'
import { scoreTrajectory } from './scorers/trajectory.js'
import { scoreLeadScanner } from './scorers/workflow-lead-scanner.js'
import { scoreLeadScorer } from './scorers/workflow-lead-scorer.js'
import { scoreOutreachQuality, scoreOutreachWriter } from './scorers/workflow-outreach-writer.js'
import type { EvalCase, EvalResult, WorkflowEvalCase, WorkflowEvalResult } from './types.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const suite = args.find((a) => !a.startsWith('--'))

async function main() {
  const config = loadConfig()

  // Initialize tracing for eval logging
  initTracing(config.braintrust)

  if (!process.env.BRAINTRUST_API_KEY && !config.braintrust?.apiKey) {
    if (!dryRun) {
      console.error('[eval] BRAINTRUST_API_KEY is required. Set it as an env var or in config.')
      console.error('[eval] Use --dry-run to validate datasets without Braintrust.')
      process.exit(1)
    }
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace('T', '-')
  const suites: Array<{ name: string; run: () => Promise<void> }> = []

  // ── Tool Selection ──────────────────────────────────────────────
  if (!suite || suite === 'tools' || suite === 'tool-selection') {
    suites.push({
      name: 'tool-selection',
      run: async () => {
        console.log(
          `\n[eval] Running tool-selection (${toolSelectionDataset.cases.length} cases)...`,
        )
        await runBraintrustEval({
          name: `tool-selection-${timestamp}`,
          dataset: toolSelectionDataset,
          config,
          scorers: [
            {
              name: 'tool_selection',
              fn: (c, r) => scoreToolSelection(c, r),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Safety ──────────────────────────────────────────────────────
  if (!suite || suite === 'safety') {
    suites.push({
      name: 'safety',
      run: async () => {
        console.log(`\n[eval] Running safety (${safetyDataset.cases.length} cases)...`)
        await runBraintrustEval({
          name: `safety-${timestamp}`,
          dataset: safetyDataset,
          config,
          scorers: [
            {
              name: 'safety',
              fn: (c, r) => scoreSafety(c, r),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Response Quality ────────────────────────────────────────────
  if (!suite || suite === 'quality' || suite === 'response-quality') {
    suites.push({
      name: 'response-quality',
      run: async () => {
        console.log(
          `\n[eval] Running response-quality (${responseQualityDataset.cases.length} cases)...`,
        )
        await runBraintrustEval({
          name: `response-quality-${timestamp}`,
          dataset: responseQualityDataset,
          config,
          scorers: [
            {
              name: 'factuality',
              fn: (c: EvalCase, r: EvalResult) => scoreFactuality(c, r),
            },
            {
              name: 'keyword_overlap',
              fn: (c: EvalCase, r: EvalResult) => scoreKeywordOverlap(c.expected || '', r.output),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Workflow: Lead Scanner ──────────────────────────────────────
  if (!suite || suite === 'lead-scanner' || suite === 'workflows') {
    suites.push({
      name: 'lead-scanner',
      run: async () => {
        console.log(`\n[eval] Running lead-scanner (${leadScannerDataset.cases.length} cases)...`)
        await runBraintrustEval({
          name: `lead-scanner-${timestamp}`,
          dataset: leadScannerDataset,
          config,
          scorers: [
            {
              name: 'lead_scanner',
              fn: (c: EvalCase, r: EvalResult) =>
                scoreLeadScanner(c as WorkflowEvalCase, r as WorkflowEvalResult),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Workflow: Lead Scorer ─────────────────────────────────────
  if (!suite || suite === 'lead-scorer' || suite === 'workflows') {
    suites.push({
      name: 'lead-scorer',
      run: async () => {
        console.log(`\n[eval] Running lead-scorer (${leadScorerDataset.cases.length} cases)...`)
        await runBraintrustEval({
          name: `lead-scorer-${timestamp}`,
          dataset: leadScorerDataset,
          config,
          scorers: [
            {
              name: 'lead_scorer',
              fn: (c: EvalCase, r: EvalResult) =>
                scoreLeadScorer(c as WorkflowEvalCase, r as WorkflowEvalResult),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Workflow: Outreach Writer ──────────────────────────────────
  if (!suite || suite === 'outreach-writer' || suite === 'workflows') {
    suites.push({
      name: 'outreach-writer',
      run: async () => {
        console.log(
          `\n[eval] Running outreach-writer (${outreachWriterDataset.cases.length} cases)...`,
        )
        await runBraintrustEval({
          name: `outreach-writer-${timestamp}`,
          dataset: outreachWriterDataset,
          config,
          scorers: [
            {
              name: 'outreach_heuristic',
              fn: (c: EvalCase, r: EvalResult) =>
                scoreOutreachWriter(c as WorkflowEvalCase, r as WorkflowEvalResult),
            },
            {
              name: 'outreach_quality',
              fn: (c: EvalCase, r: EvalResult) =>
                scoreOutreachQuality(c as WorkflowEvalCase, r as WorkflowEvalResult),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Chat: Code Generation ──────────────────────────────────────
  if (!suite || suite === 'code' || suite === 'code-generation' || suite === 'chat') {
    suites.push({
      name: 'code-generation',
      run: async () => {
        console.log(
          `\n[eval] Running code-generation (${codeGenerationDataset.cases.length} cases)...`,
        )
        await runBraintrustEval({
          name: `code-generation-${timestamp}`,
          dataset: codeGenerationDataset,
          config,
          scorers: [
            {
              name: 'code_structure',
              fn: (c: EvalCase, r: EvalResult) => scoreCodeGeneration(c, r),
            },
            {
              name: 'code_quality',
              fn: (c: EvalCase, r: EvalResult) => scoreCodeQuality(c, r),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Chat: Task Planning ───────────────────────────────────────
  if (!suite || suite === 'planning' || suite === 'task-planning' || suite === 'chat') {
    suites.push({
      name: 'task-planning',
      run: async () => {
        console.log(`\n[eval] Running task-planning (${taskPlanningDataset.cases.length} cases)...`)
        await runBraintrustEval({
          name: `task-planning-${timestamp}`,
          dataset: taskPlanningDataset,
          config,
          scorers: [
            {
              name: 'task_planning',
              fn: (c: EvalCase, r: EvalResult) => scoreTaskPlanning(c, r),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Chat: Context Awareness ───────────────────────────────────
  if (!suite || suite === 'context' || suite === 'context-awareness' || suite === 'chat') {
    suites.push({
      name: 'context-awareness',
      run: async () => {
        console.log(
          `\n[eval] Running context-awareness (${contextAwarenessDataset.cases.length} cases)...`,
        )
        await runBraintrustEval({
          name: `context-awareness-${timestamp}`,
          dataset: contextAwarenessDataset,
          config,
          scorers: [
            {
              name: 'context_awareness',
              fn: (c: EvalCase, r: EvalResult) => scoreContextAwareness(c, r),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Trajectory Efficiency ────────────────────────────────────
  if (!suite || suite === 'trajectory' || suite === 'trajectory-efficiency') {
    suites.push({
      name: 'trajectory-efficiency',
      run: async () => {
        console.log(
          `\n[eval] Running trajectory-efficiency (${trajectoryEfficiencyDataset.cases.length} cases)...`,
        )
        await runBraintrustEval({
          name: `trajectory-efficiency-${timestamp}`,
          dataset: trajectoryEfficiencyDataset,
          config,
          scorers: [
            {
              name: 'trajectory',
              fn: (c: EvalCase, r: EvalResult) => scoreTrajectory(c, r),
            },
            {
              name: 'efficiency',
              fn: (c: EvalCase, r: EvalResult) => scoreEfficiency(c, r),
            },
            {
              name: 'per_tool_breakdown',
              fn: (c: EvalCase, r: EvalResult) => scorePerToolBreakdown(c, r),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Planning Enforcement ───────────────────────────────────────
  if (!suite || suite === 'planning-enforcement' || suite === 'multi-step-planning') {
    suites.push({
      name: 'multi-step-planning',
      run: async () => {
        console.log(
          `\n[eval] Running multi-step-planning (${multiStepPlanningDataset.cases.length} cases)...`,
        )
        await runBraintrustEval({
          name: `multi-step-planning-${timestamp}`,
          dataset: multiStepPlanningDataset,
          config,
          scorers: [
            {
              name: 'autonomous_trajectory',
              fn: (c: EvalCase, r: EvalResult) => scoreAutonomousTrajectory(c, r),
            },
            {
              name: 'trajectory',
              fn: (c: EvalCase, r: EvalResult) => scoreTrajectory(c, r),
            },
          ],
          dryRun,
        })
      },
    })
  }

  // ── Autonomous Orchestration ──────────────────────────────────
  if (!suite || suite === 'autonomy' || suite === 'autonomous-orchestration') {
    suites.push({
      name: 'autonomous-orchestration',
      run: async () => {
        console.log(
          `\n[eval] Running autonomous-orchestration (${autonomousOrchestrationDataset.cases.length} cases)...`,
        )
        await runBraintrustEval({
          name: `autonomous-orchestration-${timestamp}`,
          dataset: autonomousOrchestrationDataset,
          config,
          scorers: [
            {
              name: 'autonomous_trajectory',
              fn: (c: EvalCase, r: EvalResult) => scoreAutonomousTrajectory(c, r),
            },
          ],
          dryRun,
        })
      },
    })
  }

  if (suites.length === 0) {
    console.error(
      `[eval] Unknown suite: "${suite}". Available: tools, safety, quality, code, planning, context, trajectory, planning-enforcement, autonomy, chat, lead-scanner, lead-scorer, outreach-writer, workflows`,
    )
    process.exit(1)
  }

  console.log(`[eval] Running ${suites.length} eval suite(s)${dryRun ? ' (DRY RUN)' : ''}...`)

  let failures = 0
  for (const s of suites) {
    try {
      await s.run()
      console.log(`[eval] ${s.name}: done`)
    } catch (err) {
      failures++
      console.error(`[eval] ${s.name}: FAILED`, err)
    }
  }

  console.log(`\n[eval] Complete. ${suites.length - failures}/${suites.length} suites passed.`)
  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error('[eval] Fatal error:', err)
  process.exit(1)
})

// Re-export types and datasets for external use
export type {
  EvalCase,
  EvalResult,
  EvalDataset,
  WorkflowEvalCase,
  WorkflowEvalResult,
} from './types.js'
export { toolSelectionDataset } from './datasets/tool-selection.js'
export { responseQualityDataset } from './datasets/response-quality.js'
export { safetyDataset } from './datasets/safety.js'
export { leadScannerDataset } from './datasets/workflow-lead-scanner.js'
export { leadScorerDataset } from './datasets/workflow-lead-scorer.js'
export { outreachWriterDataset } from './datasets/workflow-outreach-writer.js'
export { scoreToolSelection } from './scorers/tool-selection.js'
export { scoreSafety } from './scorers/safety.js'
export { scoreFactuality, scoreKeywordOverlap } from './scorers/factuality.js'
export { scoreLeadScanner } from './scorers/workflow-lead-scanner.js'
export { scoreLeadScorer } from './scorers/workflow-lead-scorer.js'
export { scoreOutreachWriter, scoreOutreachQuality } from './scorers/workflow-outreach-writer.js'
export { codeGenerationDataset } from './datasets/chat-code-generation.js'
export { taskPlanningDataset } from './datasets/chat-task-planning.js'
export { contextAwarenessDataset } from './datasets/chat-context-awareness.js'
export { autonomousOrchestrationDataset } from './datasets/autonomous-orchestration.js'
export { trajectoryEfficiencyDataset } from './datasets/trajectory-efficiency.js'
export { multiStepPlanningDataset } from './datasets/multi-step-planning.js'
export { scoreCodeGeneration, scoreCodeQuality } from './scorers/chat-code-generation.js'
export { scoreTaskPlanning } from './scorers/chat-task-planning.js'
export { scoreContextAwareness } from './scorers/chat-context-awareness.js'
export { scoreAutonomousTrajectory } from './scorers/autonomous-orchestration.js'
export { scoreEfficiency } from './scorers/efficiency.js'
export { scoreTrajectory } from './scorers/trajectory.js'
export { scorePerToolBreakdown, computePerToolBreakdown } from './scorers/per-tool-breakdown.js'
export { loadWorkflowPrompt } from './workflow-prompts.js'
export { runEvalCase, runBraintrustEval } from './runner.js'
