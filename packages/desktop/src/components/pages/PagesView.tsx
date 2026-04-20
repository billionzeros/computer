import {
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  Globe,
  Loader2,
  MoreHorizontal,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { connectionStore } from '../../lib/store/connectionStore.js'
import { type PublishedPage, pagesStore } from '../../lib/store/pagesStore.js'

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.floor(days / 30)
  return `${months}mo`
}

function typeIcon(type: PublishedPage['type']) {
  switch (type) {
    case 'html':
    case 'svg':
    case 'mermaid':
    case 'code':
      return <FileCode size={14} strokeWidth={1.5} />
    default:
      return <FileText size={14} strokeWidth={1.5} />
  }
}

function typeLabel(type: PublishedPage['type']): string {
  switch (type) {
    case 'html':
      return 'HTML'
    case 'markdown':
      return 'Markdown'
    case 'svg':
      return 'SVG'
    case 'mermaid':
      return 'Mermaid'
    case 'code':
      return 'Code'
    default:
      return type
  }
}

function PageDetail({ page, host }: { page: PublishedPage; host: string | null }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const fullUrl = host ? `https://${host}/a/${page.slug}` : `/a/${page.slug}`

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setConfirmUnpublish(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const copyLink = async () => {
    await navigator.clipboard.writeText(fullUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const openInBrowser = () => {
    window.open(fullUrl, '_blank')
    setMenuOpen(false)
  }

  const handleManage = () => {
    if (page.artifactId) {
      artifactStore.getState().openPublishModal(page.artifactId)
    }
    setMenuOpen(false)
  }

  const handleUnpublish = () => {
    if (!confirmUnpublish) {
      setConfirmUnpublish(true)
      return
    }
    pagesStore.getState().removePage(page.slug)
    setMenuOpen(false)
    setConfirmUnpublish(false)
  }

  return (
    <div className="pg-content">
      <div className="pg-toolbar">
        <div className="pg-toolbar__left">
          <div className="pg-toolbar__crumbs">
            <span>Pages</span>
            <ChevronRight size={11} strokeWidth={1.5} />
            <span className="pg-toolbar__current">{page.title}</span>
          </div>
        </div>
        <div className="pg-toolbar__right">
          <div className="pg-views">
            <span className="pg-views__label">Views</span>
            <span>{page.views.toLocaleString()}</span>
          </div>
          <button type="button" className="pg-btn" onClick={copyLink}>
            <Copy size={12} strokeWidth={1.5} />
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" className="pg-btn pg-btn--primary" onClick={openInBrowser}>
            <ExternalLink size={12} strokeWidth={1.5} />
            Open
          </button>
          <div className="pg-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="pg-iconbtn"
              aria-label="More actions"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MoreHorizontal size={15} strokeWidth={1.5} />
            </button>
            {menuOpen && (
              <div className="pg-menu">
                {page.artifactId && (
                  <button type="button" className="pg-menu__item" onClick={handleManage}>
                    <Globe size={13} strokeWidth={1.5} />
                    Manage publish settings
                  </button>
                )}
                <div className="pg-menu__sep" />
                <button
                  type="button"
                  className="pg-menu__item pg-menu__item--danger"
                  onClick={handleUnpublish}
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                  {confirmUnpublish ? 'Confirm unpublish' : 'Unpublish'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pg-scroll">
        <div className="pg-article">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            {typeIcon(page.type)}
            <span style={{ color: 'var(--text-4)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              {typeLabel(page.type)} · /a/{page.slug} · updated {formatRelativeTime(page.updatedAt)}
            </span>
          </div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
              margin: '0 0 12px',
            }}
          >
            {page.title}
          </h1>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--text-3)',
              lineHeight: 1.6,
              marginBottom: 24,
            }}
          >
            Published at{' '}
            <a
              href={fullUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                color: 'var(--accent)',
                textDecoration: 'none',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
              }}
            >
              {fullUrl}
            </a>
          </p>
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-3)',
              lineHeight: 1.6,
            }}
          >
            Open the page in your browser to preview the live content, or use the menu above to
            manage publish settings and unpublish.
          </p>
        </div>
      </div>
    </div>
  )
}

export function PagesView() {
  const pages = pagesStore((s) => s.pages)
  const loaded = pagesStore((s) => s.loaded)
  const serverHost = pagesStore((s) => s.host)
  const domain = connectionStore((s) => s.domain)
  const host = serverHost || domain || null

  const [query, setQuery] = useState('')
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

  useEffect(() => {
    pagesStore.getState().requestPages()
  }, [])

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...pages].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted
    return sorted.filter((p) => p.title.toLowerCase().includes(q) || p.slug.includes(q))
  }, [pages, query])

  // Auto-select first page once loaded
  useEffect(() => {
    if (!selectedSlug && filteredPages[0]) {
      setSelectedSlug(filteredPages[0].slug)
    }
  }, [filteredPages, selectedSlug])

  const selectedPage =
    filteredPages.find((p) => p.slug === selectedSlug) ?? filteredPages[0] ?? null

  if (!loaded) {
    return (
      <div className="pg-main">
        <div className="pg-empty-doc">
          <Loader2 size={18} strokeWidth={1.5} className="spin" />
          <div style={{ marginTop: 8 }}>Loading pages…</div>
        </div>
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="pg-main">
        <div className="pg-empty-doc">
          <Globe size={28} strokeWidth={1.2} />
          <p style={{ marginTop: 12, fontSize: 14, color: 'var(--text-2)' }}>
            No published pages yet
          </p>
          <p style={{ marginTop: 4 }}>When you publish an artifact, it will appear here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pg-main">
      <div className="pg-split">
        <aside className="pg-sidebar">
          <div className="pg-sidebar__head">
            <h2 className="pg-sidebar__title">Pages</h2>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-4)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {pages.length}
            </span>
          </div>
          <div className="pg-sidebar__search">
            <Search size={12} strokeWidth={1.5} />
            <input
              type="text"
              placeholder="Search pages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="pg-sidebar__list">
            {filteredPages.length === 0 ? (
              <div className="pg-empty-list">No pages match "{query}".</div>
            ) : (
              filteredPages.map((p) => (
                <button
                  type="button"
                  key={p.slug}
                  className={`pg-item${selectedPage?.slug === p.slug ? ' active' : ''}`}
                  onClick={() => setSelectedSlug(p.slug)}
                >
                  <span className="pg-item__emoji">{typeIcon(p.type)}</span>
                  <div className="pg-item__body">
                    <span className="pg-item__title">{p.title}</span>
                    <span className="pg-item__meta">
                      {typeLabel(p.type)}
                      <span>·</span>
                      {formatRelativeTime(p.updatedAt)}
                      <span>·</span>
                      {p.views.toLocaleString()} views
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {selectedPage ? (
          <PageDetail page={selectedPage} host={host} />
        ) : (
          <div className="pg-content">
            <div className="pg-empty-doc">Select a page to preview.</div>
          </div>
        )}
      </div>
    </div>
  )
}
