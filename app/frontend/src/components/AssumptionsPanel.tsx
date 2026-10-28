import type { Assumption } from '../api'

type Field = { label: string; hint?: string; kind?: 'percent' | 'number' | 'enum' | 'weight'; suffix?: string }

// Plain-language labels; anything not listed here is not shown.
const FIELDS: Record<string, Field> = {
  price_basis: { label: 'Pricing method', kind: 'enum' },
  price_per_flowing_boe: { label: 'Price per flowing boe/d', suffix: '$' },
  price_per_flowing_boe_gas: { label: 'Gas price per flowing boe/d', suffix: '$' },
  price_per_flowing_boe_liquids: { label: 'Liquids price per flowing boe/d', suffix: '$' },
  min_candidate_boe_d: { label: 'Minimum candidate size', suffix: 'boe/d' },
  weight_accretion: { label: 'Value (accretion)', kind: 'weight' },
  weight_proximity: { label: 'Proximity to CNRL', kind: 'weight' },
  weight_precedent_fit: { label: 'Fit with past CNRL deals', kind: 'weight' },
  wti_usd_bbl: { label: 'WTI', suffix: 'US$/bbl' },
  wcs_usd_bbl: { label: 'WCS (heavy oil)', suffix: 'US$/bbl' },
  light_oil_diff_usd: { label: 'Light oil discount to WTI', suffix: 'US$/bbl' },
  cond_pct_wti: { label: 'Condensate price', kind: 'percent', suffix: '% of WTI' },
  ngl_pct_wti: { label: 'NGL price', kind: 'percent', suffix: '% of WTI' },
  aeco_cad_gj: { label: 'AECO gas', suffix: 'C$/GJ' },
  gas_gj_per_e3m3: { label: 'Gas heat content', suffix: 'GJ/e³m³' },
  fx_usd_cad: { label: 'Exchange rate', suffix: 'C$ per US$' },
  royalty_rate: { label: 'Royalty rate', kind: 'percent', suffix: '%' },
  opex_gas_per_boe: { label: 'Opex, gas', suffix: 'C$/boe' },
  opex_light_per_boe: { label: 'Opex, light oil & liquids', suffix: 'C$/boe' },
  opex_heavy_per_boe: { label: 'Opex, heavy & thermal', suffix: 'C$/boe' },
  tax_rate: { label: 'Tax rate', kind: 'percent', suffix: '%' },
  liq_tariff_per_m3_km: { label: 'Liquids trucking', suffix: 'C$/m³/km' },
  gas_tariff_per_e3m3_km: { label: 'Gas gathering', suffix: 'C$/e³m³/km' },
  discount_rate: { label: 'Discount rate', kind: 'percent', suffix: '%' },
  roce_hurdle: { label: 'ROCE hurdle', kind: 'percent', suffix: '%' },
  npv_years: { label: 'Years valued', suffix: 'years' },
  price_per_flowing_boe_low: { label: 'Sensitivity: low price', suffix: '$' },
  price_per_flowing_boe_high: { label: 'Sensitivity: high price', suffix: '$' },
  decline_source: { label: 'Decline rate from', kind: 'enum' },
  min_decline: { label: 'Minimum decline', kind: 'percent', suffix: '%/yr' },
  max_decline: { label: 'Maximum decline', kind: 'percent', suffix: '%/yr' },
  material_deal_boe_d: { label: 'Past deals that count', hint: 'Deals at least this big set the "fit" baseline', suffix: 'boe/d' },
}

const ENUMS: Record<string, { value: string; label: string }[]> = {
  price_basis: [
    { value: 'flat', label: 'One price for all production' },
    { value: 'mix', label: 'Separate gas and liquids prices' },
  ],
  decline_source: [
    { value: 'precedent', label: "CNRL's past deals" },
    { value: 'fitted', label: "Each operator's own history" },
  ],
}

const ADVANCED: { title: string; keys: string[] }[] = [
  { title: 'Prices (2025 averages)', keys: ['wti_usd_bbl', 'wcs_usd_bbl', 'light_oil_diff_usd', 'cond_pct_wti', 'ngl_pct_wti', 'aeco_cad_gj', 'gas_gj_per_e3m3', 'fx_usd_cad'] },
  { title: 'Costs', keys: ['royalty_rate', 'opex_gas_per_boe', 'opex_light_per_boe', 'opex_heavy_per_boe', 'tax_rate'] },
  { title: 'Transport tariffs', keys: ['liq_tariff_per_m3_km', 'gas_tariff_per_e3m3_km'] },
  { title: 'Valuation', keys: ['discount_rate', 'roce_hurdle', 'npv_years', 'price_per_flowing_boe_low', 'price_per_flowing_boe_high'] },
  { title: 'Decline & precedents', keys: ['decline_source', 'min_decline', 'max_decline', 'material_deal_boe_d'] },
]

