import { ChevronRight, File as FileIcon, Folder, FolderPlus, Home, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { connection } from '../../lib/connection.js'

interface Entry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: string
}

/** One file in a picker invocation. */
export interface PickerFile {
  /** Original filename (editable only in single-file mode). */
  name: string
  sizeBytes: number
  mime?: string
}

export interface DestinationPickerResult {
  /** Absolute workspace path of the chosen folder. */
  folderPath: string
  /**
   * Final filenames for each file in the batch, aligned with the input
   * `files` array by index. Single-file mode still returns a 1-element array.
   */
  filenames: string[]
  /** Whether the user asked to attach the files to their next message. */
  attachToMessage: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (result: DestinationPickerResult) => void
  /** Root of the project. Picker starts here and forbids navigating above it. */
  workspaceRoot: string
  /**
   * Files being uploaded in this picker invocation. Length ≥ 1.
   * Single-file mode shows an editable name field; batch mode shows a
   * stacked list with original names.
   */
  files: PickerFile[]
  /** Whether the "Attach to this message" checkbox is shown & default-checked. */
  offerAttach?: boolean
  /** Optional pre-selected starting folder (workspace-relative or absolute). */
  initialFolder?: string
}

const HIDDEN_NAMES = new Set(['.DS_Store', '.anton.json', 'Thumbs.db', '.git'])
const MAX_BYTES_HARD = 500 * 1024 * 1024
const COMPOSER_SOFT_BYTES = 100 * 1024 * 1024

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function sanitizeFilename(name: string): string {
  // Strip path separators and control chars. Collapse whitespace. No leading dots.
  let s = name
    .replace(/[\\/]/g, '_')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ASCII control chars is the intent
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
  s = s.replace(/^\.+/, '')
  return s || 'untitled'
}

function resolveInitialCwd(workspaceRoot: string, initialFolder: string | undefined): string {
  if (!initialFolder) return workspaceRoot
  // Treat absolute paths as-is; treat relative as workspace-relative.
  if (initialFolder.startsWith('/')) return initialFolder
  const trimmed = initialFolder.replace(/^\/+|\/+$/g, '')
  return trimmed ? `${workspaceRoot.replace(/\/$/, '')}/${trimmed}` : workspaceRoot
}

