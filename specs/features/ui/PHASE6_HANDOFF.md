# Anton redesign — Phase 6 handoff

Scope of this file: what's done, what's left, and how to pick up the redesign
in a new conversation without re-discovering everything from scratch.

## Status snapshot

- **Branch:** `billionzeros/stream-redesign`
- **Plan source:** `.context/attachments/plan.md` (the original 5-phase plan)
- **Design source (latest bundle):** `/tmp/anton-design-v2/anton-computer/`
  - Read `README.md` at the top of that bundle first — it tells coding agents
    to open `Anton Redesign.html` and follow its imports.
- **Typecheck:** clean (0 errors) as of Phase 6 handoff.
- **Build:** `pnpm --filter @anton/desktop exec vite build --mode production`
  succeeds in ~4 s.

Phases 1–5 and two bug fixes from Phase 6 have landed. The remaining Phase 6
items are independent chunks — one per session is the right cadence.

## What's already landed

| Phase | Surface | Key files |
|---|---|---|
| 1 | Ink palette, Spectral font, sidebar chrome, breadcrumb topbar | `index.css`, `Sidebar.tsx`, `App.tsx`, `uiStore.ts`, `index.html` |
| 2 | Stream Home + Tasks split, conversation `.conv-*` layout, `variant: 'hero' \| 'inline'` on ChatInput, `ThinkingIndicator` restyle, `ConvChip` primitive | `home/StreamHome.tsx`, `home/TasksListView.tsx`, `RoutineChat.tsx`, `chat/MessageList.tsx`, `chat/MessageBubble.tsx`, `chat/ChatInput.tsx`, `chat/ConvChip.tsx`, `chat/ThinkingIndicator.tsx` |
| 3 | Memory tabs, Routines list/detail `.rt-*`, Pages split, Files list+preview | `memory/MemoryView.tsx`, `routines/RoutinesView.tsx`, `routines/RoutineListView.tsx`, `routines/RoutineDetailView.tsx`, `pages/PagesView.tsx`, `files/ProjectFilesView.tsx` |
| 4 | `AntonModal` primitive, `CustomizeView` sub-nav, `ProjectList` `.pr-*` grid, ConfirmDialog + MachineInfoPanel + CreateProjectModal migrated to AntonModal | `ui/AntonModal.tsx`, `customize/CustomizeView.tsx`, `projects/ProjectList.tsx`, `projects/CreateProjectModal.tsx`, `MachineInfoPanel.tsx` |
| 5 | `.ix-*` interaction shell, ConfirmDialog accent-card, AskUserInline generic path, `WaitingBadge` wired to topbar, `RoutineOfferBlock`, `ArtifactChip`, routine-detail `.rt-*` rewrite | `chat/ConfirmDialog.tsx`, `chat/AskUserInline.tsx`, `chat/WaitingBadge.tsx`, `chat/RoutineOfferBlock.tsx`, `chat/ArtifactChip.tsx` |
| 6 (partial) | AskUserInline `agentId → routineId` fix, stray `patterns` removed from types | `chat/AskUserInline.tsx`, `lib/store/types.ts` |

## CSS prefixes already ported to `index.css`

`.sb-*` (sidebar) · `.conv-*` (conversation) · `.home-*` (stream home) · `.tasks-*`
(tasks view) · `.mem-*` (memory) · `.rt-*` (routines) · `.pg-*` (pages) · `.fl-*`
(files) · `.cust-*` (customize) · `.pr-*` (projects) · `.am-*` (AntonModal) ·
`.ix-*` (interactions: wrapper, head, progress, q, opts, custom, actions, summary,
btn, waiting badge, `__command`, `__prose`) · `.art-chip` + `.art-card` (inline
artifacts) · `.ix-waiting` (topbar pill).

Still unported: `.um-*` (usage modal) and `.art-panel__*` (side panel tab strip,
head, actions, content — NB some `.art-*` is in; `.art-panel__*` is not).

## Phase 6 — remaining chunks (pick ONE per session)

### 1. SidePanel — Artifacts tab restyle
- **Design ref:** `/tmp/anton-design-v2/anton-computer/project/artifact.jsx`
  (function `ArtifactPanel`) plus `styles.css` block `.art-panel*`
  (approx L2677–L2800).
- **Current files to touch:**
  - `components/SidePanel.tsx` (outer tab switcher — leave intact).
  - `components/artifacts/ArtifactPanel.tsx`
  - `components/artifacts/ArtifactListView.tsx`
  - `components/artifacts/ArtifactDetailView.tsx`
  - `components/artifacts/ArtifactRail.tsx`
