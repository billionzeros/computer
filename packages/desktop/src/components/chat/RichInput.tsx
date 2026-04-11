import type React from 'react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ChatImageAttachment } from '../../lib/store.js'

// ── Public types ──────────────────────────────────────────────────────────────

/** Ordered content block — text or image, preserving the user's insertion order. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachment: ChatImageAttachment }

export interface RichInputHandle {
  focus: () => void
  getContentBlocks: () => ContentBlock[]
  clear: () => void
  insertImage: (attachment: ChatImageAttachment) => void
  getPlainText: () => string
  setPlainText: (text: string) => void
  isEmpty: () => boolean
}

interface Props {
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void
  onChange?: (plainText: string) => void
  onImageRemove?: (id: string) => void
  className?: string
  minHeight?: number
  maxHeight?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const IMAGE_CHIP_ATTR = 'data-image-id'

function getDataUrl(attachment: ChatImageAttachment): string {
  return attachment.data ? `data:${attachment.mimeType};base64,${attachment.data}` : ''
}

function createImageChipElement(attachment: ChatImageAttachment): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = 'rich-input__chip'
  chip.contentEditable = 'false'
  chip.setAttribute(IMAGE_CHIP_ATTR, attachment.id)

  const thumb = document.createElement('img')
  thumb.className = 'rich-input__chip-thumb'
  thumb.src = getDataUrl(attachment)
  thumb.alt = attachment.name
  thumb.draggable = false

  const nameEl = document.createElement('span')
  nameEl.className = 'rich-input__chip-name'
  nameEl.textContent = attachment.name

  const removeBtn = document.createElement('span')
  removeBtn.className = 'rich-input__chip-remove'
  removeBtn.setAttribute('role', 'button')
  removeBtn.setAttribute('aria-label', `Remove ${attachment.name}`)
  removeBtn.textContent = '\u00D7'

  chip.appendChild(thumb)
  chip.appendChild(nameEl)
  chip.appendChild(removeBtn)

  return chip
}

/** Walk the contentEditable DOM and produce ordered content blocks. */
function extractContentBlocks(root: HTMLElement): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let currentText = ''

  function flush() {
    if (currentText) {
      blocks.push({ type: 'text', text: currentText })
      currentText = ''
    }
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      currentText += node.textContent ?? ''
      return
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const imageId = el.getAttribute(IMAGE_CHIP_ATTR)
      if (imageId) {
        flush()
        blocks.push({
          type: 'image',
          attachment: { id: imageId, name: '', mimeType: '', sizeBytes: 0 },
        })
        return
      }
      if (el.tagName === 'BR') {
        currentText += '\n'
        return
      }
      const isBlock = el.tagName === 'DIV' || el.tagName === 'P'
      if (isBlock && currentText.length > 0 && !currentText.endsWith('\n')) {
        currentText += '\n'
      }
      for (const child of Array.from(el.childNodes)) {
        walk(child)
      }
      if (isBlock && el !== root && !currentText.endsWith('\n')) {
        currentText += '\n'
      }
    }
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child)
  }
  flush()

  return blocks
}

