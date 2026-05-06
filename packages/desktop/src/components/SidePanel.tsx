import { motion } from 'framer-motion'
import { AppWindow, Brain, Code, Layers, ListChecks, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { artifactStore } from '../lib/store/artifactStore.js'
import { useActiveSessionState } from '../lib/store/sessionStore.js'
import { uiStore } from '../lib/store/uiStore.js'
import { PlanPanel } from './PlanPanel.js'
import { ArtifactPanelContent } from './artifacts/ArtifactPanel.js'
import { BrowserViewerContent } from './browser/BrowserViewerContent.js'
import { ContextPanelContent } from './context/ContextPanelContent.js'
import { DevModePanel } from './devmode/DevModePanel.js'

type PanelView = 'artifacts' | 'plan' | 'context' | 'browser' | 'devmode'

interface ViewTab {
  id: PanelView
  label: string
  icon: typeof Layers
  available: boolean
}

const MIN_WIDTH = 320
const MAX_WIDTH = 2400
const DEFAULT_WIDTH = 440
const BROWSER_DEFAULT_WIDTH = 1120
const BROWSER_WIDTH_RATIO = 0.66
const MIN_MAIN_WIDTH = 520

export function SidePanel() {
  const artifacts = artifactStore((s) => s.artifacts)
  const _pendingPlan = useActiveSessionState((s) => s.pendingPlan)
  const browserState = artifactStore((s) => s.browserState)
  const sidePanelView = uiStore((s) => s.sidePanelView)
  const setSidePanelView = uiStore((s) => s.setSidePanelView)
  const setArtifactPanelOpen = artifactStore((s) => s.setArtifactPanelOpen)

  const [panelWidth, setPanelWidth] = useState(() =>
    sidePanelView === 'browser' ? BROWSER_DEFAULT_WIDTH : DEFAULT_WIDTH,
  )
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(DEFAULT_WIDTH)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      startX.current = e.clientX
      const currentMaxWidth =
        workspaceWidth > 0
          ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, workspaceWidth - MIN_MAIN_WIDTH))
          : MAX_WIDTH
      startWidth.current = Math.min(panelWidth, currentMaxWidth)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [panelWidth, workspaceWidth],
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      // Dragging left increases width (panel is on the right)
      const delta = startX.current - e.clientX
      const currentMaxWidth =
        workspaceWidth > 0
          ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, workspaceWidth - MIN_MAIN_WIDTH))
          : MAX_WIDTH
      const newWidth = Math.min(currentMaxWidth, Math.max(MIN_WIDTH, startWidth.current + delta))
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
  }, [workspaceWidth])

  useEffect(() => {
    const workspaceBody = panelRef.current?.parentElement
    if (!workspaceBody) return

    const updateWidth = () => setWorkspaceWidth(workspaceBody.clientWidth)
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(workspaceBody)
    window.addEventListener('resize', updateWidth)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

  const devMode = uiStore((s) => s.devMode)

  const views: ViewTab[] = [
    {
      id: 'browser',
      label: 'Browser',
      icon: AppWindow,
      available: browserState !== null || sidePanelView === 'browser',
    },
    { id: 'artifacts', label: 'Files', icon: Layers, available: artifacts.length > 0 },
    // Plan now shows as inline overlay above chat input, not in side panel
    { id: 'plan', label: 'Plan', icon: ListChecks, available: false },
    { id: 'context', label: 'Context', icon: Brain, available: sidePanelView === 'context' },
    { id: 'devmode', label: 'Dev', icon: Code, available: devMode && sidePanelView === 'devmode' },
  ]

  const availableViews = views.filter((v) => v.available)

  // If current view is not available, switch to first available
  const activeView = availableViews.find((v) => v.id === sidePanelView)
    ? sidePanelView
    : (availableViews[0]?.id ?? 'artifacts')
  const showTabs = activeView !== 'browser' && availableViews.length > 1
  const maxPanelWidth =
    workspaceWidth > 0
      ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, workspaceWidth - MIN_MAIN_WIDTH))
      : MAX_WIDTH
  const browserTargetWidth =
    workspaceWidth > 0
      ? Math.min(
          maxPanelWidth,
          Math.max(BROWSER_DEFAULT_WIDTH, Math.round(workspaceWidth * BROWSER_WIDTH_RATIO)),
        )
      : BROWSER_DEFAULT_WIDTH
  const renderedPanelWidth = Math.min(panelWidth, maxPanelWidth)

  useLayoutEffect(() => {
    if (isDragging.current) return
    if (activeView === 'browser') {
      const targetWidth = panelWidth < browserTargetWidth ? browserTargetWidth : panelWidth
      const nextWidth = Math.min(maxPanelWidth, Math.max(MIN_WIDTH, targetWidth))
      if (nextWidth !== panelWidth) setPanelWidth(nextWidth)
      return
    }
    if (panelWidth > maxPanelWidth) {
      setPanelWidth(maxPanelWidth)
    }
  }, [activeView, panelWidth, maxPanelWidth, browserTargetWidth])

  return (
    <motion.div
      ref={panelRef}
      className="side-panel"
      data-view={activeView}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: renderedPanelWidth, flexBasis: renderedPanelWidth, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={isDragging.current ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
      style={{
        width: renderedPanelWidth,
        flexBasis: renderedPanelWidth,
        maxWidth: maxPanelWidth,
      }}
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
                <Icon size={14} strokeWidth={1.5} />
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
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Artifacts view owns its own premium header (title + actions + close);
          no generic side-panel header needed in single-view mode. */}

      {/* Single-view close button for context */}
      {!showTabs && activeView === 'context' && (
        <div className="side-panel__header-bar">
          <span className="side-panel__header-title">Conversation Context</span>
          <button
            type="button"
            className="side-panel__close"
            onClick={() => setArtifactPanelOpen(false)}
            aria-label="Close panel"
          >
            <X size={14} strokeWidth={1.5} />
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
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Single-view close button for devmode */}
      {!showTabs && activeView === 'devmode' && (
        <div className="side-panel__header-bar">
          <span className="side-panel__header-title">Developer Tools</span>
          <button
            type="button"
            className="side-panel__close"
            onClick={() => setArtifactPanelOpen(false)}
            aria-label="Close panel"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Panel content */}
      <div className="side-panel__body">
        {activeView === 'browser' && <BrowserViewerContent showTopBar={false} />}
        {activeView === 'artifacts' && <ArtifactPanelContent />}
        {activeView === 'plan' && <PlanPanel />}
        {activeView === 'context' && <ContextPanelContent />}
        {activeView === 'devmode' && <DevModePanel />}
      </div>
    </motion.div>
  )
}
