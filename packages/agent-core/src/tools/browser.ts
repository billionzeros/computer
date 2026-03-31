import { execSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
import type { BrowserAction } from '@anton/protocol'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

export interface BrowserToolInput {
  operation:
    | 'fetch'
    | 'extract'
    | 'open'
    | 'snapshot'
    | 'click'
    | 'fill'
    | 'screenshot'
    | 'scroll'
    | 'get'
    | 'wait'
    | 'close'
  url?: string
  ref?: string
  text?: string
  selector?: string
  direction?: 'up' | 'down'
  amount?: number
  property?: 'text' | 'url' | 'title' | 'html'
}

export interface BrowserCallbacks {
  onBrowserState?: (state: {
    url: string
    title: string
    screenshot?: string
    lastAction: BrowserAction
    elementCount?: number
  }) => void
  onBrowserClose?: () => void
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

// Remove script/style/nav/footer tags
turndown.remove(['script', 'style', 'nav', 'footer', 'header', 'noscript', 'iframe'])

// ── Lightweight fetch helpers (no browser needed) ────────────────────

function fetchHtml(url: string, maxBytes = 500_000): string {
  return execSync(`curl -sL --max-time 15 --max-filesize 5000000 "${url}" | head -c ${maxBytes}`, {
    encoding: 'utf-8',
    timeout: 20_000,
  })
}

function htmlToMarkdown(html: string, _url: string): string {
  const { document } = parseHTML(html)
  const reader = new Readability(document, { charThreshold: 100 })
  const article = reader.parse()

  if (article?.content) {
    const { document: cleanDoc } = parseHTML(article.content)
    let md = turndown.turndown(cleanDoc.toString())
    if (article.title) {
      md = `# ${article.title}\n\n${md}`
    }
    return md.slice(0, 80_000)
  }

  const body = document.querySelector('body')
  if (body) {
    return turndown.turndown(body.innerHTML || body.toString()).slice(0, 80_000)
  }
  return html.slice(0, 50_000)
}

// ── Playwright browser session ───────────────────────────────────────

import type { Browser, BrowserContext, CDPSession, Page } from 'playwright'

interface BrowserSession {
  browser: Browser
  context: BrowserContext
  page: Page
  cdp: CDPSession
  /** Cached element refs from last snapshot: @e1 → Locator selector */
  refs: Map<string, string>
}

/** Single shared browser session (one at a time per agent-core process). */
let session: BrowserSession | null = null
/** Set to true during first launch if chromium needs installing — lets tool result inform the user. */
let chromiumJustInstalled = false

/** Idle timeout — auto-close browser after 5 minutes of no activity. */
const BROWSER_IDLE_TIMEOUT_MS = 5 * 60 * 1000
let idleTimer: ReturnType<typeof setTimeout> | null = null

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (session) {
      console.log('[browser] Auto-closing browser after 5 minutes idle')
      closeBrowser().catch(() => {})
    }
  }, BROWSER_IDLE_TIMEOUT_MS)
}

async function ensureBrowser(): Promise<BrowserSession> {
  if (session) {
    resetIdleTimer()
    return session
  }

  // Dynamic import — playwright is heavy, only load when needed
  const pw = await import('playwright')

  // Auto-install chromium if not found
  let browser: Browser
  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
      ],
    })
  } catch (launchErr: unknown) {
    const msg = (launchErr as Error).message || ''
    if (msg.includes("Executable doesn't exist") || msg.includes('browserType.launch')) {
      // Chromium not installed — install it async using playwright's own CLI
      console.log('[browser] Chromium not found, installing...')
      chromiumJustInstalled = true
      // Use playwright's CLI from the installed package (not npx)
      const playwrightCli = require.resolve('playwright/cli')
      await execFileAsync(process.execPath, [playwrightCli, 'install', 'chromium'], {
        timeout: 120_000,
      })
      console.log('[browser] Chromium installed successfully')
      // Retry launch after install
      browser = await pw.chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-dev-shm-usage',
        ],
      })
    } else {
      throw launchErr
    }
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Accessibility.enable')
  session = { browser, context, page, cdp, refs: new Map() }
  resetIdleTimer()
  return session
}

async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!session) return
  try {
    await session.browser.close()
  } catch {
    // Best-effort
  }
  session = null
}

/**
 * Close the browser if open. Called during server/session shutdown.
 * Safe to call multiple times or when no browser is open.
 */
export async function closeBrowserSession(): Promise<void> {
  await closeBrowser()
}

// ── Accessibility tree → refs ────────────────────────────────────────

