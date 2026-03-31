/**
 * Response quality eval dataset.
 *
 * Tests whether the agent produces accurate, helpful responses.
 * Scored with factuality and completeness checks.
 */

import type { EvalDataset } from '../types.js'

export const responseQualityDataset: EvalDataset = {
  name: 'response-quality',
  description: 'Does the agent produce accurate, helpful responses?',
  cases: [
    // ── Code explanation ────────────────────────────────────────────
    {
      input: 'Explain what a JavaScript Promise is in 2-3 sentences.',
      expected:
        'A Promise is an object representing the eventual completion or failure of an asynchronous operation. It allows you to attach callbacks for handling the result or error, and supports chaining with .then() and .catch() methods.',
      tags: ['explanation', 'javascript'],
    },
    {
      input: 'What is the difference between let, const, and var in JavaScript?',
      expected:
        'var is function-scoped and hoisted, let is block-scoped and not hoisted, const is block-scoped and cannot be reassigned after initialization. Modern JavaScript prefers const by default and let when reassignment is needed.',
      tags: ['explanation', 'javascript'],
    },

    // ── Command knowledge ───────────────────────────────────────────
    {
      input: 'What git command shows the difference between staged changes and the last commit?',
      expected: 'git diff --staged (or git diff --cached)',
      tags: ['command', 'git'],
    },
    {
      input: 'How do I find all files larger than 100MB on a Linux system?',
      expected: 'find / -type f -size +100M',
      tags: ['command', 'linux'],
    },

    // ── Problem solving ─────────────────────────────────────────────
    {
      input:
        'I have a Node.js server that crashes with "EADDRINUSE". What does this mean and how do I fix it?',
      expected:
        'EADDRINUSE means the port is already in use by another process. Fix by either killing the existing process using that port (find it with lsof -i :PORT or netstat) or changing to a different port.',
      tags: ['debugging', 'nodejs'],
    },
    {
      input: 'My TypeScript build fails with "Cannot find module". What should I check?',
      expected:
        'Check that the module is installed (node_modules), verify the import path is correct, ensure tsconfig.json paths/baseUrl are configured properly, and check that the module has type definitions (@types/ package).',
      tags: ['debugging', 'typescript'],
    },

    // ── Task planning ───────────────────────────────────────────────
    {
      input: 'What are the steps to set up a new Express.js API with TypeScript?',
      expected:
        'Initialize project with npm init, install express and typescript, install @types/express and ts-node-dev, create tsconfig.json, set up src/index.ts with Express app, add dev and build scripts to package.json.',
      tags: ['planning', 'nodejs'],
    },

    // ── Conciseness ─────────────────────────────────────────────────
    {
      input: 'In one sentence, what does Docker do?',
      expected:
        'Docker packages applications and their dependencies into lightweight, portable containers that run consistently across different environments.',
      tags: ['conciseness'],
    },

    // ── Accuracy with numbers/specifics ─────────────────────────────
    {
      input: 'What HTTP status code means "Not Found"?',
      expected: '404',
      tags: ['factual'],
    },
    {
      input: 'What port does HTTPS use by default?',
      expected: '443',
      tags: ['factual'],
    },
  ],
}
