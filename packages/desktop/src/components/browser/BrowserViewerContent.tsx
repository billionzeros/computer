import type { BrowserRuntimeInstallTarget, BrowserRuntimeStatus } from '@anton/protocol'
import {
  AlertTriangle,
  AppWindow,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { connection } from '../../lib/connection.js'
import { useStore } from '../../lib/store.js'
import { artifactStore } from '../../lib/store/artifactStore.js'

function keyboardModifiers(e: React.KeyboardEvent): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
}

function visibleRuntimeReady(status: BrowserRuntimeStatus | null): boolean {
  if (!status) return false
  const chrome = status.components.find((component) => component.id === 'chrome')
  const agentBrowser = status.components.find((component) => component.id === 'agent-browser')
  return chrome?.status === 'ready' && agentBrowser?.status === 'ready'
}

function visibleRuntimeInstallTarget(
  status: BrowserRuntimeStatus | null,
): BrowserRuntimeInstallTarget | null {
  if (!status || visibleRuntimeReady(status)) return null
  const agentBrowser = status.components.find((component) => component.id === 'agent-browser')
  const chrome = status.components.find((component) => component.id === 'chrome')
  if (agentBrowser?.status !== 'ready') return null
  return chrome?.status === 'error' ? 'repair' : 'chrome'
}

function runtimeIssueText(status: BrowserRuntimeStatus | null): string {
  if (!status) return 'Checking browser runtime'
  const agentBrowser = status.components.find((component) => component.id === 'agent-browser')
  const chrome = status.components.find((component) => component.id === 'chrome')
  if (agentBrowser?.status !== 'ready') return 'Browser package is missing from this deployment.'
  if (chrome?.status === 'error') return 'Chrome for Anton needs repair before it can open.'
  return 'Chrome for Anton needs setup before it can open.'
}

