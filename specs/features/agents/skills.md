# Skills — Directory-Based Packages

## Overview

Skills are **directory-based packages** — self-contained toolkits where `SKILL.md` orchestrates the model to use bundled real assets at runtime. This matches Claude Code's SKILL.md system.

**Status:** Implemented on branch `OmGuptaIND/skills-ui-redesign`

---

## Architecture

### Skill Package Structure

```
~/.anton/skills/
├── code-review/
│   ├── SKILL.md              # Main prompt + YAML frontmatter
│   ├── agents/               # Sub-agent prompts (.md) model can Read
│   │   └── reviewer.md
│   └── references/           # Docs/guides model reads for context
│       └── checklist.md
├── security-review/
│   ├── SKILL.md
│   └── references/
│       └── owasp-top-10.md
├── write-tests/
│   ├── SKILL.md
│   └── references/
│       └── test-patterns.md
└── ...
```

Skills are **not** just markdown prompts. They are directories that can contain:

| Subdirectory | Purpose | Runtime usage |
|---|---|---|
| `agents/` | Sub-agent prompts (.md) | Model uses `Read` to load and delegate |
| `scripts/` | Python/bash scripts | Model executes via `Bash` tool |
| `assets/` | HTML, config, templates | Model references in generated code |
| `references/` | Docs, guides, checklists | Model reads for context |
| `canvas-fonts/` | Binary assets (fonts) | Referenced in generated output |

### How Assets Are Used at Runtime

1. `buildSkillPrompt()` prepends `Base directory for this skill: /real/path/` to the prompt
2. `${CLAUDE_SKILL_DIR}` in the SKILL.md body is substituted with the real directory path
3. The agent uses its existing tools to access bundled files:
   - `Read ${CLAUDE_SKILL_DIR}/references/style-guide.md` for context
   - `shell python ${CLAUDE_SKILL_DIR}/scripts/analyze.py` to run scripts
   - References asset paths in generated code

### SKILL.md Frontmatter Format

```yaml
---
name: Code Review
description: Review code for bugs, performance issues, and style
icon: code                    # lucide icon name
category: Code Quality        # UI grouping
featured: true                # show in "Recommended" section
when_to_use: When the user wants code reviewed
context: inline               # inline = expand into conversation, fork = sub-agent
allowed-tools:
  - filesystem
  - shell
  - git
parameters:
  - name: scope
    label: Scope
    type: select
    options: [Current file, Staged changes, Full project]
---

(markdown prompt body here — ${CLAUDE_SKILL_DIR} is substituted at runtime)
```

---

## Data Flow

```
Server                                    Desktop
──────                                    ───────
~/.anton/skills/*/SKILL.md
       │
  loadSkills()                     skill_list message
  ├─ scan dirs for SKILL.md  ◄──────────────────────  skillStore.requestSkills()
  ├─ parseFrontmatter()                                        │
  ├─ scanSkillAssets()                                         │
  └─ return SkillConfig[]    ──────────────────────►  skillStore.setSkills()
                              skill_list_response              │
                                                        SkillsPanel renders
                                                        from skillStore
```

### Protocol Messages

```typescript
// Desktop → Server
interface SkillListMessage { type: 'skill_list' }

// Server → Desktop
interface SkillListResponse {
  type: 'skill_list_response'
  skills: SkillListResponseSkill[]  // full SkillConfig including assets
}
```

---

## Server-Side

### SkillConfig Interface (`agent-config/src/config.ts`)

```typescript
export interface SkillAssets {
  agents?: string[]      // filenames in agents/
  scripts?: string[]     // filenames in scripts/
  references?: string[]  // filenames in references/
  other?: string[]       // files from assets/, canvas-fonts/, etc.
}

export interface SkillConfig {
  // Identity
  name: string
  description: string
  icon?: string
  category?: string
  featured?: boolean

  // Prompt (loaded from SKILL.md body)
  prompt: string
  whenToUse?: string

  // Execution
  context?: 'inline' | 'fork'
  allowedTools?: string[]
  tools?: string[]
  schedule?: string
  model?: string

  // Source
  source: 'builtin' | 'user' | 'project'
  skillDir?: string

  // Bundled assets (populated by scanning skill directory)
  assets?: SkillAssets

  // Parameters (for UI form)
  parameters?: SkillParameter[]
}
```

