import { ChevronLeft, ChevronRight, Download, Loader2, Minus, Plus, RotateCw } from 'lucide-react'
import {
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
  TextLayer,
  getDocument,
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  type FormEvent,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useWorkspaceBytes } from './useWorkspaceBytes.js'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface Props {
  sourcePath: string
  filename?: string
}

type FitMode = 'width' | 'page'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.15

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function downloadName(filename: string | undefined, sourcePath: string) {
  const name = filename || sourcePath.split('/').pop() || 'document.pdf'
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
}

export function PdfRenderer({ sourcePath, filename }: Props) {
  const { bytes, loading, error, mimeType } = useWorkspaceBytes(sourcePath)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [zoom, setZoom] = useState(1)
  const [fitMode, setFitMode] = useState<FitMode>('width')
  const [rotation, setRotation] = useState(0)
  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 })
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!bytes) {
      setObjectUrl(null)
      return
    }
    const blob = new Blob([bytes.slice().buffer], { type: mimeType || 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [bytes, mimeType])

  useEffect(() => {
    if (!bytes) {
      setPdf(null)
      setLoadError(null)
      return
    }

    let disposed = false
    let loadedPdf: PDFDocumentProxy | null = null
    setPdf(null)
    setLoadError(null)
    setCurrentPage(1)
    setPageInput('1')

    const task = getDocument({
      data: bytes.slice(),
      useSystemFonts: true,
    })

    task.promise
      .then((document) => {
        loadedPdf = document
        if (disposed) {
          void document.destroy()
          return
        }
        setPdf(document)
      })
      .catch((reason: unknown) => {
        if (!disposed) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      disposed = true
      if (loadedPdf) void loadedPdf.destroy()
      else void task.destroy()
    }
  }, [bytes])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !pdf) return

    const measure = () => {
      setViewerSize({ width: el.clientWidth, height: el.clientHeight })
    }
    measure()

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(el)
    return () => resizeObserver.disconnect()
  }, [pdf])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  const pages = useMemo(
    () => (pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : []),
    [pdf],
  )

  const goToPage = useCallback(
    (page: number) => {
      if (!pdf) return
      const nextPage = clamp(Math.round(page), 1, pdf.numPages)
      const pageEl = scrollerRef.current?.querySelector<HTMLElement>(
        `[data-pdf-page="${nextPage}"]`,
      )
      pageEl?.scrollIntoView({ block: 'start' })
      setCurrentPage(nextPage)
    },
    [pdf],
  )

  const updatePageFromScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const scrollerRect = scroller.getBoundingClientRect()
    const focusLine = scrollerRect.top + scroller.clientHeight * 0.42
    let bestPage = 1
    const pageEls = scroller.querySelectorAll<HTMLElement>('[data-pdf-page]')

    for (const pageEl of pageEls) {
      const pageNumber = Number(pageEl.dataset.pdfPage)
      if (!Number.isFinite(pageNumber)) continue
      const { top, bottom } = pageEl.getBoundingClientRect()
      if (focusLine >= top && focusLine <= bottom) bestPage = pageNumber
      else if (top <= focusLine) bestPage = pageNumber
    }

    setCurrentPage(bestPage)
  }, [])

  const handleScroll = useCallback(
    (_event: UIEvent<HTMLDivElement>) => {
      if (scrollFrameRef.current !== null) return
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        updatePageFromScroll()
      })
    },
    [updatePageFromScroll],
  )

  const submitPage = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const parsed = Number.parseInt(pageInput, 10)
      if (Number.isFinite(parsed)) goToPage(parsed)
      else setPageInput(String(currentPage))
    },
    [currentPage, goToPage, pageInput],
  )

  if (error || loadError) {
    return (
      <div className="art-panel__failure">
        <div className="art-panel__failure-title">Couldn't open this PDF.</div>
        <div className="art-panel__failure-reason">{error || loadError}</div>
        <div className="art-panel__failure-hint">{filename || sourcePath.split('/').pop()}</div>
      </div>
    )
  }

  if (loading || !bytes || !pdf) {
    return (
      <div className="art-panel__loading">
        <Loader2 size={16} className="art-panel__spin" />
        <span>Loading PDF...</span>
      </div>
    )
  }

  return (
    <div className="pdf-reader">
      <div className="pdf-reader__toolbar">
        <div className="pdf-reader__control-group" aria-label="PDF pages">
          <button
            type="button"
            className="pdf-reader__icon-btn"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            title="Previous page"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <form className="pdf-reader__page-form" onSubmit={submitPage}>
            <input
              className="pdf-reader__page-input"
              value={pageInput}
              onChange={(event) => setPageInput(event.currentTarget.value)}
              inputMode="numeric"
              aria-label="Page"
            />
            <span className="pdf-reader__page-total">/ {pdf.numPages}</span>
          </form>
          <button
            type="button"
            className="pdf-reader__icon-btn"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pdf.numPages}
            title="Next page"
            aria-label="Next page"
          >
            <ChevronRight size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="pdf-reader__control-group pdf-reader__control-group--right">
          <button
            type="button"
            className="pdf-reader__icon-btn"
            onClick={() => setZoom((value) => clamp(value - ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="pdf-reader__mode-btn"
            onClick={() => setFitMode((mode) => (mode === 'width' ? 'page' : 'width'))}
            title="Toggle fit mode"
          >
            {fitMode === 'width' ? 'Fit width' : 'Fit page'}
          </button>
          <button
            type="button"
            className="pdf-reader__icon-btn"
            onClick={() => setZoom((value) => clamp(value + ZOOM_STEP, ZOOM_MIN, ZOOM_MAX))}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="pdf-reader__icon-btn"
            onClick={() => setRotation((value) => (value + 90) % 360)}
            title="Rotate"
            aria-label="Rotate"
          >
            <RotateCw size={15} strokeWidth={1.8} />
          </button>
          {objectUrl ? (
            <a
              className="pdf-reader__icon-btn"
              href={objectUrl}
              download={downloadName(filename, sourcePath)}
              title="Download"
              aria-label="Download"
            >
              <Download size={15} strokeWidth={1.8} />
            </a>
          ) : null}
        </div>
      </div>

      <div className="pdf-reader__scroller" ref={scrollerRef} onScroll={handleScroll}>
        <div className="pdf-reader__pages">
          {pages.map((pageNumber) => (
            <PdfPageCanvas
              key={pageNumber}
              pdf={pdf}
              pageNumber={pageNumber}
              fitMode={fitMode}
              zoom={zoom}
              rotation={rotation}
              viewerSize={viewerSize}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface PdfPageCanvasProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  fitMode: FitMode
  zoom: number
  rotation: number
  viewerSize: { width: number; height: number }
}

function PdfPageCanvas({
  pdf,
  pageNumber,
  fitMode,
  zoom,
  rotation,
  viewerSize,
}: PdfPageCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const textLayerTaskRef = useRef<TextLayer | null>(null)
  const [shouldRender, setShouldRender] = useState(false)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendering' | 'ready' | 'error'>('idle')
  const [pageSize, setPageSize] = useState({ width: 612, height: 792 })

  useEffect(() => {
    const node = wrapperRef.current
    if (!node) return

    const root = node.closest('.pdf-reader__scroller')
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setShouldRender(true)
        observer.disconnect()
      },
      { root, rootMargin: '1200px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldRender) return

    let disposed = false
    setStatus('loading')
    pdf
      .getPage(pageNumber)
      .then((loadedPage) => {
        if (disposed) return
        const viewport = loadedPage.getViewport({ scale: 1, rotation })
        setPageSize({ width: viewport.width, height: viewport.height })
        setPage(loadedPage)
      })
      .catch(() => {
        if (!disposed) setStatus('error')
      })

    return () => {
      disposed = true
    }
  }, [pageNumber, pdf, rotation, shouldRender])

  useEffect(() => {
    const canvas = canvasRef.current
    const textLayerNode = textLayerRef.current
    if (!page || !canvas || !textLayerNode || viewerSize.width <= 0) return

    renderTaskRef.current?.cancel()
    textLayerTaskRef.current?.cancel()
    renderTaskRef.current = null
    textLayerTaskRef.current = null

    const unscaledViewport = page.getViewport({ scale: 1, rotation })
    const availableWidth = Math.max(280, viewerSize.width - 56)
    const availableHeight = Math.max(360, viewerSize.height - 72)
    const fitScale =
      fitMode === 'page'
        ? Math.min(
            availableWidth / unscaledViewport.width,
            availableHeight / unscaledViewport.height,
          )
        : availableWidth / unscaledViewport.width
    const scale = clamp(fitScale * zoom, 0.2, 4)
    const viewport = page.getViewport({ scale, rotation })
    const outputScale = clamp(window.devicePixelRatio || 1, 1, 2)
    const width = Math.floor(viewport.width)
    const height = Math.floor(viewport.height)

    setPageSize({ width, height })
    setStatus('rendering')

    canvas.width = Math.floor(viewport.width * outputScale)
    canvas.height = Math.floor(viewport.height * outputScale)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    textLayerNode.innerHTML = ''
    textLayerNode.style.width = `${width}px`
    textLayerNode.style.height = `${height}px`

    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      setStatus('error')
      return
    }

    const transform: [number, number, number, number, number, number] | undefined =
      outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
    const renderTask = page.render({
      canvas: null,
      canvasContext: context,
      viewport,
      transform,
      background: '#ffffff',
    })
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent({ includeMarkedContent: true }),
      container: textLayerNode,
      viewport,
    })
    renderTaskRef.current = renderTask
    textLayerTaskRef.current = textLayer

    let disposed = false
    Promise.all([renderTask.promise, textLayer.render()])
      .then(() => {
        if (!disposed) setStatus('ready')
      })
      .catch((reason: unknown) => {
        if (disposed) return
        if (reason instanceof Error && reason.name === 'RenderingCancelledException') return
        setStatus('error')
      })

    return () => {
      disposed = true
      renderTask.cancel()
      textLayer.cancel()
    }
  }, [fitMode, page, rotation, viewerSize.height, viewerSize.width, zoom])

  const isLoading = status === 'idle' || status === 'loading' || status === 'rendering'

  return (
    <div
      className="pdf-reader__page"
      data-pdf-page={pageNumber}
      ref={wrapperRef}
      style={{ width: pageSize.width, minHeight: pageSize.height }}
    >
      <canvas className="pdf-reader__canvas" ref={canvasRef} />
      <div className="pdf-reader__text-layer textLayer" ref={textLayerRef} />
      {isLoading ? (
        <div className="pdf-reader__page-status">
          <Loader2 size={14} className="art-panel__spin" />
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="pdf-reader__page-status pdf-reader__page-status--error">
          Page {pageNumber} couldn't render.
        </div>
      ) : null}
    </div>
  )
}
