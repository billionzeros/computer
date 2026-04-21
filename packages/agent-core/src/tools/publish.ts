/**
 * Publish tool — converts artifacts to self-contained HTML documents
 * and writes them to the published directory for public access.
 *
 * All rendering happens server-side at publish time:
 *   html     → pass through (ensure doctype wrapper)
 *   markdown → server-side rendered via marked
 *   svg      → inline SVG in HTML with viewport
 *   mermaid  → mermaid CDN (needs DOM, no server-side option)
 *   code     → styled <pre><code> with monospace theme
 */

import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPublishedDir } from '@anton/agent-config'
import { marked } from 'marked'

export interface PublishInput {
  title: string
  content: string
  type: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
  language?: string
  slug?: string
}

const VALID_SLUG = /^[a-zA-Z0-9_-]+$/

function generateSlug(): string {
  return randomBytes(4).toString('hex') // 8 hex chars
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Shared template ─────────────────────────────────────────────

const BASE_STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0a0a;--bg-surface:#141414;--bg-elevated:#1a1a1a;
  --text:#e5e5e5;--text-muted:#999;--text-dim:#666;
  --accent:#60a5fa;--border:#262626;
  --font-sans:system-ui,-apple-system,'Segoe UI',sans-serif;
  --font-mono:'SF Mono',Monaco,'Cascadia Code','Fira Code',monospace;
}
html{font-size:16px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{background:var(--bg);color:var(--text);font-family:var(--font-sans);line-height:1.7}
`

const FOOTER_HTML = `<footer style="margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border);display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
Published with <a href="https://antoncomputer.in" style="color:var(--text-muted);text-decoration:none;border-bottom:1px solid var(--border)">Anton</a>
</footer>`

function buildPage(
  title: string,
  body: string,
  extra: {
    styles?: string
    scripts?: string
    description?: string
    domain?: string
    slug?: string
  } = {},
): string {
  const desc = extra.description || `${title} — published with Anton`
  const pageUrl = extra.domain && extra.slug ? `https://${extra.domain}/a/${extra.slug}` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:type" content="article">
${pageUrl ? `<meta property="og:url" content="${escapeHtml(pageUrl)}">` : ''}
${pageUrl ? `<meta property="og:image" content="${escapeHtml(pageUrl)}/og.svg">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
${pageUrl ? `<meta name="twitter:image" content="${escapeHtml(pageUrl)}/og.svg">` : ''}
<style>${BASE_STYLES}${extra.styles || ''}</style>
</head>
<body>
${body}
${extra.scripts || ''}
${extra.slug ? `<script>fetch('/_anton/views/${extra.slug}',{method:'POST',keepalive:true}).catch(function(){})<\/script>` : ''}
</body>
</html>`
}

// ── OG image generation ─────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  html: '#60a5fa',
  markdown: '#a78bfa',
  svg: '#34d399',
  mermaid: '#f472b6',
  code: '#fbbf24',
}

