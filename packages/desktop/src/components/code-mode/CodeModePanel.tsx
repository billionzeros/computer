import { ChevronRight, File, FileCode, FileText, Folder, FolderOpen, Image, RefreshCw, Terminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../lib/store.js'

// ── Types ──

interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
  extension?: string
}

type CodeModeTab = 'files' | 'terminal'

// ── File icon helper ──

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'rs':
    case 'go':
    case 'java':
    case 'rb':
    case 'c':
    case 'cpp':
    case 'h':
    case 'swift':
    case 'kt':
      return <FileCode size={14} strokeWidth={1.5} />
    case 'md':
    case 'txt':
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
    case 'html':
    case 'css':
      return <FileText size={14} strokeWidth={1.5} />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <Image size={14} strokeWidth={1.5} />
    default:
      return <File size={14} strokeWidth={1.5} />
  }
}

// ── Language detection ──

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
    c: 'c', cpp: 'cpp', h: 'c', swift: 'swift', kt: 'kotlin',
    md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', xml: 'xml', html: 'html', css: 'css',
    sh: 'bash', zsh: 'bash', dockerfile: 'dockerfile',
  }
  return map[ext || ''] || 'text'
}

// ── FileTree Item ──

function FileTreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: FileNode
  depth: number
  selectedPath: string | null
  onSelect: (node: FileNode) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)

  if (node.type === 'dir') {
    return (
      <div className="code-tree__group">
        <button
          type="button"
          className="code-tree__item code-tree__item--dir"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            size={12}
            strokeWidth={1.5}
            className={`code-tree__chevron ${expanded ? 'code-tree__chevron--open' : ''}`}
          />
          {expanded
            ? <FolderOpen size={14} strokeWidth={1.5} className="code-tree__icon code-tree__icon--dir" />
            : <Folder size={14} strokeWidth={1.5} className="code-tree__icon code-tree__icon--dir" />
          }
          <span className="code-tree__label">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div className="code-tree__children">
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const isSelected = selectedPath === node.path
  return (
    <button
      type="button"
      className={`code-tree__item code-tree__item--file ${isSelected ? 'code-tree__item--selected' : ''}`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={() => onSelect(node)}
    >
      <span className="code-tree__icon">{getFileIcon(node.name)}</span>
      <span className="code-tree__label">{node.name}</span>
    </button>
  )
}

// ── Terminal Output ──

function TerminalOutput({ outputs }: { outputs: Array<{ command: string; output: string; isError?: boolean }> }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [outputs])

  if (outputs.length === 0) {
    return (
      <div className="code-terminal__empty">
        <Terminal size={18} strokeWidth={1.5} />
        <span>Shell output will appear here as Anton executes commands</span>
      </div>
    )
  }

  return (
    <div className="code-terminal__output" ref={scrollRef}>
      {outputs.map((entry, i) => (
        <div key={`${entry.command}-${i}`} className="code-terminal__entry">
          <div className="code-terminal__command">
            <span className="code-terminal__prompt">$</span>
            <span>{entry.command}</span>
          </div>
          {entry.output && (
            <pre className={`code-terminal__result ${entry.isError ? 'code-terminal__result--error' : ''}`}>
              {entry.output}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

// ── File Viewer ──

function FileViewer({ filename, content }: { filename: string; content: string }) {
  const lang = detectLanguage(filename)
  const lines = content.split('\n')

  return (
    <div className="code-viewer">
      <div className="code-viewer__header">
        <span className="code-viewer__filename">{filename}</span>
        <span className="code-viewer__lang">{lang}</span>
      </div>
      <div className="code-viewer__body">
        <div className="code-viewer__gutter">
          {lines.map((_, i) => (
            <span key={`line-${i + 1}`} className="code-viewer__line-number">{i + 1}</span>
          ))}
        </div>
        <pre className="code-viewer__code">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  )
}

// ── Main CodeModePanel ──

export function CodeModePanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<CodeModeTab>('files')
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Get workspace path from the active project
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const project = projects.find((p) => p.id === activeProjectId)
  const workspacePath = project?.workspacePath

  // Get shell outputs from artifacts (tool_call results for shell commands)
  const artifacts = useStore((s) => s.artifacts)
  const shellOutputs = artifacts
    .filter((a) => a.type === 'output' && a.title?.startsWith('$'))
    .map((a) => ({
      command: a.title?.replace(/^\$\s*/, '') || '',
      output: a.content || '',
      isError: false,
    }))

  // Build file tree from artifacts
  useEffect(() => {
    const fileArtifacts = artifacts.filter(
      (a) => a.type === 'file' && a.filepath
    )

    if (fileArtifacts.length === 0 && !workspacePath) {
      setFileTree([])
      return
    }

    // Build tree from file artifacts
    const tree = buildTreeFromPaths(
      fileArtifacts.map((a) => ({
        path: a.filepath || a.filename || a.title || 'unknown',
        content: a.content,
      })),
      workspacePath || ''
    )
    setFileTree(tree)
  }, [artifacts, workspacePath])

  const handleFileSelect = useCallback((node: FileNode) => {
    setSelectedFile(node)
    // Try to find content from artifacts
    const artifact = artifacts.find(
      (a) => a.filepath === node.path || a.filename === node.name
    )
    if (artifact) {
      setFileContent(artifact.content)
    } else {
      setFileContent(null)
    }
  }, [artifacts])

  const handleRefresh = useCallback(() => {
    setIsLoading(true)
    // The tree is built from artifacts, so just trigger a re-render
    setTimeout(() => setIsLoading(false), 300)
  }, [])

  // ── Resize ──
  const [panelWidth, setPanelWidth] = useState(520)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(520)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      startX.current = e.clientX
      startWidth.current = panelWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [panelWidth],
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = startX.current - e.clientX
      const newWidth = Math.min(900, Math.max(380, startWidth.current + delta))
      setPanelWidth(newWidth)
    }
    const handleMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div className="code-mode" style={{ width: panelWidth }}>
      {/* Resize handle */}
      <div className="code-mode__resize" onMouseDown={handleMouseDown} />

      {/* Tab bar */}
      <div className="code-mode__tabs">
        <button
          type="button"
          className={`code-mode__tab ${activeTab === 'files' ? 'code-mode__tab--active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          <FileCode size={13} strokeWidth={1.5} />
          Files
        </button>
        <button
          type="button"
          className={`code-mode__tab ${activeTab === 'terminal' ? 'code-mode__tab--active' : ''}`}
          onClick={() => setActiveTab('terminal')}
        >
          <Terminal size={13} strokeWidth={1.5} />
          Terminal
        </button>
        <div className="code-mode__tabs-spacer" />
        {activeTab === 'files' && (
          <button
            type="button"
            className="code-mode__tab-action"
            onClick={handleRefresh}
            title="Refresh file tree"
          >
            <RefreshCw size={13} strokeWidth={1.5} className={isLoading ? 'spin' : ''} />
          </button>
        )}
        <button
          type="button"
          className="code-mode__tab-action"
          onClick={onClose}
          title="Close panel"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </div>

      {/* Content area */}
      <div className="code-mode__body">
        {activeTab === 'files' && (
          <div className="code-mode__files">
            {/* File tree */}
            <div className="code-tree">
              {workspacePath && (
                <div className="code-tree__root-label">
                  {project?.name || 'Project'}
                </div>
              )}
              {fileTree.length === 0 ? (
                <div className="code-tree__empty">
                  <FileCode size={18} strokeWidth={1.5} />
                  <span>Files will appear here as Anton creates them</span>
                </div>
              ) : (
                <div className="code-tree__list">
                  {fileTree.map((node) => (
                    <FileTreeItem
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={selectedFile?.path || null}
                      onSelect={handleFileSelect}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* File viewer (below tree) */}
            {selectedFile && fileContent !== null && (
              <FileViewer filename={selectedFile.name} content={fileContent} />
            )}
          </div>
        )}

        {activeTab === 'terminal' && (
          <TerminalOutput outputs={shellOutputs} />
        )}
      </div>

      {/* Workspace path footer */}
      {workspacePath && (
        <div className="code-mode__footer">
          <Folder size={11} strokeWidth={1.5} />
          <span>{workspacePath.replace(/^\/Users\/[^/]+/, '~')}</span>
        </div>
      )}
    </div>
  )
}

// ── Tree builder ──

function buildTreeFromPaths(
  files: Array<{ path: string; content?: string }>,
  basePath: string,
): FileNode[] {
  const root: Record<string, FileNode> = {}

  for (const file of files) {
    // Make path relative to workspace
    let relPath = file.path
    if (basePath && relPath.startsWith(basePath)) {
      relPath = relPath.slice(basePath.length).replace(/^\//, '')
    }

    const parts = relPath.split('/').filter(Boolean)
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const fullPath = parts.slice(0, i + 1).join('/')

      if (!current[part]) {
        current[part] = {
          name: part,
          path: basePath ? `${basePath}/${fullPath}` : fullPath,
          type: isLast ? 'file' : 'dir',
          children: isLast ? undefined : [],
          extension: isLast ? part.split('.').pop() : undefined,
        }
      }

      if (!isLast) {
        if (!current[part].children) {
          current[part].children = []
          current[part].type = 'dir'
        }
        // Convert children array to a map for next iteration
        const childMap: Record<string, FileNode> = {}
        for (const child of current[part].children!) {
          childMap[child.name] = child
        }
        current = childMap

        // After processing, sync back to the array
        // (We'll rebuild at the end)
      }
    }
  }

  // Convert root map to sorted array
  return sortTree(Object.values(root))
}

function sortTree(nodes: FileNode[]): FileNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: node.children ? sortTree(node.children) : undefined,
    }))
    .sort((a, b) => {
      // Dirs first, then files
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}
