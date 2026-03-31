#!/usr/bin/env node
/**
 * Anton eval CLI entry point.
 *
 * Usage:
 *   pnpm eval                  — run all eval suites
 *   pnpm eval:tools            — run tool selection evals
 *   pnpm eval:safety           — run safety evals
 *   pnpm eval:quality          — run response quality evals
 *   pnpm eval -- --dry-run     — validate datasets without running
 *
 * Requires:
 *   BRAINTRUST_API_KEY (env var or config)
 *   A provider API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 */

import { loadConfig } from '@anton/agent-config'
import { initTracing } from '../tracing.js'
import { toolSelectionDataset } from './datasets/tool-selection.js'
import { responseQualityDataset } from './datasets/response-quality.js'
import { safetyDataset } from './datasets/safety.js'
import { scoreToolSelection } from './scorers/tool-selection.js'
import { scoreSafety } from './scorers/safety.js'
import { scoreFactuality, scoreKeywordOverlap } from './scorers/factuality.js'
import { runBraintrustEval } from './runner.js'
import type { EvalCase, EvalResult } from './types.js'

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
        console.log(`\n[eval] Running tool-selection (${toolSelectionDataset.cases.length} cases)...`)
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
              fn: (c: EvalCase, r: EvalResult) =>
                scoreKeywordOverlap(c.expected || '', r.output),
            },
          ],
          dryRun,
        })
      },
    })
  }

  if (suites.length === 0) {
    console.error(`[eval] Unknown suite: "${suite}". Available: tools, safety, quality`)
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
export type { EvalCase, EvalResult, EvalDataset } from './types.js'
export { toolSelectionDataset } from './datasets/tool-selection.js'
export { responseQualityDataset } from './datasets/response-quality.js'
export { safetyDataset } from './datasets/safety.js'
export { scoreToolSelection } from './scorers/tool-selection.js'
export { scoreSafety } from './scorers/safety.js'
export { scoreFactuality, scoreKeywordOverlap } from './scorers/factuality.js'
export { runEvalCase, runBraintrustEval } from './runner.js'
