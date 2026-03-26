import { Check, Copy } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode } from '../../lib/shiki.js'

interface Props {
  content: string
}

/** Strip internal tags that should never be shown to users */
function sanitize(text: string): string {
  return text.replace(/\[PROJECT_CONTEXT_UPDATE\][\s\S]*?\[\/PROJECT_CONTEXT_UPDATE\]/g, '').trim()
}

export function MarkdownRenderer({ content }: Props) {
  const cleaned = sanitize(content)
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="markdown-body__link"
            >
              {children}
            </a>
          ),
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
            <h1 className="markdown-body__heading markdown-body__heading--h1">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="markdown-body__heading markdown-body__heading--h2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="markdown-body__heading markdown-body__heading--h3">{children}</h3>
          ),
          p: ({ children }) => <p className="markdown-body__paragraph">{children}</p>,
          hr: () => <hr className="markdown-body__rule" />,
        }}
      >
        {cleaned}
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
