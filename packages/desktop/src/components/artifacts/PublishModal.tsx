import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpRight,
  Check,
  Code2,
  Copy,
  Globe,
  Linkedin,
  RefreshCw,
  Share2,
  Twitter,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { artifactStore } from '../../lib/store/artifactStore.js'
import { connectionStore } from '../../lib/store/connectionStore.js'
import { Modal } from '../ui/Modal.js'

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'untitled'
  )
}

export function PublishModal() {
  const open = artifactStore((s) => s.publishModalOpen)
  const artifactId = artifactStore((s) => s.publishModalArtifactId)
  const artifacts = artifactStore((s) => s.artifacts)
  const closeModal = artifactStore((s) => s.closePublishModal)
  const publishError = artifactStore((s) => s.publishError)
  const domain = connectionStore((s) => s.domain)

  const artifact = artifacts.find((a) => a.id === artifactId) ?? null

  const defaultTitle = artifact?.title || artifact?.filename || 'Untitled'
  const alreadyPublished = !!artifact?.publishedUrl

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [justPublished, setJustPublished] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedEmbed, setCopiedEmbed] = useState(false)

  // Which view: 'form' for first publish, 'manage' for already published
  const showManage = alreadyPublished || justPublished

  // Build full URL from domain + slug
  const buildFullUrl = useCallback(
    (s: string) => (domain ? `https://${domain}/a/${s}` : `/a/${s}`),
    [domain],
  )

  const publicUrl = useMemo(() => {
    if (artifact?.publishedUrl) {
      // If server returned a full URL, use it; otherwise construct from domain
      if (artifact.publishedUrl.startsWith('http')) return artifact.publishedUrl
      return buildFullUrl(artifact.publishedSlug || slug)
    }
    return buildFullUrl(slug)
  }, [artifact?.publishedUrl, artifact?.publishedSlug, slug, buildFullUrl])

  // Reset state when modal opens with a new artifact
  useEffect(() => {
    if (open) {
      setName(defaultTitle)
      const existingSlug = artifact?.publishedSlug
      setSlug(existingSlug || slugify(defaultTitle))
      setSlugEdited(!!existingSlug)
      setPublishing(false)
      setJustPublished(false)
      setCopiedLink(false)
      setCopiedEmbed(false)
    }
  }, [open, defaultTitle, artifact?.publishedSlug])

  // Watch for publish success
  useEffect(() => {
    if (publishing && artifact?.publishedUrl) {
      setPublishing(false)
      setJustPublished(true)
    }
  }, [publishing, artifact?.publishedUrl])

  // Watch for publish error
  useEffect(() => {
    if (publishing && publishError) {
      setPublishing(false)
    }
  }, [publishing, publishError])

  // Derive slug from name unless manually edited
  useEffect(() => {
    if (!slugEdited) {
      setSlug(slugify(name))
      if (publishError) artifactStore.getState().setPublishError(null)
    }
  }, [name, slugEdited, publishError])

  const handlePublish = useCallback(() => {
    if (!artifact || publishing) return
    setPublishing(true)
    artifactStore
      .getState()
      .publishArtifact(
        artifact.id,
        artifact.content,
        artifact.renderType,
        name || 'Untitled',
        artifact.projectId,
        slug,
      )
  }, [artifact, publishing, name, slug])

  const handleCopyLink = useCallback(() => {
    if (!publicUrl) return
    navigator.clipboard.writeText(publicUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }, [publicUrl])

  const embedCode = useMemo(
    () =>
      `<iframe src="${publicUrl}" width="100%" height="600" style="border:none;border-radius:8px"></iframe>`,
    [publicUrl],
  )

  const handleCopyEmbed = useCallback(() => {
    navigator.clipboard.writeText(embedCode)
    setCopiedEmbed(true)
    setTimeout(() => setCopiedEmbed(false), 2000)
  }, [embedCode])

  const handleClose = useCallback(() => {
    closeModal()
  }, [closeModal])

  if (!artifact) return null

  const modalTitle = showManage ? 'Publish' : 'Publish to web'

  return (
    <Modal open={open} onClose={handleClose} title={modalTitle}>
      <AnimatePresence mode="wait">
        {!showManage ? (
          /* ── First publish form ── */
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="publish-modal"
          >
            <div className="publish-modal__field">
              <span className="publish-modal__label-text">Title</span>
              <input
                type="text"
                className="publish-modal__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Page title"
                autoFocus
              />
            </div>

            <div className="publish-modal__field">
              <span className="publish-modal__label-text">URL</span>
              <div className="publish-modal__slug-row">
                <span className="publish-modal__slug-prefix">
                  {domain ? `${domain}/a/` : '/a/'}
                </span>
                <input
                  type="text"
                  className="publish-modal__slug-input"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))
                    setSlugEdited(true)
                    if (publishError) artifactStore.getState().setPublishError(null)
                  }}
                  placeholder="url-slug"
                />
              </div>
            </div>

            {publishError && <div className="publish-modal__error">{publishError}</div>}

            <button
              type="button"
              className="publish-modal__publish-btn"
              onClick={handlePublish}
              disabled={publishing || !slug}
            >
              {publishing ? (
                <span className="publish-modal__spinner" />
              ) : (
                <Globe size={15} strokeWidth={1.5} />
              )}
              <span>{publishing ? 'Publishing...' : 'Publish'}</span>
            </button>
          </motion.div>
        ) : (
          /* ── Manage published page (Notion-style) ── */
          <motion.div
            key="manage"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="publish-modal"
          >
            {/* Domain breadcrumb */}
            <div className="publish-modal__breadcrumb">
              <Globe size={13} strokeWidth={1.5} />
              <span className="publish-modal__breadcrumb-domain">
                {domain || 'your-site'}
              </span>
              <span className="publish-modal__breadcrumb-sep">/</span>
              <span className="publish-modal__breadcrumb-slug">
                {artifact.publishedSlug || slug}
              </span>
              <div className="publish-modal__breadcrumb-status">
                <div className="publish-modal__live-dot" />
                <span>Live</span>
              </div>
            </div>

            {/* Action rows — Notion style */}
            <div className="publish-modal__actions-list">
              <button
                type="button"
                className="publish-modal__action-row"
                onClick={handleCopyEmbed}
              >
                <Code2 size={15} strokeWidth={1.5} />
                <span>{copiedEmbed ? 'Copied embed code' : 'Embed this page'}</span>
                {copiedEmbed && <Check size={14} strokeWidth={1.5} className="publish-modal__action-check" />}
              </button>

              <button
                type="button"
                className="publish-modal__action-row"
                onClick={handleCopyLink}
              >
                <Copy size={15} strokeWidth={1.5} />
                <span>{copiedLink ? 'Link copied' : 'Copy link'}</span>
                {copiedLink && <Check size={14} strokeWidth={1.5} className="publish-modal__action-check" />}
              </button>

              <div className="publish-modal__action-row publish-modal__action-row--group">
                <Share2 size={15} strokeWidth={1.5} />
                <span>Share via social</span>
                <div className="publish-modal__social-icons">
                  <a
                    href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="publish-modal__social-link"
                  >
                    <Twitter size={14} strokeWidth={1.5} />
                  </a>
                  <a
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(publicUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="publish-modal__social-link"
                  >
                    <Linkedin size={14} strokeWidth={1.5} />
                  </a>
                </div>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="publish-modal__footer">
              <button
                type="button"
                className="publish-modal__footer-btn publish-modal__footer-btn--secondary"
                onClick={handlePublish}
                disabled={publishing}
              >
                {publishing ? (
                  <span className="publish-modal__spinner publish-modal__spinner--dark" />
                ) : (
                  <RefreshCw size={14} strokeWidth={1.5} />
                )}
                <span>{publishing ? 'Updating...' : 'Update'}</span>
              </button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="publish-modal__footer-btn publish-modal__footer-btn--primary"
              >
                <span>View site</span>
                <ArrowUpRight size={14} strokeWidth={1.5} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  )
}
