import type { ChatMessage } from './store.js'

// ── Types ───────────────────────────────────────────────────────────

export type ArtifactRenderType = 'code' | 'markdown' | 'html' | 'svg' | 'mermaid'

export interface Artifact {
  id: string
  type: 'file' | 'output' | 'artifact'
  renderType: ArtifactRenderType
  title?: string
  filename?: string
  filepath?: string
  language: string
  content: string
  toolCallId: string
  timestamp: number
}

// ── Language detection ──────────────────────────────────────────────

const EXT_MAP: Record<string, string> = {
  md: 'markdown',
  mdx: 'markdown',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  env: 'text',
  txt: 'text',
  csv: 'text',
  svg: 'xml',
  vue: 'vue',
  svelte: 'svelte',
}

export function getLanguageFromPath(path: string): string {
  const filename = path.split('/').pop() || ''
  const lower = filename.toLowerCase()

  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'

  const ext = lower.split('.').pop() || ''
  return EXT_MAP[ext] || 'text'
}

/** Map language to render type for file writes */
function languageToRenderType(language: string): ArtifactRenderType {
  if (language === 'markdown') return 'markdown'
  if (language === 'html') return 'html'
  return 'code'
}

// ── Artifact extraction ─────────────────────────────────────────────

export function extractArtifact(
  toolCallMsg: ChatMessage,
  toolResultMsg: ChatMessage,
): Artifact | null {
  const toolName = toolCallMsg.toolName
  const toolInput = toolCallMsg.toolInput

  if (!toolName || !toolInput) return null

  // Explicit artifact tool calls
  if (toolName === 'artifact') {
    const artifactType = (toolInput.type as string) || 'code'
    const language =
      artifactType === 'code' ? (toolInput.language as string) || 'text' : artifactType

    return {
      id: `artifact_${toolCallMsg.id}_${Date.now()}`,
      type: 'artifact',
      renderType: artifactType as ArtifactRenderType,
      title: toolInput.title as string,
      filename: toolInput.filename as string | undefined,
      filepath: toolInput.filename as string | undefined,
      language,
      content: toolInput.content as string,
      toolCallId: toolCallMsg.id,
      timestamp: Date.now(),
    }
  }

  // File writes
  if (toolName === 'filesystem' && toolInput.operation === 'write' && toolInput.content) {
    const filepath = toolInput.path as string
    const filename = filepath?.split('/').pop() || 'untitled'
    const language = getLanguageFromPath(filepath || '')

    return {
      id: `artifact_${toolCallMsg.id}_${Date.now()}`,
      type: 'file',
      renderType: languageToRenderType(language),
      filename,
      filepath,
      language,
      content: toolInput.content as string,
      toolCallId: toolCallMsg.id,
      timestamp: Date.now(),
    }
  }

  // Large shell outputs
  if (toolName === 'shell' && toolResultMsg.content && toolResultMsg.content.length > 500) {
    const cmd = (toolInput.command as string) || 'output'
    const shortCmd = cmd.length > 40 ? `${cmd.slice(0, 37)}...` : cmd

    return {
      id: `artifact_${toolCallMsg.id}_${Date.now()}`,
      type: 'output',
      renderType: 'code',
      filename: shortCmd,
      language: 'text',
      content: toolResultMsg.content,
      toolCallId: toolCallMsg.id,
      timestamp: Date.now(),
    }
  }

  return null
}
