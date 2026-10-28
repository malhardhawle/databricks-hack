"""SQL for the CNRL acquisition explorer. Rates: oil/cond/NGL bbl/d, gas MMcf/d, boe/d (6:1, NGLs excluded)."""
from db import query

HAVERSINE = """2 * 6371 * asin(sqrt(power(sin(radians(c.lat - s.lat) / 2), 2)
    + cos(radians(s.lat)) * cos(radians(c.lat)) * power(sin(radians(c.lon - s.lon) / 2), 2)))"""

# Production window -> column suffix. Only these two values ever reach the SQL text.
WINDOWS = {"2025": "", "last3": "_last3"}


def facilities():
    return query("""
        SELECT facility_id, facility_name, facility_type_code, operator_baid, operator_name,
               is_cnrl, is_acquired, seller_name, deal_month, lat, lon,
               oil_bbl_d, gas_mmcf_d, cond_bbl_d, ngl_bbl_d, boe_d
        FROM facility_summary
    """)


def facility(facility_id):
    """Full facility_summary row for the details panel (None if unknown)."""
    df = query("SELECT * FROM facility_summary WHERE facility_id = %(id)s", {"id": facility_id})
    return df.iloc[0] if len(df) else None


def wells_at(facility_id):
    """Wells reporting to a facility (from ngl_volumes-based wells), biggest lifetime boe first."""
    return query("""
        SELECT well_id, field_display_name, formation, active_months, total_oil_m3, total_gas_e3m3,
               total_condensate_m3, total_water_m3, first_production_month, last_production_month
        FROM wells
        WHERE facility_id = %(id)s
        ORDER BY coalesce(total_oil_m3, 0) * 6.2898 + coalesce(total_condensate_m3, 0) * 6.2898
                 + coalesce(total_gas_e3m3, 0) * 35.3147 / 6 DESC
    """, {"id": facility_id})


def operator_metrics():
    return query("SELECT * FROM operator_metrics")


def deal_precedents():
    return query("SELECT * FROM deal_precedents ORDER BY pre_boe_d DESC")


def assumptions():
    return query("SELECT * FROM assumptions ORDER BY category, key")


def nearby(cnrl_ids, radius_km=25.0, mode="radius", k=5, window="2025", limit=5000):
    """Producing competitor facilities near any of the selected CNRL facilities, each with its nearest one."""
    sfx = WINDOWS[window]
    if mode == "knn":
        # k nearest producing competitors per selected CNRL asset, searched within ~1 degree.
        pairs = f"""
            SELECT n.facility_id, s.facility_id AS cnrl_id, s.facility_name AS cnrl_name, n.km
            FROM sel s CROSS JOIN LATERAL (
                SELECT c.facility_id, {HAVERSINE} AS km
                FROM facility_summary c
                WHERE NOT c.is_cnrl AND c.boe_d{sfx} > 0
                  AND c.lat BETWEEN s.lat - 1 AND s.lat + 1 AND c.lon BETWEEN s.lon - 1.6 AND s.lon + 1.6
                ORDER BY km LIMIT %(k)s
            ) n"""
        within = "TRUE"
    else:
        pairs = f"""
            SELECT c.facility_id, s.facility_id AS cnrl_id, s.facility_name AS cnrl_name, {HAVERSINE} AS km
            FROM sel s JOIN facility_summary c
              ON NOT c.is_cnrl AND c.boe_d{sfx} > 0
             AND c.lat BETWEEN s.lat - %(r)s / 111.0 AND s.lat + %(r)s / 111.0
             AND c.lon BETWEEN s.lon - %(r)s / (111.0 * cos(radians(s.lat)))
                           AND s.lon + %(r)s / (111.0 * cos(radians(s.lat)))"""
        within = "km <= %(r)s"
    return query(f"""
        WITH sel AS (
            SELECT facility_id, facility_name, lat, lon FROM facility_summary
            WHERE is_cnrl AND facility_id = ANY(%(ids)s)
        ),
        pairs AS ({pairs}),
        best AS (
            SELECT DISTINCT ON (facility_id) facility_id, cnrl_id, cnrl_name, km
            FROM pairs WHERE {within} ORDER BY facility_id, km
        )
        SELECT c.facility_id, c.facility_name, c.facility_type_code, c.operator_baid, c.operator_name,
               b.cnrl_id AS nearest_cnrl_id, b.cnrl_name AS nearest_cnrl_name, b.km,
               c.oil_bbl_d{sfx} AS oil_bbl_d, c.gas_mmcf_d{sfx} AS gas_mmcf_d, c.cond_bbl_d{sfx} AS cond_bbl_d,
               c.ngl_bbl_d{sfx} AS ngl_bbl_d, c.boe_d{sfx} AS boe_d, c.lat, c.lon
        FROM best b JOIN facility_summary c USING (facility_id)
        ORDER BY b.km, c.boe_d{sfx} DESC
        LIMIT %(limit)s
    """, {"ids": list(cnrl_ids), "r": float(radius_km), "k": int(k), "limit": int(limit)})
