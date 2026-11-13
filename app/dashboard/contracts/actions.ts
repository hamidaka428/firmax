'use server';

import { revalidatePath } from 'next/cache';
import { query, withTransaction } from '@/app/lib/db';
import type { DbClient } from '@/app/lib/db';
import { getActiveCompanyId } from '@/app/lib/tenant';
import { deleteStoredFile, saveUpload } from '@/app/lib/storage';
import { SQL_TODAY, formatQty, round } from '@/app/lib/format';
import { CONTRACT_STATUSES, CONTRACT_TYPES, isValidVatRate } from '@/app/lib/types';
import { BILLING_OPTIONS, SQL_NEXT_PERIOD, runRecurringBilling } from '@/app/lib/recurring';
import type {
    ActionResult,
    Contract,
    ContractInput,
    ContractItemInput,
    ContractStatus,
    ContractType,
    StockUpdate,
} from '@/app/lib/types';
import { loadContracts, readStock } from './data';
import { NumberingError, assignNumber } from '@/app/lib/numbering';

/** An error whose message is suitable for showing to the user. */
class UserError extends Error {}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
    if (error instanceof UserError || error instanceof NumberingError) return { ok: false, error: error.message };
    const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
    if (code === '23505') return { ok: false, error: 'A contract with this number already exists in your company.' };
    console.error(fallback, error);
    return { ok: false, error: fallback };
}

