'use server';

import { revalidatePath } from 'next/cache';
import { query, withTransaction } from '@/app/lib/db';
import type { DbClient } from '@/app/lib/db';
import { getActiveCompanyId } from '@/app/lib/tenant';
import { deleteStoredFile, saveUpload } from '@/app/lib/storage';
import { round, SQL_TZ } from '@/app/lib/format';
import { DOC_TYPES, INVOICE_STATUSES, PAYMENT_METHODS, isValidVatRate } from '@/app/lib/types';
import { isNote } from '@/app/lib/documents';
import type { ActionResult, Invoice, InvoiceInput, InvoiceStatus, ContractItemInput, DocType, PaymentMethod } from '@/app/lib/types';
import { loadInvoices } from './data';
import { NumberingError, assignNumber, seriesKeyFor } from '@/app/lib/numbering';

/** An error whose message is suitable for showing to the user. */
class UserError extends Error {}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
    if (error instanceof UserError || error instanceof NumberingError) return { ok: false, error: error.message };
    const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
    if (code === '23505') return { ok: false, error: 'An invoice with this number already exists.' };
    console.error(fallback, error);
    return { ok: false, error: fallback };
}

function refresh() {
    revalidatePath('/dashboard/invoices');
    revalidatePath('/dashboard/contracts');
    revalidatePath('/dashboard/clients');
    revalidatePath('/dashboard');
}

function isValidISODate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

interface ParsedInvoice {
    doc_type: DocType;
    related_invoice_id: number | null;
    note_reason: string;
    client_id: number;
    contract_id: number | null;
    issue_date: string;
    due_date: string | null;
    payment_method: PaymentMethod;
    vat_rate: number;
    vat_exempt_reason: string;
    notes: string;
    items: (ContractItemInput & { line_total: number })[];
    subtotal: number;
    vat_amount: number;
    total_amount: number;
    series_id: number | null;
    bank_account_id: number | null;
}

