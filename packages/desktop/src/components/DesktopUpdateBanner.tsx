import { Download, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { checkDesktopUpdate } from '../lib/desktop-updater.js'

type Stage = 'idle' | 'available' | 'installing' | 'error'

export function DesktopUpdateBanner() {
  const [stage, setStage] = useState<Stage>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [install, setInstall] = useState<(() => Promise<void>) | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    checkDesktopUpdate().then((update) => {
      if (cancelled || !update) return
      setVersion(update.version)
      setInstall(() => update.install)
      setStage('available')
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (dismissed || stage === 'idle') return null

  return (
    <output className="desktop-update-banner">
      {stage === 'available' && (
        <>
          <Download size={14} strokeWidth={1.5} />
          <span className="desktop-update-banner__text">Desktop v{version} available</span>
          <button
            type="button"
            className="desktop-update-banner__action"
            onClick={async () => {
              if (!install) return
              setStage('installing')
              try {
                await install()
              } catch (err) {
                console.warn('Desktop update failed:', err)
                setStage('error')
              }
            }}
          >
            Update now
          </button>
          <button
            type="button"
            className="desktop-update-banner__dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </>
      )}
      {stage === 'installing' && (
        <>
          <Loader2 size={14} strokeWidth={1.5} className="desktop-update-banner__spin" />
          <span className="desktop-update-banner__text">Installing update…</span>
        </>
      )}
      {stage === 'error' && (
        <>
          <span className="desktop-update-banner__text desktop-update-banner__text--error">
            Desktop update failed
          </span>
          <button
            type="button"
            className="desktop-update-banner__dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </>
      )}
    </output>
  )
}
