import {
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  Globe,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { connectionStore } from '../../lib/store/connectionStore.js'
import { pagesStore, type PublishedPage } from '../../lib/store/pagesStore.js'

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
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
    case 'html': return 'HTML'
    case 'markdown': return 'Markdown'
    case 'svg': return 'SVG'
    case 'mermaid': return 'Mermaid'
    case 'code': return 'Code'
    default: return type
  }
}

function PageRow({ page, host }: { page: PublishedPage; host: string | null }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const fullUrl = host ? `https://${host}/a/${page.slug}` : `/a/${page.slug}`

  useEffect(() => {
    if (!menuOpen) return
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setConfirmUnpublish(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  const copyLink = () => {
    navigator.clipboard.writeText(fullUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    setMenuOpen(false)
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
    <div className="pv-row" onClick={openInBrowser}>
      <div className="pv-row__name-cell">
        <span className="pv-row__icon">{typeIcon(page.type)}</span>
        <span className="pv-row__title">{page.title}</span>
      </div>
      <span className="pv-row__type">{typeLabel(page.type)}</span>
      <span className="pv-row__views">{page.views.toLocaleString()}</span>
      <span className="pv-row__updated">{formatRelativeTime(page.updatedAt)}</span>
      <div className="pv-row__actions" ref={menuRef}>
        <button
          className="pv-row__menu-btn"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(!menuOpen)
            setConfirmUnpublish(false)
          }}
        >
          <MoreHorizontal size={15} strokeWidth={1.5} />
        </button>
        {menuOpen && (
          <div className="pv-dropdown">
            <button className="pv-dropdown__item" onClick={(e) => { e.stopPropagation(); copyLink() }}>
              <Copy size={14} strokeWidth={1.5} />
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button className="pv-dropdown__item" onClick={(e) => { e.stopPropagation(); openInBrowser() }}>
              <ExternalLink size={14} strokeWidth={1.5} />
              Open in browser
            </button>
            {page.artifactId && (
              <button className="pv-dropdown__item" onClick={(e) => { e.stopPropagation(); handleManage() }}>
                <Globe size={14} strokeWidth={1.5} />
                Manage
              </button>
            )}
            <div className="pv-dropdown__sep" />
            <button
              className="pv-dropdown__item pv-dropdown__item--danger"
              onClick={(e) => { e.stopPropagation(); handleUnpublish() }}
            >
              <Trash2 size={14} strokeWidth={1.5} />
              {confirmUnpublish ? 'Confirm unpublish' : 'Unpublish'}
            </button>
          </div>
        )}
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

  useEffect(() => {
    pagesStore.getState().requestPages()
  }, [])

  return (
    <div className="pv">
      <div className="pv-container">
        {/* Subheader with domain and count */}
        <div className="pv-subheader">
          <div className="pv-subheader__left">
            <Globe size={14} strokeWidth={1.5} className="pv-subheader__icon" />
            <span className="pv-subheader__domain">{host || 'Published pages'}</span>
            {loaded && pages.length > 0 && (
              <span className="pv-subheader__count">{pages.length}</span>
            )}
          </div>
        </div>

        {!loaded ? (
          <div className="pv-loading">
            <Loader2 size={16} strokeWidth={1.5} className="pv-spinner" />
            <span>Loading pages...</span>
          </div>
        ) : pages.length === 0 ? (
          <div className="pv-empty">
            <div className="pv-empty__icon">
              <Globe size={28} strokeWidth={1.2} />
            </div>
            <p className="pv-empty__title">No published pages yet</p>
            <p className="pv-empty__desc">
              When you publish an artifact, it will appear here
            </p>
          </div>
        ) : (
          <div className="pv-table">
            {/* Column headers */}
            <div className="pv-thead">
              <span className="pv-thead__name">Name</span>
              <span className="pv-thead__type">Type</span>
              <span className="pv-thead__views">Views</span>
              <span className="pv-thead__updated">Updated</span>
              <span className="pv-thead__actions" />
            </div>

            {/* Rows */}
            <div className="pv-tbody">
              {pages.map((page) => (
                <PageRow key={page.slug} page={page} host={host} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
