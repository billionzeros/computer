# Multi-Format Attachments & `@` References

**Status:** Proposal — ready to implement
**Owners:** TBD
**Related:** `ProjectFilesView`, `ChatInput`, `RichInput`, `ArtifactPanel`, `agent-server` filesync channel

---

## 1. Goal

Extend the composer from image-only attachments to first-class support for
documents (PDF, DOCX), spreadsheets (CSV, XLSX), and plain text — and make
every file in the project reachable from the composer through `@` references,
with previews rendered in the artifact panel.

Design principle: **the project workspace filesystem is the single source of
truth.** No parallel upload store, no sidecar DBs, no hidden buckets. What the
user sees in the Files view is what the agent sees on disk.

---

## 2. Invariants (locked-in decisions)

1. **Files live in `activeProject.workspacePath`** (`~/Anton/<project>/`) at
   the location the user picks in the destination modal. No `/uploads/`
   directory, no `.anton/files.sqlite` sidecar.
2. **Path is the ID.** Pills store `{ path, name }` snapshots. No UUIDs.
3. **Images inline, everything else path-only.** Images remain vision blocks;
   all other kinds reach the model as a path reference; the model reads via
   `read` / `bash` on demand.
4. **Same modal everywhere.** Composer, Files view upload button, and drag-drop
   all open one destination picker → one `sendFilesystemWrite` call.
5. **`@` is a provider registry from day one.** Files + folders ship first;
   agents / web / chat slot in later without refactoring.
6. **Event-driven cleanup only.** Project delete removes the workspace; file
   delete removes the file. No GC cadence.
7. **No on-disk dedupe.** Disk is cheap; if two users upload the same bytes,
   we have two files. Acceptable.

---

## 3. Storage model

### 3.1 On-disk layout

Exactly what `ProjectFilesView` already renders — untouched:

```
~/Anton/<project-name>/                ← activeProject.workspacePath
├── .anton.json                        (existing; hidden by filter)
├── anton-pitch.html                   (existing)
├── data/                              (user-created folder)
│   └── sales_cycle.xlsx               (user-uploaded file, visible here)
├── references/
│   └── contract.pdf
└── scripts/
    └── existing-code.ts
```

Project metadata (`project.json`, `conversations/`, `context/`) stays in
`~/.anton/projects/<id>/` — separate concern, not touched by this spec.

### 3.2 APIs we reuse (no new server code for storage)

| Operation | Existing API | File |
|---|---|---|
| List directory | `connection.sendFilesystemList(path, showHidden)` | `connection.ts:514` |
| Write file | `connection.sendFilesystemWrite(path, content, 'base64')` | `ProjectFilesView.tsx:407` |
| Create folder | `connection.sendFilesystemMkdir(path)` | `ProjectFilesView.tsx:381` |
| Delete | `connection.sendFilesystemDelete(path)` | existing |
| Sandbox enforcement | `isPathWithinWorkspace()` | `server.ts:1404` |

### 3.3 One new primitive

Binary file read for artifact previews:

```ts
// new on connection.ts
sendFilesystemReadBytes(path: string): Promise<Uint8Array>

// new on server.ts filesync handler
case 'fs_read_bytes':
  await isPathWithinWorkspace(path)
  const bytes = await fs.readFile(path)
  return { ok: true, bytes: bytes.toString('base64') }
```

That's the only server-side addition for storage.

---

## 4. Upload flow (unified destination picker)

### 4.1 Entry points (all converge)

```
┌─ Composer "+" ────────┐
│ Add file              │──┐
│ Add folder            │  │
└───────────────────────┘  │
                            │
┌─ Files view ──────────┐   │    ┌── Destination Picker Modal ──┐
│ "Upload" button       │──┼───►│   (same component, same API)  │
└───────────────────────┘   │    └───────────────────────────────┘
                            │                   │
┌─ Drag-drop ───────────┐   │                   ▼
│ onto composer / Files │──┘          sendFilesystemWrite(path, b64)
└───────────────────────┘                        │
                                                 ▼
                              ProjectFilesView auto-refreshes
                              `@` index auto-updates
```

### 4.2 Destination picker modal

