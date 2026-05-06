/**
 * `browser` — Lightpanda-backed fetch / extract plus visible Chrome automation.
 * Lifted out of
 * agent.ts so the harness MCP shim can hand it to Codex / Claude Code.
 *
 * The lightweight `fetch` / `extract` operations use agent-browser's
 * Lightpanda engine and don't need callbacks. The full-browser operations (`open` / `snapshot` /
 * `click` / `fill` / `scroll` / `screenshot` / `get` / `wait` /
 * `close`) use agent-browser's Chrome engine with an Anton-owned persistent
 * profile and drive `onBrowserState` to push live state into the desktop
 * browser pane — same callback shape Pi SDK uses.
 *
 * Note on per-session scoping: agent-browser sessions are named. The default
 * visible browser uses `anton-visible`; the background Lightpanda browser uses
 * `anton-lightpanda`.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'
import { defineTool, toolResult } from './_helpers.js'
import { type BrowserCallbacks, type BrowserToolInput, executeBrowser } from './browser.js'

export function buildBrowserTool(callbacks?: BrowserCallbacks): AgentTool {
  return defineTool({
    name: 'browser',
    label: 'Browser',
    description:
      'Web browsing and browser automation. Two modes:\n' +
      '• fetch/extract — Fast Lightpanda engine for reading and extracting pages behind the scenes.\n' +
      '• open/snapshot/click/fill/scroll/screenshot/get/wait/close — Visible Chromium browser with persistent Anton cookies/profile and live stream in the desktop Browser pane. Use `open` when the user asks to visit, browse, preview localhost, scrape an app, or interact with a website.\n' +
      'For local files, use the read tool instead.',
    parameters: Type.Object({
      operation: Type.Union(
        [
          Type.Literal('fetch'),
          Type.Literal('extract'),
          Type.Literal('open'),
          Type.Literal('snapshot'),
          Type.Literal('click'),
          Type.Literal('fill'),
          Type.Literal('screenshot'),
          Type.Literal('scroll'),
          Type.Literal('get'),
          Type.Literal('wait'),
          Type.Literal('close'),
        ],
        {
          description:
            'fetch: GET page as markdown (fast, no JS). extract: CSS selector extraction. ' +
            'open: navigate real browser to URL. snapshot: get interactive elements with @refs. ' +
            'click: click element by @ref. fill: type text into @ref. screenshot: capture page. ' +
            'scroll: scroll page. get: get text/url/title. wait: wait for element/load. close: close browser.',
        },
      ),
      url: Type.Optional(Type.String({ description: 'URL for fetch/extract/open' })),
      ref: Type.Optional(Type.String({ description: 'Element ref like @e1 for click/fill/get' })),
      text: Type.Optional(Type.String({ description: 'Text for fill operation' })),
      selector: Type.Optional(Type.String({ description: 'CSS selector for extract' })),
      direction: Type.Optional(
        Type.Union([Type.Literal('up'), Type.Literal('down')], {
          description: 'Scroll direction',
        }),
      ),
      amount: Type.Optional(Type.Number({ description: 'Scroll amount in pixels' })),
      property: Type.Optional(
        Type.Union(
          [Type.Literal('text'), Type.Literal('url'), Type.Literal('title'), Type.Literal('html')],
          { description: 'Property for get operation' },
        ),
      ),
    }),
    async execute(_toolCallId, params) {
      const output = await executeBrowser(params as BrowserToolInput, callbacks)
      return toolResult(output)
    },
  })
}
