/**
 * Multi-step planning eval dataset.
 *
 * These cases require the agent to plan before executing. They run in
 * autonomous mode and require task_tracker usage for structured execution.
 */

import type { EvalDataset } from '../types.js'

export const multiStepPlanningDataset: EvalDataset = {
  name: 'multi-step-planning',
  description: 'Does Anton plan before executing complex multi-step tasks?',
  cases: [
    {
      input:
        'Set up a basic Express API with TypeScript. Include a health check endpoint at GET /health and a simple test for it.',
      expectedTool: 'task_tracker',
      acceptableTools: ['shell'],
      requiredTools: ['task_tracker', 'shell', 'write'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      expectedTrajectory: ['task_tracker', 'shell', 'write', 'write', 'write', 'shell'],
      tags: ['multi-step', 'autonomous', 'setup'],
    },
    {
      input:
        'Refactor the database module to use connection pooling. Find all callers of the current DB functions and update them to use the new pool interface.',
      expectedTool: 'grep',
      acceptableTools: ['read', 'task_tracker'],
      requiredTools: ['grep', 'task_tracker'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      expectedTrajectory: ['grep', 'task_tracker', 'read', 'edit', 'edit'],
      tags: ['multi-step', 'autonomous', 'refactoring'],
    },
    {
      input:
        'Create a CI pipeline configuration with three stages: lint, test, and build. Use GitHub Actions.',
      expectedTool: 'task_tracker',
      acceptableTools: ['write'],
      requiredTools: ['task_tracker', 'write'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      expectedTrajectory: ['task_tracker', 'write'],
      tags: ['multi-step', 'autonomous', 'ci'],
    },
    {
      input:
        'Add JWT authentication middleware and protect the /api/users, /api/orders, and /api/admin routes with it.',
      expectedTool: 'task_tracker',
      acceptableTools: ['read', 'grep'],
      requiredTools: ['task_tracker'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      expectedTrajectory: ['task_tracker', 'read', 'write', 'edit', 'edit', 'edit'],
      tags: ['multi-step', 'autonomous', 'auth'],
    },
    {
      input:
        'Write unit tests for all exported functions in src/utils.ts. Cover edge cases and error conditions.',
      expectedTool: 'read',
      acceptableTools: ['task_tracker'],
      requiredTools: ['read', 'task_tracker'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      expectedTrajectory: ['read', 'task_tracker', 'write'],
      tags: ['multi-step', 'autonomous', 'testing'],
    },
    {
      input:
        'Set up a Dockerfile and docker-compose.yml for this project. Include a multi-stage build and a development compose profile with hot reload.',
      expectedTool: 'task_tracker',
      acceptableTools: ['read'],
      requiredTools: ['task_tracker', 'write'],
      forbiddenTools: ['ask_user', 'plan'],
      runtimeProfile: 'autonomous',
      expectedTrajectory: ['task_tracker', 'read', 'write', 'write'],
      tags: ['multi-step', 'autonomous', 'devops'],
    },
  ],
}
