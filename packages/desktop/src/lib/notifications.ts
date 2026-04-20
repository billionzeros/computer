/**
 * Native notification system — Tauri plugin with Web Notifications API fallback.
 *
 * - Fires OS-level notifications + dock bounce when the window is not focused
 * - Throttles rapid notifications into grouped summaries
 * - Tracks the last notified session for click-to-navigate on refocus
 * - Caches Tauri imports at init (no dynamic import per notification)
 */

// ── Types ────────────────────────────────────────────────────────────

export type NotifyEvent =
  | { type: 'done'; title?: string; sessionId?: string }
  | { type: 'confirm'; command: string; sessionId?: string }
  | { type: 'plan_confirm'; planTitle: string; sessionId?: string }
  | { type: 'ask_user'; question: string; sessionId?: string }
  | { type: 'error'; message: string; sessionId?: string }

// ── Copy ─────────────────────────────────────────────────────────────

function getCopy(event: NotifyEvent): { title: string; body: string } {
  switch (event.type) {
    case 'done':
      return {
        title: 'Task completed',
        body: event.title ? `${event.title}` : 'Anton finished working.',
      }
    case 'confirm':
      return {
        title: 'Approval needed',
        body: `Anton wants to run: ${truncate(event.command, 80)}`,
      }
    case 'plan_confirm':
      return {
        title: 'Plan ready for review',
        body: truncate(event.planTitle, 100),
      }
    case 'ask_user':
      return {
        title: 'Anton has a question',
        body: truncate(event.question, 100),
      }
    case 'error':
      return {
        title: 'Something went wrong',
        body: truncate(event.message, 100),
      }
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

// ── Tauri detection ──────────────────────────────────────────────────

const isTauri = !!(window as unknown as { __TAURI__?: unknown }).__TAURI__

// ── Cached Tauri API references ──────────────────────────────────────

let tauriSendNotification: ((options: { title: string; body: string }) => void) | null = null
let tauriGetCurrentWindow:
  | (() => {
      isFocused: () => Promise<boolean>
      requestUserAttention: (type: number) => Promise<void>
      setFocus: () => Promise<void>
    })
  | null = null

// ── Permission state ─────────────────────────────────────────────────

let permissionGranted = false

// ── Click-to-navigate state ──────────────────────────────────────────
// When a notification fires, we store the sessionId + timestamp.
// On window refocus (within 60s), we navigate to that session.

let pendingNavigationSessionId: string | null = null
let pendingNavigationTs = 0
const NAVIGATE_WINDOW_MS = 60_000

/** Called by the app to register a navigation callback. */
let onNavigateToSession: ((sessionId: string) => void) | null = null

export function setNavigationHandler(handler: (sessionId: string) => void) {
  onNavigateToSession = handler
}

// ── Throttle state ───────────────────────────────────────────────────
// If multiple notifications fire within THROTTLE_WINDOW_MS, group them.

const THROTTLE_WINDOW_MS = 3_000
let throttleTimer: ReturnType<typeof setTimeout> | null = null
const pendingEvents: NotifyEvent[] = []
let lastFlushedAt = 0

// ── Init ─────────────────────────────────────────────────────────────

/**
 * Call once on app mount. Caches Tauri API references, requests permissions,
 * and sets up the refocus listener for click-to-navigate.
 */
export async function initNotifications(): Promise<void> {
  if (isTauri) {
    try {
      const notifModule = await import('@tauri-apps/plugin-notification')
      tauriSendNotification = notifModule.sendNotification

      // Request permission
      let granted = await notifModule.isPermissionGranted()
      if (!granted) {
        const result = await notifModule.requestPermission()
        granted = result === 'granted'
      }
      permissionGranted = granted

      const windowModule = await import('@tauri-apps/api/window')
      tauriGetCurrentWindow = windowModule.getCurrentWindow as typeof tauriGetCurrentWindow
    } catch {
      // Tauri plugin unavailable — fall through to web API
      requestWebPermission()
    }
  } else {
    requestWebPermission()
  }

  // Listen for window refocus → navigate to last notified session
  window.addEventListener('focus', handleWindowFocus)
}

function requestWebPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'granted') {
    permissionGranted = true
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((result) => {
      permissionGranted = result === 'granted'
    })
  }
}

