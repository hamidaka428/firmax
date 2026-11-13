// Types shared between server and client components.

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

export interface Product {
    id: number;
    sku: string;
    name: string;
    category: string;
    unit: string;
    qty_in_stock: number;
    min_stock_level: number;
    unit_price: number;
}

export type ProductInput = Omit<Product, 'id'>;

// ---------------------------------------------------------------------------
// Clients (CRM)
// ---------------------------------------------------------------------------
export interface Client {
    id: number;
    name: string;
    reg_no: string;
    vat_number: string;
    city: string;
    address: string;
    country: string;
    representative: string;
    phone: string;
    email: string;
    notes: string;
}

export type ClientInput = Omit<Client, 'id'>;

export interface ClientRow extends Client {
    contract_count: number;
    invoiced_total: number;
    unpaid_total: number;
}

export interface ClientHistory {
    contracts: {
        id: number;
        contract_number: string;
        title: string;
        contract_type: string;
        start_date: string;
        end_date: string | null;
        total_price: number;
        status: string;
    }[];
    invoices: {
        id: number;
        invoice_number: string;
        issue_date: string;
        due_date: string | null;
        total_amount: number;
        status: string;
    }[];
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------
export const CONTRACT_TYPES = ['rental', 'sale', 'service'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_STATUSES = ['active', 'completed'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface ContractItem {
    id: number;
    product_id: number | null;
    description: string;
    unit: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    stock_deducted: boolean;
}

export interface ContractItemInput {
    product_id: number | null;
    description: string;
    unit: string;
    quantity: number;
    unit_price: number;
}

export interface Contract {
    id: number;
    contract_number: string;
    title: string;
    contract_type: ContractType;
    client_id: number | null;
    client_name: string;
    start_date: string;
    end_date: string | null;
    total_price: number;
    status: ContractStatus;
    file_path: string | null;
    file_name: string | null;
    notes: string;
    template_id: number | null;
    /** The filled-in contract text (from a template or typed by hand). Empty = no text. */
    body: string;
    invoice_count: number;
    deducted_count: number;
    items: ContractItem[];
    /** Recurring billing: 0 = off, otherwise every N months. */
    billing_months: number;
    billing_start: string | null;
    billing_issued: number;
    billing_due_days: number;
    billing_vat_rate: number;
    billing_vat_exempt_reason: string;
    billing_auto_email: boolean;
    /** Date of the next recurring invoice (null = none). */
    billing_next: string | null;
    share_token: string | null;
    sent_at: string | null;
    sent_to: string;
    viewed_at: string | null;
}

export interface ContractInput {
    contract_number: string;
    title: string;
    client_id: number;
    contract_type: ContractType;
    start_date: string;
    end_date: string | null;
    status: ContractStatus;
    notes: string;
    template_id: number | null;
    body: string;
    items: ContractItemInput[];
    deduct_stock: boolean;
    billing_months: number;
    billing_start: string | null;
    billing_due_days: number;
    billing_vat_rate: number;
    billing_vat_exempt_reason: string;
    billing_auto_email: boolean;
}

/** Client for dropdowns — with the fields needed to fill in a template. */
export interface ClientOption {
    id: number;
    name: string;
    reg_no: string;
    vat_number: string;
    city: string;
    address: string;
    country: string;
    representative: string;
    phone: string;
    email: string;
}

export interface ContractTemplate {
    id: number;
    name: string;
    contract_type: ContractType;
    default_title: string;
    default_months: number | null;
    body: string;
    updated_at: string;
    contract_count: number;
}

export interface ContractTemplateInput {
    name: string;
    contract_type: ContractType;
    default_title: string;
    default_months: number | null;
    body: string;
}

export interface ProductOption {
    id: number;
    sku: string;
    name: string;
    unit: string;
    qty_in_stock: number;
    unit_price: number;
}

export interface StockUpdate {
    id: number;
    qty_in_stock: number;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export const INVOICE_STATUSES = ['pending', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['bank_transfer', 'cash', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** VAT rate bounds (percent). Any rate in this range with up to 2 decimals is accepted. */
export const VAT_RATE_MAX = 100;

export function isValidVatRate(rate: unknown): rate is number {
    return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= VAT_RATE_MAX && Math.round(rate * 100) === rate * 100;
}

export interface InvoiceItem {
    id: number;
    product_id: number | null;
    description: string;
    unit: string;
    quantity: number;
    unit_price: number;
    line_total: number;
}

export interface Invoice {
    id: number;
    invoice_number: string;
    client_id: number | null;
    client_name: string;
    contract_id: number | null;
    contract_number: string;
    issue_date: string;
    due_date: string | null;
    subtotal: number;
    vat_rate: number;
    vat_exempt_reason: string;
    vat_amount: number;
    total_amount: number;
    status: InvoiceStatus;
    payment_method: PaymentMethod;
    paid_date: string | null;
    file_path: string | null;
    file_name: string | null;
    notes: string;
    /** Document type */
    doc_type: DocType;
    /** Note → the invoice it amends; invoice → the proforma it was issued from */
    related_invoice_id: number | null;
    related_number: string;
    related_date: string | null;
    /** Reason for a credit/debit note */
    note_reason: string;
    /** Proforma → number of the invoice issued from it (empty if none yet) */
    converted_number: string;
    /** 'main', 's<id>' (additional number series) or 'proforma' */
    series_key: string;
    /** null = the company's main bank account */
    bank_account_id: number | null;
    /** Online link (null = not shared) and email delivery */
    share_token: string | null;
    sent_at: string | null;
    sent_to: string;
    viewed_at: string | null;
    items: InvoiceItem[];
}

export const DOC_TYPES = ['invoice', 'credit_note', 'debit_note', 'proforma'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface InvoiceInput {
    client_id: number;
    contract_id: number | null;
    issue_date: string;
    /** null only for credit notes (no payment term) */
    due_date: string | null;
    /** Defaults to 'invoice'. The type cannot be changed when editing. */
    doc_type?: DocType;
    related_invoice_id?: number | null;
    note_reason?: string;
    payment_method: PaymentMethod;
    vat_rate: number;
    /** VAT exemption note — required when the rate is 0%. */
    vat_exempt_reason: string;
    notes: string;
    items: ContractItemInput[];
    /** Additional number series (new invoices only); null = main series */
    series_id?: number | null;
    /** Additional bank account; null = main account */
    bank_account_id?: number | null;
}

export interface ContractOption {
    id: number;
    contract_number: string;
    title: string;
    client_id: number | null;
    items: ContractItemInput[];
}

// ---------------------------------------------------------------------------
// Company (settings)
// ---------------------------------------------------------------------------
export interface CompanyInput {
    name: string;
    reg_no: string;
    vat_number: string;
    city: string;
    address: string;
    country: string;
    representative: string;
    phone: string;
    email: string;
    bank_name: string;
    iban: string;
    bic: string;
    currency: string;
}

/** Additional company bank account (the main one is part of the company details). */
export interface BankAccount {
    id: number;
    label: string;
    bank_name: string;
    iban: string;
    bic: string;
    invoices: number;
}

/** Additional number series. The main one is 'main'. */
export interface InvoiceSeries {
    id: number;
    name: string;
    next_number: number;
    invoices: number;
}
