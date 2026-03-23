import {
  ChevronRight,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { connection } from '../lib/connection.js'

interface FileEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: string
}

interface DirState {
  entries: FileEntry[]
  loading: boolean
  error: string | null
}

// Start in home directory — server will resolve ~ to actual path
const HOME_DIR = '/root'

export function FileBrowser() {
  const [cwd, setCwd] = useState(HOME_DIR)
  const [pathParts, setPathParts] = useState<string[]>([HOME_DIR])
  const [dirState, setDirState] = useState<DirState>({ entries: [], loading: true, error: null })
  const [_expandedDirs, _setExpandedDirs] = useState<Set<string>>(new Set())

  const listDir = useCallback((path: string) => {
    setDirState({ entries: [], loading: true, error: null })
    setCwd(path)

    // Build breadcrumb parts — show ~ for home
    const isHome = path === HOME_DIR
    const isUnderHome = path.startsWith(`${HOME_DIR}/`)
    if (isHome) {
      setPathParts(['~'])
    } else if (isUnderHome) {
      const rel = path.slice(HOME_DIR.length + 1)
      setPathParts(['~', ...rel.split('/').filter(Boolean)])
    } else {
      setPathParts(path === '/' ? ['/'] : ['/', ...path.split('/').filter(Boolean)])
    }

    // Send filesystem list on the FILESYNC channel (session-independent)
    connection.sendFilesystemList(path)
  }, [])

  // Listen for filesystem list responses
  useEffect(() => {
    const unsub = connection.onFilesystemResponse((entries, error) => {
      if (error) {
        setDirState({ entries: [], loading: false, error })
      } else {
        setDirState({ entries, loading: false, error: null })
      }
    })
    return unsub
  }, [])

  // Timeout — if no response after 5s, show error
  useEffect(() => {
    if (!dirState.loading) return
    const timer = setTimeout(() => {
      setDirState((prev) =>
        prev.loading
          ? {
              entries: [],
              loading: false,
              error: 'No response — restart the agent server to enable file browsing.',
            }
          : prev,
      )
    }, 5000)
    return () => clearTimeout(timer)
  }, [dirState.loading])

  // Initial load — start in home dir
  useEffect(() => {
    listDir(HOME_DIR)
  }, [listDir])

  const navigateTo = (path: string) => {
    listDir(path)
  }

  const navigateToBreadcrumb = (index: number) => {
    if (index === 0) {
      // First part is either ~ or /
      navigateTo(pathParts[0] === '~' ? HOME_DIR : '/')
    } else {
      const base = pathParts[0] === '~' ? HOME_DIR : ''
      const path = `${base}/${pathParts.slice(1, index + 1).join('/')}`
      navigateTo(path)
    }
  }

  const handleEntryClick = (entry: FileEntry) => {
    if (entry.type === 'dir') {
      const newPath = cwd === '/' ? `/${entry.name}` : `${cwd}/${entry.name}`
      navigateTo(newPath)
    }
  }

  const getFileIcon = (entry: FileEntry) => {
    if (entry.type === 'dir') return <Folder className="fb-entry__icon fb-entry__icon--dir" />

    const ext = entry.name.split('.').pop()?.toLowerCase()
    if (
      ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'sh', 'json', 'yaml', 'yml', 'toml'].includes(
        ext || '',
      )
    )
      return <FileCode className="fb-entry__icon fb-entry__icon--code" />
    if (['md', 'txt', 'log', 'csv'].includes(ext || ''))
      return <FileText className="fb-entry__icon fb-entry__icon--text" />
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext || ''))
      return <Image className="fb-entry__icon fb-entry__icon--image" />
    return <File className="fb-entry__icon" />
  }

  return (
    <div className="fb">
      {/* Breadcrumb */}
      <div className="fb-breadcrumb">
        {pathParts.map((part, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb parts can have duplicate names
          <span key={`${part}-${i}`} className="fb-breadcrumb__segment">
            {i > 0 && <ChevronRight className="fb-breadcrumb__sep" />}
            <button
              type="button"
              onClick={() => navigateToBreadcrumb(i)}
              className={`fb-breadcrumb__btn${i === pathParts.length - 1 ? ' fb-breadcrumb__btn--active' : ''}`}
            >
              {part === '/' ? '~' : part}
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => listDir(cwd)}
          className="fb-breadcrumb__refresh"
          aria-label="Refresh"
        >
          <RefreshCw
            className={`fb-breadcrumb__refreshIcon${dirState.loading ? ' fb-spinning' : ''}`}
          />
        </button>
      </div>

      {/* File list */}
      <div className="fb-list">
        {dirState.loading && (
          <div className="fb-status">
            <Loader2 className="fb-status__icon fb-spinning" />
            <span>Loading...</span>
          </div>
        )}

        {dirState.error && (
          <div className="fb-status fb-status--error">
            <span>{dirState.error}</span>
          </div>
        )}

        {!dirState.loading && !dirState.error && dirState.entries.length === 0 && (
          <div className="fb-status">
            <span>Empty directory</span>
          </div>
        )}

        {/* Show parent directory link if not at root */}
        {cwd !== '/' && !dirState.loading && (
          <button
            type="button"
            onClick={() => {
              const parent = cwd.split('/').slice(0, -1).join('/') || '/'
              navigateTo(parent)
            }}
            className="fb-entry fb-entry--parent"
          >
            <FolderOpen className="fb-entry__icon fb-entry__icon--dir" />
            <span className="fb-entry__name">..</span>
          </button>
        )}

        {/* Directories first, then files */}
        {dirState.entries
          .sort((a, b) => {
            if (a.type === 'dir' && b.type !== 'dir') return -1
            if (a.type !== 'dir' && b.type === 'dir') return 1
            return a.name.localeCompare(b.name)
          })
          .map((entry) => (
            <button
              type="button"
              key={entry.name}
              onClick={() => handleEntryClick(entry)}
              className={`fb-entry${entry.type === 'dir' ? ' fb-entry--dir' : ''}`}
            >
              {getFileIcon(entry)}
              <span className="fb-entry__name">{entry.name}</span>
              {entry.type === 'file' && entry.size && (
                <span className="fb-entry__size">{entry.size}</span>
              )}
            </button>
          ))}
      </div>
    </div>
  )
}
