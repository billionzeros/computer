# Browser Automation — Real Browser Control + Live Viewer

## Overview

The browser tool has two modes:

1. **Lightweight fetch** (`fetch`/`extract`) — Fast content retrieval via curl + Readability. No JavaScript execution. For reading articles, docs, API responses.
2. **Full browser automation** (`open`/`snapshot`/`click`/`fill`/`screenshot`/`scroll`/`get`/`wait`/`close`) — Real Chromium browser via Playwright. For interacting with pages: clicking buttons, filling forms, navigating JS-heavy SPAs, automating workflows.

When the agent uses the real browser, the desktop UI shows a **live Browser Viewer** in the SidePanel — streaming screenshots, current URL, and an action log so the user can watch what the agent is doing.

## Why Two Modes

A real browser (Chromium) costs ~700 MB RAM and takes 2-3 seconds to launch. Most "go read this webpage" tasks don't need JavaScript execution — curl is instant and free. The tool description explicitly guides the LLM to prefer `fetch` for reading and only launch the real browser when interaction is required.

## Architecture

### Data Flow

```
User: "Go to example.com and click the sign-up button"
    ↓
LLM decides: needs interaction → uses real browser operations
    ↓
browser tool calls Playwright API (dynamic import, lazy-loaded)
    ↓
Playwright launches headless Chromium (or reuses existing session)
    ↓
After each action: screenshot + page info captured
    ↓
Session.emitBrowserState() pushes browser_state into live event stream
    ↓
Server forwards event to client via WebSocket (Channel.AI)
    ↓
Desktop store sets browserState, auto-opens Browser tab in SidePanel
    ↓
BrowserViewerContent renders: URL bar, live screenshot, action log
    ↓
LLM calls snapshot → gets interactive elements with @refs
    ↓
LLM reasons about which element to interact with
    ↓
LLM calls click/fill with @ref → Playwright acts → screenshot updates
    ↓
(repeat until task done)
    ↓
LLM calls close → browser destroyed → browser_close event → viewer cleared
```

### The Snapshot + Refs Pattern

The agent can't "see" a webpage like a human. Instead, it calls `snapshot` which:

1. Opens a CDP session to Chromium's accessibility tree (`Accessibility.getFullAXTree`)
2. Walks the tree, extracting interactive elements (links, buttons, inputs, etc.)
3. Assigns deterministic refs: `@e1`, `@e2`, `@e3`...
4. Returns a compact text representation:

```
@e1  link "Home"
@e2  link "Products"
@e3  textbox "Search"
@e4  button "Sign Up"
@e5  button "Log In"
```

The LLM reads this, decides what to do, and references elements by ref:
- `click @e4` → clicks the "Sign Up" button
- `fill @e3 "AI agents"` → types into the search box

Refs are cached in the browser session and resolved to Playwright locators (`role=button[name="Sign Up"]`) at execution time. Refs are invalidated on each new `snapshot` call.

### Browser Session Lifecycle

- **One session at a time** per agent-core process (module-level singleton)
- **Lazy launch**: Chromium only starts on first `open` call
- **Persistent across tool calls**: Browser stays alive between tool invocations within a conversation turn
- **Explicit close**: Agent calls `close` when done, or session is cleaned up on crash
- **Crash recovery**: If Chromium dies mid-session, the next tool call returns an error and clears the session

### Playwright Configuration

```typescript
chromium.launch({
  headless: true,
  args: [
    '--disable-blink-features=AutomationControlled',  // basic stealth
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',                         // Docker-friendly
  ],
})

context = browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent: '...',  // standard Chrome UA string
})
```

## Protocol

### New Message Types

```typescript
// Emitted after each mutating browser action
interface AiBrowserStateMessage {
  type: 'browser_state'
  sessionId?: string
  url: string           // current page URL
  title: string         // page title
  screenshot?: string   // base64 JPEG (quality 60, CSS-scale)
  lastAction: BrowserAction
  elementCount?: number // from last snapshot
}

// Emitted when browser is closed
interface AiBrowserCloseMessage {
  type: 'browser_close'
  sessionId?: string
}

interface BrowserAction {
  action: string   // 'open', 'click', 'fill', 'scroll', 'snapshot', etc.
  target?: string  // URL or @ref
  value?: string   // fill text, scroll direction
  timestamp: number
}
```

Both are added to the `AiMessage` union and flow through Channel.AI alongside existing events (tool_call, tool_result, artifact, tasks_update, etc.).

### Session Events

```typescript
// Added to SessionEvent union
| { type: 'browser_state'; url; title; screenshot?; lastAction; elementCount? }
| { type: 'browser_close' }
```

