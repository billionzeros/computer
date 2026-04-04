/**
 * Shared security utilities for tools.
 *
 * - SSRF protection (block private/internal IPs)
 * - Forbidden path enforcement
 * - Dangerous operation detection
 */

import { resolve } from 'node:path'

// ── SSRF protection ──────────────────────────────────────────────────

/**
 * Private/internal IP ranges that should be blocked for outbound requests.
 * Prevents SSRF attacks where the agent could probe internal infrastructure.
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local
  /^0\./, // Current network
  /^fc/i, // IPv6 unique local
  /^fd/i, // IPv6 unique local
  /^fe80/i, // IPv6 link-local
  /^::1$/, // IPv6 loopback
  /^::$/, // IPv6 unspecified
]

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  '0.0.0.0',
  '[::1]',
  '[::0]',
])

/**
 * Check if a hostname or IP resolves to a private/internal address.
 * Used to prevent SSRF in http_api and network tools.
 */
export function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()

  // Direct hostname match
  if (PRIVATE_HOSTNAMES.has(lower)) return true

  // IP pattern match
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(lower)) return true
  }

  // Cloud metadata endpoints
  if (lower === '169.254.169.254') return true
  if (lower.endsWith('.internal')) return true

  return false
}

// ── Forbidden path enforcement ───────────────────────────────────────

/**
 * Default forbidden paths — always blocked regardless of config.
 * These protect system-critical and credential files.
 */
const ALWAYS_FORBIDDEN = ['/etc/shadow', '/etc/passwd', '/etc/sudoers', '/etc/ssh/sshd_config']

/** Sensitive path patterns that are blocked by default. */
const SENSITIVE_PATTERNS = [
  /\/\.ssh\/(?:id_|authorized_keys|known_hosts|config)/, // SSH keys and config
  /\/\.gnupg\//, // GPG keys
  /\/\.aws\/credentials/, // AWS credentials
  /\/\.config\/gcloud/, // GCP credentials
  /\/\.kube\/config/, // Kubernetes config
  /\/\.docker\/config\.json/, // Docker auth
  /\/\.netrc/, // FTP/HTTP credentials
  /\/\.npmrc/, // npm auth tokens
  /\/\.pypirc/, // PyPI auth tokens
]

/**
 * Check if a file path is forbidden (sensitive system/credential files).
 *
 * @param filePath  — path the agent wants to access
 * @param forbiddenPaths — additional patterns from config.security.forbiddenPaths
 * @returns reason string if forbidden, null if allowed
 */
export function checkForbiddenPath(filePath: string, forbiddenPaths: string[] = []): string | null {
  const resolved = resolve(filePath)

  // Always-forbidden system files
  for (const forbidden of ALWAYS_FORBIDDEN) {
    if (resolved === forbidden || resolved.startsWith(`${forbidden}/`)) {
      return `Access to ${forbidden} is blocked for security`
    }
  }

  // Sensitive credential patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(resolved)) {
      return `Access to credential/key files is blocked for security: ${resolved}`
    }
  }

  // User-configured forbidden paths (from config.security.forbiddenPaths)
  for (const forbidden of forbiddenPaths) {
    const resolvedForbidden = resolve(forbidden)
    if (resolved === resolvedForbidden || resolved.startsWith(`${resolvedForbidden}/`)) {
      return `Access to ${forbidden} is blocked by security configuration`
    }
  }

  return null
}

// ── Dangerous operation detection ────────────────────────────────────

/**
 * Patterns that indicate dangerous database operations requiring confirmation.
 */
const DANGEROUS_SQL_PATTERNS = [
  /\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\b.*\bDROP\b/i,
]

/**
 * Check if a SQL statement is destructive and should require confirmation.
 */
export function isDangerousSql(sql: string): boolean {
  return DANGEROUS_SQL_PATTERNS.some((p) => p.test(sql))
}

/**
 * Patterns that indicate dangerous filesystem operations requiring confirmation.
 */
const DANGEROUS_FS_PATTERNS = [
  /^\/$/, // Root directory
  /^\/etc\/?$/, // System config
  /^\/usr\/?$/, // System binaries
  /^\/boot\/?$/, // Boot partition
  /^\/var\/?$/, // System variable data
]

/**
 * Check if a filesystem write target is in a dangerous location.
 */
export function isDangerousFsWrite(path: string): boolean {
  const resolved = resolve(path)
  return DANGEROUS_FS_PATTERNS.some((p) => p.test(resolved))
}
