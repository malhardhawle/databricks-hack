"""Genie (AI/BI) conversations for the app's Ask panel.

Map selections travel to Genie as a "Map context" block in front of the question; the space's instructions
(genie/spec.py) tell Genie how to use those facility, operator and well IDs as filters.
"""
import json
import os
from datetime import timedelta
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

_CONFIG = Path(__file__).resolve().parent.parent / "genie_space.json"
CONFIG = json.loads(_CONFIG.read_text()) if _CONFIG.exists() else {}
SPACE_ID = os.environ.get("GENIE_SPACE_ID") or CONFIG.get("space_id")
MAX_ROWS = 200
LIMITS = {"cnrl": 40, "operators": 15, "wells": 40}
TIMEOUT = timedelta(minutes=3)


class OperatorRef(BaseModel):
    baid: str
    name: str
    boe_d: Optional[float] = None


class FacilityRef(BaseModel):
    id: str
    name: Optional[str] = None
    operator_baid: Optional[str] = None
    operator_name: Optional[str] = None


class MapContext(BaseModel):
    cnrl_facility_ids: list[str] = []
    radius_km: Optional[float] = None
    competitor_operators: list[OperatorRef] = []
    focused_facility: Optional[FacilityRef] = None
    well_ids: list[str] = []
    focused_operator: Optional[OperatorRef] = None


def _listing(ids, limit):
    shown = ", ".join(ids[:limit])
    return shown if len(ids) <= limit else f"{shown} (first {limit} of {len(ids)})"


def context_block(ctx: Optional[MapContext]) -> str:
    """Plain-text 'Map context' block, or '' when nothing is selected."""
    if ctx is None:
        return ""
    out = []
    if ctx.cnrl_facility_ids:
        out.append(f"- Selected CNRL facilities ({len(ctx.cnrl_facility_ids)}): {_listing(ctx.cnrl_facility_ids, LIMITS['cnrl'])}")
    if ctx.competitor_operators:
        ops = sorted(ctx.competitor_operators, key=lambda o: -(o.boe_d or 0))
        within = f" within {ctx.radius_km:g} km" if ctx.radius_km else ""
        items = "; ".join(f"{o.baid} {o.name}" + (f" ({o.boe_d:,.0f} boe/d)" if o.boe_d is not None else "")
                          for o in ops[:LIMITS["operators"]])
        more = f" (top {LIMITS['operators']} of {len(ops)})" if len(ops) > LIMITS["operators"] else ""
        out.append(f"- Nearby competitor operators{within}, by 2025 boe/d{more}: {items}")
    if ctx.focused_facility:
        f = ctx.focused_facility
        who = f", operator {f.operator_name} (BA ID {f.operator_baid})" if f.operator_baid else ""
        out.append(f"- Focused facility: {f.id}{' ' + f.name if f.name else ''}{who}")
    if ctx.well_ids:
        out.append(f"- Selected wells ({len(ctx.well_ids)}): {_listing(ctx.well_ids, LIMITS['wells'])}")
    if ctx.focused_operator:
        out.append(f"- Focused operator: {ctx.focused_operator.baid} {ctx.focused_operator.name}")
    return "Map context (selections from the CNRL Acquisition Explorer map):\n" + "\n".join(out) if out else ""


def compose(question: str, ctx: Optional[MapContext]) -> str:
    block = context_block(ctx)
    return f"{block}\n\nQuestion: {question}" if block else question


def _client():
    import db  # imported lazily so tests can run without a Lakebase connection
    return db.ws


def _parse(w, m):
    out = {"conversation_id": m.conversation_id, "message_id": m.message_id,
           "status": m.status.value if m.status else None, "text": None, "sql": None, "sql_description": None,
           "columns": [], "rows": [], "row_count": 0, "suggested_questions": [],
           "error": m.error.error if m.error else None}
    texts = []
    for a in m.attachments or []:
        if a.text and a.text.content:
            texts.append(a.text.content)
        if a.query:
            out["sql"], out["sql_description"] = a.query.query, a.query.description
            res = w.genie.get_message_attachment_query_result(SPACE_ID, m.conversation_id, m.message_id, a.attachment_id)
            sr = res.statement_response
            if sr and sr.manifest and sr.manifest.schema:
                out["columns"] = [c.name for c in sr.manifest.schema.columns]
                data = (sr.result.data_array if sr.result else None) or []
                out["rows"] = data[:MAX_ROWS]
                out["row_count"] = sr.manifest.total_row_count or len(data)
        if a.suggested_questions and a.suggested_questions.questions:
            out["suggested_questions"] = a.suggested_questions.questions
    out["text"] = "\n\n".join(texts) or None
    return out


def ask(question: str, conversation_id: Optional[str] = None, ctx: Optional[MapContext] = None):
    """Send a question (with map context) to Genie and wait for the answer, SQL and result rows."""
    w = _client()
    content = compose(question, ctx)
    if conversation_id:
        m = w.genie.create_message_and_wait(SPACE_ID, conversation_id, content, timeout=TIMEOUT)
    else:
        m = w.genie.start_conversation_and_wait(SPACE_ID, content, timeout=TIMEOUT)
    return {**_parse(w, m), "sent": content}


def info():
    host = _client().config.host.rstrip("/") if SPACE_ID else None
    return {"space_id": SPACE_ID, "title": CONFIG.get("title"),
            "url": f"{host}/genie/rooms/{SPACE_ID}" if SPACE_ID else None,
            "sample_questions": CONFIG.get("sample_questions", [])}
