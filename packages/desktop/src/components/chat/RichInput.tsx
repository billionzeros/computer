import type React from 'react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatImageAttachment } from '../../lib/store.js'

// ── Public types ──────────────────────────────────────────────────────────────

/** Reference to a file in the project workspace (workspace-relative path). */
export interface FileReference {
  path: string
  name: string
}

/** Reference to a folder in the project workspace. */
export interface FolderReference {
  path: string
  name: string
}

/**
 * Ordered content block — text, image, file, or dir — preserving the user's
 * insertion order. `file` and `dir` land here when users select them from the
 * `@` dropdown; the composer serializes them as `[file:path]` / `[dir:path]`
 * markers on send.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachment: ChatImageAttachment }
  | { type: 'file'; file: FileReference }
  | { type: 'dir'; dir: FolderReference }

export interface RichInputHandle {
  focus: () => void
  getContentBlocks: () => ContentBlock[]
  clear: () => void
  insertImage: (attachment: ChatImageAttachment) => void
  /**
   * Replaces the trailing `@query` fragment (if any) with a file or folder
   * pill followed by a space. No-op if no mention trigger is present.
   */
  replaceMentionTriggerWithPill: (
    kind: 'file' | 'dir',
    ref: FileReference | FolderReference,
  ) => void
  getPlainText: () => string
  /**
   * Sets editor content from a plain-text string. `[file:path]` and
   * `[dir:path]` markers in the string are parsed back into pill nodes so
   * draft restoration round-trips losslessly.
   */
  setPlainText: (text: string) => void
  isEmpty: () => boolean
}

interface Props {
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void
  onChange?: (plainText: string) => void
  onImageRemove?: (id: string) => void
  /**
   * Fired when a file or folder pill is clicked. File pills typically open
   * an artifact preview; folder pills typically navigate to the Files view.
   */
  onPillClick?: (kind: 'file' | 'dir', ref: FileReference | FolderReference) => void
  className?: string
  minHeight?: number
  maxHeight?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const IMAGE_CHIP_ATTR = 'data-image-id'
const FILE_PILL_ATTR = 'data-file-pill'
const FILE_PILL_PATH_ATTR = 'data-file-pill-path'
const FILE_PILL_NAME_ATTR = 'data-file-pill-name'

/**
 * Matches `[file:...]` and `[dir:...]` markers produced by serialization.
 * Keeps it permissive: any non-`]` inside the path works for unicode names.
 */
const FILE_PILL_MARKER_RE = /\[(file|dir):([^\]]+)\]/g

function basenameOf(path: string): string {
  const clean = path.replace(/\/+$/, '')
  const idx = clean.lastIndexOf('/')
  return idx >= 0 ? clean.slice(idx + 1) : clean
}

const CODE_EXTS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rs',
  'go',
  'sh',
  'rb',
  'java',
  'c',
  'cpp',
  'html',
  'css',
  'scss',
  'swift',
  'kt',
  'vue',
  'svelte',
])
const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'csv', 'xml', 'toml', 'sql', 'xlsx', 'xls'])
const TEXT_EXTS = new Set(['md', 'txt', 'log', 'pdf', 'doc', 'docx', 'rtf', 'mdx'])
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',
  'bmp',
  'heic',
  'heif',
])

function pillIconSymbolFor(name: string, isDir: boolean): string {
  if (isDir) return '📁'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return '🖼'
  if (DATA_EXTS.has(ext)) return '📊'
  if (CODE_EXTS.has(ext)) return '⟨⟩'
  if (TEXT_EXTS.has(ext)) return '📄'
  return '📎'
}

