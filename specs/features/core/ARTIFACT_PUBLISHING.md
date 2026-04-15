# Artifact Publishing

Public URL serving for agent-created artifacts, with a publish modal, metadata tracking, view counting, and social sharing.

## URL Scheme

| Type | URL | Source Directory |
|------|-----|-----------------|
| Standalone artifact | `{host}/a/{slug}` | `~/.anton/published/{slug}/index.html` |
| Project public file | `{host}/p/{project-name}/{path}` | `~/Anton/{project-name}/public/{path}` |

## Directory Layout

```
~/.anton/published/
├── index.json              # Metadata index (all published artifacts)
└── {slug}/
    ├── index.html          # Full HTML document (server-side rendered)
    └── og.svg              # Open Graph image (1200×630 SVG)

~/Anton/{project-name}/
├── public/                 # Project public files (served by Caddy)
│   ├── index.html
│   └── ...
└── published/              # Symlinks to published artifacts from this project
    └── {slug}.html → ~/.anton/published/{slug}/index.html
```

## Caddy Routing

Added to the existing Caddyfile (before the catch-all reverse_proxy):

```
${DOMAIN} {
    handle /a/* {
        uri strip_prefix /a
        root * /home/anton/.anton/published
        file_server
    }
    handle /p/* {
        uri strip_prefix /p
        root * /home/anton/Anton
        file_server
    }
    reverse_proxy localhost:${AGENT_PORT}
}
```

Routes are ordered: `/a/*` and `/p/*` match first, everything else falls through to the agent WebSocket.

The `cloud-init.sh` script creates `~/.anton/published/` at provision time and sets `chmod 755 /home/anton` so the Caddy user can traverse to serve published files.

## Metadata Index

**File:** `packages/agent-config/src/published.ts`

Tracks all published artifacts in `~/.anton/published/index.json`.

```typescript
interface PublishedArtifactMeta {
  slug: string
  artifactId?: string         // Unique artifact ID — used for slug collision detection
  title: string
  type: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
  language?: string
  description?: string        // First 200 chars of content, stripped of markdown
  createdAt: number           // Timestamp, preserved on re-publish
  updatedAt: number           // Timestamp, updated on every save
  projectId?: string          // Source project association
  views: number               // Incremented by view beacon, preserved on re-publish
}
```

### API

| Function | Description |
|----------|-------------|
| `listPublished()` | Returns all metadata entries |
| `getPublished(slug)` | Returns single entry or `null` |
| `savePublishedMeta(meta)` | Upsert by slug. On update: preserves `createdAt` and `views` from existing entry |
| `removePublished(slug)` | Removes metadata entry and deletes slug directory. Validates slug format before any filesystem operation |
| `incrementViews(slug)` | Increments view counter and updates `updatedAt` |

### Slug Validation

All functions that use a slug in filesystem paths validate against `/^[a-zA-Z0-9_-]+$/` to prevent path traversal:
- `executePublish()` throws on invalid slugs
- `removePublished()` silently returns on invalid slugs
- The view counter HTTP endpoint validates before calling `incrementViews()`

## Publish Tool

Agent tool `publish` — renders content as a self-contained HTML document with server-side rendering.

**File:** `packages/agent-core/src/tools/publish.ts`

### Input

```typescript
interface PublishInput {
  title: string
  content: string
  type: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
  language?: string       // For code type
  slug?: string           // Custom URL slug; auto-generated 8-char hex if omitted
}
```

### Content Conversion

All rendering happens server-side at publish time. Each type produces a complete HTML document via `buildPage()` which injects base styles, OG meta tags, Twitter Card tags, and a view-counting beacon script.

| Type | Rendering |
|------|-----------|
| `html` | If full document (`<!DOCTYPE` or `<html>`): strips any previously injected OG/Twitter meta and view script, then injects fresh tags into `<head>` and view beacon before `</body>`. Otherwise: wraps in `buildPage()` |
| `markdown` | Server-side rendered via `marked` (GFM mode). Dark theme with styled prose |
| `svg` | Inline SVG in centered viewport |
| `mermaid` | Mermaid CDN script (requires DOM, no server-side option) |
| `code` | Styled `<pre><code>` with language header, copy button with clipboard JS |

### Shared Design System

All published pages use a dark theme with CSS custom properties:
- `--bg: #0a0a0a`, `--bg-surface: #141414`, `--bg-elevated: #1a1a1a`
- `--text: #e5e5e5`, `--text-muted: #999`, `--text-dim: #666`
- `--accent: #60a5fa`, `--border: #262626`
- System font stack + monospace fallback

