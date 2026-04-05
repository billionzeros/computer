import { Check, Copy } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode } from '../../lib/shiki.js'
import type { CitationSource } from '../../lib/store.js'

function slugify(children: React.ReactNode): string {
  const text = extractText(children)
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children)
  }
  return ''
}

interface Props {
  content: string
  citations?: CitationSource[]
}

/**
 * Preprocess markdown to convert [n] citation references into markdown links
 * with a cite: scheme so we can intercept them in the `a` component override.
 * Skips code fences and existing markdown links.
 */
function injectCitationLinks(text: string): string {
  // Split by code fences to avoid processing inside code blocks
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g)
  return parts
    .map((part, i) => {
      // Odd indices are code blocks/inline code — leave them alone
      if (i % 2 === 1) return part
      // Replace [n] but not [text](url) patterns
      // Negative lookbehind for ! avoids image syntax ![n]
      return part.replace(/(?<!!)\[(\d+)\](?!\()/g, '[⁠$1](cite:$1)')
    })
    .join('')
}

function CitationPill({ index, source }: { index: number; source?: CitationSource }) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <span className="citation-pill-wrapper">
      <a
        href={source?.url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="citation-pill"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => {
          if (!source?.url) e.preventDefault()
        }}
      >
        {index}
      </a>
      {showTooltip && source && (
        <span className="citation-tooltip">
          <span className="citation-tooltip__title">{source.title}</span>
          <span className="citation-tooltip__domain">{source.domain}</span>
        </span>
      )}
    </span>
  )
}

/**
 * Strip <think>…</think> blocks that some models (DeepSeek, QwQ, etc.)
 * include inline in their text output. Also handles the streaming case
 * where the closing tag hasn't arrived yet.
 */
function stripThinkTags(text: string): string {
  // Remove complete <think>…</think> blocks (dotall)
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  // Remove an unclosed <think>… at the end (still streaming)
  result = result.replace(/<think>[\s\S]*$/g, '')
  return result.trim()
}

export function MarkdownRenderer({ content, citations }: Props) {
  const processedContent = injectCitationLinks(stripThinkTags(content))

  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
          a: ({ href, children }) => {
            if (href?.startsWith('cite:')) {
              const index = Number.parseInt(href.slice(5), 10)
              const source = citations?.find((s) => s.index === index)
              return <CitationPill index={index} source={source} />
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="markdown-body__link"
              >
                {children}
              </a>
            )
          },
          ul: ({ children }) => <ul className="markdown-body__list">{children}</ul>,
          ol: ({ children }) => (
            <ol className="markdown-body__list markdown-body__list--ordered">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="markdown-body__quote">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="markdown-body__tableWrap">
              <table className="markdown-body__table">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="markdown-body__th">{children}</th>,
          td: ({ children }) => <td className="markdown-body__td">{children}</td>,
          h1: ({ children }) => (
            <h1
              id={slugify(children)}
              className="markdown-body__heading markdown-body__heading--h1"
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              id={slugify(children)}
              className="markdown-body__heading markdown-body__heading--h2"
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              id={slugify(children)}
              className="markdown-body__heading markdown-body__heading--h3"
            >
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="markdown-body__paragraph">{children}</p>,
          hr: () => <hr className="markdown-body__rule" />,
        }}
      >
        {processedContent}
      </Markdown>
    </div>
  )
}

function CodeBlock({
  className,
  children,
  ..._props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || '')
  const lang = match?.[1] || ''
  const code = String(children).replace(/\n$/, '')
  const isInline = !match && !code.includes('\n')

  if (isInline) {
    return <code className="markdown-body__inlineCode">{children}</code>
  }

  return <HighlightedBlock code={code} lang={lang} />
}

export function HighlightedBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    highlightCode(code, lang).then(setHtml)
  }, [code, lang])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__language">{lang || 'text'}</span>
        <button type="button" onClick={handleCopy} className="code-block__copy">
          {copied ? (
            <>
              <Check className="code-block__copyIcon" />
              Copied
            </>
          ) : (
            <>
              <Copy className="code-block__copyIcon" />
              Copy
            </>
          )}
        </button>
      </div>

      {html ? (
        <div
          className="code-block__content code-block__content--highlighted"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki HTML output is trusted
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="code-block__content">
          <code className="code-block__fallback">{code}</code>
        </pre>
      )}
    </div>
  )
}
