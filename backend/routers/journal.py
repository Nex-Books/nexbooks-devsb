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
    limit: int = Query(20, ge=1, le=1000),
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

    if not entries:
        return {"data": [], "total": total, "page": page, "limit": limit, "total_pages": total_pages}

    # Step 4: fetch lines for returned entries in one query
    entry_ids = [e["id"] for e in entries]
    lines_result = (
        supabase.table("journal_lines")
        .select("journal_entry_id, account_name, account_type, debit, credit, description")
        .in_("journal_entry_id", entry_ids)
        .execute()
    )
    lines_by_entry: dict = {}
    for line in (lines_result.data or []):
        lines_by_entry.setdefault(line["journal_entry_id"], []).append(line)

    # Step 5: build response rows
    rows = []
    for entry in entries:
        eid = entry["id"]
        entry_lines = lines_by_entry.get(eid, [])
        rows.append({
            **entry,
            "lines": entry_lines,
        })

    return {
        "data": rows,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
    }


# ─── GET /api/journal-entries/{id} ───────────────────────────────────────────

@router.get("/{entry_id}")
def get_journal_entry(
    entry_id: str,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        entry_result = (
            supabase.table("journal_entries")
            .select("*")
            .eq("id", entry_id)
            .eq("user_id", uid)
            .execute()
        )
        if not entry_result.data:
            raise HTTPException(status_code=404, detail="Journal entry not found")

        entry = entry_result.data[0]

        lines_result = (
            supabase.table("journal_lines")
            .select("*")
            .eq("journal_entry_id", entry_id)
            .execute()
        )
        entry["lines"] = lines_result.data or []
        return entry
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── POST /api/journal-entries — Manual Entry ─────────────────────────────────

@router.post("")
def create_manual_journal_entry(
    payload: ManualJournalEntry,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    lines = payload.lines
    if not lines:
        raise HTTPException(status_code=400, detail="At least one journal line is required")

    # Validate double-entry balance
    total_debit = sum(float(l.debit) for l in lines)
    total_credit = sum(float(l.credit) for l in lines)
    if abs(total_debit - total_credit) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Journal entry does not balance: Debit ₹{total_debit:.2f} ≠ Credit ₹{total_credit:.2f}"
        )
    if total_debit == 0:
        raise HTTPException(status_code=400, detail="Total debit/credit cannot be zero")

    now = datetime.now(timezone.utc).isoformat()

    try:
        entry_result = supabase.table("journal_entries").insert({
            "user_id": uid,
            "created_by": uid,
            "entry_date": payload.entry_date,
            "description": payload.description,
            "reference_number": payload.reference_number,
            "total_amount": round(total_debit, 2),
            "total_debit": round(total_debit, 2),
            "total_credit": round(total_credit, 2),
            "transaction_type": "manual",
            "status": "posted",
            "source": "manual",
            "ai_generated": False,
            "created_at": now,
        }).execute()
        entry_id = entry_result.data[0]["id"]
    except Exception as e:
        # Fallback without new columns
        try:
            entry_result = supabase.table("journal_entries").insert({
                "user_id": uid,
                "entry_date": payload.entry_date,
                "description": payload.description,
                "total_amount": round(total_debit, 2),
                "transaction_type": "manual",
                "created_at": now,
            }).execute()
            entry_id = entry_result.data[0]["id"]
        except Exception as e2:
            raise HTTPException(status_code=500, detail=f"Failed to create journal entry: {e2}")

    # Insert journal lines
    line_rows = []
    for line in lines:
        line_rows.append({
            "journal_entry_id": entry_id,
            "account_name": line.account_name,
            "account_type": line.account_type,
            "debit": float(line.debit),
            "credit": float(line.credit),
            "description": line.description,
            "narration": line.description,
        })

    try:
        supabase.table("journal_lines").insert(line_rows).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save journal lines: {e}")

    return {
        "id": entry_id,
        "entry_date": payload.entry_date,
        "description": payload.description,
        "reference_number": payload.reference_number,
        "total_debit": round(total_debit, 2),
        "total_credit": round(total_credit, 2),
        "status": "posted",
        "source": "manual",
        "lines": line_rows,
    }


# ─── POST /api/journal-entries/{id}/void ─────────────────────────────────────

@router.post("/{entry_id}/void")
def void_journal_entry(
    entry_id: str,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Verify ownership
    check = (
        supabase.table("journal_entries")
        .select("id, status")
        .eq("id", entry_id)
        .eq("user_id", uid)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    if check.data[0].get("status") == "void":
        raise HTTPException(status_code=400, detail="Entry is already voided")

    try:
        result = (
            supabase.table("journal_entries")
            .update({
                "status": "void",
            })
            .eq("id", entry_id)
            .eq("user_id", uid)
            .execute()
        )
        return {"message": "Journal entry voided successfully", "entry": result.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# ─── GET /api/journal-entries/ledger ─────────────────────────────────────────

@router.get("/account/ledger")
def get_ledger(
    account_name: str = Query(...),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """
    Fetch ledger transactions for a specific account and compute running balance.
    """
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        # Get all entries for user
        query = supabase.table("journal_entries").select("*").eq("user_id", uid).neq("status", "void")
        if date_from:
            query = query.gte("entry_date", date_from)
        if date_to:
            query = query.lte("entry_date", date_to)
            
        entries_res = query.execute()
        entries = {e["id"]: e for e in (entries_res.data or [])}
        
        if not entries:
            return {"data": [], "closing_balance": 0}

        # Get lines matching account for those entries
        lines_res = (
            supabase.table("journal_lines")
            .select("*")
            .in_("journal_entry_id", list(entries.keys()))
            .eq("account_name", account_name)
            .execute()
        )
        lines = lines_res.data or []
        
        # Build ledger rows
        ledger_rows = []
        for line in lines:
            entry = entries[line["journal_entry_id"]]
            ledger_rows.append({
                "id": line["id"],
                "journal_entry_id": entry["id"],
                "entry_date": entry["entry_date"],
                "description": entry["description"],
                "reference_number": entry.get("reference_number"),
                "debit": line.get("debit", 0),
                "credit": line.get("credit", 0),
                "narration": line.get("narration") or line.get("description"),
                "account_type": line.get("account_type"),
            })
            
        # Sort by date ascending
        ledger_rows.sort(key=lambda x: x["entry_date"])
        
        # Calculate running balance
        running_balance = 0
        account_type = ledger_rows[0]["account_type"] if ledger_rows else None
        is_debit_normal = account_type in ["Asset", "Expense"]
        
        for row in ledger_rows:
            dr = float(row["debit"] or 0)
            cr = float(row["credit"] or 0)
            if is_debit_normal:
                running_balance += (dr - cr)
            else:
                running_balance += (cr - dr)
            row["running_balance"] = round(running_balance, 2)
            
        return {
            "data": ledger_rows,
            "closing_balance": round(running_balance, 2),
            "account_type": account_type
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