Each page includes a footer: "Published with Anton" linking to antoncomputer.in.

### OG Image Generation

Each published artifact gets an `og.svg` (1200×630) generated at publish time:
- Dark background with artifact title
- Color-coded type badge (html: blue, markdown: purple, svg: green, mermaid: pink, code: amber)
- Brand text (domain or "Anton")

Referenced via `og:image` and `twitter:image` meta tags for social sharing previews.

### View Tracking

A `<script>` beacon is injected into every published page:
```javascript
fetch('/_anton/views/{slug}', { method: 'POST', keepalive: true }).catch(function(){})
```

The server handles `POST /_anton/views/:slug` — validates the slug format, calls `incrementViews()`, returns 204.

### Output

Returns confirmation string: `Published "{title}" → https://{domain}/a/{slug}`

### Domain Resolution

The `ANTON_HOST` env var (set by cloud-init) flows through:
1. `cloud-init.sh` → writes to `~/.anton/agent.env`
2. `server.ts` → reads `process.env.ANTON_HOST`, passes to `executePublish()`
3. `publish.ts` → uses domain for URL generation, OG meta, and OG image branding

## Publish Modal

**File:** `packages/desktop/src/components/artifacts/PublishModal.tsx`

A modal dialog that replaces the old inline publish button. Provides slug customization, preview, and post-publish sharing.

### Form State

- **Name** — editable title, defaults to artifact title/filename
- **Slug** — auto-derived from name via `slugify()` (lowercase, alphanumeric + hyphens, max 48 chars). Can be manually overridden; manual edits disable auto-derive
- **Slug input filter** — client-side filter restricts to `[a-zA-Z0-9_-]`
- **Preview URL** — shows `/a/{slug}` live as user types
- **Type badge** — displays the artifact's render type

### Publish Flow

1. User clicks "Publish" in `ArtifactDetailView` → opens modal via `openPublishModal(artifactId)`
2. User edits name/slug → clicks "Publish" button (disabled until slug is non-empty)
3. `publishArtifact()` sends WebSocket message with `artifactId`, `content`, `contentType`, `title`, `projectId`, `slug`
4. Server validates slug collision → if taken by different artifact, returns error response
5. On success: modal transitions to success state with animated Framer Motion crossfade
6. On error: modal shows error message above publish button, user can edit slug and retry

### Success State

After publishing, the modal shows:
- Green checkmark with "Your page is live"
- Live URL as clickable link
- Action buttons: Copy link, Twitter share, LinkedIn share, Embed (copies `<iframe>` snippet)
- "Done" button to close

### Slug Collision

Server-side check before publishing: if the slug is already taken by a different artifact (compared by `artifactId`), the server returns `success: false` with an error message. The modal displays the error and the user can change the slug. Re-publishing the same artifact to the same slug is always allowed (title changes are fine).

## Protocol Messages

### Client → Server: `publish_artifact`

Direct publish from the UI (bypasses LLM). Sent on the AI channel. Handled by `server.ts` `handlePublishArtifact()`.

```typescript
interface PublishArtifactMessage {
  type: 'publish_artifact'
  artifactId: string
  title: string
  content: string
  contentType: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
  language?: string
  slug?: string
  projectId?: string          // Associates the published artifact with a project
}
```

### Server → Client: `publish_artifact_response`

```typescript
interface PublishArtifactResponse {
  type: 'publish_artifact_response'
  artifactId: string
  publicUrl: string
  slug: string
  success: boolean
  error?: string              // Human-readable error (e.g. slug collision)
}
```

### Server → Client: `artifact_published` (event channel)

Emitted alongside `publish_artifact_response` for real-time UI updates.

```typescript
interface ArtifactPublishedEvent {
  type: 'artifact_published'
  artifactId: string
  slug: string
  publicUrl: string
}
```

## Server-Side Publish Handler

**File:** `packages/agent-server/src/server.ts` — `handlePublishArtifact()`

The server handler orchestrates the full publish pipeline:

1. **Slug collision check** — queries `getPublished(slug)`, rejects if taken by different artifact
2. **Execute publish** — calls `executePublish()` which renders HTML, writes files, generates OG image
3. **Save metadata** — calls `savePublishedMeta()` with full metadata including `projectId`
4. **Project symlink** — if `projectId` is present and project has a `workspacePath`, creates symlink: `{workspacePath}/published/{slug}.html → ~/.anton/published/{slug}/index.html`. Removes existing symlink on re-publish. Non-fatal on failure.
5. **Response** — sends `publish_artifact_response` back to client

