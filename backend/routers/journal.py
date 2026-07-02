"""
/api/journal-entries — Journal Entries CRUD
  GET  /api/journal-entries          — paginated list with filters
  GET  /api/journal-entries/{id}     — single entry with lines
  POST /api/journal-entries          — manual journal entry creation
  POST /api/journal-entries/{id}/void — void an entry
"""
import math
import uuid
from datetime import datetime, timezone, date
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Body
from pydantic import BaseModel
from typing import List

from services.supabase_service import supabase
from routers.chat import _extract_user_id, _save_journal_entry

router = APIRouter(prefix="/api/journal-entries", tags=["Journal Entries"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ManualJournalLine(BaseModel):
    account_name: str
    account_type: str   # Asset | Liability | Equity | Revenue | Expense
    debit: float = 0.0
    credit: float = 0.0
    description: Optional[str] = None


class ManualJournalEntry(BaseModel):
    entry_date: str          # YYYY-MM-DD
    description: str
    reference_number: Optional[str] = None
    lines: List[ManualJournalLine]


# ─── GET /api/journal-entries ─────────────────────────────────────────────────

@router.get("")
def list_journal_entries(
    user_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status: Optional[str] = Query(None),           # draft | posted | void
    source: Optional[str] = Query(None),           # chat | invoice_upload | manual
    ai_generated: Optional[bool] = Query(None),
    account: Optional[str] = Query(None),          # filter by account name
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Step 1: if account filter, resolve matching entry IDs via journal_lines
    filtered_ids: Optional[list] = None
    if account:
        lines_resp = (
            supabase.table("journal_lines")
            .select("journal_entry_id")
            .ilike("account_name", f"%{account}%")
            .execute()
        )
        filtered_ids = list({r["journal_entry_id"] for r in (lines_resp.data or [])})
        if not filtered_ids:
            return {"data": [], "total": 0, "page": page, "limit": limit, "total_pages": 0}

    # Step 2: build journal_entries query
    query = (
        supabase.table("journal_entries")
        .select("*", count="exact")
        .eq("user_id", uid)
        .order("entry_date", desc=True)
        .order("created_at", desc=True)
    )
    if date_from:
        query = query.gte("entry_date", date_from)
    if date_to:
        query = query.lte("entry_date", date_to)
    if status:
        query = query.eq("status", status)
    if source:
        query = query.eq("source", source)
    if ai_generated is not None:
        query = query.eq("ai_generated", ai_generated)
    if filtered_ids is not None:
        query = query.in_("id", filtered_ids)

    # Step 3: paginate
    start = (page - 1) * limit
    end = start + limit - 1
    result = query.range(start, end).execute()

    entries = result.data or []
    total = result.count or 0
    total_pages = math.ceil(total / limit) if total > 0 else 0