function getPlainTextFromRoot(root: HTMLElement): string {
  const blocks = extractContentBlocks(root)
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

// ── Hover preview state ───────────────────────────────────────────────────────

interface PreviewState {
  src: string
  name: string
  top: number
  left: number
  flipBelow: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export const RichInput = forwardRef<RichInputHandle, Props>(function RichInput(
  {
    placeholder,
    onKeyDown,
    onPaste,
    onChange,
    onImageRemove,
    className,
    minHeight = 64,
    maxHeight = 220,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const attachmentsRef = useRef<Map<string, ChatImageAttachment>>(new Map())
  const [empty, setEmpty] = useState(true)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const checkEmpty = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const isNowEmpty = !el.textContent?.trim() && !el.querySelector(`[${IMAGE_CHIP_ATTR}]`)
    setEmpty(isNowEmpty)
  }, [])

  const autoResize = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(minHeight, Math.min(el.scrollHeight, maxHeight))}px`
  }, [minHeight, maxHeight])

  const notifyChange = useCallback(() => {
    checkEmpty()
    autoResize()
    if (!editorRef.current) return
    onChange?.(getPlainTextFromRoot(editorRef.current))
  }, [checkEmpty, autoResize, onChange])

  const placeCursorAtEnd = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [])

  // Click handler for remove buttons
  useEffect(() => {
    const el = editorRef.current
    if (!el) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('rich-input__chip-remove')) {
        const chip = target.closest(`[${IMAGE_CHIP_ATTR}]`) as HTMLElement | null
        if (chip) {
          chip.remove() // MutationObserver handles attachmentsRef cleanup and onImageRemove
          notifyChange()
          setPreview(null)
        }
      }
    }

    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [notifyChange])

  // Hover handler for preview — uses mouseover/mouseout delegation
  useEffect(() => {
    const el = editorRef.current
    const wrapper = wrapperRef.current
    if (!el || !wrapper) return

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const chip = target.closest?.(`[${IMAGE_CHIP_ATTR}]`) as HTMLElement | null
      if (!chip) return

      const id = chip.getAttribute(IMAGE_CHIP_ATTR)!
      const attachment = attachmentsRef.current.get(id)
      if (!attachment) return

      const chipRect = chip.getBoundingClientRect()

      // ~210px is roughly the preview height (180 img + 20 name + padding)
      const spaceAbove = chipRect.top
      const flipBelow = spaceAbove < 220

      setPreview({
        src: getDataUrl(attachment),
        name: attachment.name,
        // Use viewport (fixed) coordinates
        top: flipBelow ? chipRect.bottom + 8 : chipRect.top - 8,
        left: chipRect.left + chipRect.width / 2,
        flipBelow,
      })
    }

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const related = e.relatedTarget as HTMLElement | null
      const chip = target.closest?.(`[${IMAGE_CHIP_ATTR}]`)
      if (chip && (!related || !chip.contains(related))) {
        setPreview(null)
      }
    }

    el.addEventListener('mouseover', handleMouseOver)
    el.addEventListener('mouseout', handleMouseOut)
    return () => {
      el.removeEventListener('mouseover', handleMouseOver)
      el.removeEventListener('mouseout', handleMouseOut)
    }
  }, [])

  // Input events
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const handleInput = () => notifyChange()
    el.addEventListener('input', handleInput)
    return () => el.removeEventListener('input', handleInput)
  }, [notifyChange])

  // MutationObserver to detect chip removals from any path (Delete key, cut, select-all+type, etc.)
  useEffect(() => {
    const el = editorRef.current
    if (!el) return

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const removed of Array.from(mutation.removedNodes)) {
          if (removed.nodeType !== Node.ELEMENT_NODE) continue
          const removedEl = removed as HTMLElement
          // Check if the removed node itself is a chip
          const id = removedEl.getAttribute?.(IMAGE_CHIP_ATTR)
          if (id) {
            attachmentsRef.current.delete(id)
            onImageRemove?.(id)
            continue
          }
          // Check for chips nested inside the removed subtree
          const nested = removedEl.querySelectorAll?.(`[${IMAGE_CHIP_ATTR}]`)
          if (nested) {
            for (const chip of Array.from(nested)) {
              const nestedId = chip.getAttribute(IMAGE_CHIP_ATTR)
              if (nestedId) {
                attachmentsRef.current.delete(nestedId)
                onImageRemove?.(nestedId)
              }
            }
          }
        }
      }
    })

    observer.observe(el, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [onImageRemove])

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editorRef.current?.focus()
        placeCursorAtEnd()
      },

      getContentBlocks(): ContentBlock[] {
        if (!editorRef.current) return []
        const raw = extractContentBlocks(editorRef.current)
        return raw.map((block) => {
          if (block.type === 'image') {
            const full = attachmentsRef.current.get(block.attachment.id)
            if (full) return { type: 'image', attachment: full }
          }
          return block
        })
      },

      clear() {
        if (!editorRef.current) return
        editorRef.current.innerHTML = ''
        attachmentsRef.current.clear()
        setPreview(null)
        checkEmpty()
        autoResize()
      },

      insertImage(attachment: ChatImageAttachment) {
        const el = editorRef.current
        if (!el) return

        attachmentsRef.current.set(attachment.id, attachment)
        const chip = createImageChipElement(attachment)

        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0)
          range.deleteContents()
          range.insertNode(chip)

          const space = document.createTextNode('\u00A0')
          chip.after(space)

          const newRange = document.createRange()
          newRange.setStartAfter(space)
          newRange.collapse(true)
          sel.removeAllRanges()
          sel.addRange(newRange)
        } else {
          el.appendChild(chip)
          const space = document.createTextNode('\u00A0')
          el.appendChild(space)
          placeCursorAtEnd()
        }

        el.focus()
        notifyChange()
      },

      getPlainText(): string {
        if (!editorRef.current) return ''
        return getPlainTextFromRoot(editorRef.current)
      },

      setPlainText(text: string) {
        if (!editorRef.current) return
        editorRef.current.textContent = text
        checkEmpty()
        autoResize()
      },

      isEmpty(): boolean {
        return empty
      },
    }),
    [empty, checkEmpty, autoResize, placeCursorAtEnd, notifyChange],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (sel?.isCollapsed && sel.anchorNode) {
        const node = sel.anchorNode
        const offset = sel.anchorOffset

        if (node.nodeType === Node.TEXT_NODE && offset === 0) {
          const prev = node.previousSibling as HTMLElement | null
          if (prev?.getAttribute?.(IMAGE_CHIP_ATTR)) {
            e.preventDefault()
            prev.remove() // MutationObserver handles cleanup
            notifyChange()
            return
          }
        }

        if (node === editorRef.current && offset > 0) {
          const prev = node.childNodes[offset - 1] as HTMLElement | null
          if (prev?.getAttribute?.(IMAGE_CHIP_ATTR)) {
            e.preventDefault()
            prev.remove() // MutationObserver handles cleanup
            notifyChange()
            return
          }
        }
      }
    }

    onKeyDown?.(e)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const hasImages = Array.from(e.clipboardData.items).some((item) =>
      item.type.startsWith('image/'),
    )

    if (hasImages) {
      onPaste?.(e)
      return
    }

    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text) {
      document.execCommand('insertText', false, text)
    }
  }

  return (
    <div ref={wrapperRef} className={`rich-input__wrapper ${className ?? ''}`}>
      <div
        ref={editorRef}
        className="rich-input__editor"
        contentEditable
        role="textbox"
        tabIndex={0}
        aria-multiline
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        suppressContentEditableWarning
        style={{ minHeight, maxHeight }}
      />
      {preview && (
        <div
          className="rich-input__hover-preview"
          style={{
            top: preview.top,
            left: preview.left,
            transform: preview.flipBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
          }}
        >
          <img src={preview.src} alt={preview.name} className="rich-input__hover-preview-img" />
          <span className="rich-input__hover-preview-name">{preview.name}</span>
        </div>
      )}
    </div>
  )
})