export function BrowserViewerContent({ showTopBar = true }: { showTopBar?: boolean }) {
  const browserState = artifactStore((s) => s.browserState)
  const browserRuntimeStatus = artifactStore((s) => s.browserRuntimeStatus)
  const browserRuntimeProgress = artifactStore((s) => s.browserRuntimeProgress)
  const browserRuntimeInstalling = artifactStore((s) => s.browserRuntimeInstalling)
  const setArtifactPanelOpen = artifactStore((s) => s.setArtifactPanelOpen)
  const setBrowserRuntimeProgress = artifactStore((s) => s.setBrowserRuntimeProgress)
  const setBrowserRuntimeInstalling = artifactStore((s) => s.setBrowserRuntimeInstalling)
  const activeConv = useStore((s) => s.getActiveConversation())
  const sessionId = activeConv?.sessionId
  const viewportRef = useRef<HTMLButtonElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointerDownRef = useRef(false)
  const autoOpenRef = useRef(false)
  const [urlValue, setUrlValue] = useState('')
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    connection.sendBrowserRuntimeStatus()
  }, [])

  useEffect(() => {
    setUrlValue(browserState?.url || '')
  }, [browserState?.url])

  const startBrowser = useCallback(() => {
    setBrowserRuntimeInstalling('chrome')
    setBrowserRuntimeProgress({
      type: 'browser_runtime_install_progress',
      target: 'chrome',
      stage: 'checking',
      message: 'Opening browser',
    })
    connection.sendBrowserOpen(sessionId)
  }, [sessionId, setBrowserRuntimeInstalling, setBrowserRuntimeProgress])

  const startRuntimeInstall = useCallback(
    (target: BrowserRuntimeInstallTarget) => {
      setBrowserRuntimeInstalling(target)
      setBrowserRuntimeProgress({
        type: 'browser_runtime_install_progress',
        target,
        stage: 'checking',
        message: 'Checking browser runtime',
      })
      connection.sendBrowserRuntimeInstall(target)
    },
    [setBrowserRuntimeInstalling, setBrowserRuntimeProgress],
  )

  const navigate = useCallback(
    (url: string) => {
      const target = url.trim()
      if (!target) return
      connection.sendBrowserNavigate(target, sessionId)
    },
    [sessionId],
  )

  const sendCommand = useCallback(
    (command: 'back' | 'forward' | 'reload') => {
      if (!browserState) return
      connection.sendBrowserCommand(command, sessionId)
    },
    [browserState, sessionId],
  )

  useEffect(() => {
    if (browserState || autoOpenRef.current) return
    autoOpenRef.current = true
    startBrowser()
  }, [browserState, startBrowser])

  useEffect(() => {
    if (!browserState) return
    const viewport = viewportRef.current
    if (!viewport) return

    let frameId: number | null = null
    const sendViewport = () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        frameId = null
        const rect = viewport.getBoundingClientRect()
        if (rect.width < 320 || rect.height < 240) return
        connection.sendBrowserViewport(Math.round(rect.width), Math.round(rect.height), sessionId)
      })
    }

    const observer = new ResizeObserver(sendViewport)
    observer.observe(viewport)
    sendViewport()
    return () => {
      observer.disconnect()
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [browserState, sessionId])

  useEffect(() => {
    if (!fullscreen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [fullscreen])

  const pointForEvent = useCallback(
    (e: React.PointerEvent | React.WheelEvent) => {
      const rect = imageRef.current?.getBoundingClientRect()
      if (!rect || !browserState) return null
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return null
      }
      const width = browserState.frameMetadata?.deviceWidth || browserState.viewportWidth || 1280
      const height = browserState.frameMetadata?.deviceHeight || browserState.viewportHeight || 720
      return {
        x: Math.max(0, Math.min(width, ((e.clientX - rect.left) / rect.width) * width)),
        y: Math.max(0, Math.min(height, ((e.clientY - rect.top) / rect.height) * height)),
      }
    },
    [browserState],
  )

  const sendMouse = useCallback(
    (
      e: React.PointerEvent | React.WheelEvent,
      eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel',
      extra: Record<string, unknown> = {},
    ) => {
      const point = pointForEvent(e)
      if (!point) return
      connection.sendBrowserInput(
        {
          type: 'input_mouse',
          eventType,
          x: Math.round(point.x),
          y: Math.round(point.y),
          ...extra,
        },
        sessionId,
      )
    },
    [pointForEvent, sessionId],
  )

  const image = browserState?.frame || browserState?.screenshot
  const installActive =
    browserRuntimeInstalling !== null &&
    browserRuntimeProgress?.stage !== 'done' &&
    browserRuntimeProgress?.stage !== 'error'
  const runtimeProgressError = !browserState && browserRuntimeProgress?.stage === 'error'
  const runtimeKnown = browserRuntimeStatus !== null
  const runtimeIssue =
    !browserState &&
    !installActive &&
    (runtimeProgressError || (runtimeKnown && !visibleRuntimeReady(browserRuntimeStatus)))
  const installTarget = runtimeProgressError
    ? 'repair'
    : visibleRuntimeInstallTarget(browserRuntimeStatus)
  const addressText = browserState
    ? urlValue
    : installActive
      ? (browserRuntimeProgress?.message ?? 'Preparing browser')
      : runtimeIssue
        ? 'Setup required'
        : 'No preview available'
  const emptyMessage = installActive
    ? (browserRuntimeProgress?.message ?? 'Preparing browser')
    : runtimeProgressError
      ? (browserRuntimeProgress?.message ?? 'Browser failed to open.')
      : runtimeIssue
        ? runtimeIssueText(browserRuntimeStatus)
        : 'All running apps and browser use activity will appear here.'
  const primaryLabel = installActive
    ? 'Preparing browser'
    : runtimeIssue
      ? installTarget === 'repair'
        ? 'Repair browser'
        : installTarget
          ? 'Set up browser'
          : 'Check runtime'
      : 'Open browser'

  const handlePrimaryAction = () => {
    if (installActive) return
    if (runtimeIssue) {
      if (installTarget) {
        startRuntimeInstall(installTarget)
      } else {
        connection.sendBrowserRuntimeStatus()
      }
      return
    }
    startBrowser()
  }

  return (
    <div
      className={[
        'browser-viewer',
        browserState ? 'browser-viewer--active' : '',
        fullscreen ? 'browser-viewer--fullscreen' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showTopBar && (
        <div className="browser-viewer__topbar">
          <div className="browser-viewer__tabs" role="tablist" aria-label="Panel view">
            <button
              type="button"
              className="browser-viewer__tab browser-viewer__tab--active"
              aria-selected="true"
            >
              <AppWindow size={14} strokeWidth={1.6} />
              Browser
            </button>
          </div>
          <button
            type="button"
            className="browser-viewer__topbar-btn"
            onClick={() => setArtifactPanelOpen(false)}
            aria-label="Close browser panel"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <div className="browser-viewer__frame">
        <div className="browser-viewer__chrome">
          <div className="browser-viewer__nav">
            <button
              type="button"
              className="browser-viewer__nav-btn"
              aria-label="Back"
              onClick={() => sendCommand('back')}
              disabled={!browserState}
            >
              <ChevronLeft size={15} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className="browser-viewer__nav-btn"
              aria-label="Forward"
              onClick={() => sendCommand('forward')}
              disabled={!browserState}
            >
              <ChevronRight size={15} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className="browser-viewer__nav-btn"
              aria-label="Reload"
              onClick={() => sendCommand('reload')}
              disabled={!browserState}
            >
              <RefreshCw size={14} strokeWidth={1.6} />
            </button>
          </div>

          {browserState ? (
            <form
              className="browser-viewer__address"
              onSubmit={(e) => {
                e.preventDefault()
                navigate(urlValue)
              }}
            >
              <AppWindow size={14} strokeWidth={1.6} />
              <input
                className="browser-viewer__url-input"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                spellCheck={false}
                aria-label="Browser URL"
              />
            </form>
          ) : (
            <div className="browser-viewer__address browser-viewer__address--empty">
              {installActive ? (
                <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
              ) : runtimeIssue ? (
                <AlertTriangle size={14} strokeWidth={1.6} />
              ) : (
                <AppWindow size={14} strokeWidth={1.6} />
              )}
              <span>{addressText}</span>
            </div>
          )}

          <div className="browser-viewer__chrome-actions">
            <button
              type="button"
              className="browser-viewer__nav-btn"
              aria-label={fullscreen ? 'Exit full screen browser' : 'Full screen browser'}
              onClick={() => setFullscreen((value) => !value)}
              disabled={!browserState}
            >
              {fullscreen ? (
                <Minimize2 size={14} strokeWidth={1.6} />
              ) : (
                <Maximize2 size={14} strokeWidth={1.6} />
              )}
            </button>
            <button
              type="button"
              className="browser-viewer__nav-btn"
              onClick={() => setArtifactPanelOpen(false)}
              aria-label="Close browser panel"
            >
              <X size={14} strokeWidth={1.6} />
            </button>
          </div>
        </div>

        {browserState ? (
          <button
            type="button"
            ref={viewportRef}
            className="browser-viewer__viewport"
            aria-label="Browser viewport"
            onPointerDown={(e) => {
              pointerDownRef.current = true
              viewportRef.current?.focus()
              e.currentTarget.setPointerCapture(e.pointerId)
              sendMouse(e, 'mousePressed', { button: 'left', clickCount: 1 })
            }}
            onPointerUp={(e) => {
              pointerDownRef.current = false
              sendMouse(e, 'mouseReleased', { button: 'left', clickCount: 1 })
            }}
            onPointerMove={(e) => {
              if (pointerDownRef.current) sendMouse(e, 'mouseMoved')
            }}
            onWheel={(e) => {
              e.preventDefault()
              sendMouse(e, 'mouseWheel', {
                deltaX: Math.round(e.deltaX),
                deltaY: Math.round(e.deltaY),
              })
            }}
            onKeyDown={(e) => {
              if (e.metaKey || e.ctrlKey) return
              e.preventDefault()
              if (e.key.length === 1) {
                connection.sendBrowserInput(
                  { type: 'input_keyboard', eventType: 'char', text: e.key },
                  sessionId,
                )
              } else {
                connection.sendBrowserInput(
                  {
                    type: 'input_keyboard',
                    eventType: 'keyDown',
                    key: e.key,
                    code: e.code,
                    modifiers: keyboardModifiers(e),
                  },
                  sessionId,
                )
              }
            }}
            onKeyUp={(e) => {
              if (e.metaKey || e.ctrlKey || e.key.length === 1) return
              connection.sendBrowserInput(
                {
                  type: 'input_keyboard',
                  eventType: 'keyUp',
                  key: e.key,
                  code: e.code,
                  modifiers: keyboardModifiers(e),
                },
                sessionId,
              )
            }}
          >
            {image ? (
              <img
                ref={imageRef}
                src={`data:image/jpeg;base64,${image}`}
                alt={browserState.title || 'Browser'}
              />
            ) : (
              <div className="browser-viewer__loading">
                <Loader2 size={18} strokeWidth={1.5} className="animate-spin" />
              </div>
            )}
          </button>
        ) : (
          <div className="browser-viewer__empty-surface">
            <div className="browser-viewer__empty-copy">
              <span>{emptyMessage}</span>
              <button
                type="button"
                className="browser-viewer__empty-action"
                onClick={handlePrimaryAction}
                disabled={installActive}
              >
                {installActive ? (
                  <Loader2 size={14} strokeWidth={1.6} className="animate-spin" />
                ) : runtimeIssue ? (
                  <AlertTriangle size={14} strokeWidth={1.6} />
                ) : (
                  <AppWindow size={14} strokeWidth={1.6} />
                )}
                {primaryLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