function handleWindowFocus() {
  if (pendingNavigationSessionId && Date.now() - pendingNavigationTs < NAVIGATE_WINDOW_MS) {
    const sid = pendingNavigationSessionId
    pendingNavigationSessionId = null
    onNavigateToSession?.(sid)
  }
}

// ── Send ─────────────────────────────────────────────────────────────

/** Queue a notification. Only fires when the window is unfocused. */
export async function notify(event: NotifyEvent): Promise<void> {
  // Check focus via Tauri (accurate) or DOM (fallback)
  const focused = await isWindowFocused()
  if (focused) return

  // Track session for click-to-navigate
  if (event.sessionId) {
    pendingNavigationSessionId = event.sessionId
    pendingNavigationTs = Date.now()
  }

  // Add to throttle queue
  pendingEvents.push(event)

  // If this is the first event in the window, set a timer to flush
  if (!throttleTimer) {
    throttleTimer = setTimeout(flushNotifications, THROTTLE_WINDOW_MS)
  }

  // Fire immediately if we're outside the cooldown window (feels responsive).
  // Otherwise let the timer batch them into a grouped notification.
  if (pendingEvents.length === 1 && Date.now() - lastFlushedAt > THROTTLE_WINDOW_MS) {
    flushNotifications()
  }
}

function flushNotifications() {
  if (throttleTimer) {
    clearTimeout(throttleTimer)
    throttleTimer = null
  }

  const events = pendingEvents.splice(0)
  if (events.length === 0) return

  lastFlushedAt = Date.now()

  if (events.length === 1) {
    const { title, body } = getCopy(events[0])
    fireNotification(title, body)
  } else {
    // Group: "3 updates from Anton"
    const doneCount = events.filter((e) => e.type === 'done').length
    const attentionCount = events.filter(
      (e) => e.type === 'confirm' || e.type === 'ask_user' || e.type === 'plan_confirm',
    ).length
    const errorCount = events.filter((e) => e.type === 'error').length

    const parts: string[] = []
    if (doneCount > 0) parts.push(`${doneCount} completed`)
    if (attentionCount > 0)
      parts.push(`${attentionCount} need${attentionCount === 1 ? 's' : ''} attention`)
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`)

    fireNotification(`${events.length} updates from Anton`, parts.join(', '))
  }

  // Dock bounce
  bounceDock()
}

// ── Focus check ──────────────────────────────────────────────────────

async function isWindowFocused(): Promise<boolean> {
  if (tauriGetCurrentWindow) {
    try {
      return await tauriGetCurrentWindow().isFocused()
    } catch {
      // Fall back to DOM check
    }
  }
  return document.hasFocus()
}

// ── Transports ───────────────────────────────────────────────────────

function fireNotification(title: string, body: string) {
  if (!permissionGranted) return

  if (tauriSendNotification) {
    try {
      tauriSendNotification({ title, body })
      return
    } catch {
      // Fall through to web API
    }
  }

  // Web Notifications API fallback (also used in non-Tauri environments)
  try {
    const n = new Notification(title, { body })
    // Web API supports onclick — use it for click-to-focus
    n.onclick = () => {
      window.focus()
      handleWindowFocus()
    }
  } catch {
    // Silently ignore
  }
}

function bounceDock() {
  if (!tauriGetCurrentWindow) return
  try {
    tauriGetCurrentWindow()
      .requestUserAttention(2)
      .catch(() => {}) // Informational = single bounce
  } catch {
    // Non-critical
  }
}
