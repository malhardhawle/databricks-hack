import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, EMPTY_CONTEXT, type Assumption, type Facility, type MapContext, type Precedent, type RankResponse } from './api'
import { money, pct } from './format'
import { GeniePanel } from './components/GeniePanel'
import { MapView } from './components/MapView'
import { PrecedentsView } from './components/PrecedentsView'
import { RankingView } from './components/RankingView'
import { Top3View } from './components/Top3View'

type Tab = 'map' | 'ranking' | 'top3' | 'precedents'
// The tabs read as the decision flow: look around, rank, compare; past deals are the evidence behind the ranking.
const TABS: { id: Tab; step?: string; label: string; hint: string }[] = [
  { id: 'map', step: '1', label: 'Explore the map', hint: 'See who produces near CNRL assets' },
  { id: 'ranking', step: '2', label: 'Rank candidates', hint: 'Score every operator and tune the assumptions' },
  { id: 'top3', step: '3', label: 'Compare top 3', hint: 'Value, ROCE and transport savings side by side' },
  { id: 'precedents', label: 'Past CNRL deals', hint: 'What CNRL bought in 2024–25, and a back-test' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('map')
  const [facilities, setFacilities] = useState<Facility[] | null>(null)
  const [assumptions, setAssumptions] = useState<Assumption[]>([])
  const [precedents, setPrecedents] = useState<Precedent[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [rank, setRank] = useState<RankResponse | null>(null)
  const [rankLoading, setRankLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusOperator, setFocusOperator] = useState<string | null>(null)
  const [genieOpen, setGenieOpen] = useState(false)
  const [geniePrefill, setGeniePrefill] = useState<string | null>(null)
  const [mapContext, setMapContext] = useState<MapContext>(EMPTY_CONTEXT)
  const [selectedWells, setSelectedWells] = useState<Set<string>>(new Set())

  useEffect(() => {
    Promise.all([api.facilities(), api.assumptions(), api.precedents()])
      .then(([f, a, p]) => { setFacilities(f); setAssumptions(a); setPrecedents(p) })
      .catch(e => setError(String(e)))
  }, [])

  // Re-rank (debounced) whenever an assumption changes.
  useEffect(() => {
    let stale = false
    setRankLoading(true)
    const t = setTimeout(() => {
      api.rank(overrides)
        .then(r => { if (!stale) { setRank(r); setError(null) } })
        .catch(e => { if (!stale) setError(String(e)) })
        .finally(() => { if (!stale) setRankLoading(false) })
    }, 350)
    return () => { stale = true; clearTimeout(t) }
  }, [overrides])

  const setOverride = (key: string, value: string | null) =>
    setOverrides(prev => {
      const next = { ...prev }
      if (value === null) delete next[key]
      else next[key] = value
      return next
    })

  const setWells = useCallback((ids: string[], on: boolean) =>
    setSelectedWells(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    }), [])

  const askGenie = useCallback((question: string) => { setGeniePrefill(question); setGenieOpen(true) }, [])
  const clearPrefill = useCallback(() => setGeniePrefill(null), [])
  const showOnMap = (baid: string) => { setFocusOperator(baid); setTab('map') }
  const radius = Number(assumptions.find(a => a.key === 'lasso_radius_km')?.value ?? 25)
  const operatorNames = useMemo(() => new Map((facilities ?? []).map(f => [f.operator_baid, f.operator_name])), [facilities])
  const top = rank?.candidates[0]

  return (
    <div className={`app ${genieOpen ? 'genie-open' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <h1>CNRL Acquisition Explorer</h1>
          <span>Petrinex 2024–2025 · served from Lakebase</span>
        </div>
        <nav className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} title={t.hint}>
              {t.step && <span className="step">{t.step}</span>}{t.label}
            </button>
          ))}
        </nav>
        {top && (
          <button className="top-pick" onClick={() => setTab('top3')} title="Open the top-3 comparison">
            <span className="muted">Recommended</span>
            <b>{top.operator_name}</b>
            <span className="pill">ROCE {pct(top.roce, 0)}</span>
            <span className={`pill ${top.accretion >= 0 ? 'good' : 'bad'}`}>{money(top.accretion, 0)}</span>
          </button>
        )}
        <button className={`btn genie-btn ${genieOpen ? 'on' : ''}`} onClick={() => setGenieOpen(o => !o)}>✦ Ask Genie</button>
      </header>
      {error && <div className="banner error">{error}</div>}
      <div className="body">
        <main>
          {/* The map stays mounted so the lasso selection survives tab switches (and stays available to Genie). */}
          <div className="tab-pane" hidden={tab !== 'map'}>
            {facilities ? (
              <MapView
                facilities={facilities}
                candidates={rank?.candidates ?? []}
                tariffs={{
                  liq: Number(rank?.assumptions.liq_tariff_per_m3_km ?? 0),
                  gas: Number(rank?.assumptions.gas_tariff_per_e3m3_km ?? 0),
                }}
                top3Baids={rank?.top3.candidates.map(c => c.operator_baid) ?? []}
                focusOperator={focusOperator}
                onFocusOperator={setFocusOperator}
                defaultRadius={radius}
                selectedWells={selectedWells}
                onSetWells={setWells}
                onContextChange={setMapContext}
                onAskGenie={askGenie}
              />
            ) : <p className="loading">Loading 25,316 facilities from Lakebase…</p>}
          </div>
          {tab === 'ranking' && (
            <RankingView rank={rank} loading={rankLoading} assumptions={assumptions} overrides={overrides}
              onOverride={setOverride} onReset={() => setOverrides({})} onShowOnMap={showOnMap} operatorNames={operatorNames} />
          )}
          {tab === 'top3' && <Top3View rank={rank} onShowOnMap={showOnMap} onAskGenie={askGenie} />}
          {tab === 'precedents' && <PrecedentsView precedents={precedents} rank={rank} />}
        </main>
        <GeniePanel
          open={genieOpen}
          onClose={() => setGenieOpen(false)}
          context={mapContext}
          onClearWells={() => setSelectedWells(new Set())}
          prefill={geniePrefill}
          onPrefillUsed={clearPrefill}
        />
      </div>
    </div>
  )
}
