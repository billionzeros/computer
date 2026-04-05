/**
 * Publish tool — converts artifacts to full HTML documents and writes them
 * to the published directory, making them accessible via public URL.
 *
 * Content types are converted to standalone HTML pages:
 *   html     → pass through (ensure doctype wrapper)
 *   markdown → client-side rendering via marked CDN
 *   svg      → inline SVG in HTML with viewport
 *   mermaid  → mermaid CDN for rendering
 *   code     → <pre><code> with monospace styling
 */

import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPublishedDir } from '@anton/agent-config'

export interface PublishInput {
  title: string
  content: string
  type: 'html' | 'markdown' | 'svg' | 'mermaid' | 'code'
  language?: string
  slug?: string
}

function generateSlug(): string {
  return randomBytes(4).toString('hex') // 8 hex chars
}

function wrapHtml(title: string, body: string, headExtra = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
${headExtra}
</head>
<body>
${body}
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function convertToHtml(input: PublishInput): string {
  const { title, content, type, language } = input

  switch (type) {
    case 'html':
      if (content.includes('<!DOCTYPE') || content.includes('<html')) {
        return content
      }
      return wrapHtml(
        title,
        content,
        '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif}</style>',
      )

    case 'markdown':
      return wrapHtml(
        title,
        `<div id="content"></div>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<script>
document.getElementById('content').innerHTML = marked.parse(${JSON.stringify(content)});
<\/script>`,
        `<style>
body{max-width:800px;margin:0 auto;padding:2rem;font-family:system-ui,sans-serif;line-height:1.6;color:#1a1a1a}
h1,h2,h3{margin-top:1.5em;margin-bottom:0.5em}
pre{background:#f5f5f5;padding:1rem;border-radius:6px;overflow-x:auto}
code{font-family:'SF Mono',Monaco,monospace;font-size:0.9em}
a{color:#2563eb}
img{max-width:100%}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ddd;padding:8px;text-align:left}
blockquote{border-left:4px solid #ddd;margin:1em 0;padding:0.5em 1em;color:#555}
</style>`,
      )

    case 'svg':
      return wrapHtml(
        title,
        `<div style="display:flex;justify-content:center;align-items:center;min-height:100vh;padding:2rem">
${content}
</div>`,
        '<style>body{margin:0;background:#fff}svg{max-width:100%;height:auto}</style>',
      )

    case 'mermaid':
      return wrapHtml(
        title,
        `<pre class="mermaid">${escapeHtml(content)}</pre>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
<script>mermaid.initialize({startOnLoad:true,theme:'default'})<\/script>`,
        '<style>body{display:flex;justify-content:center;padding:2rem;background:#fff}</style>',
      )

    case 'code':
      return wrapHtml(
        title,
        `<pre><code class="language-${language || 'text'}">${escapeHtml(content)}</code></pre>`,
        `<style>
body{margin:0;padding:2rem;background:#1e1e1e;color:#d4d4d4}
pre{margin:0;overflow-x:auto}
code{font-family:'SF Mono',Monaco,'Cascadia Code',monospace;font-size:14px;line-height:1.5}
</style>`,
      )

    default:
      return wrapHtml(title, `<pre>${escapeHtml(content)}</pre>`)
  }
}

export function executePublish(input: PublishInput, domain?: string): string {
  const slug = input.slug || generateSlug()
  const html = convertToHtml(input)

  const publishedDir = getPublishedDir()
  const artifactDir = join(publishedDir, slug)
  mkdirSync(artifactDir, { recursive: true, mode: 0o755 })
  const filePath = join(artifactDir, 'index.html')
  writeFileSync(filePath, html, 'utf-8')
  chmodSync(filePath, 0o644)

  const url = domain ? `https://${domain}/a/${slug}` : `/a/${slug}`
  return `Published "${input.title}" → ${url}`
}
