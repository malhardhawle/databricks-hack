// Typed client for the FastAPI backend. Rates: oil/cond/NGL bbl/d, gas MMcf/d, boe/d (6:1, NGLs excluded).

export type Facility = {
  facility_id: string
  facility_name: string | null
  facility_type_code: string
  operator_baid: string
  operator_name: string
  is_cnrl: boolean
  is_acquired: boolean
  seller_name: string | null
  deal_month: string | null
  lat: number
  lon: number
  oil_bbl_d: number
  gas_mmcf_d: number
  cond_bbl_d: number
  ngl_bbl_d: number
  boe_d: number
}

/** Full facility_summary row, for the details panel. */
export type FacilityDetail = Facility & {
  facility_type: string | null
  facility_subtype: string | null
  is_heavy: boolean
  last_month: string | null
  oil_bbl_d_last3: number
  gas_mmcf_d_last3: number
  cond_bbl_d_last3: number
  ngl_bbl_d_last3: number
  boe_d_last3: number
  primary_product: 'gas' | 'liquids' | 'none'
  nearest_cnrl_id: string | null
  nearest_cnrl_name: string | null
  nearest_cnrl_km: number | null
  gas_tie_km: number | null
  liq_tie_km: number | null
  today_km_liq: number | null
  today_km_gas: number | null
  disp_share_to_cnrl: number | null
  liq_m3km_saved: number
  gas_e3m3km_saved: number
}

export type NearbyFacility = {
  facility_id: string
  facility_name: string | null
  facility_type_code: string
  operator_baid: string
  operator_name: string
  nearest_cnrl_id: string
  nearest_cnrl_name: string | null
  km: number
  oil_bbl_d: number
  gas_mmcf_d: number
  cond_bbl_d: number
  ngl_bbl_d: number
  boe_d: number
  lat: number
  lon: number
}

export type OperatorRollup = {
  operator_baid: string
  operator_name: string
  facilities: number
  oil_bbl_d: number
  gas_mmcf_d: number
  cond_bbl_d: number
  ngl_bbl_d: number
  boe_d: number
  mean_km: number
}

export type NearbyResponse = { facilities: NearbyFacility[]; operators: OperatorRollup[] }

export type NearbyRequest = {
  cnrl_ids: string[]
  radius_km: number
  mode: 'radius' | 'knn'
  k: number
  window: '2025' | 'last3'
}

export type Assumption = {
  key: string
  value: string
  unit: string
  category: string
  source: string
  description: string
}

export type Precedent = {
  seller_baid: string
  seller_name: string
  deal_month: string
  facilities_transferred: number
  producing_facilities: number
  pre_oil_bbl_d: number
  pre_gas_mmcf_d: number
  pre_cond_bbl_d: number
  pre_ngl_bbl_d: number
  pre_boe_d: number
  gas_share: number
  pre_annual_decline: number
  post_retention: number
  median_km_to_legacy: number
  share_within_25km: number
  pre_disp_share_to_cnrl: number
}

export type Candidate = {
  rank: number
  operator_baid: string
  operator_name: string
  boe_d: number
  oil_bbl_d: number
  gas_mmcf_d: number
  cond_bbl_d: number
  ngl_bbl_d: number
  gas_share: number
  producing_facilities: number
  decline: number
  revenue: number
  nopat: number
  npv: number
  price_paid: number
  accretion: number
  accretion_ratio: number
  roce: number
  accretive: boolean
  proximity_score: number
  precedent_fit: number
  accretion_score: number
  final_score: number
  transport_savings: number
  median_km_to_cnrl: number
  share_within_10km: number
  share_within_25km: number
  share_within_50km: number
}

export type Backtest = {
  seller_name: string
  deal_month: string
  rank: number
  of: number
  percentile: number
  top_decile: boolean
  final_score: number
  accretive: boolean
}

export type Top3Candidate = {
  rank: number
  operator_baid: string
  operator_name: string
  boe_d: number
  transport_savings: number
  savings_liq: number
  savings_gas: number
  savings_per_boe: number
  savings_pv: number
  accretion: number
  roce: number
  npv: number
  price_paid: number
  median_km_to_cnrl: number
  share_within_25km: number
}

export type Baseline = {
  deals: string[]
  boe_d: number
  gas_share: number
  median_km: number
  share_within_25km: number
  raw_decline: number
  decline: number
  retention: number
}

export type RankResponse = {
  assumptions: Record<string, number | string | string[]>
  baseline: Baseline
  candidates: Candidate[]
  backtest: Backtest[]
  top3: {
    candidates: Top3Candidate[]
    sensitivity: ({ case: string } & Record<string, number | string>)[]
  }
}

export type Well = {
  well_id: string
  field_display_name: string | null
  formation: string | null
  active_months: number | null
  total_oil_m3: number | null
  total_gas_e3m3: number | null
  total_condensate_m3: number | null
  total_water_m3: number | null
  first_production_month: string | null
  last_production_month: string | null
}

/** What the map hands to Genie as context; mirrors genie.MapContext in the backend. */
export type MapContext = {
  cnrl_facility_ids: string[]
  radius_km: number | null
  competitor_operators: { baid: string; name: string; boe_d: number | null }[]
  focused_facility: { id: string; name: string | null; operator_baid: string; operator_name: string } | null
  well_ids: string[]
  focused_operator: { baid: string; name: string } | null
}

export const EMPTY_CONTEXT: MapContext = {
  cnrl_facility_ids: [], radius_km: null, competitor_operators: [], focused_facility: null, well_ids: [], focused_operator: null,
}

export type GenieInfo = { space_id: string | null; title: string | null; url: string | null; sample_questions: string[] }

export type GenieAnswer = {
  conversation_id: string
  message_id: string
  status: string | null
  text: string | null
  sql: string | null
  sql_description: string | null
  columns: string[]
  rows: (string | null)[][]
  row_count: number
  suggested_questions: string[]
  error: string | null
  sent: string
}

async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export const api = {
  async facilities(): Promise<Facility[]> {
    const { columns, rows } = await request<{ columns: string[]; rows: unknown[][] }>('/api/facilities')
    return rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]])) as Facility)
  },
  facility: (id: string) => request<FacilityDetail>(`/api/facility/${encodeURIComponent(id)}`),
  wells: (id: string) => request<Well[]>(`/api/facility/${encodeURIComponent(id)}/wells`),
  genieInfo: () => request<GenieInfo>('/api/genie/info'),
  genieAsk: (question: string, conversation_id: string | null, context: MapContext | null) =>
    request<GenieAnswer>('/api/genie/ask', { question, conversation_id, context }),
  nearby: (req: NearbyRequest) => request<NearbyResponse>('/api/nearby', req),
  assumptions: () => request<Assumption[]>('/api/assumptions'),
  precedents: () => request<Precedent[]>('/api/precedents'),
  rank: (overrides: Record<string, string>) => request<RankResponse>('/api/rank', { overrides }),
}