```
┌─ Save file to project ─────────────────────────────┐
│ Name:    sales_cycle.xlsx                          │
│                                                     │
│ Location:                                           │
│   📁 / (project root)                               │
│   ├── 📁 data              12 files                 │
│   ├── 📁 references         4 files                 │
│   └── 📁 scripts           21 files                 │
│                                                     │
│   [+ New folder]                                    │
│                                                     │
│ ☑ Attach to this message                            │
│                                                     │
│ 2.1 MB                    [Cancel]   [Save]  ⏎      │
└─────────────────────────────────────────────────────┘
```

Behavior:

- **Default destination** = most recently used folder for this mime family
  (xlsx/csv → `data/`, pdf → `references/`, images → `images/`). Create the
  folder on first use if missing.
- **Enter commits** with current defaults. Power users upload in one keystroke.
- **"+ New folder"** inline creates a folder under current selection via
  `sendFilesystemMkdir`.
- **Rename inline** — same modal can edit the filename before save.
- **"Attach to this message"** is checked by default when invoked from the
  composer, unchecked when invoked from the Files view.
- **Multiple files** → single picker, one destination applies to the batch.
- **Collision** (same name, same folder, different bytes) → macOS-style
  "Replace / Keep both / Cancel" sub-prompt.
- **Soft cap warning at 100MB**: "Large files upload faster via the Files
  view." One-click handoff; not a hard block.
- **Hard cap at 500MB** — reject.

### 4.3 Upload sequence (one path)

```
client                                      server
  │
  │  POST /fs_write { path, base64, sha, size, mime }
  ├────────────────────────────────────────►
  │                                           │
  │                                           ▼
  │                                  validate isPathWithinWorkspace
  │                                  check collision (exists at path?)
  │                                    ├─ no: write
  │                                    └─ yes + sha same: 204 (no-op)
  │                                       yes + sha diff: prompt-token
  │  ◄────────────────────────────────────────
  │  { ok: true, path, sha }
  │
  ▼
RichInput inserts [file:path] pill (if "Attach" was checked)
```

SHA is included for one reason: a same-path-same-bytes re-upload becomes a
silent no-op (no rewrite). No cross-project dedupe, no content-addressed
store, no hashing index.

---

## 5. `@` reference system

### 5.1 Provider registry (extensible)

```ts
interface MentionProvider {
  id: 'files' | 'agents' | 'web' | 'chat' | 'notes' | 'terminal'
  label: string          // section header in dropdown
  priority: number       // display order
  search(query: string): Promise<MentionItem[]>
  renderItem(item: MentionItem): ReactNode
  onSelect(item: MentionItem): { marker: string; pill: PillSpec }
}

interface MentionItem {
  id: string
  icon: IconComponent
  label: string
  secondary?: string      // "12 files · 2d ago", "data/", "Agent"
  kind: 'file' | 'dir' | 'agent' | 'web' | ...
  payload: unknown        // provider-specific
}
```

A central `mentionRegistry` aggregates providers; dropdown merges + sorts.

**Phase 1 ships:** `files` provider only. Future providers (`agents`, `web`,
`chat`) don't require dropdown or RichInput changes.

### 5.2 Files provider

```ts
{
  id: 'files',
  label: 'Files',
  priority: 10,
  search(query) {
    // walks workspace via sendFilesystemList recursively (lazy / cached)
    // returns both files and dirs
    // ranks: recency of reference > recency of upload > fuzzy match > alpha
  },
  onSelect(item) {
    if (item.kind === 'dir')  return { marker: `[dir:${item.payload.path}]`, pill: ... }
    if (item.kind === 'file') return { marker: `[file:${item.payload.path}]`, pill: ... }
  }
}
```

**Folders are first-class.** Typing `@email` → folder match, `@email/` scopes
into it, `@email/f` fuzzy-searches within.

### 5.3 Dropdown UI

```
@sal
┌──────────────────────────────────────────────┐
│ Files                                         │
│   📊 sales_cycle.xlsx   data/ · 2d ago        │
│   📄 sales_deck.pdf     references/ · 1w ago  │
│   📁 sales/             7 files · 3d ago      │
│   ──────                                      │
│ Agents                        (future)        │
│ Web                           (future)        │
└──────────────────────────────────────────────┘
```

- `↑/↓` nav, `enter` confirm, `tab` = confirm, `esc` dismiss
- Suppress inside code blocks / inline code (same as Markdown editors do)
- Typing `@sal ` (space, no match) reverts to literal text

