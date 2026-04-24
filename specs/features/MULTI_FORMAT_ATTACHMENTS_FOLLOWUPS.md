# Multi-Format Attachments — Follow-ups

**Related:** `MULTI_FORMAT_ATTACHMENTS.md`

Bugs and rough edges surfaced by a post-ship self-review. Grouped by
severity; the critical + high ones block "production ready" and should
land before anyone relies on the feature.

---

## 🔴 Critical

### F1. DestinationPicker state thrashes on every ChatInput re-render

**Phase:** 9
**Symptom:** Breadcrumb nav, filename edits, "New folder" inline state,
attach checkbox, error state all reset unpredictably while the picker is
open. Any zustand-driven re-render of the parent triggers it.

**Root cause:** `files` and `initialFolder` are computed **inline** when
mounting `<DestinationPicker>` in `ChatInput.tsx`, producing fresh
array/object references every parent render. The picker's reset
`useEffect` has `files` in its dep list, so it fires every render.

```tsx
files={pendingFiles.map((f) => ({ ... }))}           // new array every render
initialFolder={resolveInitialFolder(...).folderRelPath}
```

**Fix:** `useMemo` the `files` array and the `initialFolder` string in
ChatInput, keyed on `pendingFiles`.

---

## 🔴 High

### F2. XlsxRenderer "Show all rows" button is a no-op

**Phase:** 6
**Symptom:** Users with sheets > 5000 rows click "Show all" — nothing
changes.

**Root cause:** On parse, we slice rows down to `EAGER_ROW_CAP` and
discard the rest. The `rowsToRender` memo returns `active.rows`
regardless of the `showAllRows` flag because we never stored the full
rowset.

**Fix:** store both `rows` (capped) and `fullRows` on the `SheetData`
shape; return `fullRows` when the flag is set.

---

### F3. File and folder pills are lost on draft save

**Phase:** 4
**Symptom:** User types `@sales_cycle.xlsx` → pill → navigates away →
pill gone when composer remounts.

**Root cause:** Draft save (`ChatInput` unmount effect) filters
`getContentBlocks()` to text-only blocks. `file` and `dir` pill blocks
silently drop. Image attachments survive because they're extracted into
a separate `attachments[]` array.

**Fix:** serialize file/dir blocks as `[file:path]` / `[dir:path]`
markers in the saved text; rely on `hydrateFromPlainText` in
`setPlainText` to rebuild pill DOM on restore.

---

## 🟠 Medium

### F4. `require('node:fs')` in agent-core may fail at runtime on ESM

**Phase:** 5
**Symptom:** Potential runtime error the first time a `[file:…]` marker
is processed. Not caught by `tsc`; build passes.

**Root cause:** `translateFileDirMarkers` uses synchronous `require` for
lazy-loading `fs` / `path`. If agent-core compiles to ESM, `require` is
undefined.

**Fix:** `await import('node:fs')` with a cached init, or move to
top-of-file ESM imports. Check the package's build output first — may
already be CommonJS (in which case this is a non-issue to confirm).

---

### F5. DestinationPicker's fs_list listener doesn't filter by echoed path

**Phase:** 2 (missed when Phase 3 added the echo)
**Symptom:** If ProjectFilesView is mounted and listing a different
directory concurrently, the picker's entries are overwritten with
whatever ProjectFilesView last received.

**Root cause:** Phase 3 added `path` echo to `fs_list_response` but
DestinationPicker's listener still processes every response without
checking.

**Fix:** accept the third `path` arg in the response handler; ignore
responses whose path doesn't match the picker's current `cwd`.

---

## 🟡 Low / Latent

### F6. Non-file mention select destroys image chips

**Phase:** 4 (latent — only files provider ships today)
**Symptom:** Future agents/web/chat providers using the plain-text
substitution fallback will find image chips replaced with literal
`[img:id]` text.

**Root cause:** `handleMentionSelect` fallback does
`setPlainText(replaced)`, which calls `hydrateFromPlainText`.
`hydrateFromPlainText` only handles `[file:…]` / `[dir:…]` — image
markers become text.

**Fix:** extend `hydrateFromPlainText` to pass through `[img:id]`
markers without rendering them (images restore separately via
`insertImage`). Or: don't round-trip through `getPlainText` /
`setPlainText` for mention select — use a direct text-range delete +
insert.

---

### F7. `getPlainTextFromRoot` emits `[img:id]` pollution

**Phase:** 4
**Symptom:** `getPlainText()` output includes `[img:id]` markers even
though the only consumer that needs them (`handleSend`) builds its text
directly from `getContentBlocks()`. Any round-trip via getPlainText →
setPlainText loses image chips.

**Fix:** stop emitting `[img:id]` in `getPlainTextFromRoot`. Keep
file/dir markers since `hydrateFromPlainText` handles them.

---

### F8. `@` trigger + replace are `$`-anchored on plain text

**Phase:** 3
**Symptom:** Typing `@foo` mid-sentence, the fallback text-replace path
replaces the **last** `@…` in text, not the one at cursor.

**Root cause:** Regex `/@[^\s\]\)}]*$/` is end-of-string anchored.
`replaceMentionTriggerWithPill` does this correctly (walks from
selection anchor backward), but the text-replace fallback for non-file
providers does not.

**Fix:** rewrite `handleMentionSelect` to always route through
`replaceMentionTriggerWithPill` with a caller-supplied marker string —
unify the two paths.

---

### F9. Inconsistent pill click routing

**Phase:** 4/6
**Symptom:** File pills call `artifactStore.addArtifact(...)` directly
from ChatInput. Folder pills dispatch `anton:navigate-files` custom
events picked up by ProjectFilesView. Two patterns for one concept.
Dead `anton:pill-click` custom event name left over from an earlier
iteration.

**Fix:** pick one — either unify on direct store calls (simpler) or
unify on events (more decoupled). Remove the dead `anton:pill-click`
reference.

---

### F10. Sequential batch upload

**Phase:** 9
**Symptom:** Uploading 10 files → base64 conversions run one at a time.
Slow for large batches even though each is independent.

**Fix:** `Promise.all` the base64 reads; keep `sendFilesystemWrite`
calls in order since the server writes serially anyway.

---

## 🟢 Nits (not bugs, worth tracking)

- **N1** `ComposerAddMenu`: fixed-positioned via `anchorRect`, no
  reposition on window resize / scroll.
- **N2** `MentionDropdown`: no viewport-top clamping; dropdown clips
  off screen when the anchor is near the top.
- **N3** Pill icons use emoji glyphs (`📁 📊 🖼`) inside contentEditable.
  Don't accept CSS `color`. Inconsistent with the lucide-icon aesthetic.
- **N4** `handleDownload` for binary decodes base64 on main thread. A
  200MB PDF stalls the renderer. Streaming decode or web worker.
- **N5** `saveRecentUploadFolder` silently swallows localStorage quota
  errors. Should at least log once.
- **N6** Duplicated conversation-id lookup in ChatInput + ProjectFilesView
  (`useStore.getState().getActiveConversation()?.sessionId ?? ...`) —
  pull into a helper.

---

## Fix order

Blockers for "production ready": **F1 → F2 → F3 → F4 → F5**.

Low-priority cleanup: **F6 → F7 → F8 → F9** can land together — they're
all in the same composer/RichInput mention pathway.

Perf + nits whenever.
