/**
 * HTTP API tool — structured HTTP client with JSON parsing.
 * Better than raw curl: proper JSON handling, auth headers, response extraction.
 */

export interface HttpApiInput {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: string
  extract?: string
}

/**
 * Simple JSONPath-like extraction.
 * Supports: $.key, $.key.nested, $.array[0], $.array[0].key
 */
function extractPath(obj: unknown, path: string): unknown {
  if (!path || path === '$') return obj

  const parts = path
    .replace(/^\$\.?/, '')
    .split(/\.|\[(\d+)\]/)
    .filter(Boolean)

  let current: unknown = obj
  for (const part of parts) {
    if (current == null) return undefined
    if (typeof current !== 'object') return undefined
    const idx = Number(part)
    if (!Number.isNaN(idx) && Array.isArray(current)) {
      current = current[idx]
    } else {
      current = (current as Record<string, unknown>)[part]
    }
  }
  return current
}

export async function executeHttpApi(input: HttpApiInput): Promise<string> {
  const { method, url, headers = {}, body, extract } = input

  // Validate URL
  try {
    new URL(url)
  } catch {
    return `Error: invalid URL "${url}".`
  }

  try {
    const fetchHeaders: Record<string, string> = { ...headers }
    if (body && !fetchHeaders['Content-Type']) {
      fetchHeaders['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: body || undefined,
      signal: AbortSignal.timeout(30_000),
    })

    const status = `${response.status} ${response.statusText}`
    const _contentType = response.headers.get('content-type') || ''
    const text = await response.text()

    // Try to parse as JSON
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Not JSON, return raw text
      if (text.length > 10_000) {
        return `${status}\n\n${text.slice(0, 10_000)}\n\n... (truncated, ${text.length} chars total)`
      }
      return `${status}\n\n${text}`
    }

    // Extract specific path if requested
    if (extract && parsed) {
      const extracted = extractPath(parsed, extract)
      return `${status}\n\n${JSON.stringify(extracted, null, 2)}`
    }

    // Format JSON
    const formatted = JSON.stringify(parsed, null, 2)
    if (formatted.length > 10_000) {
      return `${status}\n\n${formatted.slice(0, 10_000)}\n\n... (truncated)`
    }
    return `${status}\n\n${formatted}`
  } catch (err: unknown) {
    return `Error: ${(err as Error).message}`
  }
}