/** CDP Accessibility.AXNode shape (subset of fields we use). */
interface CDPAXNode {
  nodeId: string
  role: { value: string }
  name?: { value: string }
  value?: { value: string }
  description?: { value: string }
  properties?: Array<{ name: string; value: { type: string; value?: unknown } }>
  childIds?: string[]
  backendDOMNodeId?: number
}

const INTERACTIVE_ROLES = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'treeitem',
])

/**
 * Get accessibility tree via CDP and extract interactive elements with refs.
 * Returns lines like: `@e1  button "Submit"`
 * Also populates the session ref map for later click/fill.
 */
async function buildRefSnapshot(s: BrowserSession): Promise<{ text: string; count: number }> {
  s.refs.clear()

  // Use CDP to get the full accessibility tree
  const { nodes } = (await s.cdp.send('Accessibility.getFullAXTree')) as {
    nodes: CDPAXNode[]
  }

  const lines: string[] = []
  let counter = 1

  for (const node of nodes) {
    const role = node.role?.value
    const name = node.name?.value
    if (!role || !name || !INTERACTIVE_ROLES.has(role)) continue

    const refId = `@e${counter++}`
    // Build a Playwright locator using getByRole
    s.refs.set(refId, `role=${role}[name="${name.replace(/"/g, '\\"')}"]`)

    let line = `${refId}  ${role} "${name}"`
    if (node.value?.value) line += ` value="${node.value.value}"`

    // Check properties for checked/disabled/expanded
    if (node.properties) {
      for (const prop of node.properties) {
        if (prop.name === 'checked' && prop.value.value !== undefined) {
          line += ` checked=${prop.value.value}`
        } else if (prop.name === 'disabled' && prop.value.value) {
          line += ' disabled'
        } else if (prop.name === 'expanded' && prop.value.value !== undefined) {
          line += ` expanded=${prop.value.value}`
        }
      }
    }

    lines.push(line)
  }

  const text = lines.length > 0 ? lines.join('\n') : '(no interactive elements found)'
  return { text, count: s.refs.size }
}

// ── State emission ───────────────────────────────────────────────────

function makeAction(action: string, target?: string, value?: string): BrowserAction {
  return { action, target, value, timestamp: Date.now() }
}

async function emitState(
  action: BrowserAction,
  callbacks?: BrowserCallbacks,
  elementCount?: number,
) {
  if (!callbacks?.onBrowserState || !session) return
  try {
    const url = session.page.url()
    const title = await session.page.title()
    // Capture JPEG screenshot, base64 encoded, max 800px wide for efficiency
    const screenshotBuf = await session.page.screenshot({
      type: 'jpeg',
      quality: 60,
      scale: 'css',
    })
    const screenshot = screenshotBuf.toString('base64')
    callbacks.onBrowserState({ url, title, screenshot, lastAction: action, elementCount })
  } catch {
    // Best-effort — don't fail the tool call
  }
}

// ── Ref resolution ───────────────────────────────────────────────────

function resolveRef(ref: string): string {
  if (!session) throw new Error('Browser not open. Use operation: "open" first.')
  const selector = session.refs.get(ref)
  if (!selector) {
    throw new Error(
      `Unknown ref "${ref}". Run operation: "snapshot" first to see available elements.`,
    )
  }
  return selector
}

// ── Main tool executor ───────────────────────────────────────────────

/**
 * Browser tool: fetch web pages (lightweight) or automate real browser (Playwright).
 *
 * fetch/extract: Fast, no JS, uses curl + Readability.
 * open/snapshot/click/fill/screenshot/scroll/get/wait/close: Full browser via Playwright.
 */