### 5.4 Marker grammar (mirrors existing `[img:id]`)

| Marker | Meaning | Click behavior |
|---|---|---|
| `[img:<id>]` | Image (existing) | Artifact panel preview |
| `[file:<path>]` | File reference | Artifact panel preview |
| `[dir:<path>]` | Folder reference | Jump to Files view at path |
| `[agent:<id>]` (future) | Agent reference | n/a |

RichInput's existing marker → chip machinery handles all of these without
modification beyond rendering.

### 5.5 Pill component

Two visual variants:

```
[📊 sales_cycle.xlsx]           ← file pill (icon by mime)
[📁 email · 12]                  ← folder pill (count badge)
```

Common behavior:

- Backspace at pill boundary deletes the whole pill as one keystroke
- Click opens preview (file) or Files view (folder)
- Snapshot `{ path, name, mime?, count? }` stored in the pill token
- Display name resolved live from current filesystem state (so rename
  propagates automatically)
- Stale pill (path no longer exists) rendered dimmed + strikethrough + tooltip

---

## 6. Model consumption

### 6.1 What the harness sends

Two shapes:

**Images** → inline vision block (unchanged from today):

```
{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', data: '...', media_type: 'image/png' }},
    { type: 'text', text: '...' }
]}
```

**Everything else** → path reference in prose:

```
{ role: 'user', content: [{
  type: 'text',
  text: 'Summarize the regional breakdown in [📊 sales_cycle.xlsx]
         (~/Anton/my-project/data/sales_cycle.xlsx) against Q2 goals.'
}]}
```

### 6.2 Folder references with inline listings

Folder marker expansion depends on size:

```
≤20 items:
  "[📁 email] (~/Anton/my-project/email/)
   Contents: first.txt (1.2K), q2-plan.txt (3.4K), notes.md (800B), ..."

>20 items:
  "[📁 archive] (~/Anton/my-project/archive/) — 482 files"
```

Listings are shallow (immediate children only). Model walks deeper via tools
if needed.

### 6.3 Tools the model uses

No new tools required. The existing surface is sufficient:

- `read(path)` — text files (`agent-core/src/tools/read.ts`)
- `bash` — `pdftotext`, `pandoc`, `xlsx2csv`, `pandas`, `find`, `grep`, `ls`

**VM image additions** (ops work, not code): pre-install `pdftotext`,
`pandoc`, `xlsx2csv`, and `python3 + pandas + openpyxl` so the model can
process any format without user setup.

### 6.4 Why path-only beats parse-and-inline

| | Parse & inline | Path-only |
|---|---|---|
| Tokens for a 5MB xlsx | 50k+ per turn | ~30 tokens |
| Model reads only what it needs | No | Yes |
| New format = new parser | Yes | No |
| Harness complexity | High (per-mime routing) | None |

Locked in.

---

## 7. Artifact panel rendering

Desktop-side only. Lazy-loaded. Agent doesn't see these.

### 7.1 Extension to `Artifact` type

`lib/artifacts.ts`:

```ts
export type ArtifactRenderType =
  | 'code' | 'markdown' | 'html' | 'svg' | 'mermaid'   // existing
  | 'docx' | 'xlsx' | 'pdf' | 'image'                   // new

export interface Artifact {
  ...existing fields...
  source?: 'agent' | 'upload'     // default 'agent'
  sourcePath?: string              // workspace-relative; required for binary kinds
  mimeType?: string
  // content stays string-typed; binary kinds leave it empty
}
```

### 7.2 New renderers

`components/artifacts/ArtifactPanel.tsx` — extend the switch at line 110:

```tsx
case 'docx':  return <DocxRenderer  sourcePath={a.sourcePath!} />
case 'xlsx':  return <XlsxRenderer  sourcePath={a.sourcePath!} />
case 'pdf':   return <PdfRenderer   sourcePath={a.sourcePath!} />
case 'image': return <ImageRenderer sourcePath={a.sourcePath!} />
```

### 7.3 Renderer details

- **DocxRenderer**: `import('mammoth')` → `convertToHtml({ arrayBuffer })` →
  feeds into the existing `HtmlIframe` sandbox. Bytes fetched via
  `sendFilesystemReadBytes`.