export function DestinationPicker({
  open,
  onClose,
  onConfirm,
  workspaceRoot,
  files,
  offerAttach = true,
  initialFolder,
}: Props) {
  const isBatch = files.length > 1
  const [cwd, setCwd] = useState<string>(() => resolveInitialCwd(workspaceRoot, initialFolder))
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  // Distinct from listError: the cwd doesn't exist yet (ENOENT). Happens
  // when a smart-default folder like `notes/` is picked before the user
  // has ever created it. fs_write auto-creates parents on Save, so we
  // surface this as a friendly hint rather than a red error.
  const [cwdMissing, setCwdMissing] = useState(false)
  // Single-file mode: editable filename. Batch mode: snapshot of originals.
  const [filename, setFilename] = useState(sanitizeFilename(files[0]?.name ?? ''))
  const [attachToMessage, setAttachToMessage] = useState(offerAttach)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0), [files])
  const maxSingleFile = useMemo(
    () => files.reduce((m, f) => Math.max(m, f.sizeBytes || 0), 0),
    [files],
  )

  // Reset state when picker opens for a new invocation.
  useEffect(() => {
    if (!open) return
    setCwd(resolveInitialCwd(workspaceRoot, initialFolder))
    setFilename(sanitizeFilename(files[0]?.name ?? ''))
    setAttachToMessage(offerAttach)
    setNewFolderOpen(false)
    setNewFolderName('')
    setSubmitting(false)
    setListError(null)
    setCwdMissing(false)
  }, [open, files, initialFolder, offerAttach, workspaceRoot])

  // Listen for filesystem responses while open.
  //
  // Uses the server-echoed `path` to discard responses meant for other
  // listeners (e.g., ProjectFilesView browsing a different directory in
  // parallel). Without this filter, concurrent listings stomp the
  // picker's entries.
  useEffect(() => {
    if (!open) return
    const unsubList = connection.onFilesystemResponse((es, error, respPath) => {
      // Ignore responses for paths we didn't request. When path is missing
      // (server too old / some edge path), fall through — better a
      // rare mis-paint than no listing at all.
      if (respPath && respPath !== cwd) return
      setLoading(false)
      if (error) {
        // ENOENT on a smart-default folder (e.g. `notes/` when we haven't
        // created it yet) isn't a real error — fs_write auto-creates the
        // parent chain on save. Swallow ENOENT here and surface it as a
        // friendly "will be created" hint in the render path. Other
        // errors (permission denied, etc.) still flow through.
        const missing = /ENOENT|no such file|not found/i.test(error)
        setListError(missing ? null : error)
        setCwdMissing(missing)
        setEntries([])
        return
      }
      setListError(null)
      setCwdMissing(false)
      setEntries(es)
    })
    const unsubMkdir = connection.onFilesystemMkdirResponse((path, success, error) => {
      if (!success) {
        setListError(error || 'Failed to create folder')
        return
      }
      // Navigate into the created folder so the user sees the outcome.
      setNewFolderOpen(false)
      setNewFolderName('')
      setCwd(path)
    })
    return () => {
      unsubList?.()
      unsubMkdir?.()
    }
  }, [open, cwd])

  // Refresh listing whenever cwd changes.
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setListError(null)
    connection.sendFilesystemList(cwd, false)
  }, [cwd, open])

  // Esc closes. Focus-trap light-weight: focus the modal on open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    modalRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Breadcrumbs relative to workspaceRoot.
  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; path: string }[] = [{ label: 'Project', path: workspaceRoot }]
    if (cwd !== workspaceRoot && cwd.startsWith(`${workspaceRoot}/`)) {
      const rel = cwd.slice(workspaceRoot.length + 1)
      const parts = rel.split('/').filter(Boolean)
      let acc = workspaceRoot
      for (const p of parts) {
        acc = `${acc}/${p}`
        crumbs.push({ label: p, path: acc })
      }
    }
    return crumbs
  }, [cwd, workspaceRoot])

  const visibleFolders = useMemo(
    () =>
      entries
        .filter((e) => e.type === 'dir' && !HIDDEN_NAMES.has(e.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  )

  const goUp = useCallback(() => {
    if (cwd === workspaceRoot) return
    const last = cwd.lastIndexOf('/')
    if (last <= 0) return
    const parent = cwd.slice(0, last)
    // Clamp to workspaceRoot.
    if (parent.length < workspaceRoot.length) setCwd(workspaceRoot)
    else setCwd(parent)
  }, [cwd, workspaceRoot])

  const submitNewFolder = () => {
    const name = newFolderName.trim()
    if (!name) return
    const safe = sanitizeFilename(name)
    const target = cwd === '/' ? `/${safe}` : `${cwd}/${safe}`
    connection.sendFilesystemMkdir(target)
  }

  const handleConfirm = () => {
    if (maxSingleFile > MAX_BYTES_HARD) return // guarded by UI but defend in depth
    // Single-file: user may have renamed. Batch: keep original names.
    const filenames = isBatch
      ? files.map((f) => sanitizeFilename(f.name))
      : [sanitizeFilename(filename)]
    if (filenames.some((n) => !n)) return
    setSubmitting(true)
    onConfirm({ folderPath: cwd, filenames, attachToMessage })
  }

  const hardTooBig = maxSingleFile > MAX_BYTES_HARD
  const softTooBig = totalBytes > COMPOSER_SOFT_BYTES && !hardTooBig

  if (!open) return null

  // Portal into document.body so a `transform` on any composer ancestor
  // (e.g. StreamHome's `.home-stack` uses translateY) doesn't break the
  // `position: fixed` overlay positioning — it would otherwise anchor to
  // the transformed ancestor instead of the viewport.
  return createPortal(
    // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires showModal()/JS lifecycle; this overlay is portal-rendered and managed via React state
    <div className="dp-modal__overlay" role="dialog" aria-modal="true" aria-label="Save file">
      <div
        ref={modalRef}
        tabIndex={-1}
        className="dp-modal"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !newFolderOpen && !hardTooBig) {
            // Don't hijack Enter while typing in inputs.
            const tag = (e.target as HTMLElement).tagName
            if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
              e.preventDefault()
              handleConfirm()
            }
          }
        }}
      >
        {/* Header */}
        <div className="dp-modal__header">
          <div className="dp-modal__title">
            {isBatch ? `Save ${files.length} files to project` : 'Save file to project'}
          </div>
          <button type="button" className="dp-modal__close" onClick={onClose} aria-label="Close">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="dp-modal__body">
          {isBatch ? (
            // Batch mode: show the file list. Individual filenames are used
            // as-is; renaming requires single-file invocation.
            <div className="dp-batch-list">
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="dp-batch-item">
                  <FileIcon size={13} strokeWidth={1.5} className="dp-batch-item__icon" />
                  <span className="dp-batch-item__name">{f.name}</span>
                  <span className="dp-batch-item__size">{formatBytes(f.sizeBytes)}</span>
                </div>
              ))}
            </div>
          ) : (
            <label className="dp-field">
              <span className="dp-field__label">Name</span>
              <input
                type="text"
                className="dp-field__input"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !hardTooBig) {
                    e.preventDefault()
                    handleConfirm()
                  }
                }}
              />
            </label>
          )}

          {/* Breadcrumbs */}
          <div className="dp-crumbs">
            <button
              type="button"
              className="dp-crumb dp-crumb--home"
              onClick={() => setCwd(workspaceRoot)}
              aria-label="Project root"
              title="Project root"
            >
              <Home size={12} strokeWidth={1.5} />
            </button>
            {breadcrumbs.map((c, i) => {
              const isLast = i === breadcrumbs.length - 1
              return (
                <span key={`${c.path}-${i}`} className="dp-crumb-wrap">
                  <ChevronRight size={12} strokeWidth={1.5} className="dp-crumb-sep" />
                  {isLast ? (
                    <span className="dp-crumb dp-crumb--current">{c.label}</span>
                  ) : (
                    <button
                      type="button"
                      className="dp-crumb dp-crumb--link"
                      onClick={() => setCwd(c.path)}
                    >
                      {c.label}
                    </button>
                  )}
                </span>
              )
            })}
          </div>

          {/* Folder list */}
          <div className="dp-list">
            {cwd !== workspaceRoot && (
              <button type="button" className="dp-list__row dp-list__row--up" onClick={goUp}>
                <Folder size={15} strokeWidth={1.5} />
                <span>..</span>
              </button>
            )}
            {loading ? (
              <div className="dp-list__empty">
                <Loader2 size={14} className="dp-spin" /> Loading…
              </div>
            ) : listError ? (
              <div className="dp-list__empty dp-list__empty--error">{listError}</div>
            ) : cwdMissing ? (
              <div className="dp-list__empty dp-list__empty--hint">
                This folder doesn't exist yet — it'll be created when you save.
              </div>
            ) : visibleFolders.length === 0 ? (
              <div className="dp-list__empty">No folders here yet.</div>
            ) : (
              visibleFolders.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  className="dp-list__row"
                  onClick={() => {
                    const next = cwd === '/' ? `/${f.name}` : `${cwd}/${f.name}`
                    setCwd(next)
                  }}
                >
                  <Folder size={15} strokeWidth={1.5} />
                  <span className="dp-list__row-name">{f.name}</span>
                </button>
              ))
            )}

            {/* New folder inline row */}
            {newFolderOpen ? (
              <div className="dp-list__row dp-list__row--new-folder">
                <FolderPlus size={15} strokeWidth={1.5} />
                <input
                  ref={newFolderInputRef}
                  type="text"
                  className="dp-field__input dp-field__input--inline"
                  value={newFolderName}
                  placeholder="New folder name"
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitNewFolder()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setNewFolderOpen(false)
                      setNewFolderName('')
                    }
                  }}
                  // biome-ignore lint/a11y/noAutofocus: inline create flow; focus expected here
                  autoFocus
                />
                <button
                  type="button"
                  className="dp-btn dp-btn--ghost dp-btn--tiny"
                  onClick={() => {
                    setNewFolderOpen(false)
                    setNewFolderName('')
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dp-btn dp-btn--primary dp-btn--tiny"
                  onClick={submitNewFolder}
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="dp-list__row dp-list__row--add"
                onClick={() => {
                  setNewFolderOpen(true)
                  setNewFolderName('')
                  window.setTimeout(() => newFolderInputRef.current?.focus(), 20)
                }}
              >
                <FolderPlus size={15} strokeWidth={1.5} />
                <span>New folder</span>
              </button>
            )}
          </div>

          {/* Size + soft-cap notice */}
          <div className="dp-size-row">
            <span className="dp-size">
              {isBatch
                ? `${files.length} files · ${formatBytes(totalBytes)}`
                : formatBytes(totalBytes)}
            </span>
            {softTooBig && (
              <span className="dp-hint dp-hint--warn">
                Large batch — uploads may be slow from the composer.
              </span>
            )}
            {hardTooBig && (
              <span className="dp-hint dp-hint--error">
                At least one file is over 500 MB — cannot upload.
              </span>
            )}
          </div>

          {/* Attach checkbox */}
          {offerAttach && (
            <label className="dp-attach">
              <input
                type="checkbox"
                checked={attachToMessage}
                onChange={(e) => setAttachToMessage(e.target.checked)}
              />
              <span>{isBatch ? 'Attach all to this message' : 'Attach to this message'}</span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="dp-modal__footer">
          <button type="button" className="dp-btn dp-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="dp-btn dp-btn--primary"
            onClick={handleConfirm}
            disabled={submitting || hardTooBig || !filename.trim()}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
