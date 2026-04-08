/**
 * CommonMark → Telegram legacy-Markdown converter.
 *
 * Telegram has three parse modes:
 *   - `Markdown`   (legacy, forgiving, no heading support)
 *   - `MarkdownV2` (strict, requires escaping `_*[]()~\`>#+-=|{}.!`)
 *   - `HTML`
 *
 * We target legacy `Markdown`. It's what the existing reply path uses
 * and it doesn't require character-level escaping, which makes this
 * transform much safer: if it misses a case, the worst that happens
 * is the text renders literally, not a 400 "bad request" from the API.
 *
 * Rules we handle:
 *   - `**bold**` or `__bold__` → `*bold*`   (legacy uses single-char)
 *   - `# h` / `## h` / `### h` → `*h*`      (no heading support)
 *   - `~~strike~~`            → `strike`   (legacy has no strike)
 *
 * Things we intentionally leave alone:
 *   - Single `*x*` / `_x_`: already legacy-compatible.
 *   - Inline code `` `x` `` and fenced code blocks: supported as-is.
 *   - `[text](url)`: supported as-is.
 *
 * As with the Slack transform, we protect fenced code blocks by
 * splitting on them first. A full parser would be overkill for a
 * handful of substitutions on outbound text.
 */

export function toTelegramMd(input: string): string {
  if (!input) return input
  const segments = splitOnCodeBlocks(input)
  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = transformProse(segments[i])
  }
  return segments.join('')
}

/**
 * Split on fenced code blocks AND inline code spans so that asterisks
 * and underscores inside code survive the prose transforms unmodified.
 */
function splitOnCodeBlocks(input: string): string[] {
  const out: string[] = []
  const re = /```[\s\S]*?```|`[^`\n]+`/g
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

  // ATX headings → single-line `*Title*`. Strip the leading `#`s and
  // any trailing `#`s some generators emit.
  out = out.replace(/^ {0,3}#{1,6} +(.+?)\s*#*\s*$/gm, '*$1*')

  // Bold: `**x**` / `__x__` → `*x*`. Telegram legacy Markdown treats
  // `*x*` as bold (not italic) and `_x_` as italic; collapsing both
  // double-forms onto `*` is the safe choice because emphasis > no-op.
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
  out = out.replace(/__([^_\n]+?)__/g, '*$1*')

  // Strikethrough: legacy Markdown has no strike — drop the markers
  // so the text still reads naturally instead of showing `~~raw~~`.
  out = out.replace(/~~([^~\n]+?)~~/g, '$1')

  // Escape bare `*` followed by `/` — common in cron expressions and
  // glob patterns (e.g. `*/10 * * * *`). Without escaping, Telegram
  // interprets the first `*` as a bold opener and mangles the text.
  out = out.replace(/\*(?=\/)/g, '\\*')

  return out
}
