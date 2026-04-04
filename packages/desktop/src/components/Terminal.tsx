import { Channel } from '@anton/protocol'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as XTerm } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { connection } from '../lib/connection.js'
import { projectStore } from '../lib/store/projectStore.js'
import { uiStore } from '../lib/store/uiStore.js'
import '@xterm/xterm/css/xterm.css'

const TERMINAL_ID = 't1'

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeProjectId = projectStore((s) => s.activeProjectId)
  const projects = projectStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const workspacePathRef = useRef(activeProject?.workspacePath)

  useEffect(() => {
    if (!containerRef.current) return
    const { sendTerminalSpawn, sendTerminalData, sendTerminalResize } = uiStore.getState()

    const term = new XTerm({
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
        cursor: '#22c55e',
        cursorAccent: '#09090b',
        selectionBackground: '#27272a',
        black: '#09090b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
      fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    const { cols, rows } = term
    sendTerminalSpawn(TERMINAL_ID, cols, rows, workspacePathRef.current)

    term.onData((data) => {
      sendTerminalData(TERMINAL_ID, btoa(data))
    })

    const unsub = connection.onMessage((channel, msg) => {
      if (channel === Channel.TERMINAL && msg.type === 'pty_data' && msg.id === TERMINAL_ID) {
        try {
          term.write(atob(msg.data as string))
        } catch {
          term.write(msg.data as string)
        }
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      sendTerminalResize(TERMINAL_ID, term.cols, term.rows)
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      unsub()
      resizeObserver.disconnect()
      term.dispose()
    }
  }, [])

  return (
    <div className="terminal-shell">
      <div className="terminal-frame">
        <div className="terminal-header">
          <span className="terminal-header__title">Live Terminal</span>
          <span className="terminal-header__session">Session {TERMINAL_ID}</span>
        </div>
        <div ref={containerRef} className="terminal-viewport" />
      </div>
    </div>
  )
}
