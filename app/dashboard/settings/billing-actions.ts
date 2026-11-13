'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/app/lib/db';
import { getActiveCompanyId } from '@/app/lib/tenant';
import { normalizeIban, validateBic, validateIban } from '@/app/lib/validation';
import { loadBankAccounts, loadInvoiceSeries } from '@/app/lib/billing-setup';
import type { ActionResult, BankAccount, InvoiceSeries } from '@/app/lib/types';

function refresh() {
    revalidatePath('/dashboard/settings');
    revalidatePath('/dashboard/invoices');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/* ----------------------------------------------------------------------------
 * Bank accounts
 * ------------------------------------------------------------------------- */

export async function saveBankAccount(
    id: number | null,
    raw: { label: string; bank_name: string; iban: string; bic: string },
): Promise<ActionResult<BankAccount[]>> {
    const label = str(raw?.label);
    const bank_name = str(raw?.bank_name);
    const iban = normalizeIban(str(raw?.iban));
    const bic = str(raw?.bic).replace(/\s+/g, '').toUpperCase();
    if (!iban) return { ok: false, error: 'Enter an IBAN.' };
    const ibanError = validateIban(iban);
    if (ibanError) return { ok: false, error: ibanError };
    const bicError = validateBic(bic);
    if (bicError) return { ok: false, error: bicError };
    if (label.length > 100 || bank_name.length > 150) return { ok: false, error: 'One of the fields is too long.' };
    try {
        const companyId = await getActiveCompanyId();
        if (id === null) {
            const count = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM bank_accounts WHERE company_id = $1`, [companyId]);
            if (count.rows[0].n >= 10) return { ok: false, error: 'The maximum is 10 additional accounts.' };
            await query(`INSERT INTO bank_accounts (company_id, label, bank_name, iban, bic) VALUES ($1, $2, $3, $4, $5)`, [
                companyId, label, bank_name, iban, bic,
            ]);
        } else {
            const r = await query(`UPDATE bank_accounts SET label = $1, bank_name = $2, iban = $3, bic = $4 WHERE id = $5 AND company_id = $6`, [
                label, bank_name, iban, bic, id, companyId,
            ]);
            if (r.rowCount === 0) return { ok: false, error: 'Account not found.' };
        }
        refresh();
        return { ok: true, data: await loadBankAccounts(companyId) };
    } catch (error) {
        console.error('saveBankAccount', error);
        return { ok: false, error: 'Failed to save the account.' };
    }
}

/** Deleting: issued invoices read the bank details from the account when printed — so an account in use cannot be deleted. */
export async function deleteBankAccount(id: number): Promise<ActionResult<BankAccount[]>> {
    try {
        const companyId = await getActiveCompanyId();
        const used = await query(`SELECT 1 FROM invoices WHERE bank_account_id = $1 AND company_id = $2 LIMIT 1`, [id, companyId]);
        if (used.rows.length > 0) {
            return { ok: false, error: 'This account is used on issued invoices and cannot be deleted (they must keep printing the same way).' };
        }
        await query(`DELETE FROM bank_accounts WHERE id = $1 AND company_id = $2`, [id, companyId]);
        refresh();
        return { ok: true, data: await loadBankAccounts(companyId) };
    } catch (error) {
        console.error('deleteBankAccount', error);
        return { ok: false, error: 'Delete failed.' };
    }
}

/* ----------------------------------------------------------------------------
 * Number series
 * ------------------------------------------------------------------------- */

/**
 * New number series or edit. The start number can only be changed while the series has no invoices
 * (otherwise the sequence would break).
 */
export async function saveInvoiceSeries(id: number | null, raw: { name: string; start: number }): Promise<ActionResult<InvoiceSeries[]>> {
    const name = str(raw?.name);
    const start = Number(raw?.start);
    if (!name || name.length > 100) return { ok: false, error: 'Enter a series name (up to 100 characters).' };
    if (!Number.isInteger(start) || start < 1 || start > 9_999_999_998) return { ok: false, error: 'The start number must be a whole number between 1 and 9,999,999,998.' };
    try {
        const companyId = await getActiveCompanyId();

        // The start must not fall in a used range: check whether the number already exists
        // and whether the main series has reached it.
        const startStr = String(start).padStart(10, '0');
        const clash = await query<{ seq: number; used: boolean }>(
            `SELECT c.invoice_seq AS seq,
                    EXISTS (SELECT 1 FROM invoices WHERE company_id = c.id AND invoice_number = $2 AND series_key <> 'proforma') AS used
               FROM companies c WHERE c.id = $1`,
            [companyId, startStr],
        );
        const otherStarts = await query<{ n: number }>(
            `SELECT next_number AS n FROM invoice_series WHERE company_id = $1 AND ($2::int IS NULL OR id <> $2)`,
            [companyId, id],
        );
        if (clash.rows[0].used || start <= clash.rows[0].seq) {
            return { ok: false, error: `Number ${startStr} is already used or within the main series range. Choose a higher start (e.g. 2000000001).` };
        }
        if (otherStarts.rows.some((o) => Math.abs(o.n - start) < 1_000_000)) {
            return { ok: false, error: 'The start is too close to another series — leave at least 1,000,000 numbers in between.' };
        }

        if (id === null) {
            const count = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM invoice_series WHERE company_id = $1`, [companyId]);
            if (count.rows[0].n >= 10) return { ok: false, error: 'The maximum is 10 additional series.' };
            await query(`INSERT INTO invoice_series (company_id, name, next_number) VALUES ($1, $2, $3)`, [companyId, name, start]);
        } else {
            const used = await query(`SELECT 1 FROM invoices WHERE company_id = $1 AND series_key = $2 LIMIT 1`, [companyId, `s${id}`]);
            if (used.rows.length > 0) {
                await query(`UPDATE invoice_series SET name = $1 WHERE id = $2 AND company_id = $3`, [name, id, companyId]);
            } else {
                await query(`UPDATE invoice_series SET name = $1, next_number = $2 WHERE id = $3 AND company_id = $4`, [name, start, id, companyId]);
            }
        }
        refresh();
        return { ok: true, data: await loadInvoiceSeries(companyId) };
    } catch (error) {
        console.error('saveInvoiceSeries', error);
        return { ok: false, error: 'Failed to save the series.' };
    }
}

export async function deleteInvoiceSeries(id: number): Promise<ActionResult<InvoiceSeries[]>> {
    try {
        const companyId = await getActiveCompanyId();
        const used = await query(`SELECT 1 FROM invoices WHERE company_id = $1 AND series_key = $2 LIMIT 1`, [companyId, `s${id}`]);
        if (used.rows.length > 0) return { ok: false, error: 'The series has issued documents and cannot be deleted.' };
        await query(`DELETE FROM invoice_series WHERE id = $1 AND company_id = $2`, [id, companyId]);
        refresh();
        return { ok: true, data: await loadInvoiceSeries(companyId) };
    } catch (error) {
        console.error('deleteInvoiceSeries', error);
        return { ok: false, error: 'Delete failed.' };
    }
}
