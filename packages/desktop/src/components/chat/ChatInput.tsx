import type { AskUserQuestion } from '@anton/protocol'
import { Brain, Plus, Send, Square } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { anyProviderReady } from '../../lib/providers.js'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useIsCurrentSessionWorking, useStore } from '../../lib/store.js'
import { sessionStore } from '../../lib/store/sessionStore.js'
import { AskUserInline } from './AskUserInline.js'
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
  const thinkingEnabled = sessionStore((s) => s.thinkingEnabled)
  const richInputRef = useRef<RichInputHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const _isWorking = useIsCurrentSessionWorking()
  const isCurrentSessionWorking = ignoreWorkingState ? false : _isWorking

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
      const text = blocks
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
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

  const handleChange = useCallback((plainText: string) => {
    setInput(plainText)
    if (plainText.startsWith('/')) {
      setShowSlashMenu(true)
      setSlashFilter(plainText.slice(1))
    } else {
      setShowSlashMenu(false)
    }
  }, [])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) {
        setAttachmentError('Only image attachments are supported right now.')
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

    // Build text with inline markers preserving image positions
    const parts: string[] = []
    const attachments: ChatImageAttachment[] = []
    for (const block of blocks) {
      if (block.type === 'text') {
        parts.push(block.text)
      } else {
        attachments.push(block.attachment)
        parts.push(`[img:${block.attachment.id}]`)
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
      }
    },
    [showSlashMenu, handleSend],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null)

      if (files.length === 0) return
      e.preventDefault()
      void addFiles(files)
    },
    [addFiles],
  )

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    void addFiles(files)
    e.target.value = ''
  }

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

        <div className="composer__box">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="composer__file-input"
            onChange={handleFileChange}
          />
          <RichInput
            ref={richInputRef}
            placeholder={customPlaceholder || 'What should we work on next?'}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onChange={handleChange}
            onImageRemove={handleImageRemove}
            className="composer__rich-input"
          />
          {attachmentError && (
            <div className="composer__helper composer__helper--error">{attachmentError}</div>
          )}
          <div className="composer__toolbar">
            <div className="composer__toolbar-left">
              <button
                type="button"
                className="composer__pill composer__pill--icon"
                aria-label="Attach images"
                data-tooltip="Attach images"
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus size={12} strokeWidth={1.8} />
              </button>
              <ConnectorPill />
              <button
                type="button"
                className={`composer__pill composer__pill--thinking${thinkingEnabled ? ' composer__pill--on' : ''}`}
                aria-label={thinkingEnabled ? 'Thinking on' : 'Thinking off'}
                data-tooltip={thinkingEnabled ? 'Thinking on' : 'Thinking off'}
                onClick={() => sessionStore.getState().setThinkingEnabled(!thinkingEnabled)}
              >
                <Brain size={12} strokeWidth={1.8} />
                <span>Thinking</span>
              </button>
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
      </div>
    </div>
  )
}