### Skill Loading (`agent-config/src/skills.ts`)

- `loadSkills()` — scans `~/.anton/skills/` for directories containing `SKILL.md`. Also loads legacy `.yaml` files for backward compatibility.
- `loadSkillDir()` — parses YAML frontmatter, extracts markdown body as prompt, calls `scanSkillAssets()` to populate the `assets` field.
- `scanSkillAssets()` — scans known subdirectories (`agents/`, `scripts/`, `references/`, `assets/`, `canvas-fonts/`) and returns file lists.
- `buildSkillPrompt()` — prepends `Base directory for this skill:` and substitutes `${CLAUDE_SKILL_DIR}`.
- `createExampleSkills()` — creates ~16 builtin coding skill directories on first run, including reference files for code-review, security-review, and write-tests.

### Server Handler (`agent-server/src/server.ts`)

Handles `skill_list` messages by calling `loadSkills()` and sending back `skill_list_response`.

---

## Desktop-Side

### Skill Store (`lib/store/skillStore.ts`)

Zustand store managing skills loaded from the server:

- `skills: Skill[]` — loaded from server
- `loaded: boolean` — whether initial fetch completed
- `requestSkills()` — sends `skill_list` message via connection
- `setSkills()` — called by handler on `skill_list_response`

### Skill Data Layer (`lib/skills.ts`)

- `getSkills()` — returns skills from store
- `getSkillCommand(skill)` — derives `/slash-command` from skill name
- `findSkillByCommand(command)` — lookup for slash command matching
- `executeSkill(skill, params)` — substitutes parameters, prepends base directory, creates new conversation, sends to agent

### Message Handler (`lib/store/handlers/skillHandler.ts`)

Handles `skill_list_response` by calling `skillStore.setSkills()`.

---

## UI Components

### SkillsPanel (`components/skills/SkillsPanel.tsx`)

Connectors-style layout:
- Fetches skills from server on mount via `skillStore.requestSkills()`
- Search input filters by name, description, category
- **"Recommended"** section for `featured: true` skills (with star icon)
- Category sections with uppercase labels, divider lines, 2-column grid
- Click card opens SkillDetail overlay
- Empty state with icon and message

### SkillCard (`components/skills/SkillCard.tsx`)

Connector-card pattern:
- 40x40 icon wrapper, subtle background, radius 10px, **no border**
- Lucide icon: size 18, strokeWidth 1.5
- Name: 13px, weight 500, truncated
- Description: 11px, muted, 2-line clamp
- No category badge (category is the section header)
- Coding-relevant icon map (Code, GitBranch, TestTube, Shield, Sparkles, Wand, etc.)

### SkillDetail (`components/skills/SkillDetail.tsx`)

Centered modal (matches AppSetup pattern, NOT generic `<Modal>`):
1. Fixed overlay with `backdrop-filter: blur(16px)`
2. 440px card, radius 20px, centered
3. Close X button top-right
4. Large icon (48x48 wrapper)
5. Name (20px, weight 600)
6. Description (13px, muted, max-width 340px)
7. **Badges row** — command badge (`/code-review` in mono) + context badge ("Runs inline" / "Runs as sub-agent")
8. **Assets section** — shows bundled asset counts ("Includes: 1 agent, 1 reference") in a styled pill. Computed from `skill.assets` field.
9. Parameter form (if any) — text inputs, select dropdowns, required field validation
10. "Run Skill" primary button (disabled when required params missing)

---

## Built-in Skills (16 packages)

Created on first run in `~/.anton/skills/`:

### Code Quality (featured: Code Review, Refactor)
- `code-review/` — review staged changes or files for bugs, perf, style. **Bundled: `references/checklist.md`, `agents/reviewer.md`**
- `refactor/` — refactor for readability, DRY, SOLID
- `security-review/` — check for vulnerabilities. **Bundled: `references/owasp-top-10.md`**

### Generation (featured: Create Component)
- `create-component/` — scaffold UI component with params: name, framework
- `create-api/` — generate REST endpoint with params: method, path
- `generate-types/` — create TS types from data samples

### Testing (featured: Write Tests)
- `write-tests/` — generate tests for a target file/function. **Bundled: `references/test-patterns.md`**
- `add-coverage/` — find untested code paths

### Understanding
- `explain-code/` — explain what code does step by step
- `trace-data-flow/` — follow data through the codebase
- `architecture-overview/` — high-level architecture summary