function refresh() {
    revalidatePath('/dashboard/contracts');
    revalidatePath('/dashboard/contracts/templates');
    revalidatePath('/dashboard/warehouse');
    revalidatePath('/dashboard');
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
function isValidISODate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

interface ParsedContract extends Omit<ContractInput, 'items'> {
    items: (ContractItemInput & { line_total: number })[];
    total_price: number;
}

function parseContract(raw: unknown): ParsedContract {
    if (typeof raw !== 'object' || raw === null) throw new UserError('Invalid data.');
    const r = raw as Record<string, unknown>;

    const contract_number = typeof r.contract_number === 'string' ? r.contract_number.trim() : '';
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const notes = typeof r.notes === 'string' ? r.notes.trim() : '';
    const body = typeof r.body === 'string' ? r.body.replace(/\r\n?/g, '\n').trimEnd() : '';
    const template_id = typeof r.template_id === 'number' && Number.isInteger(r.template_id) && r.template_id > 0 ? r.template_id : null;
    const client_id = typeof r.client_id === 'number' && Number.isInteger(r.client_id) ? r.client_id : 0;
    const contract_type = r.contract_type as ContractType;
    const status = r.status as ContractStatus;
    const start_date = r.start_date;
    const end_date = r.end_date === null || r.end_date === '' || r.end_date === undefined ? null : r.end_date;

    if (!contract_number) throw new UserError('Contract number is required.');
    if (!title) throw new UserError('Contract subject/title is required.');
    if (contract_number.length > 50 || title.length > 255 || notes.length > 5000) {
        throw new UserError('One of the fields is too long.');
    }
    if (body.length > 200_000) throw new UserError('The contract text is too long.');
    if (client_id <= 0) throw new UserError('Select a client.');
    if (!CONTRACT_TYPES.includes(contract_type)) throw new UserError('Invalid contract type.');
    if (!CONTRACT_STATUSES.includes(status)) throw new UserError('Invalid status.');
    if (!isValidISODate(start_date)) throw new UserError('Invalid start date.');
    if (end_date !== null && !isValidISODate(end_date)) throw new UserError('Invalid end date.');
    if (end_date !== null && end_date < start_date) throw new UserError('The end date cannot be before the start date.');

    // Recurring billing
    const billing_months = typeof r.billing_months === 'number' ? r.billing_months : 0;
    if (!BILLING_OPTIONS.some((o) => o.months === billing_months)) throw new UserError('Invalid billing period.');
    const billing_start = billing_months > 0 ? r.billing_start : null;
    const billing_due_days = typeof r.billing_due_days === 'number' && Number.isInteger(r.billing_due_days) ? r.billing_due_days : 14;
    const billing_vat_rate = typeof r.billing_vat_rate === 'number' ? r.billing_vat_rate : 20;
    const billing_vat_exempt_reason =
        billing_vat_rate === 0 && typeof r.billing_vat_exempt_reason === 'string' ? r.billing_vat_exempt_reason.trim() : '';
    if (billing_months > 0) {
        if (!isValidISODate(billing_start)) throw new UserError('Enter the date of the next recurring invoice.');
        if (end_date !== null && billing_start > end_date) throw new UserError('The first recurring invoice is after the contract end date.');
        if (billing_due_days < 0 || billing_due_days > 365) throw new UserError('The payment term must be between 0 and 365 days.');
        if (!isValidVatRate(billing_vat_rate)) throw new UserError('Invalid VAT rate (0–100%).');
        if (billing_vat_rate === 0 && !billing_vat_exempt_reason) {
            throw new UserError('With 0% VAT, enter the VAT exemption note for the recurring invoices.');
        }
        if (billing_vat_exempt_reason.length > 255) throw new UserError('The VAT exemption note is too long.');
    }

    if (!Array.isArray(r.items) || r.items.length === 0) throw new UserError('Add at least one line to the contract.');
    if (r.items.length > 100) throw new UserError('The maximum is 100 lines per contract.');

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

    return {
        contract_number,
        title,
        client_id,
        contract_type,
        start_date,
        end_date,
        status,
        notes,
        template_id,
        body,
        deduct_stock: r.deduct_stock === true,
        billing_months,
        billing_start: billing_start as string | null,
        billing_due_days,
        billing_vat_rate,
        billing_vat_exempt_reason,
        billing_auto_email: billing_months > 0 && r.billing_auto_email === true,
        items,
        total_price: round(
            items.reduce((sum, i) => sum + i.line_total, 0),
            2,
        ),
    };
}

// ---------------------------------------------------------------------------
// Inventory: restore and deduct (inside a transaction)
// ---------------------------------------------------------------------------
async function restoreStock(client: DbClient, companyId: number, contractId: number, touched: Set<number>) {
    const rows = await client.query<{ product_id: number; qty: number }>(
        `SELECT product_id, SUM(quantity) AS qty
           FROM contract_items
          WHERE contract_id = $1 AND stock_deducted AND product_id IS NOT NULL
          GROUP BY product_id ORDER BY product_id`,
        [contractId],
    );
    for (const row of rows.rows) {
        await client.query(
            `UPDATE products SET qty_in_stock = qty_in_stock + $1 WHERE id = $2 AND company_id = $3`,
            [row.qty, row.product_id, companyId],
        );
        touched.add(row.product_id);
    }
}

async function deductStock(
    client: DbClient,
    companyId: number,
    items: ContractItemInput[],
    touched: Set<number>,
) {
    const needed = new Map<number, number>();
    for (const item of items) {
        if (item.product_id !== null) needed.set(item.product_id, round((needed.get(item.product_id) ?? 0) + item.quantity, 3));
    }

    // Fixed lock order (by id) — no deadlocks between concurrent contracts
    for (const productId of Array.from(needed.keys()).sort((a, b) => a - b)) {
        const qty = needed.get(productId) as number;
        const res = await client.query<{ qty_in_stock: number }>(
            `UPDATE products SET qty_in_stock = qty_in_stock - $1
              WHERE id = $2 AND company_id = $3 AND qty_in_stock >= $1
              RETURNING qty_in_stock`,
            [qty, productId, companyId],
        );
        if (res.rows.length === 0) {
            const info = await client.query<{ name: string; unit: string; qty_in_stock: number }>(
                `SELECT name, unit, qty_in_stock FROM products WHERE id = $1 AND company_id = $2`,
                [productId, companyId],
            );
            const p = info.rows[0];
            throw new UserError(
                p
                    ? `Insufficient stock for "${p.name}": ${formatQty(p.qty_in_stock)} ${p.unit} available, ${formatQty(qty)} ${p.unit} needed.`
                    : 'A product that does not exist was selected.',
            );
        }
        touched.add(productId);
    }
}

// ---------------------------------------------------------------------------
// Create / edit (one transaction: contract + lines + inventory)
// ---------------------------------------------------------------------------
/** A recurring invoice cannot start in the past (otherwise a batch of invoices would be issued at once). */
async function assertNotPast(client: DbClient, date: string | null) {
    if (!date) return;
    const r = await client.query<{ past: boolean }>(`SELECT $1::date < ${SQL_TODAY} AS past`, [date]);
    if (r.rows[0].past) throw new UserError('The date of the next recurring invoice cannot be in the past.');
}

async function saveContractTx(
    client: DbClient,
    companyId: number,
    contractId: number | null,
    data: ParsedContract,
    touched: Set<number>,
): Promise<number> {
    const clientCheck = await client.query(`SELECT 1 FROM clients WHERE id = $1 AND company_id = $2`, [data.client_id, companyId]);
    if (clientCheck.rows.length === 0) throw new UserError('The selected client does not exist.');

    const productIds = Array.from(new Set(data.items.map((i) => i.product_id).filter((x): x is number => x !== null)));
    if (productIds.length > 0) {
        const found = await client.query(`SELECT id FROM products WHERE company_id = $1 AND id = ANY($2::int[])`, [companyId, productIds]);
        if (found.rows.length !== productIds.length) throw new UserError('One of the selected products does not exist in inventory.');
    }

    if (data.template_id !== null) {
        const tpl = await client.query(`SELECT 1 FROM contract_templates WHERE id = $1 AND company_id = $2`, [data.template_id, companyId]);
        if (tpl.rows.length === 0) throw new UserError('The selected template does not exist (it may have been deleted).');
    }

    let id: number;
    if (contractId === null) {
        if (data.billing_months > 0) await assertNotPast(client, data.billing_start);
        const ins = await client.query<{ id: number }>(
            `INSERT INTO contracts (company_id, client_id, contract_number, title, contract_type,
                                    start_date, end_date, total_price, status, notes, template_id, body,
                                    billing_months, billing_start, billing_issued, billing_due_days,
                                    billing_vat_rate, billing_vat_exempt_reason, billing_auto_email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0, $15, $16, $17, $18) RETURNING id`,
            [companyId, data.client_id, data.contract_number, data.title, data.contract_type,
             data.start_date, data.end_date, data.total_price, data.status, data.notes, data.template_id, data.body,
             data.billing_months, data.billing_start, data.billing_due_days, data.billing_vat_rate, data.billing_vat_exempt_reason,
             data.billing_auto_email],
        );
        id = ins.rows[0].id;
    } else {
        const cur = await client.query<{ billing_months: number; billing_next: string | null }>(
            `SELECT c.billing_months,
                    CASE WHEN c.billing_start IS NOT NULL THEN ${SQL_NEXT_PERIOD} END AS billing_next
               FROM contracts c WHERE c.id = $1 AND c.company_id = $2 FOR UPDATE`,
            [contractId, companyId],
        );
        if (cur.rows.length === 0) throw new UserError('Contract not found.');

        // Period or date changed → start over from the new date (periods already invoiced are skipped)
        const prev = cur.rows[0];
        const billingChanged = data.billing_months > 0 && (prev.billing_months !== data.billing_months || prev.billing_next !== data.billing_start);
        if (billingChanged) await assertNotPast(client, data.billing_start);
        await client.query(
            `UPDATE contracts
                SET billing_months = $1::smallint, billing_due_days = $2, billing_vat_rate = $3, billing_vat_exempt_reason = $4, billing_auto_email = $8,
                    billing_start = CASE WHEN $5::boolean THEN $6::date WHEN $1::smallint = 0 THEN NULL ELSE billing_start END,
                    billing_issued = CASE WHEN $5::boolean OR $1::smallint = 0 THEN 0 ELSE billing_issued END
              WHERE id = $7 AND company_id = $9`,
            [data.billing_months, data.billing_due_days, data.billing_vat_rate, data.billing_vat_exempt_reason,
             billingChanged, data.billing_start, contractId, data.billing_auto_email, companyId],
        );

        await restoreStock(client, companyId, contractId, touched); // previous deductions are restored
        await client.query(`DELETE FROM contract_items WHERE contract_id = $1`, [contractId]);
        await client.query(
            `UPDATE contracts
                SET client_id = $1, contract_number = $2, title = $3, contract_type = $4,
                    start_date = $5, end_date = $6, total_price = $7, status = $8, notes = $9,
                    template_id = $12, body = $13
              WHERE id = $10 AND company_id = $11`,
            [data.client_id, data.contract_number, data.title, data.contract_type,
             data.start_date, data.end_date, data.total_price, data.status, data.notes, contractId, companyId,
             data.template_id, data.body],
        );
        id = contractId;
    }

    for (let i = 0; i < data.items.length; i++) {
        const it = data.items[i];
        await client.query(
            `INSERT INTO contract_items (contract_id, product_id, description, unit, quantity, unit_price,
                                         line_total, position, stock_deducted)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, it.product_id, it.description, it.unit, it.quantity, it.unit_price, it.line_total, i + 1,
             data.deduct_stock && it.product_id !== null],
        );
    }

    if (data.deduct_stock) await deductStock(client, companyId, data.items, touched);
    return id;
}

export interface SaveContractResult {
    contract: Contract;
    stock: StockUpdate[];
    /** Numbers of recurring invoices issued immediately on save. */
    generated: string[];
}

async function saveContract(contractId: number | null, raw: unknown): Promise<ActionResult<SaveContractResult>> {
    try {
        const data = parseContract(raw);
        const companyId = await getActiveCompanyId();
        const touched = new Set<number>();

        const id = await withTransaction((client) => saveContractTx(client, companyId, contractId, data, touched));

        // If the first recurring invoice is due today — issue it right away
        const generated = data.billing_months > 0 ? await runRecurringBilling(companyId) : [];
        if (generated.length) revalidatePath('/dashboard/invoices');

        const [contracts, stock] = await Promise.all([loadContracts(companyId, id), readStock(companyId, Array.from(touched))]);
        refresh();
        return { ok: true, data: { contract: contracts[0], stock, generated: generated.map((g) => g.invoice_number) } };
    } catch (error) {
        return failure(error, 'Failed to save the contract.');
    }
}


export async function createContract(raw: ContractInput): Promise<ActionResult<SaveContractResult>> {
    return saveContract(null, raw);
}

export async function updateContract(id: number, raw: ContractInput): Promise<ActionResult<SaveContractResult>> {
    return saveContract(id, raw);
}

// ---------------------------------------------------------------------------
// Delete (returns deducted quantities to inventory)
// ---------------------------------------------------------------------------
export async function deleteContract(id: number): Promise<ActionResult<{ stock: StockUpdate[] }>> {
    try {
        const companyId = await getActiveCompanyId();
        const touched = new Set<number>();

        const filePath = await withTransaction(async (client) => {
            const cur = await client.query<{ file_path: string | null }>(
                `SELECT file_path FROM contracts WHERE id = $1 AND company_id = $2 FOR UPDATE`,
                [id, companyId],
            );
            if (cur.rows.length === 0) throw new UserError('Contract not found.');
            await restoreStock(client, companyId, id, touched);
            await client.query(`DELETE FROM contracts WHERE id = $1 AND company_id = $2`, [id, companyId]);
            return cur.rows[0].file_path;
        });

        await deleteStoredFile(filePath);
        const stock = await readStock(companyId, Array.from(touched));
        refresh();
        return { ok: true, data: { stock } };
    } catch (error) {
        return failure(error, 'Failed to delete the contract.');
    }
}

export async function setContractStatus(id: number, status: ContractStatus): Promise<ActionResult> {
    if (!CONTRACT_STATUSES.includes(status)) return { ok: false, error: 'Invalid status.' };
    try {
        const companyId = await getActiveCompanyId();
        const res = await query(`UPDATE contracts SET status = $1 WHERE id = $2 AND company_id = $3`, [status, id, companyId]);
        if (res.rowCount === 0) return { ok: false, error: 'Contract not found.' };
        refresh();
        return { ok: true, data: undefined };
    } catch (error) {
        return failure(error, 'Failed to change the status.');
    }
}

// ---------------------------------------------------------------------------
// Files
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

/** Attaches or replaces the signed contract (PDF/image up to 15 MB). */
export async function uploadContractFile(
    contractId: number,
    formData: FormData,
): Promise<ActionResult<{ file_path: string; file_name: string }>> {
    const file = formData.get('file');
    if (!isFileLike(file)) return { ok: false, error: 'No file selected.' };

    let savedPath: string | null = null;
    try {
        const companyId = await getActiveCompanyId();
        const cur = await query<{ file_path: string | null }>(
            `SELECT file_path FROM contracts WHERE id = $1 AND company_id = $2`,
            [contractId, companyId],
        );
        if (cur.rows.length === 0) return { ok: false, error: 'Contract not found.' };

        const saved = await saveUpload('contracts', file);
        savedPath = saved.filePath;

        await query(`UPDATE contracts SET file_path = $1, file_name = $2 WHERE id = $3 AND company_id = $4`, [
            saved.filePath,
            saved.fileName,
            contractId,
            companyId,
        ]);
        await deleteStoredFile(cur.rows[0].file_path); // the old file is deleted after a successful replace

        revalidatePath('/dashboard/contracts');
        return { ok: true, data: { file_path: saved.filePath, file_name: saved.fileName } };
    } catch (error) {
        await deleteStoredFile(savedPath);
        if (error instanceof Error && !(error instanceof UserError) && /MB|PDF|file/i.test(error.message)) {
            return { ok: false, error: error.message }; // validation errors from saveUpload
        }
        return failure(error, 'Failed to upload the file.');
    }
}

export async function removeContractFile(contractId: number): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        const cur = await query<{ file_path: string | null }>(
            `SELECT file_path FROM contracts WHERE id = $1 AND company_id = $2`,
            [contractId, companyId],
        );
        if (cur.rows.length === 0) return { ok: false, error: 'Contract not found.' };

        await query(`UPDATE contracts SET file_path = NULL, file_name = NULL WHERE id = $1 AND company_id = $2`, [contractId, companyId]);
        await deleteStoredFile(cur.rows[0].file_path);
        revalidatePath('/dashboard/contracts');
        return { ok: true, data: undefined };
    } catch (error) {
        return failure(error, 'Failed to remove the file.');
    }
}

// ---------------------------------------------------------------------------
// "Issue invoice" from a contract
// ---------------------------------------------------------------------------
export async function createInvoiceFromContract(
    contractId: number,
): Promise<ActionResult<{ id: number; invoice_number: string; total_amount: number }>> {
    try {
        const companyId = await getActiveCompanyId();

        const result = await withTransaction(async (client) => {
            const c = await client.query<{ contract_number: string | null; client_id: number | null; vat_rate: number; vat_exempt_reason: string }>(
                `SELECT contract_number, client_id, billing_vat_rate AS vat_rate, billing_vat_exempt_reason AS vat_exempt_reason
                   FROM contracts WHERE id = $1 AND company_id = $2 FOR UPDATE`,
                [contractId, companyId],
            );
            if (c.rows.length === 0) throw new UserError('Contract not found.');
            if (c.rows[0].client_id === null) throw new UserError('The contract has no client.');

            const sums = await client.query<{ subtotal: number; cnt: number }>(
                `SELECT COALESCE(SUM(line_total), 0) AS subtotal, COUNT(*) AS cnt FROM contract_items WHERE contract_id = $1`,
                [contractId],
            );
            if (sums.rows[0].cnt === 0) throw new UserError('The contract has no lines — nothing to invoice.');

            const subtotal = round(sums.rows[0].subtotal, 2);
            const vatRate = Number(c.rows[0].vat_rate); // the contract's VAT rate (set under recurring billing, default 20%)
            const vatAmount = round((subtotal * vatRate) / 100, 2);
            const total = round(subtotal + vatAmount, 2);

            const num = { rows: [{ n: (await assignNumber(client, companyId, 'invoice')).number }] };
            const invoiceNumber = num.rows[0].n;

            const inv = await client.query<{ id: number }>(
                `INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                                       subtotal, vat_rate, vat_amount, total_amount, status, payment_method, notes, vat_exempt_reason)
                 VALUES ($1, $2, $3, $4, ${SQL_TODAY}, ${SQL_TODAY} + 14, $5, $6, $7, $8, 'pending', 'bank_transfer', $9, $10)
                 RETURNING id`,
                [companyId, c.rows[0].client_id, contractId, invoiceNumber, subtotal, vatRate, vatAmount, total,
                 c.rows[0].contract_number ? `Under contract ${c.rows[0].contract_number}` : '',
                 vatRate === 0 ? c.rows[0].vat_exempt_reason : ''],
            );

            await client.query(
                `INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
                 SELECT $1, product_id, description, unit, quantity, unit_price, line_total, position
                   FROM contract_items WHERE contract_id = $2 ORDER BY position, id`,
                [inv.rows[0].id, contractId],
            );

            return { id: inv.rows[0].id, invoice_number: invoiceNumber, total_amount: total };
        });

        revalidatePath('/dashboard/invoices');
        refresh();
        return { ok: true, data: result };
    } catch (error) {
        return failure(error, 'Failed to issue the invoice.');
    }
}
