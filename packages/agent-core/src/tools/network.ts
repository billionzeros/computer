/**
 * Network tool — network operations with security hardening.
 *
 * Security:
 * - curl replaced with native fetch (no shell injection)
 * - DNS/ping use execFile with argument arrays (no shell interpolation)
 * - SSRF protection blocks requests to private/internal IPs
 */

import { execFile, execSync } from 'node:child_process'
import { isPrivateHost } from './security.js'

export interface NetworkToolInput {
  operation: 'ports' | 'curl' | 'dns' | 'ping'
  url?: string
  host?: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export const networkToolDefinition = {
  name: 'network',
  description:
    'Network operations: scan listening ports, make HTTP requests, DNS lookups, ping hosts. ' +
    "Use 'ports' to see what's running on this server, 'curl' for HTTP requests, " +
    "'dns' for domain lookups, 'ping' to check connectivity.",
  parameters: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['ports', 'curl', 'dns', 'ping'],
      },
      url: {
        type: 'string',
        description: 'URL for curl operation',
      },
      host: {
        type: 'string',
        description: 'Hostname for dns/ping operations',
      },
      method: {
        type: 'string',
        description: 'HTTP method for curl (default: GET)',
      },
      headers: {
        type: 'object',
        description: 'HTTP headers for curl',
      },
      body: {
        type: 'string',
        description: 'Request body for curl POST/PUT',
      },
    },
    required: ['operation'],
  },
}

/**
 * Validate a hostname — only allow safe characters, no shell metacharacters.
 */
function validateHostname(host: string): boolean {
  // Allow domains, IPs, and IPv6 in brackets
  return /^[a-zA-Z0-9._:[\]-]+$/.test(host) && host.length < 256
}

export async function executeNetwork(input: NetworkToolInput): Promise<string> {
  const { operation, url, host, method = 'GET', headers, body } = input

  try {
    switch (operation) {
      case 'ports': {
        try {
          return execSync('ss -tlnp 2>/dev/null || lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null', {
            encoding: 'utf-8',
            timeout: 5_000,
          })
        } catch {
          return 'Could not scan ports (ss and lsof not available)'
        }
      }

      case 'curl': {
        if (!url) return 'Error: url is required for curl operation'

        // Validate URL
        let parsedUrl: URL
        try {
          parsedUrl = new URL(url)
        } catch {
          return `Error: invalid URL "${url}"`
        }

        // SSRF protection: block private/internal IPs
        if (isPrivateHost(parsedUrl.hostname)) {
          return `Error: requests to private/internal addresses are blocked for security (${parsedUrl.hostname})`
        }

        // Use native fetch instead of shelling out to curl
        const fetchHeaders: Record<string, string> = { ...headers }
        const response = await fetch(url, {
          method,
          headers: fetchHeaders,
          body: body || undefined,
          signal: AbortSignal.timeout(15_000),
        })

        const status = `${response.status} ${response.statusText}`
        const text = await response.text()

        if (text.length > 50_000) {
          return `${status}\n\n${text.slice(0, 50_000)}\n\n... (truncated)`
        }
        return `${status}\n\n${text}` || `${status}\n\n(empty response)`
      }

      case 'dns': {
        if (!host) return 'Error: host is required for dns operation'
        if (!validateHostname(host)) return `Error: invalid hostname "${host}"`

        // Use execFile with argument array — no shell interpolation
        return await new Promise<string>((resolve) => {
          execFile('dig', ['+short', host], { timeout: 10_000 }, (err, stdout, stderr) => {
            if (err) {
              // Fallback to nslookup
              execFile('nslookup', [host], { timeout: 10_000 }, (err2, stdout2) => {
                if (err2) resolve(`Error: DNS lookup failed for "${host}"`)
                else resolve(stdout2)
              })
            } else {
              resolve(stdout || stderr || `No DNS records for "${host}"`)
            }
          })
        })
      }

      case 'ping': {
        if (!host) return 'Error: host is required for ping operation'
        if (!validateHostname(host)) return `Error: invalid hostname "${host}"`

        // Use execFile with argument array — no shell interpolation
        return await new Promise<string>((resolve) => {
          execFile('ping', ['-c', '3', host], { timeout: 15_000 }, (err, stdout) => {
            if (err) resolve(`Ping failed: ${(err as Error).message}`)
            else resolve(stdout)
          })
        })
      }

      default:
        return `Unknown operation: ${operation}`
    }
  } catch (err: unknown) {
    return `Error: ${(err as Error).message}`
  }
}
