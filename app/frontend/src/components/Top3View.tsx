import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RankResponse } from '../api'
import { compact, dec, int, km, money, pct } from '../format'

const CASES: Record<string, string> = {
  multiple_low: 'We pay less',
  base: 'Base case',
  multiple_high: 'We pay more',
  oil_minus_20pct: 'Oil price 20% lower',
  oil_plus_20pct: 'Oil price 20% higher',
}

type Props = { rank: RankResponse | null; onShowOnMap: (baid: string) => void; onAskGenie: (question: string) => void }

export function Top3View({ rank, onShowOnMap, onAskGenie }: Props) {
  const top = rank?.top3.candidates ?? []
  if (!top.length) return <section className="content padded"><p className="muted">Loading…</p></section>
  const a = rank!.assumptions
  const chart = top.map(t => ({
    name: `#${t.rank} ${t.operator_name.replace(/ (LTD|INC|CORP|ULC|CORPORATION)\.?$/i, '')}`,
    Liquids: t.savings_liq / 1e6,
    Gas: t.savings_gas / 1e6,
  }))

  return (
    <section className="content padded">
      <header className="section-head">
        <div>
          <h2>Compare the top 3</h2>
          <p className="muted">The three best-scoring candidates under the current assumptions. Change assumptions on the Rank tab and this updates.</p>
        </div>
      </header>
      <details className="explain">
        <summary>How are transport savings estimated?</summary>
        <ul>
          <li>For each of the candidate's facilities we measure how far its oil, condensate and gas travel today (to where Petrinex says it actually ships) and how far the nearest suitable CNRL facility is.</li>
          <li>If CNRL is closer, the shorter haul × 2025 volume × tariff is the saving: liquids into CNRL batteries at ${dec(Number(a.liq_tariff_per_m3_km), 2)}/m³/km,
            gas into CNRL plants and gathering systems at ${dec(Number(a.gas_tariff_per_e3m3_km), 2)}/e³m³/km <em>(placeholder tariff)</em>.</li>
        </ul>
      </details>

      <div className="cards">
        {top.map(t => (
          <article key={t.operator_baid} className="card">
            <div className="card-rank">#{t.rank} · {compact(t.boe_d)} boe/d</div>
            <h3>{t.operator_name}</h3>
            <p className="verdict">
              {t.accretion >= 0 ? 'Creates' : 'Destroys'} <b>{money(Math.abs(t.accretion), 0)}</b> of value at a 15% discount rate,
              with {pct(t.share_within_25km)} of its production within 25 km of CNRL.
            </p>
            <div className="big3">
              <div><span>Value created</span><b className={t.accretion >= 0 ? 'pos' : 'neg'}>{money(t.accretion, 0)}</b></div>
              <div><span>ROCE</span><b>{pct(t.roce, 1)}</b></div>
              <div><span>Transport savings</span><b>{money(t.transport_savings, 1)}<small>/yr</small></b></div>
            </div>
            <details className="card-more">
              <summary>Details</summary>
              <div className="kv"><span>NPV @15%</span><b>{money(t.npv, 0)}</b></div>
              <div className="kv"><span>Price paid</span><b>{money(t.price_paid, 0)}</b></div>
              <div className="kv"><span>Transport savings per boe</span><b>${dec(t.savings_per_boe, 2)}</b></div>
              <div className="kv"><span>Transport savings, PV after tax</span><b>{money(t.savings_pv, 1)}</b></div>
              <div className="kv"><span>Median distance to CNRL</span><b>{km(t.median_km_to_cnrl)}</b></div>
            </details>
            <div className="card-actions">
              <button className="btn ghost" onClick={() => onShowOnMap(t.operator_baid)}>Show on map</button>
              <button className="btn ghost genie-link" onClick={() => onAskGenie(`Give me a short acquisition brief on ${t.operator_name}: production trend in 2024–2025, main facilities and how close they are to CNRL.`)}>✦ Ask Genie</button>
            </div>
          </article>
        ))}
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Transport savings per year, by product</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke="#e1e0d9" />
              <XAxis type="number" tick={{ fill: '#898781', fontSize: 11 }} tickFormatter={v => `$${v}M`} />
              <YAxis type="category" dataKey="name" width={170} tick={{ fill: '#52514e', fontSize: 12 }} />
              <Tooltip formatter={v => `$${Number(v).toFixed(2)}M`} />
              <Legend formatter={v => <span style={{ color: '#52514e' }}>{v}</span>} />
              <Bar dataKey="Liquids" stackId="s" fill="#2a78d6" stroke="#fcfcfb" strokeWidth={2} barSize={22} />
              <Bar dataKey="Gas" stackId="s" fill="#eb6834" stroke="#fcfcfb" strokeWidth={2} barSize={22} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>Value created if conditions change</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th className="left">Case</th>{top.map(t => <th key={t.operator_baid} className="right">#{t.rank} {t.operator_name.split(' ')[0]}</th>)}</tr>
              </thead>
              <tbody>
                {rank!.top3.sensitivity.map(s => (
                  <tr key={s.case} className={s.case === 'base' ? 'hl' : ''}>
                    <td>{CASES[s.case] ?? s.case}</td>
                    {top.map(t => {
                      const v = Number(s[t.operator_baid])
                      return <td key={t.operator_baid} className={`right ${v >= 0 ? 'pos' : 'neg'}`}>{money(v, 0)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small-text">
            “We pay less / more” means ${int(Number(a.price_per_flowing_boe_low))} / ${int(Number(a.price_per_flowing_boe_high))} instead
            of ${int(Number(a.price_per_flowing_boe))} per flowing boe/d{a.price_basis === 'mix' ? ' (gas and liquids prices scaled the same way)' : ''}.
          </p>
        </div>
      </div>
    </section>
  )
}