function parseInvoice(raw: unknown): ParsedInvoice {
    if (typeof raw !== 'object' || raw === null) throw new UserError('Invalid data.');
    const r = raw as Record<string, unknown>;

    const client_id = typeof r.client_id === 'number' && Number.isInteger(r.client_id) ? r.client_id : 0;
    const contract_id = typeof r.contract_id === 'number' && Number.isInteger(r.contract_id) ? r.contract_id : null;
    const payment_method = r.payment_method as PaymentMethod;
    const vat_rate = r.vat_rate as number;
    const notes = typeof r.notes === 'string' ? r.notes.trim() : '';
    const vat_exempt_reason = vat_rate === 0 && typeof r.vat_exempt_reason === 'string' ? r.vat_exempt_reason.trim() : '';
    const doc_type: DocType = DOC_TYPES.includes(r.doc_type as DocType) ? (r.doc_type as DocType) : 'invoice';
    const related_invoice_id =
        typeof r.related_invoice_id === 'number' && Number.isInteger(r.related_invoice_id) && r.related_invoice_id > 0 ? r.related_invoice_id : null;
    const note_reason = typeof r.note_reason === 'string' ? r.note_reason.trim() : '';
    const posInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
    const series_id = posInt(r.series_id);
    const bank_account_id = posInt(r.bank_account_id);

    if (client_id <= 0) throw new UserError('Select a client.');
    if (!isValidISODate(r.issue_date)) throw new UserError('Invalid issue date.');
    // A credit note has no payment term
    const due_date = doc_type === 'credit_note' ? null : r.due_date;
    if (doc_type !== 'credit_note') {
        if (!isValidISODate(due_date)) throw new UserError('Invalid due date.');
        if (due_date < r.issue_date) throw new UserError('The due date cannot be before the issue date.');
    }
    if (isNote(doc_type)) {
        if (related_invoice_id === null) throw new UserError('Select the invoice this note relates to.');
        if (note_reason.length < 3) throw new UserError('Enter a reason for the note (e.g. "Returned goods", "Discount", "Price correction").');
        if (note_reason.length > 500) throw new UserError('The reason is too long.');
    }
    if (!PAYMENT_METHODS.includes(payment_method)) throw new UserError('Invalid payment method.');
    if (!isValidVatRate(vat_rate)) throw new UserError('Invalid VAT rate (0–100%).');
    if (vat_rate === 0 && !vat_exempt_reason) {
        throw new UserError('With 0% VAT, enter the VAT exemption note (e.g. reverse charge, export).');
    }
    if (vat_exempt_reason.length > 255) throw new UserError('The VAT exemption note is too long.');
    if (notes.length > 5000) throw new UserError('The notes are too long.');

    if (!Array.isArray(r.items) || r.items.length === 0) throw new UserError('Add at least one line to the invoice.');
    if (r.items.length > 100) throw new UserError('The maximum is 100 lines per invoice.');

    const items = r.items.map((rawItem, index) => {
        const it = (typeof rawItem === 'object' && rawItem !== null ? rawItem : {}) as Record<string, unknown>;
        const description = typeof it.description === 'string' ? it.description.trim() : '';
        const unit = typeof it.unit === 'string' && it.unit.trim() ? it.unit.trim() : 'pcs';
        const quantity = typeof it.quantity === 'number' ? round(it.quantity, 3) : NaN;
        const unit_price = typeof it.unit_price === 'number' ? round(it.unit_price, 2) : NaN;
        const product_id = typeof it.product_id === 'number' && Number.isInteger(it.product_id) ? it.product_id : null;

        if (!description || description.length > 255) throw new UserError(`Line ${index + 1}: invalid description.`);
        if (unit.length > 20) throw new UserError(`Line ${index + 1}: the unit is too long.`);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
            throw new UserError(`Line ${index + 1}: quantity must be a positive number.`);
        }
        if (!Number.isFinite(unit_price) || unit_price < 0 || unit_price > 1_000_000_000) {
            throw new UserError(`Line ${index + 1}: invalid unit price.`);
        }
        return { product_id, description, unit, quantity, unit_price, line_total: round(quantity * unit_price, 2) };
    });

    const subtotal = round(items.reduce((sum, i) => sum + i.line_total, 0), 2);
    const vat_amount = round((subtotal * vat_rate) / 100, 2);

    return {
        doc_type,
        related_invoice_id: isNote(doc_type) ? related_invoice_id : null,
        note_reason: isNote(doc_type) ? note_reason : '',
        client_id,
        contract_id,
        issue_date: r.issue_date,
        due_date: due_date as string | null,
        payment_method,
        vat_rate,
        vat_exempt_reason,
        notes,
        items,
        subtotal,
        vat_amount,
        total_amount: round(subtotal + vat_amount, 2),
        series_id: doc_type === 'invoice' ? series_id : null,
        bank_account_id,
    };
}

/**
 * A note must relate to a non-cancelled invoice of the same client with the same VAT rate,
 * and the total credited cannot exceed the invoice (plus any debit notes on it).
 */
