/**
 * Skills system — directory-based skill packages.
 *
 * Each skill is a directory containing SKILL.md (prompt + YAML frontmatter)
 * plus optional supporting files (agents/, scripts/, references/).
 *
 * At runtime the prompt is injected with `Base directory for this skill: /path/`
 * and `${CLAUDE_SKILL_DIR}` is substituted in the body.
 *
 * Skills can run:
 * 1. Inline: expand into conversation
 * 2. Fork: run as sub-agent
 * 3. Scheduled: runs on cron
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { SkillAssets, SkillConfig, SkillParameter } from './config.js'
import { getAntonDir } from './config.js'

const SKILLS_DIR = join(getAntonDir(), 'skills')

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns { frontmatter, body } where body is the markdown after the closing ---.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content }
  }
  const end = trimmed.indexOf('---', 3)
  if (end === -1) {
    return { frontmatter: {}, body: content }
  }
  const yamlStr = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 3).trim()
  try {
    const frontmatter = parseYaml(yamlStr) as Record<string, unknown>
    return { frontmatter: frontmatter || {}, body }
  } catch {
    return { frontmatter: {}, body: content }
  }
}

const KNOWN_ASSET_DIRS = ['agents', 'scripts', 'references', 'assets', 'canvas-fonts'] as const

/**
 * Scan a skill directory for bundled asset files.
 */
function scanSkillAssets(dirPath: string): SkillAssets | undefined {
  const assets: SkillAssets = {}
  let hasAny = false

  for (const subdir of KNOWN_ASSET_DIRS) {
    const subdirPath = join(dirPath, subdir)
    if (!existsSync(subdirPath) || !statSync(subdirPath).isDirectory()) continue

    try {
      const files = readdirSync(subdirPath).filter((f) => !f.startsWith('.'))
      if (files.length === 0) continue

      hasAny = true
      if (subdir === 'agents') assets.agents = files
      else if (subdir === 'scripts') assets.scripts = files
      else if (subdir === 'references') assets.references = files
      else {
        // assets/, canvas-fonts/, or any other subdir → "other"
        assets.other = [...(assets.other || []), ...files.map((f) => `${subdir}/${f}`)]
      }
    } catch {
      // skip unreadable directories
    }
  }

  return hasAny ? assets : undefined
}

/**
 * Load a single skill directory.
 */
function loadSkillDir(dirPath: string, source: 'builtin' | 'user' | 'project'): SkillConfig | null {
  const skillMd = join(dirPath, 'SKILL.md')
  if (!existsSync(skillMd)) return null

  try {
    const raw = readFileSync(skillMd, 'utf-8')
    const { frontmatter, body } = parseFrontmatter(raw)

    const skill: SkillConfig = {
      name: (frontmatter.name as string) || dirPath.split('/').pop() || 'Unnamed',
      description: (frontmatter.description as string) || '',
      icon: frontmatter.icon as string | undefined,
      category: frontmatter.category as string | undefined,
      featured: frontmatter.featured as boolean | undefined,
      prompt: body,
      whenToUse: (frontmatter.when_to_use as string) || undefined,
      context: (frontmatter.context as 'inline' | 'fork') || 'inline',
      allowedTools: frontmatter['allowed-tools'] as string[] | undefined,
      tools: frontmatter.tools as string[] | undefined,
      schedule: frontmatter.schedule as string | undefined,
      model: frontmatter.model as string | undefined,
      source,
      skillDir: dirPath,
      assets: scanSkillAssets(dirPath),
      parameters: (frontmatter.parameters as SkillParameter[]) || undefined,
    }

    return skill
  } catch (err) {
    console.error(`Failed to load skill from ${dirPath}:`, err)
    return null
  }
}

/**
 * Load all skills from ~/.anton/skills/.
 * Scans for directories containing SKILL.md.
 * Also loads legacy .yaml files for backward compat.
 */
