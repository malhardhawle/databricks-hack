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
}

export function RankingView({ rank, loading, assumptions, overrides, onOverride, onReset, onShowOnMap }: Props) {
  const b = rank?.baseline
  const cols: Column<Candidate>[] = [
    { key: 'rank', label: '#', align: 'right' },
    { key: 'operator_name', label: 'Operator' },
    { key: 'boe_d', label: 'boe/d', align: 'right', format: v => int(v as number) },
    { key: 'gas_share', label: 'Gas', align: 'right', format: v => pct(v as number), title: 'Gas share of boe' },
    { key: 'roce', label: 'ROCE', align: 'right', format: v => pct(v as number, 1), title: 'Year-1 NOPAT + synergies / price paid' },
    { key: 'npv', label: 'NPV@15%', align: 'right', format: v => money(v as number, 0) },
    { key: 'price_paid', label: 'Price paid', align: 'right', format: v => money(v as number, 0) },
    { key: 'accretion', label: 'Accretion', align: 'right', format: v => money(v as number, 0), title: 'NPV@15% minus price paid' },
    { key: 'accretive', label: 'Accretive', align: 'center', format: v => (v ? '✓' : '—'), title: 'ROCE above hurdle AND accretion > 0' },
    { key: 'transport_savings', label: 'Transport $/yr', align: 'right', format: v => money(v as number, 1) },
    { key: 'median_km_to_cnrl', label: 'Median km', align: 'right', format: v => km(v as number) },
    { key: 'proximity_score', label: 'Proximity', align: 'right', format: v => dec(v as number, 2) },
    { key: 'precedent_fit', label: 'Fit', align: 'right', format: v => dec(v as number, 2), title: 'Similarity to CNRL deal baseline' },
    { key: 'final_score', label: 'Score', align: 'right', format: v => <b>{dec(v as number, 3)}</b> },
  ]

  return (
    <div className="split">
      <AssumptionsPanel assumptions={assumptions} overrides={overrides} onChange={onOverride} onReset={onReset} />
      <section className="content">
        <header className="section-head">
          <div>
            <h2>Acquisition ranking</h2>
            <p className="muted">
              Score = {pct(Number(rank?.assumptions.weight_accretion ?? 0.6))} accretion (NPV@15% ÷ price, percentile) +{' '}
              {pct(Number(rank?.assumptions.weight_proximity ?? 0.25))} proximity + {pct(Number(rank?.assumptions.weight_precedent_fit ?? 0.15))} fit to CNRL's past deals.
              Click a row to see the operator on the map.
            </p>
          </div>
          {loading && <span className="muted">Re-ranking…</span>}
        </header>

        {b && (
          <div className="tiles">
            <div className="tile"><div className="label">Candidates</div><div className="value">{int(rank?.candidates.length)}</div>
              <div className="delta">{int(rank?.candidates.filter(c => c.accretive).length)} accretive</div></div>
            <div className="tile"><div className="label">Deal baseline size</div><div className="value">{compact(b.boe_d)} <small>boe/d</small></div>
              <div className="delta">{b.deals.length} material deals</div></div>
            <div className="tile"><div className="label">Baseline gas share</div><div className="value">{pct(b.gas_share)}</div>
              <div className="delta">median {km(b.median_km)} to CNRL</div></div>
            <div className="tile"><div className="label">Decline used</div><div className="value">{pct(b.decline, 1)}<small>/yr</small></div>
              <div className="delta">precedent raw {pct(b.raw_decline, 1)} (pre-deal growth)</div></div>
            <div className="tile"><div className="label">Post-deal retention</div><div className="value">{pct(b.retention)}</div>
              <div className="delta">integration haircut</div></div>
          </div>
        )}

        <DataTable
          columns={cols}
          rows={rank?.candidates ?? []}
          rowKey={r => r.operator_baid}
          initialSort={{ key: 'final_score', desc: true }}
          highlight={r => r.rank <= 3}
          onRowClick={r => onShowOnMap(r.operator_baid)}
          csvName="acquisition-ranking"
          empty={loading ? 'Loading…' : 'No candidates match the current filters.'}
        />
      </section>
    </div>
  )
}
