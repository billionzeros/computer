import { File, FileCode, FileSpreadsheet, FileText, Folder, Image, Loader2 } from 'lucide-react'

interface FilePreviewProps {
  name: string
  type: 'file' | 'dir' | 'link'
  size: string
  content: string | null
  loading: boolean
  error: string | null
  itemCount?: number
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
  'zig',
  'hs',
])
const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'csv', 'xml', 'toml', 'sql', 'graphql'])
const TEXT_EXTS = new Set(['md', 'txt', 'log', 'rtf', 'pdf', 'doc', 'docx'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp'])

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() || ''
}

type Category = 'code' | 'data' | 'text' | 'image' | 'other'

function getCategory(name: string): Category {
  const ext = getExt(name)
  if (CODE_EXTS.has(ext)) return 'code'
  if (DATA_EXTS.has(ext)) return 'data'
  if (TEXT_EXTS.has(ext)) return 'text'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'other'
}

function isPreviewable(name: string): boolean {
  const ext = getExt(name)
  return CODE_EXTS.has(ext) || DATA_EXTS.has(ext) || TEXT_EXTS.has(ext) || ext === 'svg'
}

const KIND_LABELS: Record<Category, string> = {
  code: 'Source Code',
  data: 'Data File',
  text: 'Document',
  image: 'Image',
  other: 'File',
}

function LargeIcon({ name, type }: { name: string; type: string }) {
  const cat = getCategory(name)
  const cls = `fp-icon__inner fp-icon__inner--${type === 'dir' ? 'dir' : cat}`

  if (type === 'dir') {
    return (
      <div className={cls}>
        <Folder size={32} strokeWidth={1.2} />
      </div>
    )
  }

  const Icon =
    cat === 'code'
      ? FileCode
      : cat === 'data'
        ? FileSpreadsheet
        : cat === 'text'
          ? FileText
          : cat === 'image'
            ? Image
            : File

  return (
    <div className={cls}>
      <Icon size={32} strokeWidth={1.2} />
    </div>
  )
}

export function FilePreview({
  name,
  type,
  size,
  content,
  loading,
  error,
  itemCount,
}: FilePreviewProps) {
  const ext = getExt(name)
  const cat = getCategory(name)

  return (
    <div className="fp">
      {/* Large icon */}
      <div className="fp-hero">
        <LargeIcon name={name} type={type} />
      </div>

      {/* File name */}
      <div className="fp-name">{name}</div>

      {/* Info table */}
      <div className="fp-info">
        {type === 'dir' ? (
          <>
            <div className="fp-info__row">
              <span className="fp-info__label">Kind</span>
              <span className="fp-info__value">Folder</span>
            </div>
            {itemCount !== undefined && (
              <div className="fp-info__row">
                <span className="fp-info__label">Contents</span>
                <span className="fp-info__value">
                  {itemCount} item{itemCount !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="fp-info__row">
              <span className="fp-info__label">Kind</span>
              <span className="fp-info__value">{KIND_LABELS[cat]}</span>
            </div>
            {ext && (
              <div className="fp-info__row">
                <span className="fp-info__label">Extension</span>
                <span className="fp-info__value">.{ext}</span>
              </div>
            )}
            {size && (
              <div className="fp-info__row">
                <span className="fp-info__label">Size</span>
                <span className="fp-info__value">{size}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Content preview for text-based files */}
      {type === 'file' && isPreviewable(name) && (
        <div className="fp-preview">
          {loading && (
            <div className="fp-preview__status">
              <Loader2 size={16} strokeWidth={1.5} className="spin" />
            </div>
          )}
          {error && <div className="fp-preview__status fp-preview__status--error">{error}</div>}
          {!loading && !error && content !== null && (
            <pre className="fp-preview__code">{content}</pre>
          )}
        </div>
      )}

      {/* Image placeholder */}
      {type === 'file' && IMAGE_EXTS.has(ext) && (
        <div className="fp-preview">
          <div className="fp-preview__img-placeholder">
            <Image size={20} strokeWidth={1.2} />
          </div>
        </div>
      )}
    </div>
  )
}
