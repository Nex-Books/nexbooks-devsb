import math
from fastapi import APIRouter, Query, HTTPException, Header
from typing import Optional
from datetime import datetime, timezone

from models.schemas import InvoiceCreate, TDSEntryCreate, GSTReturnCreate
from services.supabase_service import supabase
from services.ai_service import AIService
from routers.chat import _save_journal_entry

router = APIRouter(prefix="/finance", tags=["Finance"])
ai_service = AIService()


def _get_user_id(authorization: Optional[str], fallback: Optional[str] = None) -> str:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        try:
            resp = supabase.auth.get_user(token)
            return resp.user.id
        except Exception:
            pass
    if fallback:
        return fallback
    raise HTTPException(status_code=401, detail="Authentication required")


# ─── INVOICES ─────────────────────────────────────────────────────────────────

@router.get("/invoices")
def list_invoices(
    user_id: Optional[str] = Query(None),
    invoice_type: Optional[str] = Query(None),   # purchase | sale
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    authorization: Optional[str] = Header(None),
):
    uid = _get_user_id(authorization, user_id)

    query = (
        supabase.table("invoices")
        .select("*", count="exact")
        .eq("created_by", uid)
        .order("invoice_date", desc=True)
        .order("created_at", desc=True)
    )
    if invoice_type:
        query = query.eq("invoice_type", invoice_type)
    if status:
        query = query.eq("status", status)
    if date_from:
        query = query.gte("invoice_date", date_from)
    if date_to:
        query = query.lte("invoice_date", date_to)

    start = (page - 1) * limit
    end = start + limit - 1
    result = query.range(start, end).execute()

    invoices = result.data or []
    total = result.count or 0
    total_pages = math.ceil(total / limit) if total > 0 else 0

    # Fetch line items for returned invoices
    if invoices:
        inv_ids = [i["id"] for i in invoices]
        lines_result = (
            supabase.table("invoice_line_items")
            .select("*")
            .in_("invoice_id", inv_ids)
            .execute()
        )
        lines_by_inv: dict = {}
        for line in (lines_result.data or []):
            lines_by_inv.setdefault(line["invoice_id"], []).append(line)
        for inv in invoices:
            inv["line_items"] = lines_by_inv.get(inv["id"], [])

    return {
        "data": invoices,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
    }


@router.post("/invoices")
def create_invoice(
    payload: InvoiceCreate,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _get_user_id(authorization, user_id)
    now = datetime.now(timezone.utc).isoformat()

    # Build and post the double-entry journal entry for this invoice, so
    # manually-created invoices affect the ledger/trial balance/P&L exactly
    # like AI-extracted invoices do.
    journal_entry_id: Optional[str] = None
    try:
        journal_source = {
            "invoice_type": payload.invoice_type,
            "vendor_name": payload.vendor_name,
            "buyer_name": payload.vendor_name,
            "subtotal": float(payload.subtotal),
            "cgst_amount": float(payload.cgst),
            "sgst_amount": float(payload.sgst),
            "igst_amount": float(payload.igst),
            "total_amount": float(payload.total_amount),
            "invoice_number": payload.invoice_number,
            "invoice_date": payload.invoice_date,
            "tds_amount": 0,
        }
        journal_entry = ai_service.build_invoice_journal_entry(journal_source)
        journal_entry_id = _save_journal_entry(uid, journal_entry, source="invoice_manual")
    except Exception as e:
        print(f"[finance] Journal entry creation failed: {e}")

    inv_data = {
        "invoice_number": payload.invoice_number,
        "vendor_name": payload.vendor_name,
        "vendor_gstin": payload.vendor_gstin,
        "invoice_date": payload.invoice_date,
        "due_date": payload.due_date,
        "subtotal": float(payload.subtotal),
        "cgst": float(payload.cgst),
        "sgst": float(payload.sgst),
        "igst": float(payload.igst),
        "total_amount": float(payload.total_amount),
        "invoice_type": payload.invoice_type,
        "status": "booked" if journal_entry_id else payload.status,
        "file_url": payload.file_url,
        "ai_extracted": payload.ai_extracted,
        "journal_entry_id": journal_entry_id,
        "created_by": uid,
        "created_at": now,
        "updated_at": now,
    }

    try:
        inv_result = supabase.table("invoices").insert(inv_data).execute()
        inv = inv_result.data[0]
        inv["journal_entry_id"] = journal_entry_id

        # Insert line items if provided
        if payload.line_items:
            lines = []
            for li in payload.line_items:
                lines.append({
                    "invoice_id": inv["id"],
                    "description": li.description,
                    "hsn_sac_code": li.hsn_sac_code,
                    "quantity": float(li.quantity),
                    "rate": float(li.rate),
                    "amount": float(li.amount),
                    "gst_rate": float(li.gst_rate),
                    "cgst_amount": float(li.cgst_amount),
                    "sgst_amount": float(li.sgst_amount),
                    "igst_amount": float(li.igst_amount),
                    "created_at": now,
                })
            li_result = supabase.table("invoice_line_items").insert(lines).execute()
            inv["line_items"] = li_result.data or []
        else:
            inv["line_items"] = []

        return inv
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/invoices/{invoice_id}")
def get_invoice(
    invoice_id: str,
    authorization: Optional[str] = Header(None),
    user_id: Optional[str] = Query(None),
):
    uid = _get_user_id(authorization, user_id)

    try:
        inv_result = (
            supabase.table("invoices")
            .select("*")
            .eq("id", invoice_id)
            .eq("created_by", uid)
            .execute()
        )
        if not inv_result.data:
            raise HTTPException(status_code=404, detail="Invoice not found")

        inv = inv_result.data[0]
        li_result = (
            supabase.table("invoice_line_items")
            .select("*")
            .eq("invoice_id", invoice_id)
            .execute()
        )
        inv["line_items"] = li_result.data or []
        return inv
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/invoices/{invoice_id}/status")
def update_invoice_status(
    invoice_id: str,
    status: str = Query(...),
    authorization: Optional[str] = Header(None),
    user_id: Optional[str] = Query(None),
):
    VALID = {"pending", "booked", "paid", "cancelled"}
    if status not in VALID:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(VALID)}")

    uid = _get_user_id(authorization, user_id)

    try:
        result = (
            supabase.table("invoices")
            .update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", invoice_id)
            .eq("created_by", uid)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Invoice not found")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/invoices/{invoice_id}")