- **XlsxRenderer**: `import('xlsx')` → parse → sheet tab bar + HTML table per
  sheet. Gate at 5000 rows/sheet with "Show all" escape. Formulas display as
  cached values (SheetJS default).
- **PdfRenderer**: `<embed src={objectUrl} type="application/pdf">` — Chromium
  renders natively, no lib.
- **ImageRenderer**: `<img src={objectUrl}>`.

All four fetch bytes lazily when the artifact is opened; nothing loads until
the user clicks.

### 7.4 Gating other actions on binary artifacts

`ArtifactPanel.tsx` tweaks:

- `handleDownload` (line 188) — for `sourcePath`-backed artifacts, download
  bytes from `sourcePath` instead of wrapping `content` as a Blob.
- `handleCopy` (line 174) — hide / disable for binary kinds; swap to "Copy
  path".
- `canToggle` (line 206) — confirm new kinds stay excluded from source/preview
  toggle.

### 7.5 Upload → artifact bridge

When an upload completes, push into `artifactStore`:

```ts
artifactStore.add({
  id: `upload_${path}`,
  type: 'file',
  source: 'upload',
  renderType: classifyMime(mime),   // docx / xlsx / pdf / image
  filename: name,
  sourcePath: path,
  mimeType: mime,
  conversationId,
  content: ''                        // binary — unused
})
```

Now uploads appear in the Files sidebar section AND in the artifact tabs when
the user clicks a pill. Same data shape, one pipeline.

---

## 8. Trade-offs explicitly accepted

| Choice | Consequence | Why acceptable |
|---|---|---|
| Path as ID | Rename/move breaks historical pills | Rare in practice; stale pills render gracefully |
| No on-disk dedupe | Same bytes twice = two files | Disk cheap; avoids parallel blob store |
| Shallow folder listings only | Model may need extra `ls` calls | Keeps prompt lean; tool calls are cheap |
| Images stay inline base64 | Larger protocol payloads than path-only | Vision is the whole point; inline is correct |
| No file_id UUIDs | Can't distinguish two same-named files across moves | Reduced complexity beats edge case |

---

## 9. Explicit non-goals

- Cross-project file sharing or references
- On-disk dedupe or content-addressed storage
- Blob / symlink tree
- SQLite sidecar for file metadata
- `.filename.meta.json` per-file sidecars
- Filesystem watcher (the existing refresh-on-write handles it)
- Version history of uploaded files
- OCR / AI extraction at upload time
- Harness-side XLSX / DOCX parsing
- Auto-tagging
- Full-text search across uploads (v2)

---

## 10. Implementation phases

### Phase 1 — Foundation (unblocks everything else)

- Add `sendFilesystemReadBytes` on `connection.ts` + server handler
- Extend `ChatAttachment` type (or introduce `ChatFileReference` alongside
  existing `ChatImageAttachment`)
- Extend `Artifact` type with `source`, `sourcePath`, `mimeType` fields
- Classification helper: `classifyMime(mime) → renderType`

### Phase 2 — Destination-picker modal + upload from composer

- New component `components/files/DestinationPicker.tsx`
- Composer `+` menu entries: "Add file", "Add folder"
- Wire drag-drop on composer to open picker
- Soft-cap nudge + hard-cap rejection
- Files view "Upload" button routed through the same picker

### Phase 3 — `@` provider registry + files provider

- New `lib/mentions/registry.ts` (provider interface + aggregator)
- `lib/mentions/filesProvider.ts` (walks workspace, fuzzy ranks)
- Dropdown UI component (grouped sections mirroring existing `@` mock)
- Keyboard nav + suppress-in-code-block
- Recent-references cache (in-memory, per-project)

### Phase 4 — Pills in RichInput

- Marker parser extension: `[file:...]`, `[dir:...]`
- Pill component (file variant, folder variant)
- Backspace-deletes-whole-pill behavior
- Stale-pill rendering
- Click handlers (file → artifact panel; folder → Files view)

### Phase 5 — Harness path-reference injection

- `buildInterleavedContent` in `agent-core/src/session.ts`:
  - Keep image handling
  - Translate `[file:path]` → prose with absolute path
  - Translate `[dir:path]` → prose with listing (≤20 inline) or path-only
