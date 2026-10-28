import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import DeckGL, { type DeckGLRef } from '@deck.gl/react'
import { ScatterplotLayer } from '@deck.gl/layers'
import { WebMercatorViewport, type MapViewState } from '@deck.gl/core'
import { Map } from 'react-map-gl/maplibre'
import { setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api, type Candidate, type Facility, type MapContext, type NearbyRequest, type NearbyResponse } from '../api'
import { compact, dec, int, km } from '../format'
import { DataTable, type Column } from './DataTable'
import { FacilityDetails } from './FacilityDetails'

// MapLibre 6 looks for its tile worker next to its own module, which bundling breaks ("Worker failed to load",
// blank basemap). Ship the self-contained worker as a build asset and point MapLibre at it explicitly.
setWorkerUrl(maplibreWorkerUrl)

// Basemap tiles are imagery only; every number on screen comes from shm_hack via Lakebase.
const BASEMAP = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
// Centred east of Alberta's middle so the control panel doesn't cover the western plays.
const INITIAL_VIEW: MapViewState = { longitude: -114.2, latitude: 54.6, zoom: 4.9, pitch: 0, bearing: 0 }
const CLICK_SLOP_PX = 4

type RGB = [number, number, number]
const COLORS: Record<'legacy' | 'acquired' | 'competitor' | 'ink' | 'top3', RGB> = {
  legacy: [42, 120, 214],
  acquired: [27, 175, 122],
  competitor: [235, 104, 52],
  ink: [11, 11, 11],
  top3: [98, 80, 214],
}
const TYPES = [
  { code: 'BT', label: 'Batteries' },
  { code: 'GS', label: 'Gathering' },
  { code: 'GP', label: 'Gas plants' },
  { code: 'IF', label: 'Injection' },
]

type Pt = [number, number]
type Drag =
  | { kind: 'lasso'; start: Pt; moved: boolean; additive: boolean }
  | { kind: 'pan'; start: Pt; view: MapViewState; moved: boolean }

function insidePolygon([x, y]: Pt, poly: Pt[]) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

const radius = (boe: number) => Math.min(10, 1.5 + Math.sqrt(Math.max(boe, 0)) / 16)

type Props = {
  facilities: Facility[]
  candidates: Candidate[]
  tariffs: { liq: number; gas: number }
  top3Baids: string[]
  focusOperator: string | null
  onFocusOperator: (baid: string | null) => void
  defaultRadius: number
  selectedWells: Set<string>
  onSetWells: (ids: string[], on: boolean) => void
  onContextChange: (ctx: MapContext) => void
  onAskGenie: (question: string) => void
}

