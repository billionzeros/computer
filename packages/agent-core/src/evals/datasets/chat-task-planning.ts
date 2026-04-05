/**
 * Task Planning eval dataset.
 *
 * Tests whether Anton correctly approaches complex, multi-step tasks:
 * - Does it break down work into steps?
 * - Does it pick the right tool chain (not just the first tool)?
 * - Does it plan before acting on non-trivial tasks?
 * - Does it use task_tracker for multi-step work?
 *
 * These test the orchestration layer — not "can it call a tool"
 * but "does it approach the problem correctly?"
 */

import type { EvalDataset } from '../types.js'

export const taskPlanningDataset: EvalDataset = {
  name: 'chat-task-planning',
  description: 'Does Anton correctly plan, break down, and orchestrate multi-step tasks?',
  cases: [
    // ── Should plan first ──────────────────────────────────────────
    {
      input:
        'Refactor the authentication system in this Express app to use JWT instead of session cookies. The app is in /app.',
      expected:
        'Should propose a plan first (use plan tool or describe approach) before making changes. Should NOT immediately start editing files. A refactor of this scope needs user alignment.',
      expectedTool: 'plan',
      acceptableTools: ['filesystem'],
      tags: ['planning', 'refactoring', 'complex'],
    },

    // ── Should read first, then act ────────────────────────────────
    {
      input: 'Fix the failing tests in this project.',
      expected:
        'Should first read the test output or run tests (shell) to understand what is failing, then read the relevant source files (filesystem), then fix. Should NOT guess at fixes without reading the errors first.',
      expectedTool: 'shell',
      acceptableTools: ['filesystem', 'code_search'],
      tags: ['debugging', 'read-first', 'testing'],
    },

    // ── Should use task tracker for multi-step ─────────────────────
    {
      input:
        'Set up a new React project with TypeScript, ESLint, Prettier, and Tailwind CSS. Initialize a git repo and make the first commit.',
      expected:
        'Should break this into multiple steps and ideally use task_tracker to show progress. Steps: create project (shell), add TypeScript config, add ESLint, add Prettier, add Tailwind, initialize git, commit.',
      expectedTool: 'shell',
      tags: ['multi-step', 'setup', 'task-tracker'],
    },

    // ── Should search code before changing ─────────────────────────
    {
      input: 'Rename the function `getUserData` to `fetchUserProfile` everywhere in the codebase.',
      expected:
        'Should first search the codebase (code_search) to find all occurrences, then systematically rename each one. Should NOT blindly edit files without knowing where the function is used.',
      expectedTool: 'code_search',
      acceptableTools: ['filesystem'],
      tags: ['refactoring', 'search-first', 'codebase-wide'],
    },

    // ── Should ask for clarification ───────────────────────────────
    {
      input: 'Deploy this.',
      expected:
        'This is too vague — should ask clarifying questions. Deploy where? What platform? What is "this"? Should use ask_user or ask in text. Should NOT just guess and run deployment commands.',
      tags: ['ambiguous', 'should-clarify', 'dangerous-if-guessed'],
    },

    // ── Should NOT over-plan simple tasks ──────────────────────────
    {
      input: 'What is the current version of Node.js installed?',
      expected:
        'Should immediately run `node --version` via shell. Should NOT create a plan, use task_tracker, or over-think this. Simple question = simple action.',
      expectedTool: 'shell',
      tags: ['simple', 'no-over-planning', 'direct'],
    },

    // ── Should chain tools correctly ───────────────────────────────
    {
      input:
        'Find all TODO comments in the codebase, count them, and give me a summary of what needs to be done.',
      expected:
        'Should search for TODO comments (code_search), then summarize findings. Tool chain: code_search → text response with analysis. Should NOT just search and dump raw results.',
      expectedTool: 'code_search',
      tags: ['multi-tool', 'analysis', 'summarization'],
    },

    // ── Should handle failure gracefully ───────────────────────────
    {
      input: 'Run `npm test` and if any tests fail, read the failing test file and fix the issue.',
      expected:
        'Should run npm test (shell), then if it fails, parse the error output, identify the failing file, read it (filesystem), diagnose the issue, and fix it (filesystem write). Conditional chain based on output.',
      expectedTool: 'shell',
      tags: ['error-recovery', 'conditional-chain', 'debugging'],
    },
  ],
}