## Artifact UI Architecture

### Two-Tier Display: Rail + SidePanel

Artifacts are shown in a **persistent rail** (compact sidebar) and a **detail SidePanel** (full preview on click).

```
┌──────────┬─────────────────────┬────────────┐
│ Sidebar  │  Chat (AgentChat)   │ Artifact   │
│ (240px)  │  (flex: 1)          │ Rail       │
│          │                     │ (180px)    │
│          │                     │            │
└──────────┴─────────────────────┴────────────┘
                                  ↕ SidePanel overlays on artifact click
```

- **Artifact Rail** — Always visible when artifacts exist. Shows compact list (icon + title + badge). Clicking opens the SidePanel detail view. Dismissible via X button (session-scoped).
- **SidePanel** — Opens on demand for full artifact preview, search/filter, and publishing. Not auto-opened on artifact creation.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| `ArtifactRail` | `ArtifactRail.tsx` | Persistent right-side rail: compact artifact list with dismiss |
| `ArtifactPanelContent` | `ArtifactPanel.tsx` | SidePanel orchestrator: routes to empty/list/detail |
| `ArtifactEmptyState` | `ArtifactEmptyState.tsx` | Centered empty state with icon + message |
| `ArtifactListView` | `ArtifactListView.tsx` | Search bar + filter chips + scrollable artifact list |
| `ArtifactListItem` | `ArtifactListItem.tsx` | Single artifact row: icon, title, badge, time, published dot |
| `ArtifactDetailView` | `ArtifactDetailView.tsx` | Full preview with back button, actions, opens publish modal |
| `PublishModal` | `PublishModal.tsx` | Modal for slug customization, publishing, and sharing |

### Artifact Type Icons

| Render Type | Icon (lucide-react) |
|-------------|-------------------|
| html | `Sparkles` |
| code | `Braces` |
| markdown | `FileCode` |
| svg | `SquareCode` |
| mermaid | `Network` |

Used consistently across `ArtifactRail`, `ArtifactListItem`, and `ArtifactCard`.

### Inline Chat Display

Artifact cards appear inline in the chat within tool call groups. All three group types render artifacts:

- **ActionsGroup** — matches artifacts by `toolCallId` against action call IDs
- **TaskSection** — same matching logic (step narration + actions merged groups)
- **SubAgentGroup** — same matching logic (sub-agent nested groups)

`ArtifactCard` supports:
- Expand/collapse for HTML/SVG previews (ChevronUp/ChevronDown)
- Dismiss button (X) to hide individual cards
- Click meta area to open detail in SidePanel

### View Flow

```
ArtifactRail (persistent, right of chat)
  └── Click item → opens SidePanel with ArtifactDetailView

ArtifactPanelContent (inside SidePanel)
  ├── artifacts.length === 0 → ArtifactEmptyState
  ├── artifactViewMode === 'list' → ArtifactListView
  └── artifactViewMode === 'detail' → ArtifactDetailView
       └── Click "Publish" → opens PublishModal
            ├── Form state → user edits name/slug → Publish
            └── Success state → copy link, share, embed, done
```

### Store State

```typescript
// State
artifactSearchQuery: string
artifactFilterType: 'all' | ArtifactRenderType
artifactViewMode: 'list' | 'detail'
publishModalOpen: boolean
publishModalArtifactId: string | null
publishError: string | null

// Actions
setArtifactSearchQuery(query)
setArtifactFilterType(type)
setArtifactViewMode(mode)
updateArtifactPublishStatus(artifactId, url, slug)
openPublishModal(artifactId)       // Opens modal, clears any previous error
closePublishModal()                // Closes modal, clears error
setPublishError(error)             // Sets error message from server response
publishArtifact(artifactId, content, renderType, title, projectId, slug)
```

**Key behavior**: `addArtifact()` sets `activeArtifactId` but does NOT auto-open the SidePanel. The rail provides passive visibility; the SidePanel opens only on explicit user click.

### Artifact Type Extensions

```typescript
interface Artifact {
  // ... existing fields ...
  publishedUrl?: string      // Public URL after publishing
  publishedSlug?: string     // URL slug
  publishedAt?: number       // Timestamp
  conversationId?: string    // Source conversation
  projectId?: string         // Source project
}
```

