from pydantic import BaseModel
from typing import Optional, List
from decimal import Decimal


class ChatHistoryItem(BaseModel):
    role: str   # "user" or "assistant"
    content: str


class ChatMessage(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    user_id: Optional[str] = None
    chat_history: Optional[List[ChatHistoryItem]] = None


class JournalLine(BaseModel):
    account_name: str
    account_type: str  # Asset | Liability | Equity | Income | Expense
    debit: float
    credit: float
    description: Optional[str] = None
    narration: Optional[str] = None
    account_id: Optional[str] = None


class JournalEntry(BaseModel):
    description: str
    entry_date: str
    reference: Optional[str] = None
    reference_number: Optional[str] = None
    lines: List[JournalLine]
    total_amount: float
    transaction_type: str  # expense | income | asset | liability


class ChatResponse(BaseModel):
    reply: str
    has_journal_entry: bool
    journal_entry: Optional[JournalEntry] = None
    conversation_id: str


class JournalEntryCreate(BaseModel):
    user_id: str
    entry_date: str
    description: str
    lines: List[JournalLine]


class AccountCreate(BaseModel):
    user_id: str
    account_code: str
    account_name: str
    account_type: str  # Asset | Liability | Equity | Income | Expense


class AccountUpdate(BaseModel):
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    account_type: Optional[str] = None


# ─── Chart of Accounts ───────────────────────────────────────────────────────

class ChartOfAccountCreate(BaseModel):
    account_code: str
    account_name: str
    account_type: str  # Asset | Liability | Equity | Revenue | Expense
    account_sub_type: Optional[str] = None
    parent_account_id: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True


class ChartOfAccountUpdate(BaseModel):
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    account_type: Optional[str] = None
    account_sub_type: Optional[str] = None
    parent_account_id: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


# ─── Invoice Models ──────────────────────────────────────────────────────────

class InvoiceLineItemCreate(BaseModel):
    description: str
    hsn_sac_code: Optional[str] = None
    quantity: float = 1.0
    rate: float = 0.0
    amount: float = 0.0
    gst_rate: float = 0.0
    cgst_amount: float = 0.0
    sgst_amount: float = 0.0
    igst_amount: float = 0.0


class InvoiceCreate(BaseModel):
    invoice_number: str
    vendor_name: str
    vendor_gstin: Optional[str] = None
    invoice_date: str   # YYYY-MM-DD
    due_date: Optional[str] = None
    subtotal: float = 0.0
    cgst: float = 0.0
    sgst: float = 0.0
    igst: float = 0.0
    total_amount: float = 0.0
    invoice_type: str   # purchase | sale
    status: str = 'pending'
    file_url: Optional[str] = None
    ai_extracted: bool = False
    line_items: Optional[List[InvoiceLineItemCreate]] = []


# ─── TDS Entry ───────────────────────────────────────────────────────────────

class TDSEntryCreate(BaseModel):
    journal_entry_id: Optional[str] = None
    invoice_id: Optional[str] = None
    section_code: str          # e.g. '194J', '194C', '194I'
    deductee_name: str
    deductee_pan: Optional[str] = None
    tds_rate: float = 0.0
    taxable_amount: float = 0.0
    tds_amount: float = 0.0
    payment_date: Optional[str] = None
    financial_year: Optional[str] = None
    quarter: Optional[str] = None


# ─── Bank Transaction (Manual Receipt / Payment) ─────────────────────────────

class BankTransactionCreate(BaseModel):
    transaction_date: str          # YYYY-MM-DD
    description: str
    amount: float                  # always positive; sign derived from transaction_type
    transaction_type: str          # 'Receipt' | 'Payment'
    account_name: str              # counter account, e.g. "Sales Revenue", "Rent Expense"
    account_type: str = "Income"   # Income | Expense | Asset | Liability
    reference_number: Optional[str] = None
    party_name: Optional[str] = None


# ─── GST Return ──────────────────────────────────────────────────────────────

class GSTReturnCreate(BaseModel):
    period_month: int    # 1-12
    period_year: int
    return_type: str     # GSTR1 | GSTR3B | GSTR2B
    status: str = 'draft'
    filed_date: Optional[str] = None
    total_taxable: float = 0.0
    total_cgst: float = 0.0
    total_sgst: float = 0.0
    total_igst: float = 0.0
    total_cess: float = 0.0
    net_payable: float = 0.0