import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from services.supabase_service import supabase
from routers.chat import _extract_user_id

router = APIRouter(prefix="/api/parties", tags=["Parties"])


class PartyCreate(BaseModel):
    party_type: str  # Customer, Vendor, Employee
    party_name: str
    gstin: Optional[str] = None
    pan: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None


class PartyUpdate(BaseModel):
    party_name: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None


@router.get("")
def list_parties(
    party_type: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        query = supabase.table("parties").select("*").eq("created_by", uid).order("party_name")
        if party_type:
            query = query.eq("party_type", party_type)
        
        result = query.execute()
        return {"data": result.data or []}
    except Exception as e:
        # Table might not exist yet if migration isn't run
        print(f"[parties] Table read error: {e}")
        return {"data": [], "error": "Run Phase 4 migration"}


@router.post("")
def create_party(
    payload: PartyCreate,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    if payload.party_type not in ["Customer", "Vendor", "Employee"]:
        raise HTTPException(status_code=400, detail="Invalid party type")

    try:
        exists = (
            supabase.table("parties")
            .select("id")
            .eq("party_name", payload.party_name)
            .eq("created_by", uid)
            .execute()
        )
        if exists.data:
            raise HTTPException(status_code=409, detail=f"Party '{payload.party_name}' already exists")

        now = datetime.now(timezone.utc).isoformat()
        insert_data = {
            "party_type": payload.party_type,
            "party_name": payload.party_name,
            "gstin": payload.gstin,
            "pan": payload.pan,
            "phone": payload.phone,
            "email": payload.email,
            "address": payload.address,
            "created_by": uid,
            "created_at": now,
            "updated_at": now,
        }
        result = supabase.table("parties").insert(insert_data).execute()
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{party_id}")
def update_party(
    party_id: str,
    payload: PartyUpdate,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    update_data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
        
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            supabase.table("parties")
            .update(update_data)
            .eq("id", party_id)
            .eq("created_by", uid)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Party not found")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{party_id}")
def delete_party(
    party_id: str,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        # Verify ownership first
        check = (
            supabase.table("parties")
            .select("id, party_name")
            .eq("id", party_id)
            .eq("created_by", uid)
            .execute()
        )
        if not check.data:
            raise HTTPException(status_code=404, detail="Party not found")

        result = (
            supabase.table("parties")
            .delete()
            .eq("id", party_id)
            .eq("created_by", uid)
            .execute()
        )
        return {"message": "Party deleted successfully", "id": party_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{party_id}/summary")
def get_party_summary(
    party_id: str,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """
    Computes outstanding invoices for a party to give AR/AP balance.
    """
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        # Check party
        party_res = supabase.table("parties").select("*").eq("id", party_id).eq("created_by", uid).execute()
        if not party_res.data:
            raise HTTPException(status_code=404, detail="Party not found")
        party = party_res.data[0]
        
        # Get invoices linked to this party (or by vendor_name matching)
        # For full safety, check by party_id OR vendor_name
        inv_res = (
            supabase.table("invoices")
            .select("total_amount, status, invoice_type")
            .eq("created_by", uid)
            .or_(f"party_id.eq.{party_id},vendor_name.eq.{party['party_name']}")
            .execute()
        )
        
        invoices = inv_res.data or []
        
        outstanding_receivable = 0
        outstanding_payable = 0
        
        for inv in invoices:
            if inv["status"] in ["pending", "booked"]:
                if inv["invoice_type"] == "sale":
                    outstanding_receivable += float(inv["total_amount"])
                elif inv["invoice_type"] == "purchase":
                    outstanding_payable += float(inv["total_amount"])
                    
        return {
            "party": party,
            "outstanding_receivable": round(outstanding_receivable, 2),
            "outstanding_payable": round(outstanding_payable, 2),
            "net_balance": round(outstanding_receivable - outstanding_payable, 2)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