def delete_invoice(
    invoice_id: str,
    authorization: Optional[str] = Header(None),
    user_id: Optional[str] = Query(None),
):
    uid = _get_user_id(authorization, user_id)

    try:
        # Verify ownership
        check = (
            supabase.table("invoices")
            .select("id")
            .eq("id", invoice_id)
            .eq("created_by", uid)
            .execute()
        )
        if not check.data:
            raise HTTPException(status_code=404, detail="Invoice not found")

        # Delete line items first (cascade)
        supabase.table("invoice_line_items").delete().eq("invoice_id", invoice_id).execute()

        # Delete the invoice
        supabase.table("invoices").delete().eq("id", invoice_id).eq("created_by", uid).execute()

        return {"message": "Invoice deleted successfully", "id": invoice_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── TDS ENTRIES ─────────────────────────────────────────────────────────────

@router.get("/tds")
def list_tds_entries(
    user_id: Optional[str] = Query(None),
    section_code: Optional[str] = Query(None),
    financial_year: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    authorization: Optional[str] = Header(None),
):
    uid = _get_user_id(authorization, user_id)

    query = (
        supabase.table("tds_entries")
        .select("*", count="exact")
        .eq("created_by", uid)
        .order("created_at", desc=True)
    )
    if section_code:
        query = query.eq("section_code", section_code)
    if financial_year:
        query = query.eq("financial_year", financial_year)

    start = (page - 1) * limit
    end = start + limit - 1
    result = query.range(start, end).execute()

    total = result.count or 0
    return {
        "data": result.data or [],
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": math.ceil(total / limit) if total > 0 else 0,
    }


@router.post("/tds")
def create_tds_entry(
    payload: TDSEntryCreate,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _get_user_id(authorization, user_id)
    now = datetime.now(timezone.utc).isoformat()

    try:
        result = supabase.table("tds_entries").insert({
            "journal_entry_id": payload.journal_entry_id,
            "invoice_id": payload.invoice_id,
            "section_code": payload.section_code,
            "deductee_name": payload.deductee_name,
            "deductee_pan": payload.deductee_pan,
            "tds_rate": float(payload.tds_rate),
            "taxable_amount": float(payload.taxable_amount),
            "tds_amount": float(payload.tds_amount),
            "payment_date": payload.payment_date,
            "financial_year": payload.financial_year,
            "quarter": payload.quarter,
            "created_by": uid,
            "created_at": now,
            "updated_at": now,
        }).execute()
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tds/summary")
def get_tds_summary(
    user_id: Optional[str] = Query(None),
    financial_year: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """Aggregate TDS by section code."""
    uid = _get_user_id(authorization, user_id)

    query = (
        supabase.table("tds_entries")
        .select("section_code, tds_rate, taxable_amount, tds_amount, status")
        .eq("created_by", uid)
    )
    if financial_year:
        query = query.eq("financial_year", financial_year)

    try:
        result = query.execute()
        entries = result.data or []

        summary: dict = {}
        for e in entries:
            sec = e.get("section_code", "Unknown")
            if sec not in summary:
                summary[sec] = {
                    "section_code": sec,
                    "entry_count": 0,
                    "total_taxable": 0.0,
                    "total_tds": 0.0,
                    "deposited": 0.0,
                    "pending": 0.0,
                }
            summary[sec]["entry_count"] += 1
            summary[sec]["total_taxable"] += float(e.get("taxable_amount") or 0)
            summary[sec]["total_tds"] += float(e.get("tds_amount") or 0)
            if e.get("status") == "deposited":
                summary[sec]["deposited"] += float(e.get("tds_amount") or 0)
            else:
                summary[sec]["pending"] += float(e.get("tds_amount") or 0)

        return {
            "data": list(summary.values()),
            "grand_total_tds": round(sum(s["total_tds"] for s in summary.values()), 2),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── GST RETURNS ──────────────────────────────────────────────────────────────

@router.get("/gst-returns")
def list_gst_returns(
    user_id: Optional[str] = Query(None),
    return_type: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _get_user_id(authorization, user_id)

    query = (
        supabase.table("gst_returns")
        .select("*")
        .eq("created_by", uid)
        .order("period_year", desc=True)
        .order("period_month", desc=True)
    )
    if return_type:
        query = query.eq("return_type", return_type)
    if year:
        query = query.eq("period_year", year)

    try:
        result = query.execute()
        return {"data": result.data or [], "total": len(result.data or [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/gst-returns")
def create_gst_return(
    payload: GSTReturnCreate,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _get_user_id(authorization, user_id)
    now = datetime.now(timezone.utc).isoformat()

    try:
        result = supabase.table("gst_returns").insert({
            "period_month": payload.period_month,
            "period_year": payload.period_year,
            "return_type": payload.return_type,
            "status": payload.status,
            "filed_date": payload.filed_date,
            "total_taxable": float(payload.total_taxable),
            "total_cgst": float(payload.total_cgst),
            "total_sgst": float(payload.total_sgst),
            "total_igst": float(payload.total_igst),
            "total_cess": float(payload.total_cess),
            "net_payable": float(payload.net_payable),
            "created_by": uid,
            "created_at": now,
            "updated_at": now,
        }).execute()
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/gst-summary")
def get_gst_summary(
    user_id: Optional[str] = Query(None),
    month: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """
    Compute GST summary from journal_lines by looking at GST account names.
    Returns: output GST collected, input GST paid, net GST payable.
    """
    uid = _get_user_id(authorization, user_id)

    try:
        # Get user's journal entries (optionally filtered by month/year)
        entries_query = (
            supabase.table("journal_entries")
            .select("id, entry_date")
            .eq("user_id", uid)
        )
        if year and month:
            from_date = f"{year}-{month:02d}-01"
            import calendar
            last_day = calendar.monthrange(year, month)[1]
            to_date = f"{year}-{month:02d}-{last_day}"
            entries_query = entries_query.gte("entry_date", from_date).lte("entry_date", to_date)
        elif year:
            entries_query = entries_query.gte("entry_date", f"{year}-01-01").lte("entry_date", f"{year}-12-31")

        entries_result = entries_query.execute()
        entry_ids = [e["id"] for e in (entries_result.data or [])]

        if not entry_ids:
            return {
                "output_cgst": 0, "output_sgst": 0, "output_igst": 0,
                "input_cgst": 0, "input_sgst": 0, "input_igst": 0,
                "net_cgst": 0, "net_sgst": 0, "net_igst": 0,
                "total_output": 0, "total_input": 0, "net_payable": 0,
            }

        lines_result = (
            supabase.table("journal_lines")
            .select("account_name, debit, credit")
            .in_("journal_entry_id", entry_ids)
            .execute()
        )
        lines = lines_result.data or []

        # Aggregate by GST account names
        agg = {
            "output_cgst": 0.0, "output_sgst": 0.0, "output_igst": 0.0,
            "input_cgst": 0.0, "input_sgst": 0.0, "input_igst": 0.0,
        }

        for line in lines:
            name = (line.get("account_name") or "").lower()
            credit = float(line.get("credit") or 0)
            debit = float(line.get("debit") or 0)

            # Output GST (liability accounts — credit side)
            if "payable" in name and "cgst" in name:
                agg["output_cgst"] += credit
            elif "payable" in name and "sgst" in name:
                agg["output_sgst"] += credit
            elif "payable" in name and "igst" in name:
                agg["output_igst"] += credit

            # Input GST (asset accounts — debit side)
            elif ("input" in name or "credit" in name) and "cgst" in name:
                agg["input_cgst"] += debit
            elif ("input" in name or "credit" in name) and "sgst" in name:
                agg["input_sgst"] += debit
            elif ("input" in name or "credit" in name) and "igst" in name:
                agg["input_igst"] += debit

        total_output = agg["output_cgst"] + agg["output_sgst"] + agg["output_igst"]
        total_input = agg["input_cgst"] + agg["input_sgst"] + agg["input_igst"]

        return {
            "output_cgst": round(agg["output_cgst"], 2),
            "output_sgst": round(agg["output_sgst"], 2),
            "output_igst": round(agg["output_igst"], 2),
            "input_cgst": round(agg["input_cgst"], 2),
            "input_sgst": round(agg["input_sgst"], 2),
            "input_igst": round(agg["input_igst"], 2),
            "net_cgst": round(agg["output_cgst"] - agg["input_cgst"], 2),
            "net_sgst": round(agg["output_sgst"] - agg["input_sgst"], 2),
            "net_igst": round(agg["output_igst"] - agg["input_igst"], 2),
            "total_output": round(total_output, 2),
            "total_input": round(total_input, 2),
            "net_payable": round(total_output - total_input, 2),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))