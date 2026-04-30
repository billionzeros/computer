import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// Pin ANTON_DIR to a freshly-created temp dir BEFORE importing config.ts —
// the module reads the env var once at load time. afterAll wipes the dir.
const TEMP_ROOT = mkdtempSync(join(tmpdir(), 'anton-test-'))
process.env.ANTON_DIR = TEMP_ROOT

const { loadSession, resolveSessionImagePath, saveSession } = await import('./config.js')
type ConfigModule = typeof import('./config.js')
type PersistedSession = Parameters<ConfigModule['saveSession']>[0]

afterAll(() => {
  try {
    rmSync(TEMP_ROOT, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('resolveSessionImagePath', () => {
  it('rejects empty / non-string / null-byte input', () => {
    expect(resolveSessionImagePath('s', '')).toBeNull()
    expect(resolveSessionImagePath('s', '\0images/foo.png')).toBeNull()
    expect(resolveSessionImagePath('s', 'images/foo\0.png')).toBeNull()
  })

  it('rejects paths that do not start with images/', () => {
    expect(resolveSessionImagePath('s', 'meta.json')).toBeNull()
    expect(resolveSessionImagePath('s', '../etc/passwd')).toBeNull()
    expect(resolveSessionImagePath('s', '/etc/passwd')).toBeNull()
  })

  it('rejects traversal attempts that escape the images dir', () => {
    expect(resolveSessionImagePath('s', 'images/../../etc/passwd')).toBeNull()
    expect(resolveSessionImagePath('s', 'images/../../../root/.ssh/id_rsa')).toBeNull()
    expect(resolveSessionImagePath('s', 'images/../meta.json')).toBeNull()
  })

  it('accepts well-formed image paths', () => {
    const ok = resolveSessionImagePath('sess-1', 'images/0001-01-image.png')
    expect(ok).not.toBeNull()
    expect(ok).toContain('sess-1')
    expect(ok).toContain('images')
  })

  it('normalizes backslashes from windows-style input', () => {
    const ok = resolveSessionImagePath('sess-2', 'images\\nested\\foo.png')
    expect(ok).not.toBeNull()
  })

  it('rejects malformed sessionIds', () => {
    // Empty / dot-segments / path-separator-bearing IDs would let a
    // crafted request escape the per-session sandbox.
    expect(resolveSessionImagePath('', 'images/foo.png')).toBeNull()
    expect(resolveSessionImagePath('.', 'images/foo.png')).toBeNull()
    expect(resolveSessionImagePath('..', 'images/foo.png')).toBeNull()
    expect(resolveSessionImagePath('a/b', 'images/foo.png')).toBeNull()
    expect(resolveSessionImagePath('a\\b', 'images/foo.png')).toBeNull()
    expect(resolveSessionImagePath('a\0b', 'images/foo.png')).toBeNull()
  })
})

// 1×1 transparent PNG
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBQECzr1vQwAAAABJRU5ErkJggg==',
  'base64',
)

function makeUserMessage() {
  return {
    role: 'user',
    content: [
      { type: 'text', text: 'see this' },
      {
        type: 'image',
        mimeType: 'image/png',
        data: PNG_BYTES.toString('base64'),
        name: 'pixel.png',
        sizeBytes: PNG_BYTES.byteLength,
      },
    ],
    timestamp: 1,
  }
}

function persistedSession(id: string): PersistedSession {
  return {
    id,
    provider: 'anthropic',
    model: 'claude-opus-4',
    title: 'test',
    createdAt: 1,
    lastActiveAt: 2,
    messages: [makeUserMessage()],
  } satisfies PersistedSession
}

type ImageBlock = {
  type: 'image'
  mimeType?: string
  data?: string
  storagePath?: string
  name?: string
  sizeBytes?: number
}

function findImageBlock(loaded: ReturnType<typeof loadSession>): ImageBlock {
  expect(loaded).not.toBeNull()
  const userMsg = loaded?.messages[0] as { role: string; content: ImageBlock[] }
  expect(userMsg.role).toBe('user')
  const imgBlock = userMsg.content.find((b) => b.type === 'image')
  expect(imgBlock).toBeDefined()
  return imgBlock as ImageBlock
}

describe('saveSession + loadSession round-trip with image attachments', () => {
  it('global session: persists image bytes to disk and rehydrates data on load', () => {
    const id = 'sess-global'
    saveSession(persistedSession(id))

    const imgBlock = findImageBlock(loadSession(id))
    expect(imgBlock.data).toBe(PNG_BYTES.toString('base64'))
    expect(imgBlock.storagePath).toMatch(/^images\//)
    expect(imgBlock.mimeType).toBe('image/png')
  })

  it('project (basePath) session: rehydrates image data via hydrateSessionMessage, not hydrateSessionContent', () => {
    // Regression: the project-scoped loader previously called
    // hydrateSessionContent on a whole message object instead of
    // hydrateSessionMessage. hydrateSessionContent expects content (an
    // array) and returned undefined for objects, so messages reached
    // consumers with only storagePath and no `data` after a reload —
    // chips disappeared from "My Computer" sessions despite the bytes
    // being safely on disk.
    const id = 'sess-project'
    const projectDir = join(TEMP_ROOT, 'projects/proj-1/conversations')
    mkdirSync(projectDir, { recursive: true })
    saveSession(persistedSession(id), projectDir)

    const imgBlock = findImageBlock(loadSession(id, projectDir))
    expect(imgBlock.data).toBe(PNG_BYTES.toString('base64'))
  })

  it('gracefully degrades when the image file on disk is missing', () => {
    const id = 'sess-missing-file'
    saveSession(persistedSession(id))

    rmSync(join(TEMP_ROOT, 'conversations', id, 'images'), { recursive: true, force: true })

    const imgBlock = findImageBlock(loadSession(id))
    expect(imgBlock.storagePath).toMatch(/^images\//)
    expect(imgBlock.data).toBeUndefined()
  })

  it('writes images atomically (no .tmp residue on success)', () => {
    const id = 'sess-atomic'
    saveSession(persistedSession(id))

    const imagesDir = join(TEMP_ROOT, 'conversations', id, 'images')
    const entries = readdirSync(imagesDir)
    const pngs = entries.filter((f) => f.endsWith('.png'))
    expect(pngs).toHaveLength(1)
    const written = readFileSync(join(imagesDir, pngs[0]))
    expect(written.byteLength).toBe(PNG_BYTES.byteLength)
    expect(entries.some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})