async function validateNote(client: DbClient, companyId: number, data: ParsedInvoice, selfId: number | null): Promise<void> {
    const orig = await client.query<{ client_id: number | null; vat_rate: number; total_amount: number; status: string; doc_type: DocType; issue_date: string }>(
        `SELECT client_id, vat_rate, total_amount, status, doc_type, issue_date
           FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [data.related_invoice_id, companyId],
    );
    const o = orig.rows[0];
    if (!o || o.doc_type !== 'invoice') throw new UserError('A note can only be issued against an invoice of the same company.');
    if (o.status === 'cancelled') throw new UserError('A note cannot be issued against a cancelled invoice.');
    if (o.client_id !== data.client_id) throw new UserError('The note must be addressed to the same recipient as the invoice.');
    if (Number(o.vat_rate) !== data.vat_rate) throw new UserError(`The VAT rate must match the invoice (${o.vat_rate}%).`);
    if (data.issue_date < o.issue_date) throw new UserError('The note cannot be dated before the invoice.');

    if (data.doc_type === 'credit_note') {
        const sums = await client.query<{ credited: number; debited: number }>(
            `SELECT COALESCE(SUM(total_amount) FILTER (WHERE doc_type = 'credit_note'), 0)::float8 AS credited,
                    COALESCE(SUM(total_amount) FILTER (WHERE doc_type = 'debit_note'), 0)::float8 AS debited
               FROM invoices
              WHERE related_invoice_id = $1 AND company_id = $3 AND status <> 'cancelled' AND ($2::int IS NULL OR id <> $2)`,
            [data.related_invoice_id, selfId, companyId],
        );
        const available = round(Number(o.total_amount) + sums.rows[0].debited - sums.rows[0].credited, 2);
        if (data.total_amount > available + 0.001) {
            throw new UserError(`The credit note (${data.total_amount.toFixed(2)}) exceeds the remaining invoice balance (${available.toFixed(2)}).`);
        }
    }
}

async function saveInvoiceTx(client: DbClient, companyId: number, invoiceId: number | null, data: ParsedInvoice): Promise<number> {
    const clientCheck = await client.query(`SELECT 1 FROM clients WHERE id = $1 AND company_id = $2`, [data.client_id, companyId]);
    if (clientCheck.rows.length === 0) throw new UserError('The selected client does not exist.');

    if (data.contract_id !== null) {
        const ct = await client.query<{ client_id: number | null }>(
            `SELECT client_id FROM contracts WHERE id = $1 AND company_id = $2`,
            [data.contract_id, companyId],
        );
        if (ct.rows.length === 0) throw new UserError('The selected contract does not exist.');
        if (ct.rows[0].client_id !== null && ct.rows[0].client_id !== data.client_id) {
            throw new UserError('The selected contract belongs to another client.');
        }
    }

    const productIds = Array.from(new Set(data.items.map((i) => i.product_id).filter((x): x is number => x !== null)));
    if (productIds.length > 0) {
        const found = await client.query(`SELECT id FROM products WHERE company_id = $1 AND id = ANY($2::int[])`, [companyId, productIds]);
        if (found.rows.length !== productIds.length) throw new UserError('One of the selected products does not exist in inventory.');
    }

    if (data.bank_account_id !== null) {
        const ba = await client.query(`SELECT 1 FROM bank_accounts WHERE id = $1 AND company_id = $2`, [data.bank_account_id, companyId]);
        if (ba.rows.length === 0) throw new UserError('The selected bank account does not exist.');
    }

    let id: number;
    if (invoiceId === null) {
        let seriesKey = seriesKeyFor(data.series_id);
        if (isNote(data.doc_type)) {
            await validateNote(client, companyId, data, null);
            // A note belongs to its invoice's number series
            const o = await client.query<{ series_key: string }>(`SELECT series_key FROM invoices WHERE id = $1 AND company_id = $2`, [data.related_invoice_id, companyId]);
            seriesKey = o.rows[0]?.series_key ?? 'main';
        }
        const assigned = await assignNumber(client, companyId, data.doc_type, seriesKey);
        const num = { rows: [{ n: assigned.number }] };
        const ins = await client.query<{ id: number }>(
            `INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                                   subtotal, vat_rate, vat_amount, total_amount, status, payment_method, notes,
                                   vat_exempt_reason, doc_type, related_invoice_id, note_reason, series_key, bank_account_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
            [companyId, data.client_id, data.contract_id, num.rows[0].n, data.issue_date, data.due_date,
             data.subtotal, data.vat_rate, data.vat_amount, data.total_amount, data.payment_method, data.notes,
             data.vat_exempt_reason, data.doc_type, data.related_invoice_id, data.note_reason,
             assigned.seriesKey, data.bank_account_id],
        );
        id = ins.rows[0].id;
    } else {
        const cur = await client.query<{ status: string; doc_type: DocType; related_invoice_id: number | null }>(
            `SELECT status, doc_type, related_invoice_id FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
            [invoiceId, companyId],
        );
        if (cur.rows.length === 0) throw new UserError('Document not found.');
        if (cur.rows[0].status !== 'pending') throw new UserError('Only pending documents can be edited.');
        // The type and the link are not changed when editing
        data.doc_type = cur.rows[0].doc_type;
        data.related_invoice_id = isNote(data.doc_type) ? cur.rows[0].related_invoice_id : null;
        if (data.doc_type === 'credit_note') data.due_date = null;
        if (!isNote(data.doc_type)) data.note_reason = '';
        if (isNote(data.doc_type)) await validateNote(client, companyId, data, invoiceId);

        await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
        await client.query(
            `UPDATE invoices
                SET client_id = $1, contract_id = $2, issue_date = $3, due_date = $4,
                    subtotal = $5, vat_rate = $6, vat_amount = $7, total_amount = $8,
                    payment_method = $9, notes = $10, vat_exempt_reason = $13, note_reason = $14, bank_account_id = $15
              WHERE id = $11 AND company_id = $12`,
            [data.client_id, data.contract_id, data.issue_date, data.due_date, data.subtotal, data.vat_rate,
             data.vat_amount, data.total_amount, data.payment_method, data.notes, invoiceId, companyId,
             data.vat_exempt_reason, data.note_reason, data.bank_account_id],
        );
        id = invoiceId;
    }

    for (let i = 0; i < data.items.length; i++) {
        const it = data.items[i];
        await client.query(
            `INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, it.product_id, it.description, it.unit, it.quantity, it.unit_price, it.line_total, i + 1],
        );
    }
    return id;
}

