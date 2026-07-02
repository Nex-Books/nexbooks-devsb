-- ============================================================
-- NexBooks Phase 1 — Database Foundation
-- Run this in your Supabase SQL Editor (once, top-to-bottom)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Extensions / Helpers
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ────────────────────────────────────────────────────────────
-- 1. CHART OF ACCOUNTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code      TEXT         NOT NULL,
    account_name      TEXT         NOT NULL,
    account_type      TEXT         NOT NULL CHECK (account_type IN ('Asset','Liability','Equity','Revenue','Expense')),
    account_sub_type  TEXT,
    parent_account_id UUID         REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    description       TEXT,
    created_by        UUID         REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (account_code, created_by)   -- unique per user (NULL created_by = global seed)
);

-- Allow same code for global seed (created_by IS NULL) to coexist with user rows
-- The UNIQUE constraint above handles (code, user) uniqueness fine for non-null created_by.

-- ────────────────────────────────────────────────────────────
-- 2. ALTER journal_entries — add missing columns
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
    -- status
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_entries' AND column_name='status'
    ) THEN
        ALTER TABLE public.journal_entries
            ADD COLUMN status TEXT NOT NULL DEFAULT 'posted'
            CHECK (status IN ('draft','posted','void'));
    END IF;

    -- reference_number (the spec calls it reference_number; existing column is "reference")
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_entries' AND column_name='reference_number'
    ) THEN
        ALTER TABLE public.journal_entries
            ADD COLUMN reference_number TEXT;
        -- Only copy from 'reference' column if it exists in this schema
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='journal_entries' AND column_name='reference'
        ) THEN
            UPDATE public.journal_entries SET reference_number = reference WHERE reference_number IS NULL;
        END IF;
    END IF;

    -- total_debit
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_entries' AND column_name='total_debit'
    ) THEN
        ALTER TABLE public.journal_entries
            ADD COLUMN total_debit NUMERIC(15,2) DEFAULT 0;
    END IF;

    -- total_credit
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_entries' AND column_name='total_credit'
    ) THEN
        ALTER TABLE public.journal_entries
            ADD COLUMN total_credit NUMERIC(15,2) DEFAULT 0;
    END IF;

    -- ai_generated
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_entries' AND column_name='ai_generated'
    ) THEN
        ALTER TABLE public.journal_entries
            ADD COLUMN ai_generated BOOLEAN NOT NULL DEFAULT FALSE;
        -- Back-fill: ai_generated defaults to FALSE for all existing rows (message_id column not present)
    END IF;

    -- source
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_entries' AND column_name='source'
    ) THEN
        ALTER TABLE public.journal_entries
            ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
            CHECK (source IN ('chat','invoice_upload','manual'));
        -- Back-fill: source defaults to 'manual' for all existing rows (message_id column not present)
    END IF;

    -- entry_date: ensure DATE type (it may already be correct)
    -- Supabase typically stores as text or date — we leave it as-is.

    -- created_by: some backends use user_id, spec says created_by; add alias column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_entries' AND column_name='created_by'
    ) THEN
        ALTER TABLE public.journal_entries
            ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
        -- Only copy from 'user_id' column if it exists in this schema
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='journal_entries' AND column_name='user_id'
        ) THEN
            UPDATE public.journal_entries SET created_by = user_id::uuid WHERE created_by IS NULL;
        END IF;
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. ALTER journal_lines — add account_id FK + narration
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
    -- account_id FK to chart_of_accounts
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_lines' AND column_name='account_id'
    ) THEN
        ALTER TABLE public.journal_lines
            ADD COLUMN account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
    END IF;

    -- narration (more detailed than description)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_lines' AND column_name='narration'
    ) THEN
        ALTER TABLE public.journal_lines
            ADD COLUMN narration TEXT;
    END IF;

    -- Ensure debit/credit are NUMERIC (may already be float/numeric)
    -- We skip type-casting to avoid breaking existing data.
END $$;

