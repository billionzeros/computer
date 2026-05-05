import { connection } from './connection.js'

const CHUNK_BYTES = 1024 * 1024
const ACK_TIMEOUT_MS = 60_000

export type FileUploadStage = 'preparing' | 'uploading' | 'finishing'

export class UploadCanceledError extends Error {
  constructor(filename: string) {
    super(`Upload canceled for "${filename}".`)
    this.name = 'UploadCanceledError'
  }
}

export function isUploadCanceledError(err: unknown): err is UploadCanceledError {
  return (
    err instanceof UploadCanceledError || (err as Error | undefined)?.name === 'UploadCanceledError'
  )
}

export interface FileUploadProgress {
  stage: FileUploadStage
  uploadedBytes: number
  totalBytes: number
  percent: number
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    const chunk = bytes.subarray(i, i + step)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function progressFromBytes(stage: FileUploadStage, uploadedBytes: number, totalBytes: number) {
  const percent =
    totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))) : 0
  return { stage, uploadedBytes, totalBytes, percent }
}

export async function uploadFileToWorkspace(
  file: File,
  targetPath: string,
  opts: {
    id: string
    onProgress?: (progress: FileUploadProgress) => void
    signal?: AbortSignal
  },
): Promise<void> {
  if (connection.status !== 'connected') {
    throw new Error('Not connected to the agent.')
  }
  if (opts.signal?.aborted) {
    throw new UploadCanceledError(file.name)
  }

  let ackedBytes = 0
  let completed = false
  let failed: Error | null = null
  let abortSent = false
  const waiters: Array<{
    bytes: number
    resolve: () => void
    reject: (err: Error) => void
    timer: number
  }> = []

  const rejectWaiters = (err: Error) => {
    for (const waiter of waiters.splice(0)) {
      window.clearTimeout(waiter.timer)
      waiter.reject(err)
    }
  }

  const resolveWaiters = () => {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i]
      if (!waiter) continue
      if (ackedBytes < waiter.bytes && !completed) continue
      waiters.splice(i, 1)
      window.clearTimeout(waiter.timer)
      waiter.resolve()
    }
  }

  const waitForAck = (bytes: number) => {
    if (failed) return Promise.reject(failed)
    if (ackedBytes >= bytes || completed) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const err = new Error(`Upload timed out while writing "${file.name}".`)
        for (let i = waiters.length - 1; i >= 0; i -= 1) {
          if (waiters[i]?.timer === timer) waiters.splice(i, 1)
        }
        reject(err)
      }, ACK_TIMEOUT_MS)
      waiters.push({ bytes, resolve, reject, timer })
    })
  }

  const sendAbort = () => {
    if (completed || abortSent || connection.status !== 'connected') return
    abortSent = true
    connection.sendFilesystemWriteAbort(opts.id, targetPath)
  }

  let unsubscribeProgress: (() => void) | undefined
  let unsubscribeResponse: (() => void) | undefined
  let responseReject: ((err: Error) => void) | undefined
  let abortListener: (() => void) | undefined
  const cleanup = () => {
    unsubscribeProgress?.()
    unsubscribeResponse?.()
    unsubscribeProgress = undefined
    unsubscribeResponse = undefined
    if (abortListener) opts.signal?.removeEventListener('abort', abortListener)
    abortListener = undefined
  }

  const cancelUpload = () => {
    if (failed || completed) return
    const err = new UploadCanceledError(file.name)
    failed = err
    rejectWaiters(err)
    sendAbort()
    cleanup()
    responseReject?.(err)
  }

  const responsePromise = new Promise<void>((resolve, reject) => {
    responseReject = reject
    unsubscribeProgress = connection.onFilesystemWriteProgress((payload) => {
      if (payload.id !== opts.id) return
      if (failed) return
      ackedBytes = payload.receivedBytes
      opts.onProgress?.(progressFromBytes('uploading', ackedBytes, payload.sizeBytes))
      resolveWaiters()
    })

    unsubscribeResponse = connection.onFilesystemWriteResponse(
      (path, success, error, responseId) => {
        if (responseId !== opts.id) return
        cleanup()
        if (failed) {
          reject(failed)
          return
        }
        completed = success
        if (success) {
          ackedBytes = file.size
          opts.onProgress?.(progressFromBytes('finishing', file.size, file.size))
          resolveWaiters()
          resolve()
        } else {
          failed = new Error(error || `Failed to upload "${file.name}" to ${path}`)
          rejectWaiters(failed)
          reject(failed)
        }
      },
    )
  })
  responsePromise.catch(() => {})
  abortListener = cancelUpload
  opts.signal?.addEventListener('abort', abortListener, { once: true })
  if (opts.signal?.aborted) cancelUpload()

  try {
    if (failed) throw failed
    opts.onProgress?.(progressFromBytes('preparing', 0, file.size))
    connection.sendFilesystemWriteStart(opts.id, targetPath, file.size)

    if (file.size === 0) {
      await responsePromise
      return
    }

    let offset = 0
    while (offset < file.size) {
      if (failed) throw failed
      const nextOffset = Math.min(file.size, offset + CHUNK_BYTES)
      const buffer = await file.slice(offset, nextOffset).arrayBuffer()
      if (failed) throw failed
      const content = arrayBufferToBase64(buffer)
      connection.sendFilesystemWriteChunk({
        id: opts.id,
        path: targetPath,
        content,
        offset,
        sizeBytes: file.size,
        done: nextOffset >= file.size,
      })
      offset = nextOffset
      await waitForAck(offset)
    }

    await responsePromise
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    failed = error
    rejectWaiters(error)
    cleanup()
    if (!completed) sendAbort()
    throw error
  } finally {
    cleanup()
  }
}
