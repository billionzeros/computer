/**
 * Encrypted credential storage for all connector secrets.
 *
 * Stores OAuth tokens AND API keys/secrets in the same encrypted format.
 * Credentials are encrypted with AES-256-GCM, key derived from the agent's
 * auth token via HKDF. Stored in ~/.anton/tokens/{provider}.enc
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { createLogger } from '@anton/logger'

const log = createLogger('credential-store')
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export interface StoredCredentials {
  provider: string
  // OAuth fields (backward compat with existing .enc files)
  accessToken?: string
  refreshToken?: string
  expiresAt?: number // unix timestamp (seconds)
  oauthProvider?: string // the proxy provider key (e.g. 'google') when different from provider
  metadata?: Record<string, string>
  // All connector secrets — API keys, wallet addresses, bot tokens, etc.
  secrets?: Record<string, string>
}

export class CredentialStore {
  private dir: string
  private encryptionKey: Buffer

  constructor(antonDir: string, agentToken: string) {
    this.dir = join(antonDir, 'tokens')
    mkdirSync(this.dir, { recursive: true })
    // Derive a 256-bit encryption key from the agent token
    this.encryptionKey = Buffer.from(
      hkdfSync('sha256', agentToken, 'anton-token-store', 'aes-256-gcm-key', 32),
    )
  }

  save(provider: string, token: StoredCredentials): void {
    const plaintext = JSON.stringify(token)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    // Format: iv (12 bytes) + auth tag (16 bytes) + ciphertext
    const blob = Buffer.concat([iv, tag, encrypted])
    writeFileSync(join(this.dir, `${provider}.enc`), blob, { mode: 0o600 })
  }

  load(provider: string): StoredCredentials | null {
    const path = join(this.dir, `${provider}.enc`)
    if (!existsSync(path)) return null
    try {
      const blob = readFileSync(path)
      const iv = blob.subarray(0, 12)
      const tag = blob.subarray(12, 28)
      const ciphertext = blob.subarray(28)
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv)
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      )
      return JSON.parse(plaintext)
    } catch (err) {
      log.error({ provider, err }, 'failed to decrypt credentials')
      throw new Error(
        `Credentials for ${provider} exist but could not be decrypted; please reconnect the connector`,
      )
    }
  }

  /** Check if credentials exist for a provider (file existence, no decryption). */
  has(provider: string): boolean {
    return existsSync(join(this.dir, `${provider}.enc`))
  }

  delete(provider: string): void {
    const path = join(this.dir, `${provider}.enc`)
    if (existsSync(path)) unlinkSync(path)
  }

  list(): string[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.enc'))
      .map((f) => f.replace('.enc', ''))
  }
}