Follows the same pattern as `tasks_update` — emitted via `Session.emitBrowserState()` which calls `this.pushEvent(...)`.

## Tool Interface

### Operations

| Operation | Mode | Parameters | Description |
|-----------|------|-----------|-------------|
| `fetch` | Lightweight | `url` | GET page as markdown (curl + Readability, no JS) |
| `extract` | Lightweight | `url`, `selector?` | CSS selector extraction from static HTML |
| `open` | Browser | `url` | Navigate real browser to URL |
| `snapshot` | Browser | — | Get interactive elements with @refs |
| `click` | Browser | `ref` | Click element by @ref |
| `fill` | Browser | `ref`, `text` | Type text into element by @ref |
| `screenshot` | Browser | — | Capture current page as JPEG |
| `scroll` | Browser | `direction?`, `amount?` | Scroll page up/down |
| `get` | Browser | `property?`, `ref?` | Get text/url/title/html from page or element |
| `wait` | Browser | `ref?` | Wait for element visibility or network idle |
| `close` | Browser | — | Close browser, free resources |

### Callback Wiring

```
ToolCallbacks.onBrowserState → Session.emitBrowserState → pushEvent → server → client
ToolCallbacks.onBrowserClose → Session.emitBrowserClose → pushEvent → server → client
```

Wired in both `createSession()` and `resumeSession()`.

## Desktop UI

### Browser Viewer (SidePanel tab)

New tab in the SidePanel alongside Artifacts, Plan, Context:

```
+-------------------------------------+
| [Globe] https://example.com         |  URL bar (read-only)
+-------------------------------------+
|                                     |
|    [Live JPEG screenshot]           |  aspect-ratio preserved
|                                     |
+-------------------------------------+
| Activity                            |
| > Navigated to example.com    10:32 |  scrollable action log
| > Read page elements          10:32 |  auto-scrolls to bottom
| > Clicked @e4                 10:33 |  max 50 entries
+-------------------------------------+
```

- **Auto-opens** on first `browser_state` event (switches SidePanel to 'browser' tab)
- **Auto-clears** on `browser_close` event
- **Icons**: Globe (size 18, strokeWidth 1.5) per project style

### ToolCallBlock Labels

Browser operations show human-readable labels in the chat:

| Operation | Label |
|-----------|-------|
| `open` | "Navigating to example.com" |
| `click` | "Clicking @e3" |
| `fill` | "Typing in @e2" |
| `snapshot` | "Reading page elements" |
| `screenshot` | "Capturing screenshot" |
| `scroll` | "Scrolling down" |
| `fetch` | "Fetching example.com" |
| `close` | "Closing browser" |

### Store State

```typescript
browserState: {
  url: string
  title: string
  screenshot: string | null  // base64 JPEG
  actions: Array<{ action; target?; value?; timestamp }>  // last 50
  active: boolean
} | null
```

## Dependencies

- `playwright` (^1.52.0) — added to `@anton/agent-core/package.json`
- Chromium installed via `npx playwright install chromium` (one-time setup)
- No cloud dependencies — fully self-hosted

## Files

| File | Role |
|------|------|
| `packages/protocol/src/messages.ts` | BrowserAction, AiBrowserStateMessage, AiBrowserCloseMessage |
| `packages/agent-core/src/session.ts` | SessionEvent types, emitBrowserState/emitBrowserClose methods |
| `packages/agent-core/src/agent.ts` | ToolCallbacks interface, tool definition, callback wiring |
| `packages/agent-core/src/tools/browser.ts` | Tool implementation (fetch + Playwright) |
| `packages/desktop/src/lib/store.ts` | browserState, setBrowserState/clearBrowserState, message handlers |
| `packages/desktop/src/components/SidePanel.tsx` | Browser tab in PanelView |
| `packages/desktop/src/components/browser/BrowserViewerContent.tsx` | Live viewer component |
| `packages/desktop/src/index.css` | .browser-viewer styles |
| `packages/desktop/src/components/chat/ToolCallBlock.tsx` | Operation-specific labels |
| `packages/agent/prompts/system.md` | Two-mode guidance for the LLM |

## Known Limitations

- **Bot detection**: Basic stealth only (`--disable-blink-features=AutomationControlled`). CloudFlare challenges and CAPTCHAs will block the agent.
- **One browser at a time**: Module-level singleton. Sub-agents cannot share the browser session.
- **Memory**: ~700 MB while Chromium is running. Freed on `close`.
- **No auth persistence across sessions**: Browser context is created fresh each time. Future work: save/restore cookies and storage state.
- **Screenshots over WebSocket**: Base64 JPEG images add ~15-50 KB per event. Acceptable for single-viewer use, may need throttling for high-frequency actions.
