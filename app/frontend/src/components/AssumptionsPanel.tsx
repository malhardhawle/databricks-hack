import type { Assumption } from '../api'

const ENUMS: Record<string, { value: string; label: string }[]> = {
  price_basis: [
    { value: 'flat', label: 'Flat $/boe/d' },
    { value: 'mix', label: 'Gas vs liquids multiples' },
  ],
  decline_source: [
    { value: 'precedent', label: 'CNRL deal precedent' },
    { value: 'fitted', label: "Each operator's own fit" },
  ],
}
const ORDER = ['valuation', 'universe', 'ranking', 'price', 'costs', 'transport', 'decline', 'precedent']
const LABELS: Record<string, string> = {
  valuation: 'Valuation', universe: 'Candidate universe', ranking: 'Ranking weights', price: 'Price deck',
  costs: 'Costs', transport: 'Transport tariffs', decline: 'Decline', precedent: 'Precedent baseline',
}
const HIDDEN = new Set(['lasso_radius_km'])

type Props = {
  assumptions: Assumption[]
  overrides: Record<string, string>
  onChange: (key: string, value: string | null) => void
  onReset: () => void
}

export function AssumptionsPanel({ assumptions, overrides, onChange, onReset }: Props) {
  const groups = ORDER.map(cat => ({ cat, rows: assumptions.filter(a => a.category === cat && !HIDDEN.has(a.key)) }))
    .filter(g => g.rows.length)
  const changed = Object.keys(overrides).length

  return (
    <aside className="assumptions">
      <div className="assumptions-head">
        <h3>Assumptions</h3>
        <button className="btn ghost small" onClick={onReset} disabled={!changed}>Reset{changed ? ` (${changed})` : ''}</button>
      </div>
      <p className="muted small-text">Every number Petrinex can't provide. Edits re-rank instantly.</p>
      {groups.map(({ cat, rows }) => (
        <fieldset key={cat}>
          <legend>{LABELS[cat] ?? cat}</legend>
          {rows.map(a => {
            const value = overrides[a.key] ?? a.value
            const isChanged = a.key in overrides && overrides[a.key] !== a.value
            const set = (v: string) => onChange(a.key, v === a.value ? null : v)
            return (
              <label key={a.key} className={`assumption ${isChanged ? 'changed' : ''}`} title={a.description}>
                <span className="name">
                  {a.key.replace(/_/g, ' ')}
                  {a.source !== 'assumption' && <em className="src">{a.source}</em>}
                  {a.description.startsWith('PLACEHOLDER') && <em className="src warn">placeholder</em>}
                </span>
                {ENUMS[a.key] ? (
                  <select value={value} onChange={e => set(e.target.value)}>
                    {ENUMS[a.key].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : a.unit === 'list' ? (
                  <input type="text" value={value} onChange={e => set(e.target.value)} />
                ) : (
                  <span className="num-input">
                    <input type="number" value={value} step="any" onChange={e => set(e.target.value)} />
                    <small>{a.unit}</small>
                  </span>
                )}
              </label>
            )
          })}
        </fieldset>
      ))}
    </aside>
  )
}
