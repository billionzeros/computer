/**
 * CodexRpcClient — JSON-RPC 2.0 client over a child process's stdio.
 *
 * The `codex app-server --listen stdio://` subprocess speaks newline-
 * delimited JSON-RPC 2.0: requests {jsonrpc,method,id,params} and
 * responses {jsonrpc,id,result?|error?} interleave with notifications
 * {jsonrpc,method,params} (no id). We match responses to outstanding
 * requests by id and route notifications to registered handlers.
 *
 * Lifecycle is owned by the caller — we do not spawn the process here.
 */

import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { type Interface as ReadlineInterface, createInterface } from 'node:readline'
import { createLogger } from '@anton/logger'

const log = createLogger('codex-rpc')

export interface PendingRequest {
  method: string
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer?: NodeJS.Timeout
}

export interface RpcError {
  code: number
  message: string
  data?: unknown
}

export class CodexRpcError extends Error {
  readonly code: number
  readonly data?: unknown
  constructor(method: string, err: RpcError) {
    super(`${method}: ${err.message} (code ${err.code})`)
    this.code = err.code
    this.data = err.data
    this.name = 'CodexRpcError'
  }
}

/** A handler registered for a specific notification method. */
export type NotificationHandler = (params: unknown) => void | Promise<void>

export interface CodexRpcClientOpts {
  /** Label used in logs; typically the session id. */
  label: string
  /** Default timeout for RPC calls, in ms. Defaults to 30_000. */
  defaultTimeoutMs?: number
}

export class CodexRpcClient extends EventEmitter {
  private readonly proc: ChildProcess
  private readonly label: string
  private readonly defaultTimeoutMs: number
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly handlers = new Map<string, Set<NotificationHandler>>()
  private readonly anyHandlers = new Set<NotificationHandler>()
  private readline: ReadlineInterface | null = null
  private closed = false

  constructor(proc: ChildProcess, opts: CodexRpcClientOpts) {
    super()
    this.proc = proc
    this.label = opts.label
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000
    this.wireStreams()
  }

  /** Send a JSON-RPC request and wait for its response. */
  async request<R = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<R> {
    if (this.closed) {
      throw new Error(`[${this.label}] codex-rpc: client closed`)
    }
    const id = this.nextId++
    const frame = JSON.stringify({ jsonrpc: '2.0', method, id, params })

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pend = this.pending.get(id)
        if (pend) {
          this.pending.delete(id)
          reject(
            new Error(
              `[${this.label}] codex-rpc: timeout (${timeoutMs ?? this.defaultTimeoutMs}ms) waiting for ${method}`,
            ),
          )
        }
      }, timeoutMs ?? this.defaultTimeoutMs)

      this.pending.set(id, {
        method,
        resolve: resolve as (r: unknown) => void,
        reject,
        timer,
      })

      if (!this.proc.stdin || this.proc.stdin.destroyed) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`[${this.label}] codex-rpc: stdin unavailable`))
        return
      }

      const ok = this.proc.stdin.write(`${frame}\n`, (err) => {
        if (err) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(err)
        }
      })
      if (!ok) {
        // Backpressure: give the drain event a moment. Rare for us
        // since frames are small, but log so we notice if it starts.
        log.warn({ label: this.label, method }, 'codex-rpc: stdin backpressure')
      }
    })
  }

  /** Send a JSON-RPC notification (no response expected). */
  notify(method: string, params: unknown): void {
    if (this.closed || !this.proc.stdin || this.proc.stdin.destroyed) return
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params })
    this.proc.stdin.write(`${frame}\n`)
  }

  /** Register a handler for a specific notification method. */
  on_(method: string, handler: NotificationHandler): () => void {
    let set = this.handlers.get(method)
    if (!set) {
      set = new Set()
      this.handlers.set(method, set)
    }
    set.add(handler)
    return () => set!.delete(handler)
  }

  /** Register a catch-all handler that sees every notification. */
  onAny(handler: NotificationHandler): () => void {
    this.anyHandlers.add(handler)
    return () => this.anyHandlers.delete(handler)
  }

  /** True once the subprocess has exited or close() has been called. */
  isClosed(): boolean {
    return this.closed
  }

  /** Stop accepting new requests; cancel outstanding ones with an error. */
  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.readline?.close()
    for (const [id, pend] of this.pending) {
      if (pend.timer) clearTimeout(pend.timer)
      pend.reject(new Error(`[${this.label}] codex-rpc: closed (${reason})`))
      this.pending.delete(id)
    }
    this.emit('closed', reason)
  }

  // ── private ───────────────────────────────────────────────────

  private wireStreams() {
    if (!this.proc.stdout) {
      this.close('no-stdout')
      return
    }
    this.readline = createInterface({
      input: this.proc.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    })
    this.readline.on('line', (line) => this.onLine(line))
    this.proc.on('exit', (code, signal) => {
      this.close(`exit(code=${code}, signal=${signal})`)
    })
    this.proc.on('error', (err) => {
      log.error({ label: this.label, err: err.message }, 'codex-rpc: process error')
      this.close(`process-error: ${err.message}`)
    })
  }

  private onLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(trimmed)
    } catch {
      log.warn({ label: this.label, snippet: trimmed.slice(0, 160) }, 'codex-rpc: non-JSON line')
      return
    }

    const idRaw = msg.id
    if (idRaw != null && typeof idRaw === 'number') {
      const pend = this.pending.get(idRaw)
      if (pend) {
        if (pend.timer) clearTimeout(pend.timer)
        this.pending.delete(idRaw)
        const err = msg.error as RpcError | undefined
        if (err) {
          pend.reject(new CodexRpcError(pend.method, err))
        } else {
          pend.resolve(msg.result)
        }
        return
      }
    }

    // No id or unmatched id → treat as notification.
    const method = typeof msg.method === 'string' ? msg.method : undefined
    if (!method) return
    this.dispatchNotification(method, msg.params)
  }

  private dispatchNotification(method: string, params: unknown) {
    const handlers = this.handlers.get(method)
    if (handlers) {
      for (const h of handlers) {
        try {
          const r = h(params)
          if (r && typeof (r as Promise<unknown>).then === 'function') {
            ;(r as Promise<unknown>).catch((err) => {
              log.warn(
                { label: this.label, method, err: (err as Error).message },
                'codex-rpc: notification handler threw',
              )
            })
          }
        } catch (err) {
          log.warn(
            { label: this.label, method, err: (err as Error).message },
            'codex-rpc: notification handler threw',
          )
        }
      }
    }
    for (const h of this.anyHandlers) {
      try {
        h(params)
      } catch (err) {
        log.warn(
          { label: this.label, method, err: (err as Error).message },
          'codex-rpc: any-handler threw',
        )
      }
    }
  }
}
