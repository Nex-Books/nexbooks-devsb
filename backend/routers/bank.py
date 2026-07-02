import csv
import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel

from services.supabase_service import supabase
from services.ai_service import AIService
from routers.chat import _extract_user_id, _save_journal_entry
from models.schemas import BankTransactionCreate

router = APIRouter(prefix="/api/bank", tags=["Bank Reconciliation"])
ai_service = AIService()

class BankReconcileRequest(BaseModel):
    bank_transaction_id: str
    journal_entry_id: str

@router.get("/transactions")
def list_bank_transactions(
    status: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        query = supabase.table("bank_transactions").select("*").eq("created_by", uid).order("transaction_date", desc=True)
        if status:
            query = query.eq("status", status)
            
        result = query.execute()
        return {"data": result.data or []}
    except Exception as e:
        print(f"[bank] Table read error: {e}")
        return {"data": [], "error": "Run Phase 4 migration"}


@router.post("/transactions")
def create_bank_transaction(
    payload: BankTransactionCreate,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """
    Manually add a Receipt (money in) or Payment (money out) entry.
    Also posts the corresponding double-entry journal entry against the
    Bank account, so the transaction reflects in the ledger/trial balance
    immediately -- exactly like a reconciled, AI-imported transaction.
    """
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    txn_kind = payload.transaction_type.strip().lower()
    if txn_kind not in ("receipt", "payment"):
        raise HTTPException(status_code=400, detail="transaction_type must be 'Receipt' or 'Payment'")

    is_receipt = txn_kind == "receipt"
    amount = round(abs(float(payload.amount)), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than 0")

    now = datetime.now(timezone.utc).isoformat()

    # ── Build the journal entry: Bank vs the counter account ──────────────────
    if is_receipt:
        lines = [
            {"account_name": "Bank", "account_type": "Asset",
             "debit": amount, "credit": 0.0, "description": payload.description},
            {"account_name": payload.account_name, "account_type": payload.account_type,
             "debit": 0.0, "credit": amount, "description": payload.description},
        ]
        journal_txn_type = "income"
    else:
        lines = [
            {"account_name": payload.account_name, "account_type": payload.account_type,
             "debit": amount, "credit": 0.0, "description": payload.description},
            {"account_name": "Bank", "account_type": "Asset",
             "debit": 0.0, "credit": amount, "description": payload.description},
        ]
        journal_txn_type = "expense"

    journal_entry = {
        "description": payload.description,
        "entry_date": payload.transaction_date,
        "reference": payload.reference_number,
        "lines": lines,
        "total_amount": amount,
        "transaction_type": journal_txn_type,
    }

    journal_entry_id: Optional[str] = None
    try:
        journal_entry_id = _save_journal_entry(uid, journal_entry, source="bank_manual")
    except Exception as e:
        print(f"[bank] Journal entry creation failed: {e}")

    insert_row = {
        "transaction_date": payload.transaction_date,
        "description": payload.description,
        "amount": amount if is_receipt else -amount,
        "transaction_type": "Deposit" if is_receipt else "Withdrawal",
        "reference_number": payload.reference_number,
        "status": "reconciled" if journal_entry_id else "unreconciled",
        "journal_entry_id": journal_entry_id,
        "created_by": uid,
        "created_at": now,
        "updated_at": now,
    }

    try:
        result = supabase.table("bank_transactions").insert(insert_row).execute()
        return {"message": f"{payload.transaction_type} recorded", "data": result.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload-statement")
async def upload_statement(
    file: UploadFile = File(...),
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """
    Parses a CSV bank statement and imports it into bank_transactions.
    """
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await file.read()
    text_content = content.decode("utf-8")
    
    # Parse CSV. We assume columns like Date, Description, Amount, etc.
    # We will use Gemini to extract structured bank transactions from the CSV text.
    try:
        extracted = await ai_service.extract_bank_statement(text_content)
        if not extracted or "transactions" not in extracted:
            raise HTTPException(status_code=400, detail="Failed to parse bank statement")
            
        now = datetime.now(timezone.utc).isoformat()
        insert_rows = []
        for tx in extracted["transactions"]:
            insert_rows.append({
                "transaction_date": tx.get("date"),
                "description": tx.get("description"),
                "amount": float(tx.get("amount", 0)),
                "transaction_type": "Deposit" if float(tx.get("amount", 0)) > 0 else "Withdrawal",
                "status": "unreconciled",
                "created_by": uid,
                "created_at": now,
                "updated_at": now,
            })
            
        if insert_rows:
            result = supabase.table("bank_transactions").insert(insert_rows).execute()
            return {"message": f"Successfully imported {len(insert_rows)} transactions", "data": result.data}
        return {"message": "No transactions found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reconcile")
def reconcile_transaction(
    payload: BankReconcileRequest,
    user_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    uid = _extract_user_id(authorization, user_id)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        # Check bank transaction
        bt_res = supabase.table("bank_transactions").select("*").eq("id", payload.bank_transaction_id).eq("created_by", uid).execute()
        if not bt_res.data:
            raise HTTPException(status_code=404, detail="Bank transaction not found")
            
        if bt_res.data[0]["status"] == "reconciled":
            raise HTTPException(status_code=400, detail="Transaction is already reconciled")

        # Update bank transaction
        now = datetime.now(timezone.utc).isoformat()
        result = (
            supabase.table("bank_transactions")
            .update({
                "status": "reconciled",
                "journal_entry_id": payload.journal_entry_id,
                "updated_at": now
            })
            .eq("id", payload.bank_transaction_id)
            .execute()
        )
        return {"message": "Transaction reconciled", "data": result.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))