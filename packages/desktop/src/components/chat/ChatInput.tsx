import type { AskUserQuestion } from '@anton/protocol'
import { Plus, Send, Square, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Skill } from '../../lib/skills.js'
import type { ChatImageAttachment } from '../../lib/store.js'
import { useIsCurrentSessionWorking } from '../../lib/store.js'
import { AskUserInline } from './AskUserInline.js'
import { ConnectorBanner, ConnectorPill } from './ConnectorToolbar.js'
import { ModelSelector } from './ModelSelector.js'
import { SlashCommandMenu } from './SlashCommandMenu.js'

interface Props {
  onSend: (text: string, attachments?: ChatImageAttachment[]) => void
  onSteer?: (text: string, attachments?: ChatImageAttachment[]) => void
  onCancelTurn?: () => void
  onSkillSelect: (skill: Skill) => void
  /** @deprecated variant is no longer used — all inputs render identically */
  variant?: string
  /** When true, always render as idle (for hero inputs that create new tasks) */
  ignoreWorkingState?: boolean
  initialValue?: string
  placeholder?: string
  pendingAskUser?: { id: string; questions: AskUserQuestion[] } | null
  onAskUserSubmit?: (answers: Record<string, string>) => void
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

function attachmentPreviewSrc(attachment: ChatImageAttachment): string | undefined {
  return attachment.data ? `data:${attachment.mimeType};base64,${attachment.data}` : undefined
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
}: Props) {
  const [input, setInput] = useState('')
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const _isWorking = useIsCurrentSessionWorking()
  const isCurrentSessionWorking = ignoreWorkingState ? false : _isWorking

  // Sync external initialValue into input (e.g. from suggestion chips)
  useEffect(() => {
    if (initialValue !== undefined && initialValue !== '') {
      setInput(initialValue)
      // Focus the textarea so user can review/edit before sending
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [initialValue])

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(64, Math.min(ta.scrollHeight, 220))}px`
  }, [input])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    if (val.startsWith('/')) {
      setShowSlashMenu(true)
      setSlashFilter(val.slice(1))
    } else {
      setShowSlashMenu(false)
    }
  }

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) {
        setAttachmentError('Only image attachments are supported right now.')
        return
      }

      const availableSlots = MAX_IMAGE_ATTACHMENTS - attachments.length
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

      const nextAttachments = await Promise.all(acceptedFiles.map((file) => readImageFile(file)))
      setAttachments((current) => [...current, ...nextAttachments])
    },
    [attachments.length],
  )

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text && attachments.length === 0) return

    // If agent is working, steer instead of sending a new message
    if (isCurrentSessionWorking) {
      if ((text || attachments.length > 0) && onSteer) {
        onSteer(text, attachments)
        setInput('')
        setAttachments([])
        setAttachmentError(null)
        setShowSlashMenu(false)
        textareaRef.current?.focus()
      }
      return
    }

    onSend(text, attachments)
    setInput('')
    setAttachments([])
    setAttachmentError(null)
    setShowSlashMenu(false)
    textareaRef.current?.focus()
  }, [input, attachments, isCurrentSessionWorking, onSend, onSteer])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    if (files.length === 0) return
    e.preventDefault()
    void addFiles(files)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    void addFiles(files)
    e.target.value = ''
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
    setAttachmentError(null)
  }

  const handleSkillSelect = (skill: Skill) => {
    setInput('')
    setShowSlashMenu(false)
    onSkillSelect(skill)
  }

  if (pendingAskUser && onAskUserSubmit) {
    return (
      <div className="composer composer--hero">
        <div className="composer__anchor">
          <div className="composer__box composer__box--ask-user">
            <AskUserInline questions={pendingAskUser.questions} onSubmit={onAskUserSubmit} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="composer composer--hero">
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
          {attachments.length > 0 && (
            <div className="composer__attachments" aria-label="Attached images">
              {attachments.map((attachment) => {
                const previewSrc = attachmentPreviewSrc(attachment)
                return (
                  <div key={attachment.id} className="composer__attachment">
                    {previewSrc ? (
                      <img
                        src={previewSrc}
                        alt={attachment.name}
                        className="composer__attachment-image"
                      />
                    ) : (
                      <div className="composer__attachment-fallback">{attachment.name}</div>
                    )}
                    <button
                      type="button"
                      className="composer__attachment-remove"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => handleRemoveAttachment(attachment.id)}
                    >
                      <X size={14} strokeWidth={1.5} />
                    </button>
                    <div className="composer__attachment-name">{attachment.name}</div>
                  </div>
                )
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={customPlaceholder || 'What should we work on next?'}
            rows={1}
            className="composer__textarea"
          />
          {attachmentError && (
            <div className="composer__helper composer__helper--error">{attachmentError}</div>
          )}
          <div className="composer__toolbar">
            <div className="composer__toolbar-left">
              <button
                type="button"
                className="composer__btn"
                aria-label="Attach images"
                data-tooltip="Attach images"
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus size={18} strokeWidth={1.5} />
              </button>
              <ConnectorPill />
            </div>
            <div className="composer__toolbar-right">
              <span className="composer__shortcut-hint">⌘K</span>
              <ModelSelector />
              {isCurrentSessionWorking ? (
                <>
                  {input.trim() && (
                    <button
                      type="button"
                      onClick={handleSend}
                      className="composer__btn composer__btn--steer"
                      aria-label="Send while working"
                      data-tooltip="Steer"
                    >
                      <Send size={16} strokeWidth={1.5} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="composer__btn composer__btn--stop"
                    aria-label="Stop"
                    data-tooltip="Stop"
                    onClick={onCancelTurn}
                  >
                    <Square size={18} strokeWidth={1.5} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() && attachments.length === 0}
                  className="composer__btn composer__btn--send"
                  aria-label="Send"
                  data-tooltip="Send"
                >
                  <Send size={18} strokeWidth={1.5} />
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
