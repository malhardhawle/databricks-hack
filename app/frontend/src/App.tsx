import { useEffect, useState } from 'react'
import { api, type Assumption, type Facility, type Precedent, type RankResponse } from './api'
import { MapView } from './components/MapView'
import { PrecedentsView } from './components/PrecedentsView'
import { RankingView } from './components/RankingView'
import { Top3View } from './components/Top3View'

type Tab = 'map' | 'ranking' | 'top3' | 'precedents'
const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: 'Map & lasso' },
  { id: 'ranking', label: 'Ranking' },
  { id: 'top3', label: 'Top 3' },
  { id: 'precedents', label: 'Precedents' },
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

  const showOnMap = (baid: string) => { setFocusOperator(baid); setTab('map') }
  const radius = Number(assumptions.find(a => a.key === 'lasso_radius_km')?.value ?? 25)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>CNRL Acquisition Explorer</h1>
          <span>Petrinex 2024–2025 · served from Lakebase</span>
        </div>
        <nav className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        {rank && (
          <div className="top-pick">
            Top pick <b>{rank.candidates[0]?.operator_name}</b>
          </div>
        )}
      </header>
      {error && <div className="banner error">{error}</div>}
      <main>
        {tab === 'map' && (facilities ? (
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
          />
        ) : <p className="loading">Loading 25,316 facilities from Lakebase…</p>)}
        {tab === 'ranking' && (
          <RankingView rank={rank} loading={rankLoading} assumptions={assumptions} overrides={overrides}
            onOverride={setOverride} onReset={() => setOverrides({})} onShowOnMap={showOnMap} />
        )}
        {tab === 'top3' && <Top3View rank={rank} onShowOnMap={showOnMap} />}
        {tab === 'precedents' && <PrecedentsView precedents={precedents} rank={rank} />}
      </main>
    </div>
  )
}