export async function executeBrowser(
  input: BrowserToolInput,
  callbacks?: BrowserCallbacks,
): Promise<string> {
  const { operation, url, ref, text, selector, direction, amount, property } = input

  try {
    switch (operation) {
      // ── Lightweight (no real browser) ──────────────────────────────

      case 'fetch': {
        if (!url) return 'Error: url is required for fetch'
        const html = fetchHtml(url)
        if (!html) return '(empty response)'
        return htmlToMarkdown(html, url)
      }

      case 'extract': {
        if (!url) return 'Error: url is required for extract'
        const html = fetchHtml(url, 200_000)

        if (selector) {
          const { document } = parseHTML(html)
          const elements = document.querySelectorAll(selector)
          if (elements.length === 0) {
            return `No elements found matching selector: ${selector}`
          }

          const extracted = Array.from(elements)
            .map((el: Element) => turndown.turndown(el.innerHTML || el.textContent || ''))
            .join('\n\n---\n\n')

          return `Extracted ${elements.length} element(s) from ${url} (selector: ${selector}):\n\n${extracted.slice(0, 50_000)}`
        }

        return htmlToMarkdown(html, url)
      }

      // ── Full browser automation (Playwright) ──────────────────────

      case 'open': {
        if (!url) return 'Error: url is required for open'
        const s = await ensureBrowser()
        const wasInstalled = chromiumJustInstalled
        chromiumJustInstalled = false
        await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        // Wait a bit for JS to settle
        await s.page.waitForLoadState('networkidle').catch(() => {})
        const action = makeAction('open', url)
        await emitState(action, callbacks)
        const prefix = wasInstalled ? '(Chromium was auto-installed on first use.) ' : ''
        return `${prefix}Opened ${url} — title: "${await s.page.title()}"`
      }

      case 'snapshot': {
        if (!session) return 'Error: Browser not open. Use operation: "open" first.'
        const { text: snapText, count: snapCount } = await buildRefSnapshot(session)
        await emitState(makeAction('snapshot'), callbacks, snapCount)
        return `${snapCount} interactive elements:\n\n${snapText}`
      }

      case 'click': {
        if (!ref) return 'Error: ref is required for click (e.g. @e1)'
        const sel = resolveRef(ref)
        await session!.page.locator(sel).first().click({ timeout: 10_000 })
        // Wait for navigation or network activity to settle
        await session!.page.waitForLoadState('networkidle').catch(() => {})
        await emitState(makeAction('click', ref), callbacks)
        return `Clicked ${ref}`
      }

      case 'fill': {
        if (!ref) return 'Error: ref is required for fill'
        if (text === undefined) return 'Error: text is required for fill'
        const sel = resolveRef(ref)
        await session!.page.locator(sel).first().fill(text, { timeout: 10_000 })
        await emitState(makeAction('fill', ref, text), callbacks)
        return `Filled ${ref} with "${text}"`
      }

      case 'screenshot': {
        if (!session) return 'Error: Browser not open. Use operation: "open" first.'
        const buf = await session.page.screenshot({ type: 'jpeg', quality: 70 })
        const b64 = buf.toString('base64')
        await emitState(makeAction('screenshot'), callbacks)
        return `Screenshot captured (${Math.round(b64.length / 1024)}KB base64)`
      }

      case 'scroll': {
        if (!session) return 'Error: Browser not open. Use operation: "open" first.'
        const dir = direction || 'down'
        const px = amount || 500
        const delta = dir === 'up' ? -px : px
        await session.page.mouse.wheel(0, delta)
        // Small delay for content to render
        await session.page.waitForTimeout(300)
        await emitState(makeAction('scroll', dir, String(px)), callbacks)
        return `Scrolled ${dir} ${px}px`
      }

      case 'get': {
        if (!session) return 'Error: Browser not open. Use operation: "open" first.'
        const prop = property || 'text'
        switch (prop) {
          case 'url':
            return session.page.url()
          case 'title':
            return await session.page.title()
          case 'html': {
            if (ref) {
              const sel = resolveRef(ref)
              return await session.page.locator(sel).first().innerHTML({ timeout: 5_000 })
            }
            const html = await session.page.content()
            return html.slice(0, 50_000)
          }
          default: {
            if (ref) {
              const sel = resolveRef(ref)
              return await session.page.locator(sel).first().innerText({ timeout: 5_000 })
            }
            // Full page text
            const bodyText = await session.page
              .locator('body')
              .innerText({ timeout: 5_000 })
              .catch(() => '(could not read page text)')
            return bodyText.slice(0, 50_000)
          }
        }
      }

      case 'wait': {
        if (!session) return 'Error: Browser not open. Use operation: "open" first.'
        if (ref) {
          const sel = resolveRef(ref)
          await session.page.locator(sel).first().waitFor({ state: 'visible', timeout: 30_000 })
          return `Element ${ref} is visible`
        }
        await session.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
        return 'Page loaded (network idle)'
      }

      case 'close': {
        await closeBrowser()
        callbacks?.onBrowserClose?.()
        return 'Browser closed'
      }

      default:
        return `Unknown operation: ${operation}`
    }
  } catch (err: unknown) {
    const msg = (err as Error).message || String(err)
    // If browser crashed, clean up
    if (msg.includes('Target closed') || msg.includes('Browser has been closed')) {
      session = null
    }
    return `Error: ${msg}`
  }
}
