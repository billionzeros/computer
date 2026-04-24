import type { AskUserQuestion } from '@anton/protocol'
import { Plus, Send, Square } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { classifyUpload } from '../../lib/artifacts.js'
import { connection } from '../../lib/connection.js'
// Side-effect import — registers mention providers (files, future: agents, web, …).
import '../../lib/mentions/register.js'
import { mentionRegistry } from '../../lib/mentions/registry.js'
import type { MentionItem } from '../../lib/mentions/types.js'
import { anyProviderReady } from '../../lib/providers.js'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useIsCurrentSessionWorking, useStore } from '../../lib/store.js'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { projectStore } from '../../lib/store/projectStore.js'
import { type EffortLevel, effortLabel, sessionStore } from '../../lib/store/sessionStore.js'
import {
  classifyMimeFamily,
  resolveInitialFolder,
  saveRecentUploadFolder,
} from '../../lib/uploadDefaults.js'
import { DestinationPicker, type DestinationPickerResult } from '../files/DestinationPicker.js'
import { MentionDropdown } from '../mentions/MentionDropdown.js'
import { AskUserInline } from './AskUserInline.js'
import { ComposerAddMenu } from './ComposerAddMenu.js'
import { ConnectorBanner, ConnectorPill } from './ConnectorToolbar.js'
import { ModelSelector } from './ModelSelector.js'
import type { RichInputHandle } from './RichInput.js'
import { RichInput } from './RichInput.js'
import { SlashCommandMenu } from './SlashCommandMenu.js'

interface Props {
  onSend: (text: string, attachments?: ChatImageAttachment[]) => void
  onSteer?: (text: string, attachments?: ChatImageAttachment[]) => void
  onCancelTurn?: () => void
  onSkillSelect: (skill: Skill) => void
  /** 'hero' is centered + larger (home/empty state); 'inline' is the docked composer. */
  variant?: 'hero' | 'inline'
  /** When true, always render as idle (for hero inputs that create new tasks) */
  ignoreWorkingState?: boolean
  initialValue?: string
  placeholder?: string
  pendingAskUser?: { id: string; questions: AskUserQuestion[] } | null
  onAskUserSubmit?: (answers: Record<string, string>) => void
  /** Conversation ID for draft persistence. When set, input content survives unmount/remount. */
  conversationId?: string
}

const MAX_IMAGE_ATTACHMENTS = 4
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Whether the active model + provider pair can take a reasoning effort
 * override from the composer. Kept as a local heuristic so we don't have
 * to ship the full anton-models catalog to the client.
 *
 *  - Claude Code harness: CLI has no thinking/budget flag — always false.
 *  - Codex harness: always true (o-series under the hood, per-turn effort).
 *  - API-key models: regex matches known reasoning-capable families.
 */
function supportsReasoningEffort(provider: string, model: string): boolean {
  if (provider === 'claude') return false
  if (provider === 'codex') return true
  const m = model.toLowerCase()
  return /opus|sonnet|gemini-2\.5|o1|o3|o4|reason|thinking|deepseek-r/.test(m)
}

/**
 * Four-bar ascending effort indicator. The number of "lit" bars matches
 * the level (1 / 2 / 3 / 4); the rest render at reduced opacity so the
 * pill reads as a signal-strength meter. Inline SVG — Lucide's SignalHigh
 * only exposes a single opacity channel, which can't render "2 of 4 lit."
 */
const EFFORT_LIT_COUNT: Record<EffortLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
}

function EffortBars({ level }: { level: EffortLevel }) {
  const lit = EFFORT_LIT_COUNT[level]
  const heights = [3, 5, 8, 10]
  return (
    <svg
      width={14}
      height={12}
      viewBox="0 0 14 12"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {heights.slice(0, lit).map((h, i) => (
        <rect key={h} x={i * 3.5} y={12 - h} width={2} height={h} rx={0.5} />
      ))}
    </svg>
  )
}

// File (non-image) attachment limits.
const MAX_FILE_BYTES_HARD = 500 * 1024 * 1024 // absolute rejection cap