async function saveInvoice(invoiceId: number | null, raw: unknown): Promise<ActionResult<Invoice>> {
    try {
        const data = parseInvoice(raw);
        const companyId = await getActiveCompanyId();
        const id = await withTransaction((client) => saveInvoiceTx(client, companyId, invoiceId, data));
        const rows = await loadInvoices(companyId, id);
        refresh();
        return { ok: true, data: rows[0] };
    } catch (error) {
        return failure(error, 'Failed to save the document.');
    }
}

/**
 * Issues an invoice from a proforma: copies the lines, the date is today, the due date keeps the proforma's term.
 * If the proforma was paid (advance payment), the invoice is marked as paid.
 */
export async function convertProforma(proformaId: number, today: string, seriesId: number | null = null): Promise<ActionResult<Invoice>> {
    if (!isValidISODate(today)) return { ok: false, error: 'Invalid date.' };
    try {
        const companyId = await getActiveCompanyId();
        const id = await withTransaction(async (client) => {
            const pf = await client.query<{
                client_id: number; contract_id: number | null; issue_date: string; due_date: string | null; subtotal: number; vat_rate: number;
                vat_amount: number; total_amount: number; status: string; payment_method: string; notes: string; vat_exempt_reason: string; doc_type: DocType;
                bank_account_id: number | null;
            }>(
                `SELECT client_id, contract_id, issue_date, due_date, subtotal, vat_rate, vat_amount, total_amount, status,
                        payment_method, notes, vat_exempt_reason, doc_type, bank_account_id
                   FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
                [proformaId, companyId],
            );
            const p = pf.rows[0];
            if (!p || p.doc_type !== 'proforma') throw new UserError('Proforma not found.');
            if (p.status === 'cancelled') throw new UserError('The proforma is cancelled.');
            const done = await client.query<{ invoice_number: string }>(
                `SELECT invoice_number FROM invoices WHERE related_invoice_id = $1 AND company_id = $2 AND doc_type = 'invoice' LIMIT 1`,
                [proformaId, companyId],
            );
            if (done.rows[0]) throw new UserError(`Invoice no. ${done.rows[0].invoice_number} has already been issued from this proforma.`);

            const termDays = p.due_date ? Math.max(0, Math.round((Date.parse(p.due_date) - Date.parse(p.issue_date)) / 86_400_000)) : 14;
            const due = new Date(Date.parse(`${today}T00:00:00Z`) + termDays * 86_400_000).toISOString().slice(0, 10);
            const paid = p.status === 'paid';
            const assigned = await assignNumber(client, companyId, 'invoice', seriesKeyFor(seriesId));
            const ins = await client.query<{ id: number }>(
                `INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                                       subtotal, vat_rate, vat_amount, total_amount, status, payment_method, notes,
                                       vat_exempt_reason, doc_type, related_invoice_id, series_key, paid_at, bank_account_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'invoice', $15, $17,
                         CASE WHEN $16::boolean THEN now() ELSE NULL END, $18) RETURNING id`,
                [companyId, p.client_id, p.contract_id, assigned.number, today, due, p.subtotal, p.vat_rate, p.vat_amount,
                 p.total_amount, paid ? 'paid' : 'pending', p.payment_method, p.notes, p.vat_exempt_reason, proformaId, paid,
                 assigned.seriesKey, p.bank_account_id],
            );
            await client.query(
                `INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
                 SELECT $1, product_id, description, unit, quantity, unit_price, line_total, position
                   FROM invoice_items WHERE invoice_id = $2`,
                [ins.rows[0].id, proformaId],
            );
            return ins.rows[0].id;
        });
        const rows = await loadInvoices(companyId, id);
        refresh();
        return { ok: true, data: rows[0] };
    } catch (error) {
        return failure(error, 'Failed to issue an invoice from the proforma.');
    }
}


export async function createInvoice(raw: InvoiceInput): Promise<ActionResult<Invoice>> {
    return saveInvoice(null, raw);
}

export async function updateInvoice(id: number, raw: InvoiceInput): Promise<ActionResult<Invoice>> {
    return saveInvoice(id, raw);
}

/** One-click status change: paid / cancelled / back to pending. */
export async function setInvoiceStatus(id: number, status: InvoiceStatus): Promise<ActionResult<{ paid_date: string | null }>> {
    if (!INVOICE_STATUSES.includes(status)) return { ok: false, error: 'Invalid status.' };
    try {
        const companyId = await getActiveCompanyId();
        if (status === 'cancelled') {
            const notes = await query<{ n: number }>(
                `SELECT COUNT(*)::int AS n FROM invoices n JOIN invoices i ON i.id = n.related_invoice_id
                  WHERE i.id = $1 AND i.company_id = $2 AND n.doc_type IN ('credit_note', 'debit_note') AND n.status <> 'cancelled'`,
                [id, companyId],
            );
            if (notes.rows[0].n > 0) {
                return { ok: false, error: 'The invoice has notes against it. Cancel the notes first, or correct it with a credit note.' };
            }
        }
        const res = await query<{ paid_date: string | null }>(
            `UPDATE invoices
                SET status = $1, paid_at = CASE WHEN $2::boolean THEN now() ELSE NULL END
              WHERE id = $3 AND company_id = $4
              RETURNING to_char(paid_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD') AS paid_date`,
            [status, status === 'paid', id, companyId],
        );
        if (res.rows.length === 0) return { ok: false, error: 'Document not found.' };
        refresh();
        return { ok: true, data: { paid_date: res.rows[0].paid_date } };
    } catch (error) {
        return failure(error, 'Failed to change the status.');
    }
}

// ---------------------------------------------------------------------------
// External PDFs/images attached to an invoice
// ---------------------------------------------------------------------------
function isFileLike(value: unknown): value is File {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as File).arrayBuffer === 'function' &&
        typeof (value as File).name === 'string' &&
        typeof (value as File).size === 'number'
    );
}