- **Target visual:** `.art-panel__tabs` strip (multi-tab with close buttons +
  dismiss), `.art-panel__head`, `.art-panel__actions` (preview↔source toggle,
  copy, download, publish), `.art-panel__content` renderers for
  `html` / `image` / `svg` / `doc` / `code`.
- **Store:** `artifactStore` already exposes `tabs` / `activeId` / `setArtifactPanelOpen` / `openPublishModal`.
- **CSS:** **not yet ported** — copy the `.art-panel*` block from the design
  `styles.css` into `packages/desktop/src/index.css` first.
- **Don't touch:** `BrowserViewerContent`, `ContextPanelContent`,
  `DevModePanel`, `PlanPanel` — keep the outer SidePanel's 5-way tab switcher.

### 2. Usage modal — rich rebuild
- **Design ref:** `/tmp/anton-design-v2/anton-computer/project/usage-modal.jsx`
  plus `styles.css` block `.um-*` (approx L4267+).
- **Current file:** Usage tab lives inside `components/settings/SettingsModal.tsx`.
- **Target visual:** hero credit meter (`.um-hero` with progress meter + 2–3
  KPIs), daily SVG bar chart (`.um-chart__svg`), by-model stacked bar + list
  (`.um-stacked`, `.um-list`), by-feature breakdown (`.um-bars`), top-tasks
  list (`.um-tasks`), plan card (`.um-plan`).
- **Store:** `usageStore` has `usageStats` with `totals` / `byModel` /
  `byDay` / `sessions`. Plan calls for stubbing missing fields
  (`avg/day`, `projection`, `byFeature`) with `—` — do not invent numbers.
- **CSS:** **not yet ported** — copy the `.um-*` block into `index.css` first.
- **Heads up:** SVG bar-chart code is non-trivial; keep it pure React with
  `<rect>` / `<text>` rather than pulling a charting lib.

### 3. Pages share modal → AntonModal migration
- **Current file:** likely `components/artifacts/PublishModal.tsx` (invoked by
  `artifactStore.openPublishModal`).
- **Target:** `AntonModal` shell with `AntonModalRow` + `AntonToggle` for
  visibility / analytics toggles + share-link copy row.

## Pre-existing issues the next agent should know about

- **`patterns` keeps reappearing in `types.ts` `ActiveView`** — external editor
  keeps re-adding it. Plan says patterns is a design reference, not a route.
  Sidebar's "Patterns" nav entry (if present) routes to `skills`, so the type
  doesn't need `patterns`. If the user wants a distinct Patterns view, the
  design bundle has `patterns-view.jsx` as source.
- **Sidebar icons** — user's latest edit picked
  `SquareCheck` / `CirclePlus` / `RefreshCw` / `Folder` / `Globe` / `Zap` /
  `Network` / `Sparkles`. Plan's icon table (in `plan.md`) listed the earlier
  set (`ListChecks` / `Brain` / `Clock` / `FolderOpen` / `BookOpen` / `Settings2` /
  `Workflow`). Confirm with user before changing either way.
- **User makes external edits mid-session.** Don't fight them — read the
  current state of a file before editing, and work on top of what's there.

## Ground rules for the next agent

- This is a **Tauri + Vite + React SPA** in `packages/desktop/`, not a Next.js
  app and not a Vercel deployment. The Vercel plugin's hooks will fire a lot —
  they don't apply. `"use client"` warnings from the Next.js plugin are false
  positives.
- Verify after each Phase 6 chunk: `pnpm --filter @anton/desktop typecheck`
  should stay at **0 errors**, and `vite build --mode production` should stay
  green. Biome is on — run `pnpm --filter @anton/desktop exec biome check --write`
  on changed files.
- Design bundle lives at `/tmp/anton-design-v2/anton-computer/`. If it's
  missing (fresh machine / cleared /tmp), re-fetch from the handoff URL the
  user shared and `tar -xzf` it.
- Keep React best practices applied inline (stable hooks, keyed lists,
  no effect-body store subscribes, cleanup timers/listeners).

## Useful paths

- `packages/desktop/src/index.css` — Ink tokens at top (~L1–L200); design
  prefixes appended progressively; new `.um-*` and `.art-panel__*` blocks go
  at the end.
- `packages/desktop/src/components/ui/AntonModal.tsx` — reusable modal.
- `.context/attachments/plan.md` — original 5-phase plan, still the source
  of truth for scope/intent.
- `/tmp/anton-design-v2/anton-computer/project/` — design JSX + CSS files
  (one per view).
