import { useState } from 'react'
import type { Backtest, Precedent, RankResponse } from '../api'
import { dec, int, km, pct } from '../format'
import { DataTable, type Column } from './DataTable'

type Props = { precedents: Precedent[]; rank: RankResponse | null }

export function PrecedentsView({ precedents, rank }: Props) {
  const [allColumns, setAllColumns] = useState(false)
  const material = Number(rank?.assumptions.material_deal_boe_d ?? 5000)
  const base: Column<Precedent>[] = [
    { key: 'seller_name', label: 'Bought from', format: v => <b>{v as string}</b> },
    { key: 'deal_month', label: 'When', align: 'center' },
    { key: 'pre_boe_d', label: 'Production', align: 'right', format: v => `${int(v as number)} boe/d` },
    { key: 'gas_share', label: 'Gas share', align: 'right', format: v => pct(v as number) },
    { key: 'facilities_transferred', label: 'Facilities', align: 'right' },
    { key: 'median_km_to_legacy', label: 'Distance to CNRL', align: 'right', format: v => km(v as number), title: 'Median distance to the nearest existing CNRL facility' },
    { key: 'post_retention', label: 'Production kept', align: 'right', format: v => pct(v as number), title: 'Production after the deal ÷ production before' },
  ]
  const extra: Column<Precedent>[] = [
    { key: 'pre_oil_bbl_d', label: 'Oil bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'pre_gas_mmcf_d', label: 'Gas MMcf/d', align: 'right', format: v => dec(v as number, 1) },
    { key: 'pre_ngl_bbl_d', label: 'NGL bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'pre_annual_decline', label: 'Decline before deal', align: 'right', format: v => pct(v as number, 0), title: 'Negative = it was growing' },
    { key: 'share_within_25km', label: 'Within 25 km', align: 'right', format: v => pct(v as number) },
    { key: 'pre_disp_share_to_cnrl', label: 'Already shipped to CNRL', align: 'right', format: v => pct(v as number) },
  ]
  const btCols: Column<Backtest>[] = [
    { key: 'seller_name', label: 'Past deal', format: v => <b>{v as string}</b> },
    { key: 'deal_month', label: 'When', align: 'center' },
    { key: 'rank', label: 'Where our method ranks it', align: 'right', format: (v, r) => `#${v as number} of ${r.of}` },
    { key: 'top_decile', label: 'In the top 10%?', align: 'center', format: v => (v ? <span className="pos">Yes</span> : <span className="neg">No</span>) },
    { key: 'accretive', label: 'Accretive?', align: 'center', format: v => (v ? 'Yes' : 'No') },
  ]
  const bt = rank?.backtest ?? []
  const hits = bt.filter(b => b.top_decile).length
  const big = precedents.filter(p => p.pre_boe_d >= material)

  return (
    <section className="content padded">
      <header className="section-head">
        <div>
          <h2>What CNRL has bought before</h2>
          <p className="muted">
            Facilities that switched to CNRL in 2024–25, measured over the 6 months before the deal. The {big.length} deals
            of {int(material)}+ boe/d (highlighted) are the yardstick for “fit with past deals”: all were close to existing CNRL assets.
          </p>
        </div>
      </header>
      <DataTable columns={allColumns ? [...base, ...extra] : base} rows={precedents} rowKey={r => r.seller_baid}
        initialSort={{ key: 'pre_boe_d', desc: true }} highlight={r => r.pre_boe_d >= material} csvName="cnrl-deal-precedents"
        actions={<button className="btn ghost" onClick={() => setAllColumns(v => !v)}>{allColumns ? 'Fewer columns' : 'More columns'}</button>} />

      <header className="section-head">
        <div>
          <h2>Would our method have picked them?</h2>
          <p className="muted">
            Each big past deal is scored as if it were for sale today, against today's candidates (judged only against the
            <em> other</em> past deals). {bt.length ? (
              hits === bt.length ? <b>All of them land in the top 10%, so the method matches CNRL's real choices.</b>
                : <b>{hits} of {bt.length} land in the top 10% with the current assumptions.</b>
            ) : null}{' '}
            {hits < bt.length && 'Tip: on the Rank tab, set “Pricing method” to separate gas and liquids prices and check again.'}
          </p>
        </div>
      </header>
      <DataTable columns={btCols} rows={bt} rowKey={r => r.seller_name} initialSort={{ key: 'rank', desc: false }} />
    </section>
  )
}
