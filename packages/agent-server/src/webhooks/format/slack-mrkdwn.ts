/**
 * CommonMark → Slack mrkdwn converter.
 *
 * Slack has its own lightweight markup dialect ("mrkdwn") that overlaps
 * with CommonMark in confusing, partial ways. The model is instructed
 * via the surface prompt to emit mrkdwn directly, but models slip —
 * especially on `**bold**` and ATX headings — so we run every outbound
 * message through this defensive transform as belt-and-suspenders.
 *
 * Rules we handle (the only ones that bite in practice):
 *   - `**bold**` or `__bold__` → `*bold*`
 *   - `~~strike~~`            → `~strike~`
 *   - `[text](url)`           → `<url|text>`
 *   - `# h1` / `## h2` / `### h3` / etc. → `*h*` on its own line
 *
 * Things we intentionally leave alone:
 *   - Single `*x*` / `_x_`: already mrkdwn-compatible.
 *   - Inline code `` `x` `` and fenced code blocks ``` ```x``` ```:
 *     Slack renders these the same way.
 *   - Bulleted and numbered lists: Slack's mrkdwn handles them fine.
 *   - Raw URLs: Slack auto-linkifies.
 *
 * The transform is regex-based and deliberately small. A full Markdown
 * parser is tempting but would be a major dependency for what amounts
 * to ~5 substitutions, and the regex approach has handled every real
 * model output we've seen.
 *
 * Code block safety: we split on fenced (```…```) blocks first and
 * only transform the prose between them, so asterisks/underscores
 * inside code samples survive unmodified.
 */

export function toSlackMrkdwn(input: string): string {
  if (!input) return input
  // Split on fenced code blocks, keeping the fences themselves in the
  // array so we can rejoin without altering them. Even indices are
  // prose, odd indices are code-block bodies (including the fences).
  const segments = splitOnFences(input)
  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = transformProse(segments[i])
  }
  return segments.join('')
}

function splitOnFences(input: string): string[] {
  const out: string[] = []
  const re = /```[\s\S]*?```/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  m = re.exec(input)
  while (m !== null) {
    out.push(input.slice(lastIndex, m.index))
    out.push(m[0])
    lastIndex = m.index + m[0].length
    m = re.exec(input)
  }
  out.push(input.slice(lastIndex))
  return out
}

function transformProse(prose: string): string {
  let out = prose

  // ATX headings: `### Title` → `*Title*`. Do multi-line so we can
  // anchor to start-of-line. We rewrite the whole line including
  // trailing whitespace so downstream blank lines are preserved.
  out = out.replace(/^ {0,3}#{1,6} +(.+?)\s*#*\s*$/gm, '*$1*')

  // Bold: `**x**` or `__x__` → `*x*`. Non-greedy, must contain at
  // least one non-asterisk/underscore character so we don't eat empty
  // markers like `****`.
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
  out = out.replace(/__([^_\n]+?)__/g, '*$1*')

  // Strikethrough: `~~x~~` → `~x~`.
  out = out.replace(/~~([^~\n]+?)~~/g, '~$1~')

  // Links: `[text](url)` → `<url|text>`. The URL portion is extracted
  // with a balanced-paren scanner instead of a `[^)]+` regex so URLs
  // that legitimately contain `)` (Wikipedia titles, MDN, parenthetical
  // query params) survive intact. Also handles image links
  // `![alt](url)` — Slack won't render an inline image in a text
  // message anyway, so we collapse them to the same `<url|alt>` form.
  out = replaceMarkdownLinks(out)

  return out
}

/**
 * Replace every `[text](url)` (or `![alt](url)`) span in `input` with
 * Slack's `<url|text>` form. Walks the string once, with a small
 * paren-depth counter for the URL portion so a `)` inside the URL
 * doesn't terminate the match early.
 *
 * Validation rules — same as the previous regex, kept so we don't
 * mangle non-link bracket pairs like `[1](note)`:
 *   - The URL must start with `http://`, `https://`, or `/`.
 *   - The link text (`[…]`) cannot contain `]` or a newline.
 *   - The URL itself cannot contain whitespace.
 *
 * Anything that doesn't match those rules is emitted unchanged.
 */
function replaceMarkdownLinks(input: string): string {
  let out = ''
  let i = 0
  while (i < input.length) {
    // Find the next `[` (or `![`) — anything else just gets copied.
    const bracket = input.indexOf('[', i)
    if (bracket === -1) {
      out += input.slice(i)
      break
    }
    out += input.slice(i, bracket)

    // Parse `[text]`. Bail to the next char if the bracket pair is
    // malformed (no closing `]`, contains a newline, etc.).
    const textEnd = findLinkTextEnd(input, bracket + 1)
    if (textEnd === -1 || input[textEnd + 1] !== '(') {
      out += input[bracket]
      i = bracket + 1
      continue
    }
    const text = input.slice(bracket + 1, textEnd)

    // Parse `(url)` with balanced-paren tracking.
    const urlStart = textEnd + 2
    const urlEnd = findLinkUrlEnd(input, urlStart)
    if (urlEnd === -1) {
      out += input[bracket]
      i = bracket + 1
      continue
    }
    const url = input.slice(urlStart, urlEnd)
    if (!isLinkUrl(url)) {
      out += input[bracket]
      i = bracket + 1
      continue
    }

    // Drop the leading `!` from image links (`![alt](url)`) — Slack
    // can't inline-render images in chat messages either way, so the
    // collapsed link form is the most useful thing we can emit.
    if (out.endsWith('!')) out = out.slice(0, -1)
    out += `<${url}|${text}>`
    i = urlEnd + 1
  }
  return out
}

/**
 * Return the index of the closing `]` for a link starting at `start`,
 * or -1 if the text isn't a valid link label (contains `]`, contains a
 * newline, or runs to EOF). Mirrors the previous `[^\]\n]+?` regex.
 */
function findLinkTextEnd(input: string, start: number): number {
  for (let i = start; i < input.length; i++) {
    const ch = input[i]
    if (ch === ']') return i
    if (ch === '\n') return -1
  }
  return -1
}

/**
 * Return the index of the closing `)` for a URL starting at `start`,
 * tracking paren depth so URLs containing balanced `()` survive. Returns
 * -1 if the URL contains whitespace, a newline, or never closes — those
 * are not valid link URLs and the caller emits the source unchanged.
 */
function findLinkUrlEnd(input: string, start: number): number {
  let depth = 0
  for (let i = start; i < input.length; i++) {
    const ch = input[i]
    if (ch === ' ' || ch === '\t' || ch === '\n') return -1
    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')') {
      if (depth === 0) return i
      depth -= 1
    }
  }
  return -1
}

/** Validates that the URL looks like one we should rewrite. */
function isLinkUrl(url: string): boolean {
  if (url.length === 0) return false
  if (url.startsWith('http://') || url.startsWith('https://')) return true
  if (url.startsWith('/')) return true
  return false
}