function generateOgSvg(title: string, type: string, domain?: string): string {
  const truncated = title.length > 60 ? `${title.slice(0, 57)}...` : title
  const color = TYPE_COLORS[type] || '#60a5fa'
  const brandText = domain || 'Anton'
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<rect width="1200" height="630" fill="#0a0a0a"/>
<rect x="60" y="480" width="${type.length * 14 + 32}" height="36" rx="18" fill="${color}" opacity="0.15"/>
<text x="${60 + (type.length * 14 + 32) / 2}" y="504" text-anchor="middle" fill="${color}" font-family="system-ui,sans-serif" font-size="16" font-weight="600">${escapeHtml(type.toUpperCase())}</text>
<text x="60" y="300" fill="#e5e5e5" font-family="system-ui,sans-serif" font-size="48" font-weight="700" letter-spacing="-1">${escapeHtml(truncated)}</text>
<text x="60" y="580" fill="#666" font-family="system-ui,sans-serif" font-size="18">${escapeHtml(brandText)}</text>
</svg>`
}

// ── Content-type renderers ──────────────────────────────────────

function renderMarkdown(input: PublishInput, domain?: string, slug?: string): string {
  const html = marked.parse(input.content, { async: false, gfm: true, breaks: false }) as string

  const styles = `
.page{max-width:720px;margin:0 auto;padding:2.5rem 1.5rem}
.page h1{font-size:1.75rem;font-weight:600;margin:2rem 0 0.75rem;color:#f5f5f5;letter-spacing:-0.02em}
.page h2{font-size:1.35rem;font-weight:600;margin:1.75rem 0 0.5rem;color:#f5f5f5;letter-spacing:-0.01em}
.page h3{font-size:1.1rem;font-weight:600;margin:1.5rem 0 0.5rem;color:#e5e5e5}
.page p{margin:0.75rem 0;color:var(--text)}
.page a{color:var(--accent);text-decoration:none;border-bottom:1px solid transparent}
.page a:hover{border-bottom-color:var(--accent)}
.page strong{color:#f5f5f5;font-weight:600}
.page img{max-width:100%;border-radius:8px;margin:1rem 0}
.page ul,.page ol{margin:0.75rem 0;padding-left:1.5rem;color:var(--text)}
.page li{margin:0.25rem 0}
.page li::marker{color:var(--text-dim)}
.page blockquote{margin:1rem 0;padding:0.75rem 1rem;border-left:3px solid var(--border);color:var(--text-muted);background:var(--bg-surface);border-radius:0 6px 6px 0}
.page pre{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:1rem;overflow-x:auto;margin:1rem 0;font-size:0.875rem;line-height:1.6}
.page code{font-family:var(--font-mono);font-size:0.9em}
.page :not(pre)>code{background:var(--bg-elevated);padding:2px 6px;border-radius:4px;font-size:0.85em;color:#e5a0e0}
.page table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:0.9rem}
.page th{text-align:left;padding:0.5rem 0.75rem;border-bottom:2px solid var(--border);color:var(--text-muted);font-weight:500;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em}
.page td{padding:0.5rem 0.75rem;border-bottom:1px solid var(--border)}
.page hr{border:none;border-top:1px solid var(--border);margin:2rem 0}
`

  return buildPage(input.title, `<article class="page">${html}\n${FOOTER_HTML}</article>`, {
    styles,
    domain,
    slug,
    description: input.content
      .slice(0, 200)
      .replace(/[#*_\n]/g, ' ')
      .trim(),
  })
}

function injectIntoFullHtml(
  html: string,
  title: string,
  extra: { domain?: string; slug?: string },
): string {
  const desc = `${title} — published with Anton`
  const pageUrl = extra.domain && extra.slug ? `https://${extra.domain}/a/${extra.slug}` : ''

  const ogTags = [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:type" content="article">`,
    pageUrl ? `<meta property="og:url" content="${escapeHtml(pageUrl)}">` : '',
    pageUrl ? `<meta property="og:image" content="${escapeHtml(pageUrl)}/og.svg">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}">`,
    pageUrl ? `<meta name="twitter:image" content="${escapeHtml(pageUrl)}/og.svg">` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const viewScript = extra.slug
    ? `<script>fetch('/_anton/views/${extra.slug}',{method:'POST',keepalive:true}).catch(function(){})<\/script>`
    : ''

  let result = html
  // Strip any previously injected OG/Twitter meta and view script to avoid duplicates on re-publish
  result = result.replace(/<meta property="og:[^"]*"[^>]*>\n?/g, '')
  result = result.replace(/<meta name="twitter:[^"]*"[^>]*>\n?/g, '')
  result = result.replace(/<script>fetch\('\/\_anton\/views\/[^']*'[^<]*<\/script>\n?/g, '')

  if (result.includes('</head>')) {
    result = result.replace('</head>', `${ogTags}\n</head>`)
  }
  if (viewScript && result.includes('</body>')) {
    result = result.replace('</body>', `${viewScript}\n</body>`)
  }
  return result
}

function renderHtml(input: PublishInput, domain?: string, slug?: string): string {
  // Full HTML documents: inject OG meta and view tracking, keep everything else
  if (input.content.includes('<!DOCTYPE') || input.content.includes('<html')) {
    return injectIntoFullHtml(input.content, input.title, { domain, slug })
  }

  const styles = `
body{font-family:var(--font-sans)}
.page{max-width:960px;margin:0 auto;padding:2rem 1.5rem}
`

  return buildPage(input.title, `<div class="page">${input.content}\n${FOOTER_HTML}</div>`, {
    styles,
    domain,
    slug,
  })
}

function renderCode(input: PublishInput, domain?: string, slug?: string): string {
  const lang = input.language || 'text'

  const styles = `
.page{max-width:960px;margin:0 auto;padding:2rem 1.5rem}
.code-header{display:flex;align-items:center;justify-content:space-between;padding:0.625rem 1rem;background:var(--bg-elevated);border:1px solid var(--border);border-bottom:none;border-radius:8px 8px 0 0;font-size:0.8rem;color:var(--text-dim)}
.code-lang{font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.05em}
.code-copy{background:none;border:1px solid var(--border);color:var(--text-muted);padding:3px 10px;border-radius:4px;cursor:pointer;font-size:0.75rem;font-family:var(--font-sans)}
.code-copy:hover{background:var(--bg-surface);color:var(--text)}
pre{background:var(--bg-surface);border:1px solid var(--border);border-radius:0 0 8px 8px;padding:1.25rem;overflow-x:auto;margin:0;font-size:0.875rem;line-height:1.6}
code{font-family:var(--font-mono);color:var(--text)}
`

  const scripts = `<script>
document.querySelector('.code-copy')?.addEventListener('click',function(){
  navigator.clipboard.writeText(document.querySelector('code').textContent);
  this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)
})
<\/script>`

  const body = `<div class="page">
<div class="code-header"><span class="code-lang">${escapeHtml(lang)}</span><button class="code-copy">Copy</button></div>
<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(input.content)}</code></pre>
${FOOTER_HTML}
</div>`

  return buildPage(input.title, body, { styles, scripts, domain, slug })
}

function renderSvg(input: PublishInput, domain?: string, slug?: string): string {
  const styles = `
.page{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem}
svg{max-width:100%;height:auto}
`
  return buildPage(input.title, `<div class="page">${input.content}\n${FOOTER_HTML}</div>`, {
    styles,
    domain,
    slug,
  })
}

function renderMermaid(input: PublishInput, domain?: string, slug?: string): string {
  const styles = `
.page{max-width:960px;margin:0 auto;padding:2rem 1.5rem;display:flex;flex-direction:column;align-items:center}
.mermaid{margin:2rem 0}
`
  const scripts = `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
<script>mermaid.initialize({startOnLoad:true,theme:'dark'})<\/script>`

  return buildPage(
    input.title,
    `<div class="page"><pre class="mermaid">${escapeHtml(input.content)}</pre>\n${FOOTER_HTML}</div>`,
    { styles, scripts, domain, slug },
  )
}

// ── Dispatcher ──────────────────────────────────────────────────

function convertToHtml(input: PublishInput, domain?: string, slug?: string): string {
  switch (input.type) {
    case 'markdown':
      return renderMarkdown(input, domain, slug)
    case 'html':
      return renderHtml(input, domain, slug)
    case 'code':
      return renderCode(input, domain, slug)
    case 'svg':
      return renderSvg(input, domain, slug)
    case 'mermaid':
      return renderMermaid(input, domain, slug)
    default:
      return renderMarkdown({ ...input, type: 'markdown' }, domain, slug)
  }
}

// ── Public API ──────────────────────────────────────────────────

export function executePublish(input: PublishInput, domain?: string): string {
  const slug = input.slug || generateSlug()
  if (!VALID_SLUG.test(slug)) {
    throw new Error('Invalid slug: must match [a-zA-Z0-9_-]+')
  }
  const html = convertToHtml(input, domain, slug)

  const publishedDir = getPublishedDir()
  const artifactDir = join(publishedDir, slug)
  mkdirSync(artifactDir, { recursive: true, mode: 0o755 })
  const filePath = join(artifactDir, 'index.html')
  writeFileSync(filePath, html, 'utf-8')
  chmodSync(filePath, 0o644)

  // Generate OG image
  const ogSvg = generateOgSvg(input.title, input.type, domain)
  const ogPath = join(artifactDir, 'og.svg')
  writeFileSync(ogPath, ogSvg, 'utf-8')
  chmodSync(ogPath, 0o644)

  const url = domain ? `https://${domain}/a/${slug}` : `/a/${slug}`
  return `Published "${input.title}" → ${url}`
}

// ── Tool factory ────────────────────────────────────────────────────

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@sinclair/typebox'
import type { AskUserHandler } from '../agent.js'
import { defineTool, toolResult } from './_helpers.js'

export interface PublishToolDeps {
  /** Public base domain Anton publishes under (from config). Used in the URL. */
  domain?: string
  /**
   * When wired, publishing goes through a `publish_confirm` ask_user
   * prompt first. The desktop renders a specialized card showing title,
   * type, domain, and an editable slug; the user either confirms
   * (submitting the final slug) or cancels. Empty answer = cancel.
   * Routine-factory follows the same pattern for create/delete.
   */
  askUser?: AskUserHandler
}

/**
 * Build the `publish` tool definition. Shared between the Pi SDK agent
 * and the harness MCP shim — do not duplicate this schema elsewhere.
 *
 * When an `askUser` handler is present, the model's call is gated: we
 * surface a publish_confirm prompt and only run `executePublish` after
 * the user approves + picks a slug. When it isn't, we publish directly
 * (non-desktop contexts like evals — no human in the loop to prompt).
 */
export function buildPublishTool(deps: PublishToolDeps = {}): AgentTool {
  const { domain, askUser } = deps
  return defineTool({
    name: 'publish',
    label: 'Publish',
    description:
      'Publish content to a public URL accessible from the internet. ' +
      'Converts markdown, HTML, SVG, mermaid diagrams, or code into a standalone web page. ' +
      'Returns the public URL. Use after creating an artifact when the user wants to share it publicly. ' +
      'IMPORTANT: The user will be asked to confirm + pick a final slug before this tool actually publishes — ' +
      "do not pre-ask via ask_user; just call publish with your suggested slug and let this tool's gate handle it.",
    parameters: Type.Object({
      title: Type.String({ description: 'Page title' }),
      content: Type.String({ description: 'The content to publish' }),
      type: Type.Union(
        [
          Type.Literal('html'),
          Type.Literal('markdown'),
          Type.Literal('svg'),
          Type.Literal('mermaid'),
          Type.Literal('code'),
        ],
        { description: 'Content type: html, markdown, svg, mermaid, or code' },
      ),
      language: Type.Optional(
        Type.String({ description: 'Language for code syntax (e.g. "typescript")' }),
      ),
      slug: Type.Optional(
        Type.String({
          description:
            'Suggested URL slug (the user can edit or replace before publishing; auto-generated if omitted).',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      // When there's no human in the loop (evals, scripts), fall back to
      // publishing directly — matches pre-gate behavior.
      if (!askUser) {
        return toolResult(executePublish(params, domain))
      }

      const suggestedSlug = params.slug || generateSlug()
      const answers = await askUser([
        {
          question: `Publish "${params.title}" to Anton?`,
          options: ['Publish', 'Cancel'],
          allowFreeText: false,
          metadata: {
            type: 'publish_confirm',
            title: params.title,
            contentType: params.type,
            language: params.language || null,
            suggestedSlug,
            domain: domain || null,
          },
        },
      ])

      const answer = (Object.values(answers)[0] || '').trim()

      // The PublishConfirmCard emits either the chosen slug (confirm)
      // or an empty string (cancel). Handle legacy string answers too.
      if (!answer || /^(no|cancel)$/i.test(answer)) {
        return toolResult('Publish cancelled by user.')
      }

      // Any non-empty, non-cancel answer is the final slug the user
      // wants. Validate and clamp — executePublish throws on bad slugs.
      const finalSlug = VALID_SLUG.test(answer) ? answer : suggestedSlug
      return toolResult(executePublish({ ...params, slug: finalSlug }, domain))
    },
  })
}
