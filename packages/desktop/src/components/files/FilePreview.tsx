import { File, FileCode, FileSpreadsheet, FileText, Folder, Image } from 'lucide-react'

interface FilePreviewProps {
  name: string
  type: 'file' | 'dir' | 'link'
  size: string
  content: string | null
  loading: boolean
  error: string | null
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

function getCategory(name: string): 'code' | 'data' | 'text' | 'image' | 'dir' | 'other' {
  const ext = getExt(name)
  if (CODE_EXTS.has(ext)) return 'code'
  if (DATA_EXTS.has(ext)) return 'data'
  if (TEXT_EXTS.has(ext)) return 'text'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'other'
}

function getLargeIcon(name: string, type: string) {
  if (type === 'dir') return <Folder size={48} strokeWidth={1} />
  const cat = getCategory(name)
  switch (cat) {
    case 'code':
      return <FileCode size={48} strokeWidth={1} />
    case 'data':
      return <FileSpreadsheet size={48} strokeWidth={1} />
    case 'text':
      return <FileText size={48} strokeWidth={1} />
    case 'image':
      return <Image size={48} strokeWidth={1} />
    default:
      return <File size={48} strokeWidth={1} />
  }
}

function isPreviewable(name: string): boolean {
  const ext = getExt(name)
  return CODE_EXTS.has(ext) || DATA_EXTS.has(ext) || TEXT_EXTS.has(ext) || ext === 'svg'
}

export function FilePreview({ name, type, size, content, loading, error }: FilePreviewProps) {
  const ext = getExt(name)
  const cat = getCategory(name)

  return (
    <div className="fp">
      <div className={`fp-icon fp-icon--${type === 'dir' ? 'dir' : cat}`}>
        {getLargeIcon(name, type)}
      </div>

      <h3 className="fp-name">{name}</h3>

      <div className="fp-meta">
        {type === 'dir' ? (
          <span className="fp-tag">Folder</span>
        ) : (
          <>
            <span className="fp-tag">.{ext}</span>
            {size && <span className="fp-size">{size}</span>}
          </>
        )}
      </div>

      {/* Content preview for text-based files */}
      {type === 'file' && isPreviewable(name) && (
        <div className="fp-content">
          {loading && <div className="fp-content__loading">Loading preview...</div>}
          {error && <div className="fp-content__error">{error}</div>}
          {!loading && !error && content !== null && (
            <pre className="fp-content__code">{content}</pre>
          )}
        </div>
      )}

      {/* Image indicator */}
      {type === 'file' && IMAGE_EXTS.has(ext) && (
        <div className="fp-content">
          <div className="fp-content__placeholder">
            <Image size={24} strokeWidth={1} />
            <span>Image file</span>
          </div>
        </div>
      )}
    </div>
  )
}