### Git & Workflow
- `commit-message/` — draft conventional commit from staged changes
- `pr-description/` — generate PR title + body from branch diff
- `resolve-conflict/` — help resolve merge conflicts

### Documentation
- `generate-readme/` — create/update README
- `add-docs/` — add docstrings/JSDoc to code

---

## CSS Architecture

Old `.skill-card` / `.skill-dialog` classes replaced with:

| Class | Purpose |
|---|---|
| `.skills-page` | Full-height flex container |
| `.skills-header` | Search input container |
| `.skills-content` | Scrollable content area |
| `.skills-empty` | Empty state (icon + message) |
| `.skills-category` | Category section wrapper |
| `.skills-category__header` | Label + divider line |
| `.skills-category__label` | Uppercase 10px tracking |
| `.skills-grid` | 2-col grid (`repeat(2, minmax(0, 1fr))`, gap 10px) |
| `.skill-card` | Connector-card pattern (flex, 12px gap, 14px 16px padding, radius 12px) |
| `.skill-card__icon-wrap` | 40x40, subtle bg, radius 10px |
| `.skill-card__name` / `__desc` | 13px/11px, 2-line clamp on desc |
| `.skill-detail-overlay` | Fixed overlay, blur backdrop |
| `.skill-detail` | 440px modal, radius 20px |
| `.skill-detail__assets` | Asset count pill (subtle bg, rounded) |
| `.skill-detail__badges` | Command + context badges |
| `.skill-detail__params` | Parameter form fields |
| `.skill-detail__run-btn` | Primary action button |

---

## Files Modified

### Server-side
| File | Change |
|---|---|
| `packages/agent-config/src/config.ts` | Added `SkillAssets`, `SkillParameter`, extended `SkillConfig` |
| `packages/agent-config/src/skills.ts` | Full rewrite: directory loading, frontmatter parsing, asset scanning, builtin skills with reference files |
| `packages/protocol/src/messages.ts` | Added `SkillListMessage`, `SkillListResponseSkill`, `SkillListResponse` to `AiMessage` union |
| `packages/agent-server/src/server.ts` | Added `handleSkillList()` handler, `loadSkills` import |

### Desktop-side
| File | Change |
|---|---|
| `packages/desktop/src/lib/skills.ts` | Removed 22 hardcoded skills. Now fetches from server via skillStore. Added `getSkillCommand()`. |
| `packages/desktop/src/lib/store/skillStore.ts` | **New** — Zustand store for skills |
| `packages/desktop/src/lib/store/handlers/skillHandler.ts` | **New** — handler for `skill_list_response` |
| `packages/desktop/src/lib/store/handlers/index.ts` | Registered `handleSkillMessage` |
| `packages/desktop/src/lib/connection.ts` | Added `sendSkillList()` |
| `packages/desktop/src/components/skills/SkillCard.tsx` | Rewritten: connector-card pattern |
| `packages/desktop/src/components/skills/SkillDetail.tsx` | **New** — centered modal with assets display |
| `packages/desktop/src/components/skills/SkillsPanel.tsx` | Rewritten: Connectors-style layout with server fetch |
| `packages/desktop/src/components/skills/SkillDialog.tsx` | **Deleted** |
| `packages/desktop/src/components/chat/SlashCommandMenu.tsx` | Updated for new Skill interface (no `.id`, `.command`) |
| `packages/desktop/src/components/RoutineChat.tsx` | Updated import: SkillDialog → SkillDetail |
| `packages/desktop/src/index.css` | Replaced old skill CSS with new Connectors-matching styles |

---

## Verification

1. Check `~/.anton/skills/` has directory-based skill packages with subdirs
2. Run dev server, navigate to Skills in sidebar
3. Verify: 2-col grid, categories, "Recommended" section
4. Verify: card hover effects match Connectors pattern
5. Click skill → centered modal with blur backdrop, icon, name, desc, asset counts, params, run button
6. Run a skill → verify prompt includes `Base directory` prefix and `${CLAUDE_SKILL_DIR}` substitution
7. Verify agent can Read supporting files (`references/checklist.md`, etc.) during execution
8. Search filtering works across name, description, category
9. Slash commands work in chat via SlashCommandMenu
10. Skills with bundled assets show "Includes: N agents, N references" in detail modal