-- ────────────────────────────────────────────────────────────
-- 4. INVOICES
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number   TEXT          NOT NULL,
    vendor_name      TEXT          NOT NULL,
    vendor_gstin     TEXT,
    invoice_date     DATE          NOT NULL,
    due_date         DATE,
    subtotal         NUMERIC(15,2) NOT NULL DEFAULT 0,
    cgst             NUMERIC(15,2) NOT NULL DEFAULT 0,
    sgst             NUMERIC(15,2) NOT NULL DEFAULT 0,
    igst             NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
    invoice_type     TEXT          NOT NULL CHECK (invoice_type IN ('purchase','sale')),
    status           TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','booked','paid','cancelled')),
    file_url         TEXT,
    ai_extracted     BOOLEAN       NOT NULL DEFAULT FALSE,
    journal_entry_id UUID          REFERENCES public.journal_entries(id) ON DELETE SET NULL,
    created_by       UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 5. INVOICE LINE ITEMS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id   UUID          NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    description  TEXT          NOT NULL,
    hsn_sac_code TEXT,
    quantity     NUMERIC(10,3) NOT NULL DEFAULT 1,
    rate         NUMERIC(15,2) NOT NULL DEFAULT 0,
    amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
    gst_rate     NUMERIC(5,2)  NOT NULL DEFAULT 0,
    cgst_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
    sgst_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
    igst_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 6. TDS ENTRIES
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tds_entries (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID          REFERENCES public.journal_entries(id) ON DELETE SET NULL,
    invoice_id       UUID          REFERENCES public.invoices(id) ON DELETE SET NULL,
    section_code     TEXT          NOT NULL,  -- e.g. '194J', '194C', '194I'
    deductee_name    TEXT          NOT NULL,
    deductee_pan     TEXT,
    tds_rate         NUMERIC(5,2)  NOT NULL DEFAULT 0,
    taxable_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
    tds_amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
    payment_date     DATE,
    financial_year   TEXT,         -- e.g. '2024-25'
    quarter          TEXT,         -- e.g. 'Q1', 'Q2', 'Q3', 'Q4'
    challan_number   TEXT,
    status           TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deposited','filed')),
    created_by       UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- 7. GST RETURNS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gst_returns (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    period_month    INTEGER       NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year     INTEGER       NOT NULL,
    return_type     TEXT          NOT NULL CHECK (return_type IN ('GSTR1','GSTR3B','GSTR2B')),
    status          TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','filed','nil')),
    filed_date      DATE,
    total_taxable   NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_cgst      NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_sgst      NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_igst      NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_cess      NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_payable     NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_by      UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (period_month, period_year, return_type, created_by)
);

-- ────────────────────────────────────────────────────────────
-- 8. ROW LEVEL SECURITY (RLS)
-- ────────────────────────────────────────────────────────────

-- 8a. chart_of_accounts
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

-- Users can see their own accounts AND the global seed (created_by IS NULL)
CREATE POLICY "coa_select" ON public.chart_of_accounts
    FOR SELECT TO authenticated
    USING (created_by = auth.uid() OR created_by IS NULL);

CREATE POLICY "coa_insert" ON public.chart_of_accounts
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "coa_update" ON public.chart_of_accounts
    FOR UPDATE TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "coa_delete" ON public.chart_of_accounts
    FOR DELETE TO authenticated
    USING (created_by = auth.uid());

-- 8b. invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_select" ON public.invoices
    FOR SELECT TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "invoices_insert" ON public.invoices
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "invoices_update" ON public.invoices
    FOR UPDATE TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "invoices_delete" ON public.invoices
    FOR DELETE TO authenticated
    USING (created_by = auth.uid());

-- 8c. invoice_line_items (access via invoice ownership)
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_lines_select" ON public.invoice_line_items
    FOR SELECT TO authenticated
    USING (
        invoice_id IN (
            SELECT id FROM public.invoices WHERE created_by = auth.uid()
        )
    );

CREATE POLICY "invoice_lines_insert" ON public.invoice_line_items
    FOR INSERT TO authenticated
    WITH CHECK (
        invoice_id IN (
            SELECT id FROM public.invoices WHERE created_by = auth.uid()
        )
    );

CREATE POLICY "invoice_lines_update" ON public.invoice_line_items
    FOR UPDATE TO authenticated
    USING (
        invoice_id IN (
            SELECT id FROM public.invoices WHERE created_by = auth.uid()
        )
    );

CREATE POLICY "invoice_lines_delete" ON public.invoice_line_items
    FOR DELETE TO authenticated
    USING (
        invoice_id IN (
            SELECT id FROM public.invoices WHERE created_by = auth.uid()
        )
    );

-- 8d. tds_entries
ALTER TABLE public.tds_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tds_select" ON public.tds_entries
    FOR SELECT TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "tds_insert" ON public.tds_entries
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "tds_update" ON public.tds_entries
    FOR UPDATE TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "tds_delete" ON public.tds_entries
    FOR DELETE TO authenticated
    USING (created_by = auth.uid());

-- 8e. gst_returns
ALTER TABLE public.gst_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gst_returns_select" ON public.gst_returns
    FOR SELECT TO authenticated
    USING (created_by = auth.uid());

CREATE POLICY "gst_returns_insert" ON public.gst_returns
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "gst_returns_update" ON public.gst_returns
    FOR UPDATE TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "gst_returns_delete" ON public.gst_returns
    FOR DELETE TO authenticated
    USING (created_by = auth.uid());

-- 8f. journal_entries
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journal_entries_select" ON public.journal_entries
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "journal_entries_insert" ON public.journal_entries
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "journal_entries_update" ON public.journal_entries
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "journal_entries_delete" ON public.journal_entries
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- 8g. journal_lines
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journal_lines_select" ON public.journal_lines
    FOR SELECT TO authenticated
    USING (
        journal_entry_id IN (
            SELECT id FROM public.journal_entries WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "journal_lines_insert" ON public.journal_lines
    FOR INSERT TO authenticated
    WITH CHECK (
        journal_entry_id IN (
            SELECT id FROM public.journal_entries WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "journal_lines_update" ON public.journal_lines
    FOR UPDATE TO authenticated
    USING (
        journal_entry_id IN (
            SELECT id FROM public.journal_entries WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        journal_entry_id IN (
            SELECT id FROM public.journal_entries WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "journal_lines_delete" ON public.journal_lines
    FOR DELETE TO authenticated
    USING (
        journal_entry_id IN (
            SELECT id FROM public.journal_entries WHERE user_id = auth.uid()
        )
    );

-- ────────────────────────────────────────────────────────────

-- 9. INDEXES for performance
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_coa_type       ON public.chart_of_accounts (account_type);
CREATE INDEX IF NOT EXISTS idx_coa_created_by ON public.chart_of_accounts (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by    ON public.invoices (created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_type          ON public.invoices (invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_date          ON public.invoices (invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_inv_id   ON public.invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_tds_created_by         ON public.tds_entries (created_by);
CREATE INDEX IF NOT EXISTS idx_tds_section            ON public.tds_entries (section_code);
CREATE INDEX IF NOT EXISTS idx_gst_created_by         ON public.gst_returns (created_by);
CREATE INDEX IF NOT EXISTS idx_gst_period             ON public.gst_returns (period_year, period_month);

-- ────────────────────────────────────────────────────────────
-- 10. SEED — Standard Indian Chart of Accounts (Ind AS)
--     created_by = NULL → visible to all authenticated users
--     These are the standard accounts every Indian business uses.
-- ────────────────────────────────────────────────────────────

INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_sub_type, description, is_active, created_by)
VALUES

-- ──────────── ASSETS ────────────

-- Current Assets
('1000', 'Cash in Hand',              'Asset', 'Current Asset', 'Physical cash held at business premises', TRUE, NULL),
('1010', 'Petty Cash',                'Asset', 'Current Asset', 'Small cash fund for minor expenses', TRUE, NULL),
('1020', 'Bank Account – Current',    'Asset', 'Current Asset', 'Primary current account with bank', TRUE, NULL),
('1030', 'Bank Account – Savings',    'Asset', 'Current Asset', 'Savings account with bank', TRUE, NULL),
('1040', 'Fixed Deposit',             'Asset', 'Current Asset', 'Fixed deposits with banks (< 1 year)', TRUE, NULL),

-- Receivables
('1100', 'Accounts Receivable',       'Asset', 'Current Asset', 'Amounts owed by customers', TRUE, NULL),
('1110', 'Notes Receivable',          'Asset', 'Current Asset', 'Promissory notes receivable', TRUE, NULL),
('1120', 'Advance to Suppliers',      'Asset', 'Current Asset', 'Advances paid to suppliers', TRUE, NULL),
('1130', 'Employee Advances',         'Asset', 'Current Asset', 'Advances given to employees', TRUE, NULL),

-- GST Input Credit
('1200', 'GST Input Credit – CGST',   'Asset', 'Current Asset', 'Central GST input tax credit', TRUE, NULL),
('1210', 'GST Input Credit – SGST',   'Asset', 'Current Asset', 'State GST input tax credit', TRUE, NULL),
('1220', 'GST Input Credit – IGST',   'Asset', 'Current Asset', 'Integrated GST input tax credit', TRUE, NULL),
('1230', 'GST Input Credit – CESS',   'Asset', 'Current Asset', 'GST Compensation Cess input credit', TRUE, NULL),
('1240', 'GST Refund Receivable',     'Asset', 'Current Asset', 'GST refund claimed but not yet received', TRUE, NULL),

-- TDS & Tax
('1300', 'TDS Receivable',            'Asset', 'Current Asset', 'TDS deducted by customers/payers', TRUE, NULL),
('1310', 'Advance Tax Paid',          'Asset', 'Current Asset', 'Advance income tax installments paid', TRUE, NULL),
('1320', 'Self Assessment Tax Paid',  'Asset', 'Current Asset', 'Self-assessment tax paid', TRUE, NULL),
('1330', 'Income Tax Refund Receivable','Asset','Current Asset','Income tax refund expected from IT dept', TRUE, NULL),

-- Other Current Assets
('1400', 'Inventory – Raw Materials', 'Asset', 'Current Asset', 'Raw material stock', TRUE, NULL),
('1410', 'Inventory – WIP',           'Asset', 'Current Asset', 'Work-in-progress inventory', TRUE, NULL),
('1420', 'Inventory – Finished Goods','Asset', 'Current Asset', 'Finished goods ready for sale', TRUE, NULL),
('1430', 'Prepaid Expenses',          'Asset', 'Current Asset', 'Expenses paid in advance (insurance, rent, etc.)', TRUE, NULL),
('1440', 'Security Deposit',          'Asset', 'Current Asset', 'Refundable deposits paid', TRUE, NULL),
('1450', 'Other Current Assets',      'Asset', 'Current Asset', 'Miscellaneous current assets', TRUE, NULL),

-- Fixed Assets
('1500', 'Land & Building',           'Asset', 'Fixed Asset', 'Land and owned building', TRUE, NULL),
('1510', 'Plant & Machinery',         'Asset', 'Fixed Asset', 'Manufacturing plant and machinery', TRUE, NULL),
('1520', 'Furniture & Fixtures',      'Asset', 'Fixed Asset', 'Office furniture, fittings, and fixtures', TRUE, NULL),
('1530', 'Computers & IT Equipment',  'Asset', 'Fixed Asset', 'Computers, servers, and IT hardware', TRUE, NULL),
('1540', 'Office Equipment',          'Asset', 'Fixed Asset', 'Printers, scanners, copiers, etc.', TRUE, NULL),
('1550', 'Vehicles',                  'Asset', 'Fixed Asset', 'Cars, trucks, and other vehicles', TRUE, NULL),
('1560', 'Accumulated Depreciation',  'Asset', 'Fixed Asset', 'Total depreciation charged to date (contra)', TRUE, NULL),
('1600', 'Intangible Assets',         'Asset', 'Fixed Asset', 'Goodwill, patents, trademarks, software', TRUE, NULL),
('1610', 'Capital WIP',               'Asset', 'Fixed Asset', 'Assets under construction or installation', TRUE, NULL),
('1700', 'Long-term Investments',     'Asset', 'Non-Current Asset', 'Investments held > 1 year (shares, bonds)', TRUE, NULL),

-- ──────────── LIABILITIES ────────────

-- Current Liabilities
('2000', 'Accounts Payable',          'Liability', 'Current Liability', 'Amounts owed to suppliers', TRUE, NULL),
('2010', 'Notes Payable',             'Liability', 'Current Liability', 'Short-term promissory notes payable', TRUE, NULL),
('2020', 'Advance from Customers',    'Liability', 'Current Liability', 'Advances received from customers', TRUE, NULL),
('2030', 'Salary Payable',            'Liability', 'Current Liability', 'Net salaries due to employees', TRUE, NULL),
('2040', 'PF Payable',                'Liability', 'Current Liability', 'Provident Fund contributions payable', TRUE, NULL),
('2050', 'ESI Payable',               'Liability', 'Current Liability', 'Employee State Insurance contributions payable', TRUE, NULL),
('2060', 'Professional Tax Payable',  'Liability', 'Current Liability', 'Professional tax deducted from employees', TRUE, NULL),
('2070', 'TDS Payable',               'Liability', 'Current Liability', 'TDS deducted from payments, pending deposit', TRUE, NULL),

-- GST Payable
('2100', 'GST Payable – CGST',        'Liability', 'Current Liability', 'Output CGST collected, pending remittance', TRUE, NULL),
('2110', 'GST Payable – SGST',        'Liability', 'Current Liability', 'Output SGST collected, pending remittance', TRUE, NULL),
('2120', 'GST Payable – IGST',        'Liability', 'Current Liability', 'Output IGST collected, pending remittance', TRUE, NULL),
('2130', 'GST Payable – CESS',        'Liability', 'Current Liability', 'Output GST Cess collected, pending remittance', TRUE, NULL),

-- Other Current Liabilities
('2200', 'Income Tax Payable',        'Liability', 'Current Liability', 'Income tax due for the year', TRUE, NULL),
('2210', 'Accrued Expenses',          'Liability', 'Current Liability', 'Expenses incurred but not yet paid', TRUE, NULL),
('2220', 'Bank Overdraft',            'Liability', 'Current Liability', 'Overdraft balance on current account', TRUE, NULL),
('2230', 'Short-term Loan',           'Liability', 'Current Liability', 'Loans repayable within 12 months', TRUE, NULL),
('2240', 'Other Current Liabilities', 'Liability', 'Current Liability', 'Miscellaneous current liabilities', TRUE, NULL),

-- Non-Current Liabilities
('2500', 'Long-term Loan',            'Liability', 'Non-Current Liability', 'Bank loans repayable after 12 months', TRUE, NULL),
('2510', 'Debentures Payable',        'Liability', 'Non-Current Liability', 'Debentures / bonds issued', TRUE, NULL),
('2520', 'Deferred Tax Liability',    'Liability', 'Non-Current Liability', 'Deferred tax as per Ind AS 12', TRUE, NULL),

-- ──────────── EQUITY ────────────
('3000', 'Share Capital',             'Equity', 'Share Capital', 'Paid-up equity share capital', TRUE, NULL),
('3010', 'Preference Share Capital',  'Equity', 'Share Capital', 'Paid-up preference share capital', TRUE, NULL),
('3020', 'Securities Premium',        'Equity', 'Reserves & Surplus', 'Premium received on issue of shares', TRUE, NULL),
('3030', 'Retained Earnings',         'Equity', 'Reserves & Surplus', 'Accumulated profits not yet distributed', TRUE, NULL),
('3040', 'General Reserve',           'Equity', 'Reserves & Surplus', 'Amounts transferred to general reserve', TRUE, NULL),
('3050', 'Owner''s Capital',           'Equity', 'Proprietors Capital', 'Capital contributed by proprietor/partners', TRUE, NULL),
('3060', 'Drawings',                  'Equity', 'Proprietors Capital', 'Withdrawals by owner/partners (contra equity)', TRUE, NULL),
('3070', 'Other Comprehensive Income','Equity', 'Reserves & Surplus', 'OCI items as per Ind AS (e.g. actuarial gains)', TRUE, NULL),

-- ──────────── REVENUE ────────────
('4000', 'Sales Revenue – Goods',     'Revenue', 'Operating Revenue', 'Revenue from sale of goods', TRUE, NULL),
('4010', 'Sales Revenue – Services',  'Revenue', 'Operating Revenue', 'Revenue from rendering of services', TRUE, NULL),
('4020', 'Export Revenue',            'Revenue', 'Operating Revenue', 'Revenue from exports (zero-rated GST)', TRUE, NULL),
('4030', 'Other Operating Revenue',   'Revenue', 'Operating Revenue', 'Other operating income', TRUE, NULL),
('4100', 'Interest Income',           'Revenue', 'Non-Operating Revenue', 'Interest earned on deposits/loans', TRUE, NULL),
('4110', 'Commission Income',         'Revenue', 'Non-Operating Revenue', 'Commission and agency fees received', TRUE, NULL),
('4120', 'Rental Income',             'Revenue', 'Non-Operating Revenue', 'Rent received from subletting', TRUE, NULL),
('4130', 'Dividend Income',           'Revenue', 'Non-Operating Revenue', 'Dividends received from investments', TRUE, NULL),
('4140', 'Profit on Sale of Assets',  'Revenue', 'Non-Operating Revenue', 'Gain on disposal of fixed assets', TRUE, NULL),
('4150', 'Other Income',              'Revenue', 'Non-Operating Revenue', 'Miscellaneous income', TRUE, NULL),

-- ──────────── EXPENSES ────────────

-- Cost of Goods / Services
('5000', 'Cost of Goods Sold',        'Expense', 'Direct Cost', 'Direct cost of goods sold', TRUE, NULL),
('5010', 'Raw Material Consumed',     'Expense', 'Direct Cost', 'Raw materials consumed in production', TRUE, NULL),
('5020', 'Direct Labour',             'Expense', 'Direct Cost', 'Wages of direct production workers', TRUE, NULL),
('5030', 'Manufacturing Overhead',    'Expense', 'Direct Cost', 'Factory overhead costs', TRUE, NULL),
('5040', 'Freight Inward',            'Expense', 'Direct Cost', 'Carriage and freight on purchases', TRUE, NULL),

-- Personnel Costs
('5100', 'Salary & Wages Expense',    'Expense', 'Personnel', 'Gross salaries and wages paid to staff', TRUE, NULL),
('5110', 'PF Contribution - Employer', 'Expense', 'Personnel', 'Employer''s PF contribution (12% of basic)', TRUE, NULL),
('5120', 'ESI Contribution - Employer','Expense','Personnel', 'Employer''s ESI contribution (3.25%)', TRUE, NULL),
('5130', 'Staff Welfare',             'Expense', 'Personnel', 'Tea, meals, gifts for staff', TRUE, NULL),
('5140', 'Recruitment Expense',       'Expense', 'Personnel', 'Hiring and recruitment costs', TRUE, NULL),

-- Administrative Expenses
('5200', 'Rent Expense',              'Expense', 'Administrative', 'Office / factory / warehouse rent', TRUE, NULL),
('5210', 'Office Supplies',           'Expense', 'Administrative', 'Stationery, printing, and office consumables', TRUE, NULL),
('5220', 'Electricity & Utilities',   'Expense', 'Administrative', 'Power, water, internet, and telecom bills', TRUE, NULL),
('5230', 'Repairs & Maintenance',     'Expense', 'Administrative', 'Building and equipment maintenance', TRUE, NULL),
('5240', 'Insurance Expense',         'Expense', 'Administrative', 'Business, asset, and health insurance', TRUE, NULL),
('5250', 'Communication Expense',     'Expense', 'Administrative', 'Telephone, postage, and courier charges', TRUE, NULL),
('5260', 'Professional Fees',         'Expense', 'Administrative', 'CA, legal, consulting, and advisory fees', TRUE, NULL),
('5270', 'Audit Fees',                'Expense', 'Administrative', 'Statutory and internal audit fees', TRUE, NULL),
('5280', 'Printing & Stationery',     'Expense', 'Administrative', 'Printing, stationery, and photocopying', TRUE, NULL),
('5290', 'Miscellaneous Expense',     'Expense', 'Administrative', 'Other minor administrative expenses', TRUE, NULL),

-- Selling & Distribution
('5300', 'Marketing & Advertising',   'Expense', 'Selling', 'Digital and offline marketing costs', TRUE, NULL),
('5310', 'Commission Paid',           'Expense', 'Selling', 'Sales commission paid to agents/staff', TRUE, NULL),
('5320', 'Freight Outward',           'Expense', 'Selling', 'Delivery and shipping charges on sales', TRUE, NULL),
('5330', 'Discount Allowed',          'Expense', 'Selling', 'Discounts given to customers', TRUE, NULL),
('5340', 'Bad Debts',                 'Expense', 'Selling', 'Irrecoverable amounts written off', TRUE, NULL),

-- Finance Costs
('5400', 'Bank Charges',              'Expense', 'Finance Cost', 'Bank service charges, DD charges, etc.', TRUE, NULL),
('5410', 'Interest Expense',          'Expense', 'Finance Cost', 'Interest on loans, overdraft, debentures', TRUE, NULL),
('5420', 'Loan Processing Fees',      'Expense', 'Finance Cost', 'Bank loan processing and documentation charges', TRUE, NULL),

-- Depreciation & Amortisation
('5500', 'Depreciation Expense',      'Expense', 'Depreciation', 'Depreciation on tangible fixed assets', TRUE, NULL),
('5510', 'Amortisation Expense',      'Expense', 'Depreciation', 'Amortisation of intangible assets', TRUE, NULL),

-- Tax Expenses
('5600', 'Income Tax Expense',        'Expense', 'Tax', 'Current year income tax provision', TRUE, NULL),
('5610', 'Deferred Tax Expense',      'Expense', 'Tax', 'Deferred tax charge/credit (Ind AS 12)', TRUE, NULL),

-- Travel & Entertainment
('5700', 'Travel Expense',            'Expense', 'Travel', 'Air, rail, taxi, and local travel', TRUE, NULL),
('5710', 'Hotel & Accommodation',     'Expense', 'Travel', 'Hotel and lodging during business travel', TRUE, NULL),
('5720', 'Business Meals',            'Expense', 'Travel', 'Client and team entertainment meals', TRUE, NULL)

ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 11. Update trigger for updated_at on new tables
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['chart_of_accounts','invoices','tds_entries','gst_returns']
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_' || tbl || '_updated_at'
        ) THEN
            EXECUTE FORMAT(
                'CREATE TRIGGER trg_%I_updated_at
                 BEFORE UPDATE ON public.%I
                 FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
                tbl, tbl
            );
        END IF;
    END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- DONE — Phase 1 migration complete.
-- Verify with:
--   SELECT COUNT(*) FROM chart_of_accounts;   -- should be ~80
--   SELECT column_name FROM information_schema.columns WHERE table_name='journal_entries';
-- ────────────────────────────────────────────────────────────
