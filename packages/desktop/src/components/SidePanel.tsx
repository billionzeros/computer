import { motion } from 'framer-motion'
import { FileCode, ListChecks, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store.js'
import { PlanPanel } from './PlanPanel.js'
import { ArtifactPanelContent } from './artifacts/ArtifactPanel.js'

type PanelView = 'artifacts' | 'plan'

interface ViewTab {
  id: PanelView
  label: string
  icon: typeof FileCode
  available: boolean
}

const MIN_WIDTH = 320
const MAX_WIDTH = 900
const DEFAULT_WIDTH = 480

export function SidePanel() {
  const artifacts = useStore((s) => s.artifacts)
  const pendingPlan = useStore((s) => s.pendingPlan)
  const sidePanelView = useStore((s) => s.sidePanelView)
  const setSidePanelView = useStore((s) => s.setSidePanelView)
  const setArtifactPanelOpen = useStore((s) => s.setArtifactPanelOpen)

  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(DEFAULT_WIDTH)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      startX.current = e.clientX
      startWidth.current = panelWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [panelWidth],
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      // Dragging left increases width (panel is on the right)
      const delta = startX.current - e.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
      setPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const views: ViewTab[] = [
    { id: 'artifacts', label: 'Artifacts', icon: FileCode, available: artifacts.length > 0 },
    { id: 'plan', label: 'Plan', icon: ListChecks, available: pendingPlan !== null },
  ]

  const availableViews = views.filter((v) => v.available)
  const showTabs = availableViews.length > 1

  // If current view is not available, switch to first available
  const activeView = availableViews.find((v) => v.id === sidePanelView)
    ? sidePanelView
    : (availableViews[0]?.id ?? 'artifacts')

  return (
    <motion.div
      className="side-panel"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: panelWidth, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={isDragging.current ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div className="side-panel__resize-handle" onMouseDown={handleMouseDown} />
      {/* View tabs (only when multiple views available) */}
      {showTabs && (
        <div className="side-panel__view-tabs">
          {availableViews.map((view) => {
            const Icon = view.icon
            return (
              <button
                key={view.id}
                type="button"
                className={`side-panel__view-tab ${activeView === view.id ? 'side-panel__view-tab--active' : ''}`}
                onClick={() => setSidePanelView(view.id)}
              >
                <Icon size={14} />
                {view.label}
              </button>
            )
          })}
          <div className="side-panel__view-tabs-spacer" />
          <button
            type="button"
            className="side-panel__close"
            onClick={() => setArtifactPanelOpen(false)}
            aria-label="Close panel"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Single-view close button (only for plan view when no tab bar) */}
      {!showTabs && activeView === 'plan' && (
        <div className="side-panel__header-bar">
          <span className="side-panel__header-title">Review Plan</span>
          <button
            type="button"
            className="side-panel__close"
            onClick={() => setArtifactPanelOpen(false)}
            aria-label="Close panel"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Panel content */}
      <div className="side-panel__body">
        {activeView === 'artifacts' && <ArtifactPanelContent />}
        {activeView === 'plan' && <PlanPanel />}
      </div>
    </motion.div>
  )
}
