import { useState } from 'react'
import type { Assumption, Candidate, RankResponse } from '../api'
import { compact, dec, int, km, money, pct } from '../format'
import { AssumptionsPanel } from './AssumptionsPanel'
import { DataTable, type Column } from './DataTable'

type Props = {
  rank: RankResponse | null
  loading: boolean
  assumptions: Assumption[]
  overrides: Record<string, string>
  onOverride: (key: string, value: string | null) => void
  onReset: () => void
  onShowOnMap: (baid: string) => void
  operatorNames: Map<string, string>
}

const ScoreBar = ({ v }: { v: number }) => (
  <span className="scorebar" title={dec(v, 3)}><i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /><b>{dec(v, 2)}</b></span>
)

export function RankingView({ rank, loading, assumptions, overrides, onOverride, onReset, onShowOnMap, operatorNames }: Props) {
  const [allColumns, setAllColumns] = useState(false)
  const a = rank?.assumptions
  const b = rank?.baseline
  const cands = rank?.candidates ?? []
  const top = cands[0]
  const accretive = cands.filter(c => c.accretive).length

  const base: Column<Candidate>[] = [
    { key: 'rank', label: '#', align: 'right' },
    { key: 'operator_name', label: 'Operator', format: v => <b>{v as string}</b> },
    { key: 'boe_d', label: 'Production', align: 'right', format: v => `${int(v as number)} boe/d` },
    { key: 'roce', label: 'ROCE', align: 'right', format: v => pct(v as number, 1), title: 'Year-1 after-tax cash flow (incl. transport savings) ÷ price paid' },
    { key: 'accretion', label: 'Value created', align: 'right', title: 'NPV at 15% minus the price paid',
      format: (v, r) => <span className={r.accretive ? 'pos' : 'neg'}>{money(v as number, 0)}{r.accretive && <span className="badge-ok">accretive</span>}</span> },
    { key: 'transport_savings', label: 'Transport savings', align: 'right', format: v => `${money(v as number, 1)}/yr` },
    { key: 'median_km_to_cnrl', label: 'To CNRL', align: 'right', format: v => km(v as number), title: 'Median distance from their facilities to the nearest CNRL facility' },
    { key: 'final_score', label: 'Score', format: v => <ScoreBar v={v as number} /> },
  ]
  const extra: Column<Candidate>[] = [
    { key: 'gas_share', label: 'Gas share', align: 'right', format: v => pct(v as number) },
    { key: 'npv', label: 'NPV @15%', align: 'right', format: v => money(v as number, 0) },
    { key: 'price_paid', label: 'Price paid', align: 'right', format: v => money(v as number, 0) },
    { key: 'proximity_score', label: 'Proximity', align: 'right', format: v => dec(v as number, 2) },
    { key: 'precedent_fit', label: 'Deal fit', align: 'right', format: v => dec(v as number, 2) },
  ]
  const cols = allColumns ? [...base.slice(0, 7), ...extra, base[7]] : base

  return (
    <div className="split">
      <AssumptionsPanel assumptions={assumptions} overrides={overrides} onChange={onOverride} onReset={onReset}
        operatorNames={operatorNames}
        candidateOptions={[...cands].sort((x, y) => x.operator_name.localeCompare(y.operator_name))
          .map(c => ({ baid: c.operator_baid, name: c.operator_name }))} />
      <section className="content">
        <header className="section-head">
          <div>
            <h2>Rank acquisition candidates</h2>
            <p className="muted">Every producing operator, scored on the value it would create for CNRL, how close it sits to CNRL's assets and how much it looks like the deals CNRL has done. Click a row to see it on the map.</p>
          </div>
          {loading && <span className="muted">Updating…</span>}
        </header>

        {top && (
          <div className="tiles">
            <div className="tile emphasis">
              <div className="label">Best candidate</div>
              <div className="value">{top.operator_name}</div>
              <div className="delta">{compact(top.boe_d)} boe/d · ROCE {pct(top.roce, 1)} · {money(top.accretion, 0)} value created</div>
            </div>
            <div className="tile">
              <div className="label">Candidates</div>
              <div className="value">{int(cands.length)}</div>
              <div className="delta">{int(accretive)} create value at a 15% discount rate</div>
            </div>
            <div className="tile">
              <div className="label">Score weights</div>
              <div className="value small">{pct(Number(a?.weight_accretion))} value · {pct(Number(a?.weight_proximity))} proximity · {pct(Number(a?.weight_precedent_fit))} fit</div>
              <div className="delta">change them on the left</div>
            </div>
          </div>
        )}

        {b && (
          <details className="explain">
            <summary>How is this scored?</summary>
            <ul>
              <li><b>Value created</b> = 10 years of after-tax cash flow, discounted at {pct(Number(a?.discount_rate))}, minus the price paid
                ({a?.price_basis === 'mix'
                  ? `$${int(Number(a?.price_per_flowing_boe_gas))} per gas and $${int(Number(a?.price_per_flowing_boe_liquids))} per liquids boe/d`
                  : `$${int(Number(a?.price_per_flowing_boe))} per flowing boe/d`}).
                It's <b>accretive</b> when that is positive and ROCE beats the {pct(Number(a?.roce_hurdle))} hurdle.</li>
              <li><b>Proximity</b> rewards production within 10, 25 and 50 km of a CNRL facility.</li>
              <li><b>Fit with past deals</b> compares size, gas share and distance with CNRL's {b.deals.length} big 2024–25 deals
                ({b.deals.map(d => d.split(' ')[0]).join(', ')}): typically {compact(b.boe_d)} boe/d, {pct(b.gas_share)} gas, {km(b.median_km)} from existing CNRL assets.</li>
              <li>Production is assumed to decline {pct(b.decline, 0)} a year (those past deals were actually growing beforehand, so the floor applies) and {pct(1 - b.retention, 0)} is lost in integration, as seen after CNRL's past deals.</li>
            </ul>
          </details>
        )}
        <DataTable
          columns={cols}
          rows={cands}
          rowKey={r => r.operator_baid}
          initialSort={{ key: 'final_score', desc: true }}
          highlight={r => r.rank <= 3}
          onRowClick={r => onShowOnMap(r.operator_baid)}
          csvName="acquisition-ranking"
          actions={<button className="btn ghost" onClick={() => setAllColumns(v => !v)}>{allColumns ? 'Fewer columns' : 'More columns'}</button>}
          empty={loading ? 'Loading…' : 'No candidates match these settings. Try lowering the minimum size.'}
        />
      </section>
    </div>
  )
}