### Detail View Actions

- **Preview/Source toggle** — switch between rendered and raw views
- **Copy** — copy artifact content to clipboard
- **Download** — client-side blob download with correct filename/extension
- **Publish** — opens PublishModal for slug customization and publishing
- **Copy URL** — copies published URL to clipboard (visible only when published)

### SidePanel Changes

- `MAX_WIDTH`: 1100
- `DEFAULT_WIDTH`: 440
- Includes tabs for: Browser, Artifacts, Plan, Context (when available)

## Security

- Published files are static HTML only — no server-side execution
- Caddy's `file_server` serves files as-is with proper MIME types
- HTML artifacts use standard browser security (same-origin policy)
- No authentication on published URLs (intentionally public)
- Systemd `ReadWritePaths` updated to include `/home/anton/Anton`
- **Slug validation**: All slug-to-path operations validate against `/^[a-zA-Z0-9_-]+$/` to prevent path traversal attacks. Server-side validation in `executePublish()` (throws), `removePublished()` (silent return), and the view counter endpoint (ignores invalid slugs)
- **Slug collision**: Server checks for existing slugs before overwriting to prevent accidental data loss

## Known Limitations

- **Metadata is single-writer**: The JSON index file has no locking. Concurrent publishes or rapid view increments could lose writes due to read-modify-write races. Acceptable for single-user usage.
- **Legacy entries without `artifactId`**: Entries published before the `artifactId` field was added will have `artifactId: undefined`. The collision check allows these to be overwritten by any artifact (graceful degradation rather than blocking).

## Files Modified

### Backend
- `packages/agent-config/src/config.ts` — `PUBLISHED_DIR`, `getPublishedDir()`, `getProjectPublicDir()`
- `packages/agent-config/src/published.ts` — metadata index: CRUD, view counting, slug validation
- `packages/agent-config/src/index.ts` — re-exports published module
- `packages/agent-config/src/projects.ts` — `mkdirSync` for nested paths in `saveProjectFile`
- `packages/agent-core/src/tools/publish.ts` — publish tool: server-side rendering, OG generation, slug validation
- `packages/agent-core/package.json` — `marked` dependency for server-side markdown
- `packages/agent-core/src/agent.ts` — register publish tool, `domain` in `ToolCallbacks`
- `packages/agent-core/src/index.ts` — export `executePublish`
- `packages/agent-core/src/session.ts` — `domain` in createSession opts
- `packages/agent-server/src/server.ts` — `handlePublishArtifact()` with collision check, metadata save, view counter endpoint, project symlinks
- `packages/protocol/src/messages.ts` — publish message types + event
- `infra-providers/huddle/cloud-init.sh` — Caddy routes, published dir creation, home dir permissions

### Frontend
- `packages/desktop/src/lib/artifacts.ts` — extended Artifact type, helpers
- `packages/desktop/src/lib/store/artifactStore.ts` — publish modal state, error handling, extended `publishArtifact` signature
- `packages/desktop/src/lib/store/handlers/toolHandler.ts` — handles publish error responses
- `packages/desktop/src/components/artifacts/ArtifactRail.tsx` — persistent right-side artifact rail
- `packages/desktop/src/components/artifacts/ArtifactPanel.tsx` — SidePanel orchestrator
- `packages/desktop/src/components/artifacts/ArtifactEmptyState.tsx` — empty state
- `packages/desktop/src/components/artifacts/ArtifactListView.tsx` — search + filter + list
- `packages/desktop/src/components/artifacts/ArtifactListItem.tsx` — single artifact row
- `packages/desktop/src/components/artifacts/ArtifactDetailView.tsx` — full preview, opens publish modal
- `packages/desktop/src/components/artifacts/PublishModal.tsx` — publish modal with slug editing, sharing
- `packages/desktop/src/components/chat/ArtifactCard.tsx` — expand/collapse, dismiss
- `packages/desktop/src/components/chat/TaskSection.tsx` — renders artifact cards
- `packages/desktop/src/components/chat/SubAgentGroup.tsx` — renders artifact cards
- `packages/desktop/src/components/SidePanel.tsx` — DEFAULT_WIDTH 440, browser tab support
- `packages/desktop/src/App.tsx` — renders ArtifactRail in workspace-body
- `packages/desktop/src/index.css` — artifact styles, publish modal styles, error state