- Remove any image-specific branching that blocks other mimes

### Phase 6 — Artifact panel renderers

- Add `DocxRenderer`, `XlsxRenderer`, `PdfRenderer`, `ImageRenderer`
- Switch-case in `ArtifactBody`
- Lazy imports of `mammoth`, `xlsx`
- Download / copy / toggle gating for binary kinds

### Phase 7 — Upload → artifact store bridge + Files sidebar section

- On upload completion, push `source: 'upload'` artifact
- Group `SessionFilesBar` by source (Uploads vs Artifacts sections)

### Phase 8 — VM image hardening (ops)

- Pre-install `pdftotext`, `pandoc`, `xlsx2csv`, `python3 + pandas + openpyxl`
- Confirm `read(path)` tool works on common text encodings

### Phase 9 — Polish

- Smart default folders per mime family
- Recent-folder memory for destination picker
- Drag-drop onto Files view (not just composer)
- Multi-file batch upload in one picker invocation

---

## 11. Files touched

### New

- `packages/desktop/src/components/files/DestinationPicker.tsx`
- `packages/desktop/src/components/mentions/MentionDropdown.tsx`
- `packages/desktop/src/components/chat/FilePill.tsx`
- `packages/desktop/src/components/chat/FolderPill.tsx`
- `packages/desktop/src/components/artifacts/DocxRenderer.tsx`
- `packages/desktop/src/components/artifacts/XlsxRenderer.tsx`
- `packages/desktop/src/components/artifacts/PdfRenderer.tsx`
- `packages/desktop/src/components/artifacts/ImageRenderer.tsx`
- `packages/desktop/src/lib/mentions/registry.ts`
- `packages/desktop/src/lib/mentions/filesProvider.ts`
- `packages/desktop/src/lib/mentions/types.ts`

### Modified

- `packages/desktop/src/components/chat/ChatInput.tsx` — `+` menu, drop, paste
- `packages/desktop/src/components/chat/RichInput.tsx` — marker parsing, pills
- `packages/desktop/src/components/files/ProjectFilesView.tsx` — route Upload
  button through destination picker
- `packages/desktop/src/components/artifacts/ArtifactPanel.tsx` — switch case,
  download / copy gating
- `packages/desktop/src/components/chat/SessionFilesBar.tsx` — Uploads section
- `packages/desktop/src/lib/artifacts.ts` — extend type
- `packages/desktop/src/lib/store.ts` — extend `ChatAttachment`
- `packages/desktop/src/lib/connection.ts` — `sendFilesystemReadBytes`
- `packages/agent-server/src/server.ts` — `fs_read_bytes` handler
- `packages/agent-core/src/session.ts` — marker translation
- `packages/protocol/src/messages.ts` — extend attachment shape if needed

### Deps

- `mammoth` (~400KB; dynamic import in DocxRenderer)
- `xlsx` / SheetJS CE (~800KB; dynamic import in XlsxRenderer)
- `fuse.js` optional for fuzzy ranking in `@` (or a 30-line substring scorer)

### VM image

- `apt install poppler-utils pandoc`
- `pip install pandas openpyxl`

---

## 12. Testing plan

### Manual golden paths

1. Composer "+ Add file" → pick xlsx → destination modal → save to `data/` →
   pill appears → send → model receives prose with path → model calls
   `read`/`pandas` → answers
2. Drag PDF onto composer → picker → saves to `references/` → pill → click
   pill → artifact panel shows native PDF embed
3. Type `@sal` → dropdown → pick `sales_cycle.xlsx` → pill inserted → send →
   model sees path
4. Type `@ema` → pick `email/` folder → pill → send → model sees folder
   listing prose
5. Upload file via Files view "Upload" → destination picker → lands in the
   right folder, visible in Files view immediately
6. Rename `sales.xlsx` → `q2_sales.xlsx` in Files view → historical pill
   still renders updated name (live resolution from filesystem)
7. Delete uploaded file → historical pill renders as stale (dimmed)
8. Open Docx / Xlsx / PDF artifact — each renders correctly, download
   works, copy is appropriately disabled

### Edge cases