// Accept list for the "Add Files" picker — documents, spreadsheets, PDFs, text.
// Images are deliberately excluded here; they go through the "Add Images" path.
const FILE_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.md,.mdx,.json,.log,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,application/json'

async function readImageFile(file: File): Promise<ChatImageAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read "${file.name}"`))
    reader.readAsDataURL(file)
  })

  const [, data = ''] = dataUrl.split(',', 2)
  return {
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    mimeType: file.type || 'image/png',
    sizeBytes: file.size,
    data,
  }
}

/** Read a binary file as base64 for sending over the filesync channel. */
async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read "${file.name}"`))
    reader.readAsDataURL(file)
  })
  const [, data = ''] = dataUrl.split(',', 2)
  return data
}

export function ChatInput({
  onSend,
  onSteer,
  onCancelTurn,
  onSkillSelect,
  initialValue,
  placeholder: customPlaceholder,
  pendingAskUser,
  onAskUserSubmit,
  ignoreWorkingState,
  conversationId,
  variant = 'inline',
}: Props) {
  const clearDraftInput = useStore((s) => s.clearDraftInput)
  const [input, setInput] = useState('')
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [imageCount, setImageCount] = useState(0)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const effortLevel = sessionStore((s) => s.effortLevel)
  const currentProvider = sessionStore((s) => s.currentProvider)
  const currentModel = sessionStore((s) => s.currentModel)
  const showEffortPill = supportsReasoningEffort(currentProvider, currentModel)
  const richInputRef = useRef<RichInputHandle>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusButtonRef = useRef<HTMLButtonElement>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuAnchor, setAddMenuAnchor] = useState<DOMRect | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const _isWorking = useIsCurrentSessionWorking()
  const isCurrentSessionWorking = ignoreWorkingState ? false : _isWorking
  const activeProject = projectStore((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const workspaceRoot = activeProject?.workspacePath || ''

  // Mention dropdown state.
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionAnchor, setMentionAnchor] = useState<DOMRect | null>(null)
  const composerBoxRef = useRef<HTMLDivElement>(null)

  // Restore draft on mount
  useEffect(() => {
    if (!conversationId) return
    const draft = useStore.getState().getDraftInput(conversationId)
    if (draft) {
      richInputRef.current?.setPlainText(draft.text)
      setInput(draft.text)
      for (const attachment of draft.attachments) {
        richInputRef.current?.insertImage(attachment)
      }
      setImageCount(draft.attachments.length)
    }
  }, [conversationId])

  // Save draft on unmount
  useEffect(() => {
    const convId = conversationId
    return () => {
      if (!convId) return
      const handle = richInputRef.current
      if (!handle) return
      const blocks = handle.getContentBlocks()
      // Serialize file/dir pill blocks as [file:path] / [dir:path] markers
      // in-place in the text stream, preserving relative position between
      // text segments. hydrateFromPlainText in RichInput.setPlainText
      // rebuilds the pill DOM on restore. Images remain a separate array;
      // they can't round-trip through plain text (no base64 in markers).
      const text = blocks
        .map((b) => {
          if (b.type === 'text') return b.text
          if (b.type === 'file') return `[file:${b.file.path}]`
          if (b.type === 'dir') return `[dir:${b.dir.path}]`
          return '' // images handled via attachments[]
        })
        .join('')
        .trim()
      const attachments = blocks
        .filter((b): b is Extract<typeof b, { type: 'image' }> => b.type === 'image')
        .map((b) => b.attachment)
      if (text || attachments.length > 0) {
        useStore.getState().setDraftInput(convId, text, attachments)
      } else {
        useStore.getState().clearDraftInput(convId)
      }
    }
  }, [conversationId])

  // Sync external initialValue into input (e.g. from suggestion chips)
  useEffect(() => {
    if (initialValue !== undefined && initialValue !== '') {
      richInputRef.current?.setPlainText(initialValue)
      setInput(initialValue)
      setTimeout(() => richInputRef.current?.focus(), 0)
    }
  }, [initialValue])

  const handleChange = useCallback(
    (plainText: string) => {
      setInput(plainText)
      if (plainText.startsWith('/')) {
        setShowSlashMenu(true)
        setSlashFilter(plainText.slice(1))
      } else {
        setShowSlashMenu(false)
      }

      // @-trigger detection: match `@<query>` anchored to end-of-text.
      // Allow a broader charset than just \w so folder paths (`@data/f`) work.
      const mentionMatch = plainText.match(/(?:^|[\s(\[{])@([^\s\]\)}]*)$/)
      if (mentionMatch) {
        setMentionOpen(true)
        setMentionQuery(mentionMatch[1] ?? '')
        const rect = composerBoxRef.current?.getBoundingClientRect() ?? null
        setMentionAnchor(rect)
      } else if (mentionOpen) {
        setMentionOpen(false)
      }
    },
    [mentionOpen],
  )

  const handleMentionSelect = useCallback((providerId: string, item: MentionItem) => {
    const result = mentionRegistry.select(providerId, item)
    if (!result) {
      setMentionOpen(false)
      return
    }
    const handle = richInputRef.current
    if (!handle) return

    // Files provider paths land here — insert a visual pill directly.
    // Other providers (agents, web, …) may want raw text substitution;
    // branch on marker shape.
    const fileMatch = result.markerText.match(/^\[(file|dir):([^\]]+)\]$/)
    if (fileMatch) {
      const kind = fileMatch[1] as 'file' | 'dir'
      const path = fileMatch[2] ?? ''
      // Prefer provider snapshot name so folder pills get their plain name
      // rather than the path tail (which already equals basename, but be
      // defensive against future providers supplying richer labels).
      const name =
        (result.snapshot?.name as string | undefined) ||
        (item.label as string) ||
        path.split('/').pop() ||
        path
      handle.replaceMentionTriggerWithPill(kind, { path, name })
    } else {
      // Fallback: substitute plain text for non-file providers.
      const current = handle.getPlainText()
      const replaced = current.replace(/@[^\s\]\)}]*$/, `${result.markerText} `)
      handle.setPlainText(replaced)
    }

    setInput(handle.getPlainText())
    setMentionOpen(false)
    handle.focus()
  }, [])

  /**
   * Drill into a folder in the mention dropdown: rewrite the active `@query`
   * in the editor text to `@<folderPath>/` so the files provider's
   * splitQuery scopes results into that folder. Keeps the dropdown open and
   * focus in the editor.
   *
   * The rewrite is done in three steps because `setPlainText` alone
   * doesn't re-fire `onChange`:
   *   1. Replace the trailing `@...` in the current plain text.
   *   2. Call setPlainText so the DOM updates.
   *   3. Sync `input` state + `mentionQuery` so the dropdown re-searches.
   */
  const handleMentionDrillInto = useCallback((_providerId: string, item: MentionItem) => {
    const handle = richInputRef.current
    if (!handle) return
    const payload = item.payload as { relPath?: string }
    const folderPath = payload?.relPath ?? (item.label as string)
    const current = handle.getPlainText()
    const replaced = current.replace(/@[^\s\]\)}]*$/, `@${folderPath}/`)
    handle.setPlainText(replaced)
    setInput(replaced)
    setMentionQuery(`${folderPath}/`)
    setMentionOpen(true)
    handle.focus()
  }, [])

  /** Pop one folder level off the active mention query — triggered by the
   *  back-row click, Left-arrow, or Backspace on an empty leaf. */
  const handleMentionNavigateUp = useCallback((parentQuery: string) => {
    const handle = richInputRef.current
    if (!handle) return
    const current = handle.getPlainText()
    const replaced = current.replace(/@[^\s\]\)}]*$/, `@${parentQuery}`)
    handle.setPlainText(replaced)
    setInput(replaced)
    setMentionQuery(parentQuery)
    setMentionOpen(true)
    handle.focus()
  }, [])

  const handlePillClick = useCallback(
    (kind: 'file' | 'dir', ref: { path: string; name: string }) => {
      // Resolve workspace-relative → absolute.
      const absPath =
        ref.path.startsWith('/') || !workspaceRoot
          ? ref.path
          : `${workspaceRoot.replace(/\/$/, '')}/${ref.path}`

      if (kind === 'file') {
        // Open in the artifact panel, creating the artifact record if it
        // doesn't exist yet. addArtifact dedupes by filepath, so repeated
        // clicks reactivate the existing tab.
        const renderType = classifyUpload(undefined, ref.path) ?? 'code'
        const id = `upload:${absPath}`
        artifactStore.getState().addArtifact({
          id,
          type: 'file',
          source: 'upload',
          renderType,
          filename: ref.name,
          filepath: absPath,
          sourcePath: absPath,
          language: '',
          content: '',
          toolCallId: id,
          timestamp: Date.now(),
        })
        artifactStore.getState().setArtifactPanelOpen(true)
        artifactStore.getState().setActiveArtifact(id)
        return
      }

      // Folder pill → emit a navigation event; ProjectFilesView can listen
      // and jump to that path. Decoupled so the Files surface can evolve.
      window.dispatchEvent(new CustomEvent('anton:navigate-files', { detail: { path: absPath } }))
    },
    [workspaceRoot],
  )

  const addImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) {
        setAttachmentError('No images in selection. Use Add Files for documents.')
        return
      }

      const availableSlots = MAX_IMAGE_ATTACHMENTS - imageCount
      if (availableSlots <= 0) {
        setAttachmentError(`You can attach up to ${MAX_IMAGE_ATTACHMENTS} images per message.`)
        return
      }

      const oversized = imageFiles.find((file) => file.size > MAX_IMAGE_BYTES)
      if (oversized) {
        setAttachmentError(`"${oversized.name}" is larger than 10 MB.`)
        return
      }

      const acceptedFiles = imageFiles.slice(0, availableSlots)
      if (acceptedFiles.length < imageFiles.length) {
        setAttachmentError(`You can attach up to ${MAX_IMAGE_ATTACHMENTS} images per message.`)
      } else {
        setAttachmentError(null)
      }

      const newAttachments = await Promise.all(acceptedFiles.map((file) => readImageFile(file)))
      for (const attachment of newAttachments) {
        richInputRef.current?.insertImage(attachment)
      }
      setImageCount((c) => c + newAttachments.length)
    },
    [imageCount],
  )

  /** Route non-image files through the destination picker for project-level upload.
   *  Accepts multiple files — all share one destination in the picker. */
  const queueFilesForUpload = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      if (!workspaceRoot) {
        setAttachmentError('Open a project before uploading files.')
        return
      }
      const oversized = files.find((f) => f.size > MAX_FILE_BYTES_HARD)
      if (oversized) {
        setAttachmentError(
          `"${oversized.name}" exceeds the 500 MB hard limit and cannot be uploaded.`,
        )
        return
      }
      setAttachmentError(null)
      setPendingFiles(files)
    },
    [workspaceRoot],
  )

  const handleUploadConfirm = useCallback(
    async (result: DestinationPickerResult) => {
      if (pendingFiles.length === 0) return
      setUploading(true)
      try {
        const convId =
          useStore.getState().getActiveConversation()?.sessionId ??
          useStore.getState().activeConversationId ??
          undefined
        const activeProjectId = projectStore.getState().activeProjectId ?? undefined

        // Pair each file with its (possibly-renamed) target filename.
        const pairs = pendingFiles.map((file, i) => ({
          file,
          filename: result.filenames[i] ?? file.name,
        }))

        for (const { file, filename } of pairs) {
          const base64 = await readFileAsBase64(file)
          const targetPath =
            result.folderPath === '/' ? `/${filename}` : `${result.folderPath}/${filename}`
          connection.sendFilesystemWrite(targetPath, base64, 'base64')

          // Register as an upload artifact so it appears in the Files bar
          // and is previewable on pill click.
          const renderType = classifyUpload(file.type || undefined, filename) ?? 'code'
          const uploadId = `upload:${targetPath}`
          artifactStore.getState().addArtifact({
            id: uploadId,
            type: 'file',
            source: 'upload',
            renderType,
            filename,
            filepath: targetPath,
            sourcePath: targetPath,
            mimeType: file.type || undefined,
            language: '',
            content: '',
            toolCallId: uploadId,
            timestamp: Date.now(),
            conversationId: convId,
          })

          // Pill insertion per file when "Attach" was checked. Multi-file
          // attach drops N pills into the composer — matches user intent
          // of referring to all of them.
          if (result.attachToMessage) {
            const relPath =
              workspaceRoot && targetPath.startsWith(`${workspaceRoot}/`)
                ? targetPath.slice(workspaceRoot.length + 1)
                : targetPath
            richInputRef.current?.replaceMentionTriggerWithPill('file', {
              path: relPath,
              name: filename,
            })
          }
        }

        // Persist recent folder per mime family — next upload of the same
        // kind pre-selects this folder. Store workspace-relative so it
        // survives project rename.
        if (workspaceRoot) {
          const relFolder =
            result.folderPath === workspaceRoot
              ? ''
              : result.folderPath.startsWith(`${workspaceRoot}/`)
                ? result.folderPath.slice(workspaceRoot.length + 1)
                : result.folderPath
          // Classify by the majority family of the batch (most batches
          // are same-kind; fall back to the first file's family otherwise).
          const families = pendingFiles.map((f) => classifyMimeFamily(f.type, f.name))
          const majority =
            families.every((fam) => fam === families[0]) && families[0]
              ? families[0]
              : (families[0] ?? 'other')
          saveRecentUploadFolder(activeProjectId, majority, relFolder)
        }

        setAttachmentError(null)
      } catch (err) {
        setAttachmentError(err instanceof Error ? `Upload failed: ${err.message}` : 'Upload failed')
      } finally {
        setPendingFiles([])
        setUploading(false)
      }
    },
    [pendingFiles, workspaceRoot],
  )

  const handleSend = useCallback(() => {
    const handle = richInputRef.current
    if (!handle) return

    // Gate Enter-key / programmatic sends on provider readiness to match the
    // disabled send button — avoids silently emitting turns that will fail.
    const { providers, harnessStatuses } = sessionStore.getState()
    if (!anyProviderReady(providers, harnessStatuses)) return

    const blocks = handle.getContentBlocks()
    const hasContent = blocks.some((b) => (b.type === 'text' ? b.text.trim().length > 0 : true))
    if (!hasContent) return

    // Build text with inline markers preserving image / file / folder positions.
    // - Images are sent as attachments with [img:id] inline markers.
    // - File / folder references are serialized as [file:path] / [dir:path]
    //   inline markers; the harness translates them to prose + real paths
    //   before dispatching to the model.
    const parts: string[] = []
    const attachments: ChatImageAttachment[] = []
    for (const block of blocks) {
      if (block.type === 'text') {
        parts.push(block.text)
      } else if (block.type === 'image') {
        attachments.push(block.attachment)
        parts.push(`[img:${block.attachment.id}]`)
      } else if (block.type === 'file') {
        parts.push(`[file:${block.file.path}]`)
      } else if (block.type === 'dir') {
        parts.push(`[dir:${block.dir.path}]`)
      }
    }

    const text = parts.join('').trim()

    // If agent is working and no attachments, steer with text only
    if (isCurrentSessionWorking && attachments.length === 0) {
      if (text && onSteer) {
        onSteer(text)
        handle.clear()
        setInput('')
        setImageCount(0)
        setShowSlashMenu(false)
        if (conversationId) clearDraftInput(conversationId)
        handle.focus()
      }
      return
    }

    onSend(text, attachments.length > 0 ? attachments : undefined)
    handle.clear()
    setInput('')
    setImageCount(0)
    setAttachmentError(null)
    setShowSlashMenu(false)
    if (conversationId) clearDraftInput(conversationId)
    handle.focus()
  }, [isCurrentSessionWorking, onSend, onSteer, conversationId, clearDraftInput])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSlashMenu) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
        return
      }
      // Alt/Option + T cycles reasoning effort when the pill is visible.
      if (e.altKey && (e.key === 't' || e.key === 'T' || e.key === '†') && showEffortPill) {
        e.preventDefault()
        sessionStore.getState().cycleEffortLevel()
      }
    },
    [showSlashMenu, handleSend, showEffortPill],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const allItems = Array.from(e.clipboardData.items)
      const imageFiles = allItems
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null)
      const otherFiles = allItems
        .filter(
          (item) => item.kind === 'file' && item.type !== '' && !item.type.startsWith('image/'),
        )
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null)

      if (imageFiles.length === 0 && otherFiles.length === 0) return
      e.preventDefault()
      if (imageFiles.length > 0) void addImages(imageFiles)
      // Paste of non-image files: queue the whole batch through the picker.
      if (otherFiles.length > 0) queueFilesForUpload(otherFiles)
    },
    [addImages, queueFilesForUpload],
  )

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    void addImages(files)
    e.target.value = ''
  }

  const handleDocumentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) queueFilesForUpload(files)
    e.target.value = ''
  }

  // MIME-aware drop: images go inline, other files go through the picker (batch).
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const dropped = Array.from(e.dataTransfer.files ?? [])
      if (dropped.length === 0) return
      e.preventDefault()
      const images = dropped.filter((f) => f.type.startsWith('image/'))
      const docs = dropped.filter((f) => !f.type.startsWith('image/'))
      if (images.length > 0) void addImages(images)
      if (docs.length > 0) queueFilesForUpload(docs)
    },
    [addImages, queueFilesForUpload],
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Allow drop cursor; the rich input doesn't default-prevent.
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }, [])

  const handleImageRemove = useCallback(() => {
    setImageCount((c) => Math.max(0, c - 1))
    setAttachmentError(null)
  }, [])

  const handleSkillSelect = (skill: Skill) => {
    richInputRef.current?.clear()
    setInput('')
    setShowSlashMenu(false)
    onSkillSelect(skill)
  }

  const hasContent = input.trim().length > 0 || imageCount > 0
  const anyReady = sessionStore((s) => anyProviderReady(s.providers, s.harnessStatuses))
  const canSend = hasContent && anyReady

  const rootClass = `composer composer--${variant}`

  // While an ask_user is pending, the card takes over the composer so
  // the user can't type until they answer — matches Claude Code's
  // prompt UX. AskUserInline itself routes to specialized Routine /
  // Publish cards when the question's metadata matches, and falls
  // back to its generic one-question-at-a-time renderer otherwise.
  if (pendingAskUser && onAskUserSubmit) {
    return (
      <div className={rootClass}>
        <div className="composer__anchor">
          <div className="composer__box composer__box--ask-user">
            <AskUserInline questions={pendingAskUser.questions} onSubmit={onAskUserSubmit} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={rootClass}>
      <div className="composer__anchor">
        <SlashCommandMenu
          filter={slashFilter}
          onSelect={handleSkillSelect}
          onClose={() => setShowSlashMenu(false)}
          visible={showSlashMenu}
        />

        <div
          ref={composerBoxRef}
          className="composer__box"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="composer__file-input"
            onChange={handleImageFileChange}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            className="composer__file-input"
            onChange={handleDocumentFileChange}
          />
          <RichInput
            ref={richInputRef}
            placeholder={customPlaceholder || 'What should we work on next?'}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onChange={handleChange}
            onImageRemove={handleImageRemove}
            onPillClick={handlePillClick}
            className="composer__rich-input"
          />
          {attachmentError && (
            <div className="composer__helper composer__helper--error">{attachmentError}</div>
          )}
          {uploading && <div className="composer__helper">Uploading…</div>}
          <div className="composer__toolbar">
            <div className="composer__toolbar-left">
              <button
                ref={plusButtonRef}
                type="button"
                className="composer__pill composer__pill--icon"
                aria-label="Add images or files"
                data-tooltip="Add images or files"
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
                onClick={() => {
                  const rect = plusButtonRef.current?.getBoundingClientRect() ?? null
                  setAddMenuAnchor(rect)
                  setAddMenuOpen((v) => !v)
                }}
              >
                <Plus size={12} strokeWidth={1.8} />
              </button>
              <ConnectorPill />
              {showEffortPill && (
                <button
                  type="button"
                  className={`composer__pill composer__pill--effort composer__pill--effort-${effortLevel}`}
                  aria-label={`Adjust effort level (currently ${effortLabel(effortLevel)})`}
                  data-tooltip="Adjust effort level ⌥T"
                  onClick={() => sessionStore.getState().cycleEffortLevel()}
                >
                  <EffortBars level={effortLevel} />
                  <span>{effortLabel(effortLevel)}</span>
                </button>
              )}
            </div>
            <div className="composer__toolbar-right">
              <ModelSelector />
              {isCurrentSessionWorking ? (
                <>
                  {imageCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleSend}
                      className="composer__send"
                      aria-label="Send"
                      data-tooltip="Send"
                    >
                      <Send size={14} strokeWidth={1.8} />
                    </button>
                  ) : (
                    input.trim() && (
                      <button
                        type="button"
                        onClick={handleSend}
                        className="composer__send composer__send--steer"
                        aria-label="Send while working"
                        data-tooltip="Steer"
                      >
                        <Send size={14} strokeWidth={1.8} />
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    className="composer__send composer__send--stop"
                    aria-label="Stop"
                    data-tooltip="Stop"
                    onClick={onCancelTurn}
                  >
                    <Square size={12} strokeWidth={1.8} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className={`composer__send${!canSend ? ' composer__send--disabled' : ''}`}
                  aria-label="Send"
                  data-tooltip={!anyReady ? 'Connect a provider to send' : 'Send'}
                >
                  <Send size={14} strokeWidth={1.8} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Banner below composer box */}
        <ConnectorBanner />

        <ComposerAddMenu
          open={addMenuOpen}
          anchorRect={addMenuAnchor}
          onClose={() => setAddMenuOpen(false)}
          onAddImages={() => imageInputRef.current?.click()}
          onAddFiles={() => fileInputRef.current?.click()}
        />

        <MentionDropdown
          open={mentionOpen}
          query={mentionQuery}
          context={{ workspaceRoot, conversationId }}
          anchorRect={mentionAnchor}
          onSelect={handleMentionSelect}
          onDrillInto={handleMentionDrillInto}
          onNavigateUp={handleMentionNavigateUp}
          onClose={() => setMentionOpen(false)}
        />

        {pendingFiles.length > 0 && (
          <DestinationPickerMount
            pendingFiles={pendingFiles}
            workspaceRoot={workspaceRoot}
            onClose={() => setPendingFiles([])}
            onConfirm={handleUploadConfirm}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Wrapper that isolates the memoization of `files` and `initialFolder`
 * from the parent's render cycle. Without this, ChatInput's frequent
 * zustand-driven re-renders (thinkingEnabled, activeConversation,
 * isWorking, …) produce fresh array/object references every render,
 * which in turn fire the picker's reset useEffect and wipe breadcrumb
 * nav, filename edits, attach state, etc.
 *
 * See MULTI_FORMAT_ATTACHMENTS_FOLLOWUPS.md §F1.
 */
function DestinationPickerMount({
  pendingFiles,
  workspaceRoot,
  onClose,
  onConfirm,
}: {
  pendingFiles: File[]
  workspaceRoot: string
  onClose: () => void
  onConfirm: (result: DestinationPickerResult) => void
}) {
  const files = useMemo(
    () =>
      pendingFiles.map((f) => ({
        name: f.name,
        sizeBytes: f.size,
        mime: f.type || undefined,
      })),
    [pendingFiles],
  )

  const initialFolder = useMemo(
    () =>
      resolveInitialFolder(
        projectStore.getState().activeProjectId ?? undefined,
        pendingFiles.map((f) => ({ mime: f.type, name: f.name })),
      ).folderRelPath,
    [pendingFiles],
  )

  return (
    <DestinationPicker
      open={pendingFiles.length > 0}
      onClose={onClose}
      onConfirm={onConfirm}
      workspaceRoot={workspaceRoot}
      files={files}
      initialFolder={initialFolder}
      offerAttach
    />
  )
}