export function loadSkills(): SkillConfig[] {
  if (!existsSync(SKILLS_DIR)) {
    mkdirSync(SKILLS_DIR, { recursive: true })
    createExampleSkills()
  }

  const entries = readdirSync(SKILLS_DIR)
  const skills: SkillConfig[] = []

  for (const entry of entries) {
    const fullPath = join(SKILLS_DIR, entry)

    // Directory-based skills (new format)
    if (statSync(fullPath).isDirectory()) {
      const skill = loadSkillDir(fullPath, 'builtin')
      if (skill) skills.push(skill)
      continue
    }

    // Legacy YAML files (backward compat)
    if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      try {
        const raw = readFileSync(fullPath, 'utf-8')
        const parsed = parseYaml(raw) as Record<string, unknown>
        skills.push({
          name: (parsed.name as string) || entry,
          description: (parsed.description as string) || '',
          prompt: (parsed.prompt as string) || '',
          schedule: parsed.schedule as string | undefined,
          tools: parsed.tools as string[] | undefined,
          source: 'user',
        })
      } catch (err) {
        console.error(`Failed to load legacy skill ${entry}:`, err)
      }
    }
  }

  return skills
}

/**
 * Create example skill directories on first run.
 */
function createExampleSkills() {
  const skills: Record<string, string> = {
    'code-review': `---
name: Code Review
description: Review code for bugs, performance issues, and style violations
icon: code
category: Code Quality
featured: true
when_to_use: When the user wants code reviewed or asks for a review
context: inline
parameters:
  - name: scope
    label: Scope
    type: select
    options: [Current file, Staged changes, Full project]
---

You are an expert code reviewer. Review the code thoroughly for:

1. **Bugs & Logic Errors** — off-by-one, null checks, race conditions
2. **Performance** — unnecessary allocations, N+1 queries, missing indexes
3. **Security** — injection, XSS, exposed secrets, unsafe deserialization
4. **Style & Readability** — naming, structure, dead code, unclear intent

Be specific. Reference line numbers. Suggest fixes, not just problems.
If reviewing staged changes, run \`git diff --cached\` first.
If reviewing a file, read it with the filesystem tool.

Use the review checklist at \${CLAUDE_SKILL_DIR}/references/checklist.md for a structured approach.`,

    'refactor': `---
name: Refactor Code
description: Refactor code for readability, DRY, and SOLID principles
icon: wand
category: Code Quality
featured: true
when_to_use: When the user wants to clean up or restructure code
context: inline
parameters:
  - name: target
    label: Target file or function
    type: text
    placeholder: src/utils.ts
    required: true
---

You are a refactoring expert. Analyze the target code and improve it:

1. Eliminate duplication (DRY)
2. Simplify complex conditionals
3. Extract clear abstractions where warranted
4. Improve naming for clarity
5. Apply SOLID principles where relevant

Read the target file first. Make changes incrementally and explain each refactoring.`,

    'security-review': `---
name: Security Review
description: Check code for vulnerabilities and security issues
icon: shield
category: Code Quality
when_to_use: When the user wants a security audit of their code
context: inline
---

You are a security expert. Audit the codebase for:

1. **Injection** — SQL, command, template injection
2. **Authentication** — weak auth, missing checks, session issues
3. **Data Exposure** — secrets in code, verbose errors, logs leaking PII
4. **Dependencies** — known CVEs in packages
5. **Configuration** — debug mode, permissive CORS, missing CSP

Run \`git diff --cached\` or read the relevant files. Flag severity (critical/high/medium/low) for each finding.

Reference \${CLAUDE_SKILL_DIR}/references/owasp-top-10.md for the OWASP Top 10 checklist.`,

    'create-component': `---
name: Create Component
description: Scaffold a UI component with proper structure and types
icon: layout
category: Generation
featured: true
when_to_use: When the user wants to create a new UI component
context: inline
parameters:
  - name: name
    label: Component name
    type: text
    placeholder: UserProfile
    required: true
  - name: framework
    label: Framework
    type: select
    options: [React, Vue, Svelte]
---

Create a new UI component with the given name and framework.

1. Detect the project's existing patterns (file structure, styling approach, state management)
2. Create the component file matching existing conventions
3. Add TypeScript types/props interface
4. Include basic styling following the project's approach
5. Export from the appropriate index file if one exists

Follow the project's existing patterns exactly — don't impose new conventions.`,

    'create-api': `---
name: Create API Endpoint
description: Generate a REST API endpoint with validation and error handling
icon: server
category: Generation
parameters:
  - name: method
    label: HTTP Method
    type: select
    options: [GET, POST, PUT, PATCH, DELETE]
    required: true
  - name: path
    label: Endpoint path
    type: text
    placeholder: /api/users/:id
    required: true
---

Create a new API endpoint:

1. Detect the project's API framework (Express, Fastify, Hono, Next.js, etc.)
2. Create the route handler with proper HTTP method
3. Add input validation (params, query, body as appropriate)
4. Add error handling with proper status codes
5. Include TypeScript types for request/response
6. Add to the router/route config if needed

Follow existing patterns in the codebase.`,

    'generate-types': `---
name: Generate Types
description: Create TypeScript types from data samples or API responses
icon: braces
category: Generation
when_to_use: When the user needs TypeScript types generated
context: inline
parameters:
  - name: source
    label: Data source
    type: text
    placeholder: Paste JSON or describe the data
    required: true
---

Generate TypeScript types from the provided data:

1. Analyze the data structure
2. Create precise types (not just \`any\` or \`unknown\`)
3. Use union types for enum-like values
4. Mark optional fields appropriately
5. Add JSDoc comments for non-obvious fields
6. Export types from the appropriate location`,

    'write-tests': `---
name: Write Tests
description: Generate tests for a target file or function
icon: test-tube
category: Testing
featured: true
when_to_use: When the user wants to write or generate tests
context: inline
parameters:
  - name: target
    label: File or function to test
    type: text
    placeholder: src/utils/parse.ts
    required: true
---

Write comprehensive tests for the target:

1. Read the target file to understand its behavior
2. Detect the project's test framework (Jest, Vitest, Mocha, Playwright, etc.)
3. Write tests covering:
   - Happy path / expected behavior
   - Edge cases (empty input, boundaries, nulls)
   - Error cases (invalid input, failures)
4. Follow existing test patterns in the project
5. Place the test file in the conventional location

See \${CLAUDE_SKILL_DIR}/references/test-patterns.md for common testing patterns and edge cases to cover.`,

    'add-coverage': `---
name: Add Test Coverage
description: Find untested code paths and add missing tests
icon: check-circle
category: Testing
when_to_use: When the user wants to improve test coverage
context: inline
---

Find and fill gaps in test coverage:

1. Run existing tests to understand current coverage if possible
2. Identify untested functions, branches, and edge cases
3. Write focused tests for the gaps
4. Prioritize critical paths and error handling`,

    'explain-code': `---
name: Explain Code
description: Explain what code does step by step
icon: book-open
category: Understanding
when_to_use: When the user wants to understand how code works
context: inline
parameters:
  - name: target
    label: File or function
    type: text
    placeholder: src/auth/middleware.ts
    required: true
---

Explain the target code clearly:

1. Read the file
2. Give a high-level summary (1-2 sentences: what it does and why)
3. Walk through the logic step by step
4. Highlight important patterns, edge cases, or non-obvious behavior
5. Note any dependencies or side effects

Adapt your explanation depth to the complexity of the code.`,

    'trace-data-flow': `---
name: Trace Data Flow
description: Follow data through the codebase from source to destination
icon: git-branch
category: Understanding
when_to_use: When the user wants to understand how data flows through the system
context: inline
parameters:
  - name: starting_point
    label: Starting point
    type: text
    placeholder: User login request
    required: true
---

Trace how data flows through the system:

1. Start at the entry point (API endpoint, event handler, UI action)
2. Follow the data through each layer (controller → service → model → database)
3. Note any transformations, validations, or side effects
4. Show the data shape at each step
5. Identify where errors are handled (or not)

Use Grep and Read to follow the actual code path.`,

    'architecture-overview': `---
name: Architecture Overview
description: Generate a high-level architecture summary of the project
icon: layout-dashboard
category: Understanding
when_to_use: When the user wants to understand the project structure
context: inline
---

Analyze the project and produce an architecture overview:

1. Scan the top-level directory structure
2. Read key config files (package.json, tsconfig, etc.)
3. Identify the tech stack, frameworks, and major dependencies
4. Map the module/package structure
5. Describe the data flow and key abstractions
6. Note deployment configuration if present

Keep it concise — bullet points over paragraphs.`,

    'commit-message': `---
name: Commit Message
description: Draft a conventional commit message from staged changes
icon: git-commit
category: Git & Workflow
when_to_use: When the user wants help writing a commit message
context: inline
---

Draft a commit message from staged changes:

1. Run \`git diff --cached\` to see staged changes
2. Analyze what changed and why
3. Write a conventional commit message:
   - Type: feat, fix, refactor, docs, test, chore, etc.
   - Scope (optional): the area of the codebase
   - Subject: imperative, lowercase, no period, under 72 chars
   - Body: explain what and why, not how
4. If changes span multiple concerns, suggest splitting into multiple commits`,

    'pr-description': `---
name: PR Description
description: Generate a pull request title and body from branch diff
icon: git-pull-request
category: Git & Workflow
when_to_use: When the user wants help writing a PR description
context: inline
---

Generate a PR description:

1. Run \`git log main..HEAD --oneline\` to see commits on this branch
2. Run \`git diff main...HEAD --stat\` for a file change summary
3. Write:
   - **Title**: concise, under 70 chars
   - **Summary**: 2-3 bullet points covering what changed
   - **Test plan**: how to verify the changes
4. Flag any breaking changes or migration steps needed`,

    'resolve-conflict': `---
name: Resolve Merge Conflict
description: Help resolve git merge conflicts
icon: git-merge
category: Git & Workflow
when_to_use: When the user has merge conflicts to resolve
context: inline
---

Help resolve merge conflicts:

1. Run \`git status\` to find conflicted files
2. Read each conflicted file
3. Analyze both sides of each conflict:
   - What the current branch changed and why
   - What the incoming branch changed and why
4. Suggest the correct resolution (may combine both sides)
5. Apply the fix and verify the file is valid

Never blindly pick one side — understand the intent of both changes.`,

    'generate-readme': `---
name: Generate README
description: Create or update the project README
icon: file-text
category: Documentation
when_to_use: When the user wants to create or improve their README
context: inline
---

Generate a README for the project:

1. Analyze the project structure, package.json, and existing docs
2. Create sections:
   - Project name and one-line description
   - Quick start / installation
   - Usage examples
   - Configuration (if applicable)
   - API reference (if applicable)
   - Contributing guidelines
3. Keep it practical — real commands, real examples`,

    'add-docs': `---
name: Add Documentation
description: Add JSDoc, docstrings, or inline documentation to code
icon: message-square
category: Documentation
when_to_use: When the user wants to add documentation to code
context: inline
parameters:
  - name: target
    label: File to document
    type: text
    placeholder: src/lib/parser.ts
    required: true
---

Add documentation to the target file:

1. Read the file
2. Add JSDoc/docstrings to exported functions, classes, and types
3. Document parameters, return values, and thrown errors
4. Add brief inline comments only where logic is non-obvious
5. Don't over-document — skip trivial getters/setters

Match the project's existing documentation style.`,
  }

  for (const [dirName, content] of Object.entries(skills)) {
    const dirPath = join(SKILLS_DIR, dirName)
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(join(dirPath, 'SKILL.md'), content, 'utf-8')
    }
  }

  // Add reference files to demonstrate the directory package concept
  const assetFiles: Record<string, Record<string, string>> = {
    'code-review': {
      'references/checklist.md': `# Code Review Checklist

## Critical
- [ ] No hardcoded secrets or credentials
- [ ] Input validation on all external data
- [ ] SQL queries use parameterized statements
- [ ] Error messages don't leak internal details

## Important
- [ ] No N+1 query patterns
- [ ] Proper null/undefined handling
- [ ] Resource cleanup (connections, file handles)
- [ ] Consistent error handling strategy

## Style
- [ ] Clear, descriptive naming
- [ ] Functions are focused (single responsibility)
- [ ] No commented-out code
- [ ] Consistent formatting
`,
      'agents/reviewer.md': `You are a focused code review sub-agent. You receive a specific file to review.

Read the file using the filesystem tool. Then check it against the checklist at:
\${CLAUDE_SKILL_DIR}/references/checklist.md

Report findings as:
- **CRITICAL**: Must fix before merge
- **IMPORTANT**: Should fix, may accept with justification
- **STYLE**: Nice to have, non-blocking
`,
    },
    'security-review': {
      'references/owasp-top-10.md': `# OWASP Top 10 Quick Reference

1. **A01 Broken Access Control** — Missing auth checks, IDOR, privilege escalation
2. **A02 Cryptographic Failures** — Weak hashing, plaintext secrets, missing TLS
3. **A03 Injection** — SQL, NoSQL, OS command, LDAP injection
4. **A04 Insecure Design** — Missing threat modeling, insecure patterns
5. **A05 Security Misconfiguration** — Default creds, verbose errors, open cloud storage
6. **A06 Vulnerable Components** — Outdated deps with known CVEs
7. **A07 Auth Failures** — Weak passwords, missing MFA, session fixation
8. **A08 Data Integrity Failures** — Insecure deserialization, unsigned updates
9. **A09 Logging Failures** — Missing audit logs, log injection, no alerting
10. **A10 SSRF** — Unvalidated URLs, internal network access via user input
`,
    },
    'write-tests': {
      'references/test-patterns.md': `# Testing Patterns Reference

## Arrange-Act-Assert
\`\`\`
// Arrange: set up test data and conditions
// Act: execute the code under test
// Assert: verify the expected outcome
\`\`\`

## Common Edge Cases to Cover
- Empty inputs (null, undefined, "", [], {})
- Boundary values (0, -1, MAX_INT, empty string)
- Invalid types (string where number expected)
- Concurrent access (if applicable)
- Error/exception paths
- Timeout scenarios

## Mock vs Real
- Mock: external services, time, randomness
- Real: pure functions, data transformations, business logic
`,
    },
  }

  for (const [dirName, files] of Object.entries(assetFiles)) {
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(SKILLS_DIR, dirName, relPath)
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      if (!existsSync(fullPath)) writeFileSync(fullPath, content, 'utf-8')
    }
  }
}

/**
 * Build a skill activation prompt.
 * Prepends base directory info and substitutes ${CLAUDE_SKILL_DIR}.
 */
export function buildSkillPrompt(skill: SkillConfig, userMessage?: string): string {
  let prompt = ''

  if (skill.skillDir) {
    prompt += `Base directory for this skill: ${skill.skillDir}\n\n`
  }

  prompt += `[SKILL ACTIVATED: ${skill.name}]\n\n`

  let body = skill.prompt
  if (skill.skillDir) {
    body = body.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skill.skillDir)
  }
  prompt += body

  if (userMessage) {
    prompt += `\n\n[USER REQUEST]: ${userMessage}`
  }

  return prompt
}