function createFilePillElement(ref: FileReference, isDir: boolean): HTMLSpanElement {
  const pill = document.createElement('span')
  pill.className = `rich-input__chip rich-input__chip--${isDir ? 'folder' : 'file'}`
  pill.contentEditable = 'false'
  pill.setAttribute(FILE_PILL_ATTR, isDir ? 'dir' : 'file')
  pill.setAttribute(FILE_PILL_PATH_ATTR, ref.path)
  pill.setAttribute(FILE_PILL_NAME_ATTR, ref.name)
  // Hover tooltip shows the full path so users can disambiguate two
  // files with the same basename in different folders.
  pill.title = ref.path

  const icon = document.createElement('span')
  icon.className = 'rich-input__chip-icon'
  icon.textContent = pillIconSymbolFor(ref.name, isDir)

  const nameEl = document.createElement('span')
  nameEl.className = 'rich-input__chip-name'
  nameEl.textContent = ref.name

  // Hover-reveal remove affordance, mirroring image chips. Click removes
  // the whole pill node; the editor's click-delegate below catches it.
  const removeBtn = document.createElement('span')
  removeBtn.className = 'rich-input__chip-remove'
  removeBtn.setAttribute('role', 'button')
  removeBtn.setAttribute('aria-label', `Remove ${ref.name}`)
  removeBtn.textContent = '\u00D7' // ×

  pill.appendChild(icon)
  pill.appendChild(nameEl)
  pill.appendChild(removeBtn)
  return pill
}

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
      const filePillKind = el.getAttribute(FILE_PILL_ATTR)
      if (filePillKind === 'file' || filePillKind === 'dir') {
        flush()
        const path = el.getAttribute(FILE_PILL_PATH_ATTR) ?? ''
        const name = el.getAttribute(FILE_PILL_NAME_ATTR) ?? basenameOf(path)
        if (filePillKind === 'file') {
          blocks.push({ type: 'file', file: { path, name } })
        } else {
          blocks.push({ type: 'dir', dir: { path, name } })
        }
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

/**
 * Serialize editor content to plain text. Files become `[file:path]`;
 * folders become `[dir:path]`. These markers round-trip losslessly
 * through `setPlainText` because `hydrateFromPlainText` rebuilds pill DOM.
 *
 * Images are deliberately NOT emitted: they're heavy (base64 payload),
 * restored via a separate `insertImage` call from the parent's draft
 * flow, and `hydrateFromPlainText` wouldn't reconstruct the attachment
 * anyway. Consumers that need the image positions in the outgoing send
 * payload walk `getContentBlocks()` directly (see ChatInput.handleSend).
 */
function getPlainTextFromRoot(root: HTMLElement): string {
  const blocks = extractContentBlocks(root)
  let out = ''
  for (const b of blocks) {
    if (b.type === 'text') out += b.text
    else if (b.type === 'file') out += `[file:${b.file.path}]`
    else if (b.type === 'dir') out += `[dir:${b.dir.path}]`
    // image blocks intentionally skipped — see comment above
  }
  return out.trim()
}

/**
 * Rebuild the editor DOM from a plain-text string, converting `[file:…]`
 * and `[dir:…]` markers back into pill nodes. Image markers are left as
 * literal text here; image chips are re-inserted separately via
 * `insertImage` during draft restore.
 */
function hydrateFromPlainText(root: HTMLElement, text: string) {
  root.innerHTML = ''
  if (!text) return
  let lastIndex = 0
  const re = new RegExp(FILE_PILL_MARKER_RE.source, 'g')
  for (;;) {
    const m = re.exec(text)
    if (!m) break
    if (m.index > lastIndex) {
      root.appendChild(document.createTextNode(text.slice(lastIndex, m.index)))
    }
    const kind = m[1] as 'file' | 'dir'
    const path = m[2] ?? ''
    const ref: FileReference = { path, name: basenameOf(path) }
    root.appendChild(createFilePillElement(ref, kind === 'dir'))
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) {
    root.appendChild(document.createTextNode(text.slice(lastIndex)))
  }
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
    onPillClick,
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
    const hasText = !!el.textContent?.trim()
    const hasImage = !!el.querySelector(`[${IMAGE_CHIP_ATTR}]`)
    const hasPill = !!el.querySelector(`[${FILE_PILL_ATTR}]`)
    setEmpty(!hasText && !hasImage && !hasPill)
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

  // Click handler: image chip removes, file/dir pill opens their preview surface.
  useEffect(() => {
    const el = editorRef.current
    if (!el) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Remove-button clicks handle both image chips AND file/folder pills.
      // Must run before the pill-click branch so clicking the × doesn't also
      // fire the navigate-to-artifact behavior.
      if (target.classList.contains('rich-input__chip-remove')) {
        const chip = target.closest(
          `[${IMAGE_CHIP_ATTR}], [${FILE_PILL_ATTR}]`,
        ) as HTMLElement | null
        if (chip) {
          chip.remove() // MutationObserver handles image-attachment cleanup; pills have no state
          notifyChange()
          setPreview(null)
        }
        return
      }
      // File / folder pill click → dispatch through prop.
      const pill = target.closest(`[${FILE_PILL_ATTR}]`) as HTMLElement | null
      if (pill && onPillClick) {
        const kind = pill.getAttribute(FILE_PILL_ATTR) as 'file' | 'dir' | null
        const path = pill.getAttribute(FILE_PILL_PATH_ATTR) ?? ''
        const name = pill.getAttribute(FILE_PILL_NAME_ATTR) ?? basenameOf(path)
        if (kind === 'file' || kind === 'dir') {
          onPillClick(kind, { path, name })
        }
      }
    }

    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [notifyChange, onPillClick])

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
        // Rehydrate file/dir pill markers into DOM nodes. Image markers remain
        // literal here — image restore happens separately via insertImage
        // with full base64 payloads.
        hydrateFromPlainText(editorRef.current, text)
        checkEmpty()
        autoResize()
      },

      replaceMentionTriggerWithPill(kind: 'file' | 'dir', ref: FileReference | FolderReference) {
        const el = editorRef.current
        if (!el) return
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
          // No live selection — append to end.
          const pill = createFilePillElement(ref, kind === 'dir')
          el.appendChild(pill)
          el.appendChild(document.createTextNode('\u00A0'))
          placeCursorAtEnd()
          notifyChange()
          el.focus()
          return
        }

        // Resolve the caret to a `(textNode, offset)` pair. When the anchor
        // is the editor element itself (e.g., right after `setPlainText` +
        // `placeCursorAtEnd` for a drill-in flow), we dive into the text
        // node immediately before the anchor-offset. Without this, the
        // text-node branch below never fires and we fall through to the
        // fallback path, which *appends* the pill after `@query` instead
        // of replacing it.
        let textNode: Text | null = null
        let textOffset = 0
        const rawAnchor = sel.anchorNode
        const rawOffset = sel.anchorOffset
        if (rawAnchor && rawAnchor.nodeType === Node.TEXT_NODE) {
          textNode = rawAnchor as Text
          textOffset = rawOffset
        } else if (rawAnchor && rawAnchor.nodeType === Node.ELEMENT_NODE) {
          const elAnchor = rawAnchor as HTMLElement
          // childNodes[offset - 1] is the node immediately before the caret.
          const prev = rawOffset > 0 ? elAnchor.childNodes[rawOffset - 1] : null
          if (prev && prev.nodeType === Node.TEXT_NODE) {
            textNode = prev as Text
            textOffset = textNode.textContent?.length ?? 0
          }
        }

        // Walk backward within the resolved text node looking for an `@`
        // that's preceded by start-of-node, whitespace, or an opening bracket.
        if (textNode) {
          const text = textNode.textContent ?? ''
          let at = -1
          for (let i = textOffset - 1; i >= 0; i--) {
            const ch = text[i]
            if (ch === '@') {
              const before = i === 0 ? '' : text[i - 1]
              if (!before || /[\s(\[{]/.test(before)) {
                at = i
              }
              break
            }
            if (!ch || /\s/.test(ch)) break
          }
          if (at >= 0) {
            const range = document.createRange()
            range.setStart(textNode, at)
            range.setEnd(textNode, textOffset)
            range.deleteContents()
            const pill = createFilePillElement(ref, kind === 'dir')
            range.insertNode(pill)
            const space = document.createTextNode('\u00A0')
            pill.after(space)
            const newRange = document.createRange()
            newRange.setStartAfter(space)
            newRange.collapse(true)
            sel.removeAllRanges()
            sel.addRange(newRange)
            el.focus()
            notifyChange()
            return
          }
        }

        // Fallback: no `@` trigger found — just insert at cursor.
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const pill = createFilePillElement(ref, kind === 'dir')
        range.insertNode(pill)
        const space = document.createTextNode('\u00A0')
        pill.after(space)
        const newRange = document.createRange()
        newRange.setStartAfter(space)
        newRange.collapse(true)
        sel.removeAllRanges()
        sel.addRange(newRange)
        el.focus()
        notifyChange()
      },

      isEmpty(): boolean {
        return empty
      },
    }),
    [empty, checkEmpty, autoResize, placeCursorAtEnd, notifyChange],
    // Note: `replaceMentionTriggerWithPill` closes over `notifyChange` + `placeCursorAtEnd`;
    // both are already listed. `hydrateFromPlainText` and `createFilePillElement` are
    // module-scope and stable.
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Backspace') {
      const sel = window.getSelection()
      if (sel?.isCollapsed && sel.anchorNode) {
        const node = sel.anchorNode
        const offset = sel.anchorOffset

        const isChipLike = (el: HTMLElement | null): boolean =>
          !!el && (!!el.getAttribute?.(IMAGE_CHIP_ATTR) || !!el.getAttribute?.(FILE_PILL_ATTR))

        if (node.nodeType === Node.TEXT_NODE && offset === 0) {
          const prev = node.previousSibling as HTMLElement | null
          if (isChipLike(prev)) {
            e.preventDefault()
            prev?.remove() // MutationObserver handles image cleanup; pills need no cleanup
            notifyChange()
            return
          }
        }

        if (node === editorRef.current && offset > 0) {
          const prev = node.childNodes[offset - 1] as HTMLElement | null
          if (isChipLike(prev)) {
            e.preventDefault()
            prev?.remove()
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
      {preview &&
        createPortal(
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
          </div>,
          document.body,
        )}
    </div>
  )
})