export function MapView({ facilities, candidates, tariffs, top3Baids, focusOperator, onFocusOperator, defaultRadius,
  selectedWells, onSetWells, onContextChange, onAskGenie }: Props) {
  const deckRef = useRef<DeckGLRef>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const lassoPts = useRef<Pt[]>([]) // source of truth for the outline; `path` state only drives rendering
  const hoverFrame = useRef(0)
  const [view, setView] = useState<MapViewState>(INITIAL_VIEW)
  const [path, setPath] = useState<Pt[] | null>(null)
  const [panning, setPanning] = useState(false)
  const [hover, setHover] = useState<{ f: Facility; x: number; y: number } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [types, setTypes] = useState<Set<string>>(new Set(TYPES.map(t => t.code)))
  const [show, setShow] = useState({ legacy: true, acquired: true, competitor: true })
  const [params, setParams] = useState<Omit<NearbyRequest, 'cnrl_ids'>>({ radius_km: defaultRadius, mode: 'radius', k: 5, window: '2025' })
  const [result, setResult] = useState<NearbyResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultTab, setResultTab] = useState<'facilities' | 'operators'>('operators')

  const visible = useMemo(() => facilities.filter(f => types.has(f.facility_type_code)), [facilities, types])
  const cnrl = useMemo(
    () => visible.filter(f => f.is_cnrl && (f.is_acquired ? show.acquired : show.legacy)),
    [visible, show.acquired, show.legacy],
  )
  const competitors = useMemo(
    () => (show.competitor ? visible.filter(f => !f.is_cnrl && f.boe_d > 0) : []),
    [visible, show.competitor],
  )
  const resultIds = useMemo(() => new Set(result?.facilities.map(f => f.facility_id)), [result])
  const top3 = useMemo(() => new Set(top3Baids), [top3Baids])

  // Start framed on Alberta for whatever screen size this is, leaving room for the control panel.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el || !el.clientWidth || !el.clientHeight) return
    const fit = new WebMercatorViewport({ width: el.clientWidth, height: el.clientHeight }).fitBounds(
      [[-120.1, 48.9], [-109.9, 60.1]], { padding: { left: 300, right: 40, top: 30, bottom: 60 } })
    setView(v => ({ ...v, longitude: fit.longitude, latitude: fit.latitude, zoom: fit.zoom }))
  }, [])

  // Fly to the operator picked on the Ranking tab or in the details panel.
  useEffect(() => {
    if (!focusOperator) return
    const own = facilities.filter(f => f.operator_baid === focusOperator)
    if (!own.length) return
    const lats = own.map(f => f.lat), lons = own.map(f => f.lon)
    const span = Math.max(Math.max(...lons) - Math.min(...lons), (Math.max(...lats) - Math.min(...lats)) * 1.6, 0.2)
    setView(v => ({
      ...v,
      longitude: (Math.max(...lons) + Math.min(...lons)) / 2,
      latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
      zoom: Math.min(11, Math.log2(360 / span) - 0.3),
    }))
  }, [focusOperator, facilities])

  // Query Lakebase whenever the selection or search parameters change.
  useEffect(() => {
    if (!selected.size) {
      setResult(null)
      return
    }
    let stale = false
    const t = setTimeout(() => {
      setLoading(true)
      setError(null)
      api.nearby({ cnrl_ids: [...selected], ...params })
        .then(r => { if (!stale) setResult(r) })
        .catch(e => { if (!stale) setError(String(e)) })
        .finally(() => { if (!stale) setLoading(false) })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [selected, params])

  // Everything currently selected on the map, for Genie.
  useEffect(() => {
    const detail = detailId ? facilities.find(f => f.facility_id === detailId) : undefined
    const focusName = focusOperator ? facilities.find(f => f.operator_baid === focusOperator)?.operator_name : undefined
    onContextChange({
      cnrl_facility_ids: [...selected],
      radius_km: params.mode === 'radius' ? params.radius_km : null,
      competitor_operators: (result?.operators ?? []).map(o => ({ baid: o.operator_baid, name: o.operator_name, boe_d: o.boe_d })),
      focused_facility: detail
        ? { id: detail.facility_id, name: detail.facility_name, operator_baid: detail.operator_baid, operator_name: detail.operator_name }
        : null,
      well_ids: [...selectedWells],
      focused_operator: focusOperator && focusName ? { baid: focusOperator, name: focusName } : null,
    })
  }, [selected, params.mode, params.radius_km, result, detailId, selectedWells, focusOperator, facilities, onContextChange])

  // ---------- mouse: left-drag lasso, left-click details, right/middle/ctrl-drag pan, wheel zoom ----------

  const size = () => {
    const r = surfaceRef.current!.getBoundingClientRect()
    return { width: r.width, height: r.height }
  }
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = surfaceRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const pick = ([x, y]: Pt) =>
    (deckRef.current?.pickObject({ x, y, radius: 5, layerIds: ['cnrl', 'competitors'] })?.object as Facility | undefined) ?? null

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointers can't be captured */ }
    const p = local(e)
    setHover(null)
    if (e.button === 2 || e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
      drag.current = { kind: 'pan', start: p, view, moved: false }
      setPanning(true)
    } else if (e.button === 0) {
      drag.current = { kind: 'lasso', start: p, moved: false, additive: e.shiftKey }
      lassoPts.current = [p]
      setPath([p])
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e)
    const d = drag.current
    if (!d) {
      // Hover tooltip, at most once per frame.
      cancelAnimationFrame(hoverFrame.current)
      hoverFrame.current = requestAnimationFrame(() => {
        const f = pick(p)
        setHover(f ? { f, x: p[0], y: p[1] } : null)
      })
      return
    }
    const dx = p[0] - d.start[0], dy = p[1] - d.start[1]
    if (Math.hypot(dx, dy) > CLICK_SLOP_PX) d.moved = true
    if (d.kind === 'pan') {
      const { width, height } = size()
      const vp = new WebMercatorViewport({ ...d.view, width, height })
      const [longitude, latitude] = vp.unproject([width / 2 - dx, height / 2 - dy])
      setView({ ...d.view, longitude, latitude })
    } else {
      const pts = lassoPts.current
      const last = pts[pts.length - 1]
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 3) {
        pts.push(p)
        setPath([...pts])
      }
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (!d) return
    if (d.kind === 'lasso') {
      const poly = lassoPts.current
      lassoPts.current = []
      setPath(null)
      if (!d.moved) {
        // A click, not a drag: open the details panel for whatever is under the cursor.
        setDetailId(pick(local(e))?.facility_id ?? null)
        return
      }
      const viewport = deckRef.current?.deck?.getViewports()[0]
      if (!poly || poly.length < 3 || !viewport) return
      const hits = cnrl.filter(f => insidePolygon(viewport.project([f.lon, f.lat]) as Pt, poly)).map(f => f.facility_id)
      setSelected(prev => new Set(d.additive || e.shiftKey ? [...prev, ...hits] : hits))
    }
  }

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    // Zoom toward the cursor: keep the point under the mouse fixed.
    const { width, height } = size()
    const [x, y] = local(e)
    const zoom = Math.max(3, Math.min(14, view.zoom - e.deltaY / 400))
    const before = new WebMercatorViewport({ ...view, width, height })
    const anchor = before.unproject([x, y])
    const after = new WebMercatorViewport({ ...view, zoom, width, height })
    const [px, py] = after.project(anchor)
    const [longitude, latitude] = after.unproject([width / 2 + (px - x), height / 2 + (py - y)])
    setView({ ...view, zoom, longitude, latitude })
  }

  const toggleSelect = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // ---------- layers ----------

  const layers = [
    new ScatterplotLayer<Facility>({
      id: 'competitors',
      data: competitors,
      getPosition: f => [f.lon, f.lat],
      getRadius: f => radius(f.boe_d) + (f.facility_id === detailId ? 2 : 0),
      radiusUnits: 'pixels',
      getFillColor: f => [...COLORS.competitor, result ? (resultIds.has(f.facility_id) ? 235 : 30) : 120],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: f => (f.facility_id === detailId ? 2.5 : resultIds.has(f.facility_id) ? 1.5
        : top3.has(f.operator_baid) || f.operator_baid === focusOperator ? 2 : 0),
      getLineColor: f => (f.facility_id === detailId || f.operator_baid === focusOperator ? COLORS.ink
        : top3.has(f.operator_baid) ? COLORS.top3 : [255, 255, 255]),
      pickable: true,
      updateTriggers: {
        getRadius: [detailId],
        getFillColor: [result],
        getLineWidth: [result, top3Baids, focusOperator, detailId],
        getLineColor: [top3Baids, focusOperator, detailId],
      },
    }),
    new ScatterplotLayer<Facility>({
      id: 'cnrl',
      data: cnrl,
      getPosition: f => [f.lon, f.lat],
      getRadius: f => Math.max(3, radius(f.boe_d)) + (f.facility_id === detailId ? 2 : 0),
      radiusUnits: 'pixels',
      getFillColor: f => [...(f.is_acquired ? COLORS.acquired : COLORS.legacy), selected.has(f.facility_id) ? 255 : 190],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: f => (selected.has(f.facility_id) || f.facility_id === detailId ? 2 : 0.5),
      getLineColor: f => (selected.has(f.facility_id) || f.facility_id === detailId ? COLORS.ink : [255, 255, 255]),
      pickable: true,
      updateTriggers: { getRadius: [detailId], getFillColor: [selected], getLineWidth: [selected, detailId], getLineColor: [selected, detailId] },
    }),
  ]

  // ---------- results ----------

  const totals = useMemo(() => {
    const rows = result?.facilities ?? []
    const sum = (k: 'oil_bbl_d' | 'gas_mmcf_d' | 'ngl_bbl_d' | 'cond_bbl_d' | 'boe_d') => rows.reduce((s, r) => s + (r[k] ?? 0), 0)
    return { n: rows.length, oil: sum('oil_bbl_d'), gas: sum('gas_mmcf_d'), ngl: sum('ngl_bbl_d'), cond: sum('cond_bbl_d'), boe: sum('boe_d') }
  }, [result])

  const facilityCols: Column<NearbyResponse['facilities'][number]>[] = [
    { key: 'operator_name', label: 'Operator' },
    { key: 'facility_name', label: 'Competitor facility', format: (v, r) => (v as string) ?? r.facility_id },
    { key: 'facility_type_code', label: 'Type', align: 'center' },
    { key: 'nearest_cnrl_name', label: 'Nearest CNRL asset', format: (v, r) => (v as string) ?? r.nearest_cnrl_id },
    { key: 'km', label: 'Distance', align: 'right', format: v => km(v as number) },
    { key: 'oil_bbl_d', label: 'Oil bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'gas_mmcf_d', label: 'Gas MMcf/d', align: 'right', format: v => dec(v as number, 2) },
    { key: 'ngl_bbl_d', label: 'NGL bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'cond_bbl_d', label: 'Cond bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'boe_d', label: 'boe/d', align: 'right', format: v => int(v as number) },
  ]
  const operatorCols: Column<NearbyResponse['operators'][number]>[] = [
    { key: 'operator_name', label: 'Operator' },
    { key: 'facilities', label: 'Facilities', align: 'right' },
    { key: 'mean_km', label: 'Mean distance', align: 'right', format: v => km(v as number) },
    { key: 'oil_bbl_d', label: 'Oil bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'gas_mmcf_d', label: 'Gas MMcf/d', align: 'right', format: v => dec(v as number, 1) },
    { key: 'ngl_bbl_d', label: 'NGL bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'cond_bbl_d', label: 'Cond bbl/d', align: 'right', format: v => int(v as number) },
    { key: 'boe_d', label: 'boe/d', align: 'right', format: v => int(v as number) },
  ]

  const toggleType = (code: string) =>
    setTypes(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })

  const cursor = panning ? 'grabbing' : path ? 'crosshair' : hover ? 'pointer' : 'crosshair'

  return (
    <div className={`map-page ${selected.size ? 'has-results' : ''}`}>
      <div className="map-area">
        <DeckGL ref={deckRef} viewState={view} controller={false} layers={layers}>
          <Map mapStyle={BASEMAP} />
        </DeckGL>

        <div
          ref={surfaceRef}
          className="map-surface"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { if (!drag.current) setHover(null) }}
          onContextMenu={e => e.preventDefault()}
          onWheel={onWheel}
        >
          {path && (
            <svg className="lasso-svg">
              <polygon points={path.map(p => p.join(',')).join(' ')} />
            </svg>
          )}
          {hover && (
            <div className="hover-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              <b>{hover.f.facility_name ?? hover.f.facility_id}</b>
              <span>{hover.f.is_cnrl ? (hover.f.is_acquired ? `CNRL · bought from ${hover.f.seller_name}` : 'CNRL') : hover.f.operator_name}</span>
              <span>{int(hover.f.boe_d)} boe/d · click for details</span>
            </div>
          )}
        </div>

        <div className="map-panel controls" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
          <h3>Who produces near CNRL?</h3>
          {selected.size ? (
            <div className="selection">
              <span><strong>{int(selected.size)}</strong> CNRL asset{selected.size === 1 ? '' : 's'} selected</span>
              <button className="btn ghost small" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : (
            <p className="step-hint">Draw a loop around the <i className="dot" style={{ background: `rgb(${COLORS.legacy.join(',')})` }} /> blue CNRL assets on the map.</p>
          )}

          {params.mode === 'radius' ? (
            <label className="field">
              <span>Look within <b>{params.radius_km} km</b></span>
              <input type="range" min={5} max={100} step={5} value={params.radius_km}
                onChange={e => setParams(p => ({ ...p, radius_km: Number(e.target.value) }))} />
            </label>
          ) : (
            <label className="field">
              <span>Nearest <b>{params.k}</b> competitor facilities per asset</span>
              <input type="range" min={1} max={20} value={params.k}
                onChange={e => setParams(p => ({ ...p, k: Number(e.target.value) }))} />
            </label>
          )}

          <details className="more">
            <summary>More options</summary>
            <label className="field">
              <span>Search by</span>
              <select value={params.mode} onChange={e => setParams(p => ({ ...p, mode: e.target.value as 'radius' | 'knn' }))}>
                <option value="radius">Distance (radius)</option>
                <option value="knn">Nearest facilities to each asset</option>
              </select>
            </label>
            <label className="field">
              <span>Production period</span>
              <select value={params.window} onChange={e => setParams(p => ({ ...p, window: e.target.value as '2025' | 'last3' }))}>
                <option value="2025">2025 average</option>
                <option value="last3">Last 3 months (Oct–Dec 2025)</option>
              </select>
            </label>
            <div className="field">
              <span>Facility types shown</span>
              <div className="chips">
                {TYPES.map(t => (
                  <button key={t.code} className={`chip ${types.has(t.code) ? 'on' : ''}`} onClick={() => toggleType(t.code)}>{t.label}</button>
                ))}
              </div>
            </div>
          </details>

          <div className="legend">
            {([
              ['legacy', 'CNRL'],
              ['acquired', 'CNRL, bought 2024–25'],
              ['competitor', 'Competitors (bigger = more boe/d)'],
            ] as const).map(([k, label]) => (
              <label key={k} className="legend-item" title="Show or hide">
                <input type="checkbox" checked={show[k]} onChange={() => setShow(s => ({ ...s, [k]: !s[k] }))} />
                <i style={{ background: `rgb(${COLORS[k].join(',')})` }} />
                {label}
              </label>
            ))}
            <div className="legend-item"><span className="spacer" /><i className="ring" style={{ borderColor: `rgb(${COLORS.top3.join(',')})` }} />Top-3 acquisition candidates</div>
            {focusOperator && (
              <div className="legend-item">
                <span className="spacer" /><i className="ring" style={{ borderColor: '#0b0b0b' }} />{facilities.find(f => f.operator_baid === focusOperator)?.operator_name ?? 'Focused operator'}
                <button className="btn ghost small" onClick={() => onFocusOperator(null)}>Clear</button>
              </div>
            )}
          </div>
        </div>

        <div className="map-hint" onPointerDown={e => e.stopPropagation()}>
          <span><b>Drag</b> to lasso</span><span><b>Shift</b>+drag to add</span><span><b>Click</b> a dot for details</span>
          <span><b>Right-drag</b> to pan</span><span><b>Scroll</b> to zoom</span>
        </div>

        {detailId && (
          <FacilityDetails
            facilityId={detailId}
            candidates={candidates}
            tariffs={tariffs}
            selected={selected.has(detailId)}
            onClose={() => setDetailId(null)}
            onFindNearby={id => setSelected(new Set([id]))}
            onToggleSelect={toggleSelect}
            onFocusOperator={baid => onFocusOperator(baid)}
            selectedWells={selectedWells}
            onSetWells={onSetWells}
            onAskGenie={onAskGenie}
          />
        )}
      </div>

      {!selected.size ? (
        <div className="results-empty">
          <b>Start here:</b> draw a loop around CNRL assets on the map. You'll see every competitor facility within {params.radius_km} km,
          with its oil, gas and NGL production, grouped by operator.
          <span className="muted"> Or click any dot to see its details.</span>
        </div>
      ) : (
      <div className="results">
        <div className="results-head">
          <div className="results-title">
            <h3>
              {loading && !result ? 'Searching…' : (
                <>{int(totals.n)} competitor facilities from {int(result?.operators.length ?? 0)} operators{' '}
                  {params.mode === 'radius' ? `within ${params.radius_km} km of` : `nearest to`} your {int(selected.size)} selected CNRL asset{selected.size === 1 ? '' : 's'}</>
              )}
            </h3>
            <div className="totals">
              <span><b>{compact(totals.oil)}</b> bbl/d oil</span>
              <span><b>{dec(totals.gas, 0)}</b> MMcf/d gas</span>
              <span><b>{compact(totals.ngl)}</b> bbl/d NGLs</span>
              <span><b>{compact(totals.boe)}</b> boe/d total</span>
              <span className="muted">{params.window === '2025' ? '2025 average' : 'Oct–Dec 2025'}</span>
            </div>
          </div>
          <div className="results-actions">
            <div className="seg">
              <button className={resultTab === 'operators' ? 'on' : ''} onClick={() => setResultTab('operators')}>By operator</button>
              <button className={resultTab === 'facilities' ? 'on' : ''} onClick={() => setResultTab('facilities')}>By facility</button>
            </div>
            <button className="btn genie-btn small-btn" disabled={!result?.facilities.length}
              onClick={() => onAskGenie('Which of these nearby competitors would be the best acquisition for CNRL, and why?')}>
              ✦ Ask Genie about this
            </button>
          </div>
          {loading && result && <span className="muted">Updating…</span>}
          {error && <span className="error">{error}</span>}
        </div>
        {resultTab === 'operators' ? (
          <DataTable
            columns={operatorCols}
            rows={result?.operators ?? []}
            rowKey={r => r.operator_baid}
            initialSort={{ key: 'boe_d', desc: true }}
            highlight={r => top3.has(r.operator_baid)}
            onRowClick={r => onFocusOperator(r.operator_baid)}
            csvName="nearest-competitors-by-operator"
            empty="No producing competitor facilities in range. Try a bigger radius."
          />
        ) : (
          <DataTable
            columns={facilityCols}
            rows={result?.facilities ?? []}
            rowKey={r => r.facility_id}
            initialSort={{ key: 'km', desc: false }}
            highlight={r => top3.has(r.operator_baid)}
            onRowClick={r => setDetailId(r.facility_id)}
            csvName="nearest-competitor-facilities"
            empty="No producing competitor facilities in range. Try a bigger radius."
          />
        )}
      </div>
      )}
    </div>
  )
}