- 100MB upload warns, 500MB rejects
- Same-path-same-bytes re-upload short-circuits silently
- Same-path-different-bytes upload prompts Replace/Keep both/Cancel
- `@` inside inline code / code block doesn't open dropdown
- Paste 4 files → single picker, batch destination
- Large folder (1000 files) → `@` ref skips inline listing
- Stale pill after rename renders without crashing

### Automated

- Unit tests for marker parser (`[file:]`, `[dir:]`, `[img:]` interleaving)
- Unit tests for mime classification → renderType
- Unit tests for folder listing size decision (≤20 inline vs path-only)
- Server-side `isPathWithinWorkspace` fuzz tests on traversal attempts
- Integration test: end-to-end upload → pill → send → agent receives
  prose with correct path

---

## 13. Resolved decisions

1. **Per-project quota**: none. The VM has its own filesystem limits; we don't
   add a product-level cap. Server still rejects >500MB per file.
2. **Multi-select `@`**: no. One item per invocation. Multiple references =
   multiple `@`s. Keeps the dropdown, keyboard model, and pill insertion simple.
3. **Tags on files**: out for v1. Folders cover organization.
4. **Pill resolution**: live. Display name, icon, and preview are always
   sourced from the filesystem at render time. Rename a file → every historical
   pill updates automatically. Delete a file → pill renders stale.

---

## 13a. Production readiness checklist

### Security

- **Path traversal**: every write / read / list passes through
  `isPathWithinWorkspace()` (already exists). `fs_read_bytes` handler must use
  the same check. Unit tests for `../` escapes, symlink following, Windows
  reserved names, NTFS ADS, long-path edge cases.
- **Filename sanitization**: reject or sanitize null bytes, control chars,
  leading dots, reserved names (`CON`, `PRN`, `.`, `..`). Server does the
  enforcement, not the client.
- **Max-path-length check** (Linux 4096; HFS+ 255 per component).
- **Magic-byte mime verification on server** — don't trust the client's
  declared MIME. We keep the user-supplied filename/extension but log a
  warning if the detected MIME disagrees with the extension.
- **Zip-bomb-style resource exhaustion** — not an issue for storage (we don't
  auto-unpack), but relevant if we ever add preview extraction; flagged for
  future.
- **Binary preview content in sandboxed iframes** — `HtmlIframe` already sets
  `sandbox="allow-scripts allow-forms allow-modals allow-popups"`. DocxRenderer
  output goes through it. XlsxRenderer renders via React (no iframe).

### Reliability

- **Partial write protection**: write to `<name>.tmp-<nonce>` then atomic
  `rename`. No reader ever sees a half-written file.
- **Disk-full handling**: `ENOSPC` returns a typed error → UI toast with
  "Project out of disk space."
- **Permission denied** on target directory → typed error → UI toast.
- **Concurrent uploads with same target name**: second upload sees the first
  as a collision and triggers the Replace/Keep both/Cancel prompt.
- **Orphaned temp files**: boot-time sweep of `*.tmp-*` in workspace cleans
  any leftovers from crashed uploads.
- **Message send while upload in progress**: block Send until all pending
  uploads resolve; pill chip shows progress bar.

### Performance

- **Streaming uploads** rather than base64-in-memory when >5MB: client
  chunks into 1MB pieces; server appends. Base64 stays in-memory for small
  files where the overhead is negligible.
- **Lazy renderer bundles**: `mammoth` and `xlsx` only loaded when a docx /
  xlsx artifact is opened. Confirmed via bundle analyzer during rollout.
- **`@` index cache**: walk the workspace once on project open, maintain a
  client-side in-memory index, invalidate on filesystem events. No server
  round-trip per keystroke.
- **XLSX render gate**: refuse to render sheets >5000 rows eagerly; show a
  "Load all rows" button.
- **Binary byte transport**: `fs_read_bytes` returns base64 (not raw
  binary) — acceptable for files up to ~50MB; above that we revisit.

### Observability

- **Upload telemetry**: success rate, error categories (quota, permission,
  disk full, client abort, network), p50 / p99 duration by size bucket.
- **Renderer error rates**: mammoth failure, SheetJS failure, PDF embed
  blocked. Surface aggregated to product.
- **`@` usage**: items offered vs. items selected, time-to-select, empty
  searches (for relevance tuning).
- **Log lines are structured** (JSON) not free-text, using existing
  `agent-server` logging conventions.

### Accessibility

