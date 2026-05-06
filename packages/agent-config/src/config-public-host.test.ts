import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const TEMP_ROOT = mkdtempSync(join(tmpdir(), 'anton-public-host-test-'))
process.env.ANTON_DIR = TEMP_ROOT

const PUBLIC_HOST_ENV_KEYS = [
  'ANTON_PUBLIC_HOST',
  'ANTON_PUBLIC_URL',
  'ANTON_URL',
  'OAUTH_CALLBACK_BASE_URL',
  'ANTON_HOST',
] as const

const originalEnv = Object.fromEntries(PUBLIC_HOST_ENV_KEYS.map((key) => [key, process.env[key]]))

const { getPublicHost } = await import('./config.js')

afterEach(() => {
  for (const key of PUBLIC_HOST_ENV_KEYS) {
    const original = originalEnv[key]
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
})

afterAll(() => {
  try {
    rmSync(TEMP_ROOT, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('getPublicHost', () => {
  it('prefers the public Anton URL over a console/control-plane host', () => {
    process.env.ANTON_HOST = 'console.antoncomputer.in'
    process.env.ANTON_URL = 'https://itsomg.antoncomputer.in'

    expect(getPublicHost()).toBe('itsomg.antoncomputer.in')
  })

  it('falls back to the OAuth callback base URL before ANTON_HOST', () => {
    process.env.ANTON_HOST = 'console.antoncomputer.in'
    process.env.OAUTH_CALLBACK_BASE_URL = 'https://itsomg.antoncomputer.in/oauth/callback'

    expect(getPublicHost()).toBe('itsomg.antoncomputer.in')
  })

  it('keeps host ports from URL-shaped values', () => {
    process.env.ANTON_PUBLIC_URL = 'http://localhost:9876'

    expect(getPublicHost()).toBe('localhost:9876')
  })

  it('does not return the console host as a publish host', () => {
    process.env.ANTON_HOST = 'console.antoncomputer.in'

    expect(getPublicHost()).toBeUndefined()
  })
})