export async function uploadInvoiceFile(
    invoiceId: number,
    formData: FormData,
): Promise<ActionResult<{ file_path: string; file_name: string }>> {
    const file = formData.get('file');
    if (!isFileLike(file)) return { ok: false, error: 'No file selected.' };

    let savedPath: string | null = null;
    try {
        const companyId = await getActiveCompanyId();
        const cur = await query<{ file_path: string | null }>(
            `SELECT file_path FROM invoices WHERE id = $1 AND company_id = $2`,
            [invoiceId, companyId],
        );
        if (cur.rows.length === 0) return { ok: false, error: 'Invoice not found.' };

        const saved = await saveUpload('invoices', file);
        savedPath = saved.filePath;

        await query(`UPDATE invoices SET file_path = $1, file_name = $2 WHERE id = $3 AND company_id = $4`, [
            saved.filePath,
            saved.fileName,
            invoiceId,
            companyId,
        ]);
        await deleteStoredFile(cur.rows[0].file_path);

        revalidatePath('/dashboard/invoices');
        return { ok: true, data: { file_path: saved.filePath, file_name: saved.fileName } };
    } catch (error) {
        await deleteStoredFile(savedPath);
        if (error instanceof Error && !(error instanceof UserError) && /MB|PDF|file/i.test(error.message)) {
            return { ok: false, error: error.message };
        }
        return failure(error, 'Failed to upload the file.');
    }
}

export async function removeInvoiceFile(invoiceId: number): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        const cur = await query<{ file_path: string | null }>(
            `SELECT file_path FROM invoices WHERE id = $1 AND company_id = $2`,
            [invoiceId, companyId],
        );
        if (cur.rows.length === 0) return { ok: false, error: 'Invoice not found.' };

        await query(`UPDATE invoices SET file_path = NULL, file_name = NULL WHERE id = $1 AND company_id = $2`, [invoiceId, companyId]);
        await deleteStoredFile(cur.rows[0].file_path);
        revalidatePath('/dashboard/invoices');
        return { ok: true, data: undefined };
    } catch (error) {
        return failure(error, 'Failed to remove the file.');
    }
}