- **Destination picker** is keyboard-navigable (tab, arrow, enter, esc).
  ARIA roles on modal, folder list, and breadcrumbs.
- **`@` dropdown** is a listbox with `aria-activedescendant`. Announces
  "N results for <query>" via aria-live.
- **Pills** have `role="button"`, keyboard-focusable, enter opens preview,
  backspace deletes.
- **Artifact renderers** forward `aria-label` from filename.

### Internationalization

- **Filenames** preserved verbatim (UTF-8 on Linux). No normalization.
- **UI copy** routed through the project's existing i18n mechanism (or added
  as a TODO if none yet).

### Rollout

- **Feature flag** `ENABLE_MULTI_FORMAT_ATTACHMENTS` gating Phase 2–9 UI
  changes. Phase 1 (foundation) is API-additive and ships unflagged.
- **Fallback path**: if a pill's marker can't be resolved (e.g., provider
  registry not yet loaded), render as plain text so messages never blow up.
- **Migration**: no stored data changes for existing sessions; old messages
  keep rendering. New markers only appear in new messages.

### Failure modes and recovery

| Failure | User-visible result | Recovery |
|---|---|---|
| Upload network drop mid-stream | Toast: "Upload failed, retry?" | Retry button; partial file cleaned on server |
| `fs_read_bytes` for deleted file | Artifact shows "File no longer exists" | User deletes artifact tab |
| Mammoth throws on malformed docx | Artifact shows "Couldn't render. Open file externally." | Download button still works |
| XLSX sheet with formulas referencing externals | Shows cached values; note "Some formulas reference external workbooks" | User opens file in Excel |
| `@` dropdown empty on fresh project | Shows "No files yet — upload one to reference here" | Link to destination picker |
| Pill to a file in a folder the user deleted | Dimmed "File deleted" state | Remove pill manually or restore file |
| Concurrent same-path-same-bytes upload | Server returns `dedupe_hit: true`, client silently uses existing | None needed |

---

## 14. Minimum viable slice (if we want a vertical prototype first)

If we want a quick demo before building all 9 phases end-to-end:

1. `sendFilesystemReadBytes` + `+ Add file` → saves to project root (no
   picker, no folder choice)
2. Pill renders in composer for the uploaded file
3. Harness injects path prose
4. `XlsxRenderer` in artifact panel (one renderer only, to show the
   preview story)

This slice proves the end-to-end flow in ~1 week. Full spec is ~4–6 weeks.

---

## 15. Summary diagram

```
       DESKTOP                                      SERVER (VM)
 ┌───────────────────────────────────┐    ┌──────────────────────────────┐
 │                                    │    │                              │
 │  Composer "+" ─┐                   │    │  Channel.FILESYNC            │
 │  Files Upload ─┼─► DestinationPicker│    │    fs_list                  │
 │  Drag-drop ────┘          │        │    │    fs_write                  │
 │                           ▼        │    │    fs_mkdir                  │
 │              sendFilesystemWrite ──┼───►│    fs_read                   │
 │                                    │    │    fs_read_bytes (new)       │
 │  RichInput:                        │    │                              │
 │    [file:path]  [dir:path]         │    │  sandboxed to workspacePath  │
 │    [img:id]     (existing)         │    │                              │
 │    pills + markers                 │    │   ~/Anton/<project>/         │
 │                                    │    │     data/sales_cycle.xlsx    │
 │  @ MentionDropdown                 │    │     references/contract.pdf  │
 │    providers: files (dirs+files)   │    │     email/first.txt          │
 │    future: agents, web, chat       │    │                              │
 │                                    │    │  Agent cwd = workspacePath   │
 │  ArtifactPanel renderers:          │    │    reads files directly:     │
 │    Docx → mammoth                  │    │      read(./data/...)        │
 │    Xlsx → SheetJS                  │    │      bash: pandas, pandoc,   │
 │    Pdf  → <embed>                  │    │            pdftotext, ...    │
 │    Image→ <img>                    │    │                              │
 │                                    │    │                              │
 │  ProjectFilesView (unchanged)      │    │                              │
 │    auto-refreshes on writes        │    │                              │
 │                                    │    │                              │
 └───────────────────────────────────┘    └──────────────────────────────┘
```

---

**Next step:** confirm open questions (§13), then start Phase 1.
