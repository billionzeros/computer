import { Download, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceBytes } from './useWorkspaceBytes.js'

interface Props {
  sourcePath: string
  filename?: string
}

interface SheetData {
  name: string
  /** Capped slice used for the default render (up to EAGER_ROW_CAP). */
  rows: unknown[][]
  /** Complete rowset — referenced only when the user clicks "Show all". */
  fullRows: unknown[][]
  rowCount: number
  colCount: number
  /** True when `rows` was truncated and `fullRows` carries more. */
  truncated: boolean
}

const EAGER_ROW_CAP = 5000

/**
 * Renders .xlsx / .xls by parsing with SheetJS (lazy-loaded) and displaying
 * each sheet as an HTML table with a tab switcher. Formulas render as their
 * cached values (SheetJS default). Sheets >EAGER_ROW_CAP rows render the
 * cap with a "Show all rows" escape to avoid locking the main thread on
 * big workbooks.
 */
export function XlsxRenderer({ sourcePath, filename }: Props) {
  const { bytes, loading, error } = useWorkspaceBytes(sourcePath)
  const [sheets, setSheets] = useState<SheetData[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [activeSheet, setActiveSheet] = useState(0)
  const [showAllRows, setShowAllRows] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (!bytes) {
      setSheets(null)
      return
    }
    let cancelled = false
    setParsing(true)
    setParseError(null)
    ;(async () => {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: SheetJS ships as any in most setups
        const XLSX: any = await import('xlsx')
        const workbook = XLSX.read(bytes, { type: 'array' })
        const parsed: SheetData[] = []
        for (const name of workbook.SheetNames as string[]) {
          const sheet = workbook.Sheets[name]
          const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: false,
            defval: '',
            blankrows: false,
          })
          const rowCount = rows.length
          const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0)
          const truncated = rowCount > EAGER_ROW_CAP
          parsed.push({
            name,
            rows: truncated ? rows.slice(0, EAGER_ROW_CAP) : rows,
            fullRows: rows,
            rowCount,
            colCount,
            truncated,
          })
        }
        if (cancelled) return
        setSheets(parsed)
        setActiveSheet(0)
      } catch (e) {
        if (!cancelled) setParseError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setParsing(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bytes])

  const active = sheets?.[activeSheet]
  const rowsToRender = useMemo(() => {
    if (!active) return null
    if (!active.truncated) return active.rows
    return showAllRows[activeSheet] ? active.fullRows : active.rows
  }, [active, showAllRows, activeSheet])

  if (error || parseError) {
    return (
      <FailureView
        path={sourcePath}
        filename={filename}
        reason={error || parseError || 'Unknown error'}
      />
    )
  }
  if (loading || parsing || !sheets) {
    return (
      <div className="art-panel__loading">
        <Loader2 size={16} className="art-panel__spin" />
        <span>{loading ? 'Fetching spreadsheet…' : 'Parsing…'}</span>
      </div>
    )
  }
  if (sheets.length === 0) {
    return <div className="art-panel__empty">This workbook has no sheets.</div>
  }

  return (
    <div className="xlsx-renderer">
      {sheets.length > 1 && (
        <div className="xlsx-renderer__tabs" role="tablist">
          {sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === activeSheet}
              className={`xlsx-renderer__tab${i === activeSheet ? ' xlsx-renderer__tab--active' : ''}`}
              onClick={() => setActiveSheet(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {active && (
        <div className="xlsx-renderer__sheet">
          <div className="xlsx-renderer__meta">
            {active.rowCount.toLocaleString()} row{active.rowCount === 1 ? '' : 's'} ·{' '}
            {active.colCount} col{active.colCount === 1 ? '' : 's'}
            {active.truncated && !showAllRows[activeSheet] && (
              <>
                {' '}
                · showing first {EAGER_ROW_CAP.toLocaleString()}{' '}
                <button
                  type="button"
                  className="xlsx-renderer__show-all"
                  onClick={() => setShowAllRows((prev) => ({ ...prev, [activeSheet]: true }))}
                >
                  Show all
                </button>
              </>
            )}
          </div>
          <div className="xlsx-renderer__table-wrap">
            <table className="xlsx-renderer__table">
              <tbody>
                {rowsToRender?.map((row, r) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable ID
                  <tr key={r}>
                    {Array.from({ length: active.colCount }).map((_, c) => {
                      const v = row[c]
                      return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: cell position is stable within a render
                        <td key={c}>{v === null || v === undefined ? '' : String(v)}</td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function FailureView({
  path,
  filename,
  reason,
}: { path: string; filename?: string; reason: string }) {
  return (
    <div className="art-panel__failure">
      <div className="art-panel__failure-title">Couldn't render this spreadsheet.</div>
      <div className="art-panel__failure-reason">{reason}</div>
      <div className="art-panel__failure-hint">
        {filename || path.split('/').pop()} — try downloading and opening externally.
      </div>
      <div className="art-panel__failure-actions">
        <button
          type="button"
          className="art-panel__btn"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('anton:request-download', { detail: { path, filename } }),
            )
          }}
        >
          <Download size={13} strokeWidth={1.5} /> Download raw file
        </button>
      </div>
    </div>
  )
}
