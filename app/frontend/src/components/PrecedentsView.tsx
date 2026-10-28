import type { Backtest, Precedent, RankResponse } from '../api'
import { dec, int, km, pct } from '../format'
import { DataTable, type Column } from './DataTable'

type Props = { precedents: Precedent[]; rank: RankResponse | null }

export function PrecedentsView({ precedents, rank }: Props) {
  const material = Number(rank?.assumptions.material_deal_boe_d ?? 5000)
  const cols: Column<Precedent>[] = [
    { key: 'seller_name', label: 'Seller' },
    { key: 'deal_month', label: 'CNRL from', align: 'center' },
    { key: 'facilities_transferred', label: 'Facilities', align: 'right' },
    { key: 'pre_oil_bbl_d', label: 'Oil bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'pre_gas_mmcf_d', label: 'Gas MMcf/d', align: 'right', format: v => dec(v as number, 1) },
    { key: 'pre_cond_bbl_d', label: 'Cond bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'pre_ngl_bbl_d', label: 'NGL bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'pre_boe_d', label: 'boe/d', align: 'right', format: v => <b>{int(v as number)}</b> },
    { key: 'gas_share', label: 'Gas', align: 'right', format: v => pct(v as number) },
    { key: 'pre_annual_decline', label: 'Pre-deal decline', align: 'right', format: v => pct(v as number, 0), title: 'Negative = growing before the deal' },
    { key: 'post_retention', label: 'Retention', align: 'right', format: v => pct(v as number) },
    { key: 'median_km_to_legacy', label: 'Median km to CNRL', align: 'right', format: v => km(v as number) },
    { key: 'share_within_25km', label: '≤25 km', align: 'right', format: v => pct(v as number) },
    { key: 'pre_disp_share_to_cnrl', label: 'Already shipped to CNRL', align: 'right', format: v => pct(v as number) },
  ]
  const btCols: Column<Backtest>[] = [
    { key: 'seller_name', label: 'Seller (scored as if pre-deal)' },
    { key: 'deal_month', label: 'Deal', align: 'center' },
    { key: 'rank', label: 'Rank', align: 'right', format: (v, r) => <b>#{v as number} of {r.of}</b> },
    { key: 'percentile', label: 'Percentile', align: 'right', format: v => pct(v as number) },
    { key: 'top_decile', label: 'Top decile', align: 'center', format: v => (v ? '✓ yes' : '✗ no') },
    { key: 'accretive', label: 'Accretive', align: 'center', format: v => (v ? '✓' : '—') },
    { key: 'final_score', label: 'Score', align: 'right', format: v => dec(v as number, 3) },
  ]
  const hits = rank?.backtest.filter(b => b.top_decile).length ?? 0

  return (
    <section className="content padded">
      <header className="section-head">
        <div>
          <h2>CNRL's deal precedents</h2>
          <p className="muted">
            Facilities whose reporting operator changed to CNRL (BAID 0HE9) in 2024–2025, measured over the 6 months before transfer.
            Deals of {int(material)}+ boe/d form the baseline that candidates are compared against.
          </p>
        </div>
      </header>
      <DataTable columns={cols} rows={precedents} rowKey={r => r.seller_baid} initialSort={{ key: 'pre_boe_d', desc: true }}
        highlight={r => r.pre_boe_d >= material} csvName="cnrl-deal-precedents" />

      <header className="section-head">
        <div>
          <h2>Back-test</h2>
          <p className="muted">
            Each material seller is scored with today's method against today's candidates, using a baseline built from the <em>other</em> deals
            (leave-one-out). Target: all land in the top decile. Currently {hits} of {rank?.backtest.length ?? 0} do.
            Try “price basis → gas vs liquids multiples” on the Ranking tab.
          </p>
        </div>
      </header>
      <DataTable columns={btCols} rows={rank?.backtest ?? []} rowKey={r => r.seller_name} initialSort={{ key: 'rank', desc: false }} />
    </section>
  )
}