type Props = {
  assumptions: Assumption[]
  overrides: Record<string, string>
  onChange: (key: string, value: string | null) => void
  onReset: () => void
  operatorNames: Map<string, string>
  candidateOptions: { baid: string; name: string }[]
}

export function AssumptionsPanel({ assumptions, overrides, onChange, onReset, operatorNames, candidateOptions }: Props) {
  const byKey = new Map(assumptions.map(a => [a.key, a]))
  const value = (key: string) => overrides[key] ?? byKey.get(key)?.value ?? ''
  const set = (key: string, v: string) => onChange(key, v === byKey.get(key)?.value ? null : v)
  const changed = Object.keys(overrides).length
  const basis = value('price_basis')

  const input = (key: string) => {
    const a = byKey.get(key)
    const f = FIELDS[key]
    if (!a || !f) return null
    const isChanged = key in overrides && overrides[key] !== a.value
    let control
    if (f.kind === 'enum') {
      control = (
        <select value={value(key)} onChange={e => set(key, e.target.value)}>
          {ENUMS[key].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    } else if (f.kind === 'weight') {
      const pctValue = Math.round(Number(value(key)) * 100)
      control = (
        <span className="weight">
          <input type="range" min={0} max={100} step={5} value={pctValue} onChange={e => set(key, String(Number(e.target.value) / 100))} />
          <b>{pctValue}%</b>
        </span>
      )
    } else {
      const pct = f.kind === 'percent'
      const shown = pct ? String(+(Number(value(key)) * 100).toFixed(4)) : value(key)
      control = (
        <span className="num-input">
          <input type="number" step="any" value={shown}
            onChange={e => set(key, pct ? String(Number(e.target.value) / 100) : e.target.value)} />
          {f.suffix && <small>{f.suffix}</small>}
        </span>
      )
    }
    return (
      <label key={key} className={`assumption ${isChanged ? 'changed' : ''} ${f.kind === 'enum' || f.kind === 'weight' ? 'wide' : ''}`}
        title={a.description}>
        <span className="name">
          {f.label}
          {a.source === 'market_prices' && <em className="src">2025 data</em>}
          {a.source === 'calibrated' && <em className="src">from data</em>}
          {a.description.startsWith('PLACEHOLDER') && <em className="src warn">placeholder</em>}
        </span>
        {control}
      </label>
    )
  }

  const excluded = value('exclude_baids').split(',').map(s => s.trim()).filter(Boolean)
  const setExcluded = (ids: string[]) => set('exclude_baids', ids.join(','))
  const addable = candidateOptions.filter(c => !excluded.includes(c.baid))

  return (
    <aside className="assumptions">
      <div className="assumptions-head">
        <h3>Assumptions</h3>
        <button className="btn ghost small" onClick={onReset} disabled={!changed}>Reset{changed ? ` (${changed})` : ''}</button>
      </div>
      <p className="muted small-text">Change anything and the ranking updates instantly. Hover a field for details.</p>

      <fieldset>
        <legend>What we'd pay</legend>
        {input('price_basis')}
        {basis === 'mix' ? <>{input('price_per_flowing_boe_gas')}{input('price_per_flowing_boe_liquids')}</> : input('price_per_flowing_boe')}
      </fieldset>

      <fieldset>
        <legend>Who counts as a candidate</legend>
        {input('min_candidate_boe_d')}
        <div className="assumption wide">
          <span className="name">Excluded operators</span>
          <div className="chips">
            {excluded.map(b => (
              <span key={b} className="chip on removable">
                {operatorNames.get(b) ?? b}
                <button aria-label={`Include ${operatorNames.get(b) ?? b}`} onClick={() => setExcluded(excluded.filter(x => x !== b))}>×</button>
              </span>
            ))}
          </div>
          <select value="" onChange={e => e.target.value && setExcluded([...excluded, e.target.value])}>
            <option value="">Exclude another operator…</option>
            {addable.map(c => <option key={c.baid} value={c.baid}>{c.name}</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset>
        <legend>What matters most</legend>
        {input('weight_accretion')}
        {input('weight_proximity')}
        {input('weight_precedent_fit')}
      </fieldset>

      <details className="advanced">
        <summary>Advanced assumptions</summary>
        {ADVANCED.map(g => (
          <fieldset key={g.title}>
            <legend>{g.title}</legend>
            {g.keys.map(input)}
          </fieldset>
        ))}
      </details>
    </aside>
  )
}
