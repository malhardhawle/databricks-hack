import { useEffect, useState, type ReactNode } from 'react'
import { api, type Candidate, type FacilityDetail, type Well } from '../api'
import { dec, int, km, money, pct } from '../format'

type Props = {
  facilityId: string
  candidates: Candidate[]
  tariffs: { liq: number; gas: number }
  selected: boolean
  onClose: () => void
  onFindNearby: (id: string) => void
  onToggleSelect: (id: string) => void
  onFocusOperator: (baid: string) => void
  selectedWells: Set<string>
  onSetWells: (ids: string[], on: boolean) => void
  onAskGenie: (question: string) => void
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="kv"><span>{label}</span><b>{value}</b></div>
}

export function FacilityDetails({ facilityId, candidates, tariffs, selected, onClose, onFindNearby, onToggleSelect,
  onFocusOperator, selectedWells, onSetWells, onAskGenie }: Props) {
  const [f, setF] = useState<FacilityDetail | null>(null)
  const [wells, setWells] = useState<Well[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setF(null)
    setWells(null)
    setError(null)
    api.facility(facilityId).then(d => { if (!stale) setF(d) }).catch(e => { if (!stale) setError(String(e)) })
    api.wells(facilityId).then(w => { if (!stale) setWells(w) }).catch(() => { if (!stale) setWells([]) })
    return () => { stale = true }
  }, [facilityId])

  const wellIds = wells?.map(w => w.well_id) ?? []
  const picked = wellIds.filter(id => selectedWells.has(id)).length

  const cand = f ? candidates.find(c => c.operator_baid === f.operator_baid) : undefined
  const savings = f ? f.liq_m3km_saved * tariffs.liq + f.gas_e3m3km_saved * tariffs.gas : 0
  const owner = f?.is_cnrl ? (f.is_acquired ? 'acquired' : 'legacy') : 'competitor'

  return (
    <aside className="map-panel details" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <div className="details-head">
        <span className={`badge ${owner}`}>
          {owner === 'competitor' ? 'Competitor' : owner === 'acquired' ? 'CNRL · acquired' : 'CNRL · legacy'}
        </span>
        <button className="btn ghost small close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!f && !error && <p className="muted">Loading…</p>}
      {f && (
        <>
          <h3>{f.facility_name ?? f.facility_id}</h3>
          <p className="muted small-text">{f.facility_id} · {f.facility_type ?? f.facility_type_code}{f.facility_subtype ? ` · ${f.facility_subtype.toLowerCase()}` : ''}</p>

          <Row label="Operator" value={f.operator_name} />
          {f.is_acquired && <Row label="Bought from" value={`${f.seller_name} (${f.deal_month})`} />}
          <Row label="Location" value={`${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`} />
          <Row label="Last reported" value={f.last_month ?? '–'} />

          <h4>Production</h4>
          <table className="mini">
            <thead><tr><th /><th>2025 avg</th><th>Oct–Dec 25</th></tr></thead>
            <tbody>
              <tr><td>Oil bbl/d</td><td>{int(f.oil_bbl_d)}</td><td>{int(f.oil_bbl_d_last3)}</td></tr>
              <tr><td>Gas MMcf/d</td><td>{dec(f.gas_mmcf_d, 2)}</td><td>{dec(f.gas_mmcf_d_last3, 2)}</td></tr>
              <tr><td>Condensate bbl/d</td><td>{int(f.cond_bbl_d)}</td><td>{int(f.cond_bbl_d_last3)}</td></tr>
              <tr><td>NGLs bbl/d</td><td>{int(f.ngl_bbl_d)}</td><td>{int(f.ngl_bbl_d_last3)}</td></tr>
              <tr className="total"><td>Total boe/d</td><td>{int(f.boe_d)}</td><td>{int(f.boe_d_last3)}</td></tr>
            </tbody>
          </table>

          <h4>Proximity to CNRL</h4>
          <Row label="Nearest CNRL asset" value={f.nearest_cnrl_name ?? f.nearest_cnrl_id ?? '> 59 km'} />
          <Row label="Distance" value={f.nearest_cnrl_km == null ? '> 59 km' : km(f.nearest_cnrl_km)} />
          {!f.is_cnrl && (
            <>
              <Row label="CNRL gas tie-in" value={km(f.gas_tie_km)} />
              <Row label="CNRL liquids tie-in" value={km(f.liq_tie_km)} />
              <Row label="Today's haul (liquids / gas)" value={`${km(f.today_km_liq)} / ${km(f.today_km_gas)}`} />
              <Row label="Already shipped to CNRL" value={pct(f.disp_share_to_cnrl)} />
              <Row label="Transport savings if acquired" value={`${money(savings, 2)}/yr`} />
            </>
          )}

          {!f.is_cnrl && (
            <>
              <h4>Operator as a candidate</h4>
              {cand ? (
                <>
                  <Row label="Rank" value={`#${cand.rank} of ${candidates.length}`} />
                  <Row label="Operator production" value={`${int(cand.boe_d)} boe/d`} />
                  <Row label="ROCE" value={pct(cand.roce, 1)} />
                  <Row label="Accretion" value={<span className={cand.accretion >= 0 ? 'pos' : 'neg'}>{money(cand.accretion, 0)}</span>} />
                  <Row label="Score" value={dec(cand.final_score, 3)} />
                </>
              ) : (
                <p className="muted small-text">Not in the ranking (below the size floor, excluded, or not producing).</p>
              )}
            </>
          )}

          <h4>Wells ({wells ? wells.length : '…'})</h4>
          {wells && wells.length > 0 ? (
            <>
              <div className="wells-tools">
                <span className="muted small-text">{picked} selected for Genie</span>
                <button className="btn ghost small" onClick={() => onSetWells(wellIds, picked < wellIds.length)}>
                  {picked < wellIds.length ? 'Select all' : 'Clear'}
                </button>
              </div>
              <div className="wells-list">
                {wells.map(w => (
                  <label key={w.well_id} className="well-row" title={`${w.first_production_month ?? '?'} to ${w.last_production_month ?? '?'} · ${w.active_months ?? 0} active months`}>
                    <input type="checkbox" checked={selectedWells.has(w.well_id)} onChange={e => onSetWells([w.well_id], e.target.checked)} />
                    <span className="well-id">{w.well_id.replace(/^ABWI/, '')}</span>
                    <span className="well-num">{dec(w.total_gas_e3m3, 0)} <small>e³m³</small></span>
                    <span className="well-num">{dec(w.total_oil_m3, 0)} <small>m³ oil</small></span>
                  </label>
                ))}
              </div>
              <p className="muted small-text">Lifetime 2024–25 totals. Ticked wells are sent to Genie as context.</p>
            </>
          ) : (
            <p className="muted small-text">{wells ? 'No wells linked to this facility in the NGL well data.' : 'Loading…'}</p>
          )}

          <div className="details-actions">
            <button className="btn primary" onClick={() => onAskGenie(
              picked
                ? `How have the ${picked} selected wells at ${f.facility_name ?? f.facility_id} performed month by month in 2025?`
                : `Summarize ${f.facility_name ?? f.facility_id}: its 2025 production trend, its top wells and how it compares with nearby facilities.`,
            )}>Ask Genie about this {picked ? 'well selection' : 'facility'}</button>
            {f.is_cnrl ? (
              <>
                <button className="btn" onClick={() => onFindNearby(f.facility_id)}>Find competitors near this asset</button>
                <button className="btn ghost" onClick={() => onToggleSelect(f.facility_id)}>{selected ? 'Remove from selection' : 'Add to selection'}</button>
              </>
            ) : (
              <button className="btn" onClick={() => onFocusOperator(f.operator_baid)}>Highlight all {f.operator_name} facilities</button>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
