/**
 * Tool selection eval dataset.
 *
 * Tests whether the agent picks the right tool for a given task.
 * Each case maps a natural language request to the expected first tool call.
 */

import type { EvalDataset } from '../types.js'

export const toolSelectionDataset: EvalDataset = {
  name: 'tool-selection',
  description: 'Does the agent select the correct tool for the task?',
  cases: [
    // ── Filesystem ──────────────────────────────────────────────────
    {
      input: 'Read the contents of /etc/hosts',
      expectedTool: 'filesystem',
      tags: ['filesystem'],
    },
    {
      input: 'Create a new file called notes.txt with "Hello World" in it',
      expectedTool: 'filesystem',
      tags: ['filesystem'],
    },
    {
      input: 'List all files in the /tmp directory',
      expectedTool: 'filesystem',
      acceptableTools: ['shell'],
      tags: ['filesystem'],
    },
    {
      input: 'What is the size of the file at ~/report.pdf?',
      expectedTool: 'filesystem',
      acceptableTools: ['shell'],
      tags: ['filesystem'],
    },

    // ── Shell ───────────────────────────────────────────────────────
    {
      input: 'Install the express npm package',
      expectedTool: 'shell',
      tags: ['shell'],
    },
    {
      input: 'Run the test suite with npm test',
      expectedTool: 'shell',
      tags: ['shell'],
    },
    {
      input: 'Check how much disk space is available',
      expectedTool: 'shell',
      tags: ['shell'],
    },
    {
      input: 'Compile the TypeScript project',
      expectedTool: 'shell',
      tags: ['shell'],
    },
    {
      input: 'Start the development server on port 3000',
      expectedTool: 'shell',
      tags: ['shell'],
    },
    {
      input: 'Kill the process running on port 8080',
      expectedTool: 'shell',
      acceptableTools: ['process'],
      tags: ['shell'],
    },

    // ── Code search ─────────────────────────────────────────────────
    {
      input: 'Find all files that contain the function handleSubmit',
      expectedTool: 'code_search',
      tags: ['code_search'],
    },
    {
      input: 'Search for all TODO comments in the codebase',
      expectedTool: 'code_search',
      tags: ['code_search'],
    },
    {
      input: 'Find where the UserProfile component is defined',
      expectedTool: 'code_search',
      tags: ['code_search'],
    },

    // ── Git ─────────────────────────────────────────────────────────
    {
      input: 'Show me the git log for the last 5 commits',
      expectedTool: 'git',
      acceptableTools: ['shell'],
      tags: ['git'],
    },
    {
      input: 'Create a new branch called feature/auth',
      expectedTool: 'git',
      acceptableTools: ['shell'],
      tags: ['git'],
    },
    {
      input: 'What files have been modified since the last commit?',
      expectedTool: 'git',
      acceptableTools: ['shell'],
      tags: ['git'],
    },

    // ── Web search ──────────────────────────────────────────────────
    {
      input: 'What is the current weather in San Francisco?',
      expectedTool: 'web_search',
      tags: ['web'],
    },
    {
      input: 'Find the latest documentation for the Hono framework',
      expectedTool: 'web_search',
      tags: ['web'],
    },

    // ── HTTP API ────────────────────────────────────────────────────
    {
      input: 'Make a GET request to https://api.github.com/users/octocat',
      expectedTool: 'http_api',
      tags: ['http'],
    },
    {
      input: 'POST {"name": "test"} to https://httpbin.org/post',
      expectedTool: 'http_api',
      tags: ['http'],
    },

    // ── Browser ─────────────────────────────────────────────────────
    {
      input: 'Open https://example.com and take a screenshot',
      expectedTool: 'browser',
      tags: ['browser'],
    },
    {
      input: 'Navigate to the login page and fill in the username field',
      expectedTool: 'browser',
      tags: ['browser'],
    },

    // ── Artifact ────────────────────────────────────────────────────
    {
      input: 'Create an HTML page with a bar chart showing Q1 revenue data',
      expectedTool: 'artifact',
      tags: ['artifact'],
    },
    {
      input: 'Generate an SVG diagram showing the system architecture',
      expectedTool: 'artifact',
      tags: ['artifact'],
    },

    // ── Memory ──────────────────────────────────────────────────────
    {
      input: 'Remember that my preferred language is TypeScript',
      expectedTool: 'memory',
      tags: ['memory'],
    },

    // ── Database ────────────────────────────────────────────────────
    {
      input: 'Create a SQLite database and add a users table',
      expectedTool: 'database',
      acceptableTools: ['shell'],
      tags: ['database'],
    },

    // ── Process ─────────────────────────────────────────────────────
    {
      input: 'Show me all running processes',
      expectedTool: 'process',
      acceptableTools: ['shell'],
      tags: ['process'],
    },

    // ── Network ─────────────────────────────────────────────────────
    {
      input: 'Check if google.com is reachable',
      expectedTool: 'network',
      acceptableTools: ['shell'],
      tags: ['network'],
    },

    // ── Diff ────────────────────────────────────────────────────────
    {
      input: 'Apply this diff to fix the bug in server.ts',
      expectedTool: 'diff',
      acceptableTools: ['filesystem'],
      tags: ['diff'],
    },

    // ── Image ───────────────────────────────────────────────────────
    {
      input: 'Resize the image at ~/photo.png to 800x600',
      expectedTool: 'image',
      acceptableTools: ['shell'],
      tags: ['image'],
    },

    // ── Notification ────────────────────────────────────────────────
    {
      input: 'Send me a notification when the deploy is done',
      expectedTool: 'notification',
      tags: ['notification'],
    },

    // ── Plan ────────────────────────────────────────────────────────
    {
      input: 'Create a plan for building a REST API with authentication, rate limiting, and database integration',
      expectedTool: 'plan',
      tags: ['plan'],
    },

    // ── Sub-agent ───────────────────────────────────────────────────
    {
      input: 'In parallel: (1) set up the database schema, (2) create the API routes, and (3) write the tests',
      expectedTool: 'sub_agent',
      tags: ['sub_agent'],
    },
  ],
}
