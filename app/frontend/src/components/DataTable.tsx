import { useMemo, useState, type ReactNode } from 'react'

export type Column<T> = {
  key: keyof T & string
  label: string
  align?: 'left' | 'right' | 'center'
  format?: (value: T[keyof T], row: T) => ReactNode
  /** Plain-text value for CSV export; defaults to the raw value. */
  csv?: (row: T) => string | number
  title?: string
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  initialSort?: { key: keyof T & string; desc: boolean }
  highlight?: (row: T) => boolean
  onRowClick?: (row: T) => void
  csvName?: string
  maxRows?: number
  empty?: string
  /** Extra buttons shown in the toolbar next to Export CSV. */
  actions?: ReactNode
}

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function DataTable<T>({ columns, rows, rowKey, initialSort, highlight, onRowClick, csvName, maxRows = 500, empty, actions }: Props<T>) {
  const [sort, setSort] = useState(initialSort)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const dir = sort.desc ? -1 : 1
    return [...rows].sort((a, b) => {
      const x = a[sort.key] as unknown, y = b[sort.key] as unknown
      if (x == null) return 1
      if (y == null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
    })
  }, [rows, sort])

  const exportCsv = () => {
    const lines = [columns.map(c => csvCell(c.label)).join(',')]
    for (const r of sorted) lines.push(columns.map(c => csvCell(c.csv ? c.csv(r) : (r[c.key] as unknown))).join(','))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${csvName ?? 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const shown = sorted.slice(0, maxRows)
  return (
    <div className="table-block">
      {csvName && (
        <div className="table-tools">
          <span className="muted">
            {rows.length > maxRows ? `Showing ${maxRows.toLocaleString()} of ${rows.length.toLocaleString()} rows` : `${rows.length.toLocaleString()} rows`}
          </span>
          <span className="table-actions">
            {actions}
            <button className="btn ghost" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {columns.map(c => (
                <th
                  key={c.key}
                  className={c.align ?? 'left'}
                  title={c.title}
                  onClick={() => setSort(s => ({ key: c.key, desc: s?.key === c.key ? !s.desc : true }))}
                >
                  {c.label}
                  <span className="sort">{sort?.key === c.key ? (sort.desc ? ' ▾' : ' ▴') : ''}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr
                key={rowKey(r)}
                className={`${highlight?.(r) ? 'hl' : ''} ${onRowClick ? 'clickable' : ''}`}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map(c => (
                  <td key={c.key} className={c.align ?? 'left'}>
                    {c.format ? c.format(r[c.key], r) : String(r[c.key] ?? '–')}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={columns.length} className="empty">{empty ?? 'No rows'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
