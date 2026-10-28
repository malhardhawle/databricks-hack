const bad = (v: unknown): v is null | undefined => v == null || (typeof v === 'number' && !Number.isFinite(v))

export const int = (v: number | null | undefined) => (bad(v) ? '–' : Math.round(v).toLocaleString('en-US'))

export const dec = (v: number | null | undefined, d = 1) =>
  bad(v) ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

/** CAD millions, e.g. $12.3M / −$4.0M */
export const money = (v: number | null | undefined, d = 1) =>
  bad(v) ? '–' : `${v < 0 ? '−' : ''}$${(Math.abs(v) / 1e6).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}M`

export const pct = (v: number | null | undefined, d = 0) => (bad(v) ? '–' : `${(v * 100).toFixed(d)}%`)

export const km = (v: number | null | undefined) => (bad(v) ? '–' : `${v.toFixed(1)} km`)

/** Compact boe/d etc.: 1,234 / 12.3K / 1.2M */
export const compact = (v: number | null | undefined) => {
  if (bad(v)) return '–'
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}K`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return Math.round(v).toString()
}
