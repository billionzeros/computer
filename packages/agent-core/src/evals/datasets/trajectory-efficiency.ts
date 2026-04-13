/**
 * Trajectory efficiency eval dataset.
 *
 * Tests whether Anton picks the right tool sequence and completes tasks
 * efficiently. Each case includes expectedTrajectory and baseline metrics.
 */

import type { EvalDataset } from '../types.js'

export const trajectoryEfficiencyDataset: EvalDataset = {
  name: 'trajectory-efficiency',
  description: 'Does Anton pick the right tool trajectory and stay efficient?',
  cases: [
    {
      input: 'Read README.md and tell me what this project does.',
      expectedTool: 'read',
      expectedTrajectory: ['read'],
      baseline: { toolCalls: 1, durationMs: 15_000 },
      tags: ['simple', 'filesystem'],
    },
    {
      input: 'Find all TODO comments in the codebase.',
      expectedTool: 'grep',
      expectedTrajectory: ['grep'],
      baseline: { toolCalls: 1, durationMs: 15_000 },
      tags: ['simple', 'search'],
    },
    {
      input: 'What React version does this project use?',
      expectedTool: 'read',
      expectedTrajectory: ['read'],
      baseline: { toolCalls: 1, durationMs: 15_000 },
      tags: ['simple', 'filesystem'],
    },
    {
      input: 'Rename the variable foo to bar in src/utils.ts.',
      expectedTool: 'read',
      expectedTrajectory: ['read', 'edit'],
      baseline: { toolCalls: 2, durationMs: 20_000 },
      tags: ['simple', 'edit'],
    },
    {
      input: "What's the diff from the last git commit?",
      expectedTool: 'shell',
      expectedTrajectory: ['shell'],
      baseline: { toolCalls: 1, durationMs: 15_000 },
      tags: ['simple', 'git'],
    },
    {
      input: 'List all TypeScript files in the src/ directory.',
      expectedTool: 'glob',
      expectedTrajectory: ['glob'],
      baseline: { toolCalls: 1, durationMs: 15_000 },
      tags: ['simple', 'filesystem'],
    },
    {
      input: 'Search for the function handleAuth in the codebase.',
      expectedTool: 'grep',
      expectedTrajectory: ['grep'],
      baseline: { toolCalls: 1, durationMs: 15_000 },
      tags: ['simple', 'search'],
    },
    {
      input: 'Create a new file src/hello.ts with a hello world function.',
      expectedTool: 'write',
      expectedTrajectory: ['write'],
      baseline: { toolCalls: 1, durationMs: 15_000 },
      tags: ['simple', 'filesystem'],
    },
  ],
}
