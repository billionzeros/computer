/**
 * Autonomous orchestration eval dataset.
 *
 * These cases measure whether Anton behaves like an autonomous agent under
 * benchmark-style pressure rather than an interactive chat assistant.
 */

import type { EvalDataset } from '../types.js'

export const autonomousOrchestrationDataset: EvalDataset = {
  name: 'autonomous-orchestration',
  description: 'Does Anton execute benchmark-style tasks autonomously with the right trajectory?',
  cases: [
    {
      input:
        "I'm choosing between Supabase, PocketBase, and Firebase for my next project. Compare their pricing, developer experience, and self-hosting options.",
      expectedTool: 'sub_agent',
      requiredTools: ['sub_agent'],
      forbiddenTools: ['ask_user', 'plan'],
      minToolCallsByName: { sub_agent: 2 },
      runtimeProfile: 'autonomous',
      tags: ['autonomous', 'parallel', 'research'],
    },
    {
      input:
        "Look at all the config files in this project — package.json, tsconfig, biome.json, and any CI configs. Tell me what's outdated or misconfigured.",
      expectedTool: 'sub_agent',
      requiredTools: ['sub_agent'],
      forbiddenTools: ['ask_user', 'plan'],
      minToolCallsByName: { sub_agent: 2 },
      runtimeProfile: 'autonomous',
      tags: ['autonomous', 'parallel', 'config-review'],
    },
    {
      input:
        'Set up a new React project with TypeScript, ESLint, Prettier, and Tailwind CSS. Initialize a git repo and make the first commit.',
      expectedTool: 'task_tracker',
      acceptableTools: ['shell'],
      requiredTools: ['task_tracker', 'shell'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      tags: ['autonomous', 'multi-step', 'task-tracker'],
    },
    {
      input: 'Run npm test and if any tests fail, read the failing test file and fix the issue.',
      expectedTool: 'shell',
      requiredTools: ['shell'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      tags: ['autonomous', 'debugging', 'read-first'],
    },
    {
      input: 'Rename the function `getUserData` to `fetchUserProfile` everywhere in the codebase.',
      expectedTool: 'grep',
      requiredTools: ['grep'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      tags: ['autonomous', 'refactoring', 'search-first'],
    },
    {
      input:
        'Find the latest stable versions of Next.js, React, and TypeScript, then summarize the main upgrade considerations.',
      expectedTool: 'web_search',
      requiredTools: ['web_search'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      tags: ['autonomous', 'current-info', 'research'],
    },
  ],
}
