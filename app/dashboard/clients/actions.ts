'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/app/lib/db';
import { getActiveCompanyId } from '@/app/lib/tenant';
import type { ActionResult, ClientHistory, ClientInput, ClientRow } from '@/app/lib/types';
import { loadClients } from './data';
import { normalizeRegNo, normalizeVatNumber, validateRegNo, validateVatNumber } from '@/app/lib/validation';

const LIMITS: Record<keyof ClientInput, number> = {
    name: 255,
    reg_no: 30,
    vat_number: 30,
    city: 100,
    address: 255,
    country: 100,
    representative: 150,
    phone: 50,
    email: 150,
    notes: 2000,
};

/**
 * @param previous the values before editing — identifiers that were already saved don't block saving;
 *                 format checks apply only to new/changed values.
 */
function parseClient(
    raw: unknown,
    previous?: { reg_no: string; vat_number: string },
): { ok: true; value: ClientInput } | { ok: false; error: string } {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Invalid data.' };
    const r = raw as Record<string, unknown>;
    const get = (key: string) => (typeof r[key] === 'string' ? (r[key] as string).trim() : '');

    const value: ClientInput = {
        name: get('name'),
        reg_no: normalizeRegNo(get('reg_no')),
        vat_number: normalizeVatNumber(get('vat_number')),
        city: get('city'),
        address: get('address'),
        country: get('country'),
        representative: get('representative'),
        phone: get('phone'),
        email: get('email'),
        notes: get('notes'),
    };

    if (!value.name) return { ok: false, error: 'Client name is required.' };
    for (const key of Object.keys(LIMITS) as (keyof ClientInput)[]) {
        if (value[key].length > LIMITS[key]) return { ok: false, error: 'One of the fields is too long.' };
    }
    if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
        return { ok: false, error: 'Invalid email address.' };
    }
    if (value.reg_no !== previous?.reg_no) {
        const regNoError = validateRegNo(value.reg_no);
        if (regNoError) return { ok: false, error: regNoError };
    }
    if (value.vat_number !== previous?.vat_number) {
        const vatError = validateVatNumber(value.vat_number);
        if (vatError) return { ok: false, error: vatError };
    }
    return { ok: true, value };
}

async function duplicateRegNo(companyId: number, reg_no: string, exceptId: number | null): Promise<string | null> {
    if (!reg_no) return null;
    const res = await query<{ name: string }>(
        `SELECT name FROM clients WHERE company_id = $1 AND reg_no = $2 AND ($3::int IS NULL OR id <> $3) LIMIT 1`,
        [companyId, reg_no, exceptId],
    );
    return res.rows[0]?.name ?? null;
}

function refresh() {
    revalidatePath('/dashboard/clients');
    revalidatePath('/dashboard');
}

export async function createClient(raw: ClientInput): Promise<ActionResult<ClientRow>> {
    const parsed = parseClient(raw);
    if (!parsed.ok) return parsed;
    const c = parsed.value;

    try {
        const companyId = await getActiveCompanyId();
        const dup = await duplicateRegNo(companyId, c.reg_no, null);
        if (dup) return { ok: false, error: `There is already a client with this registration number: ${dup}.` };
        const ins = await query<{ id: number }>(
            `INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, representative, phone, email, notes, country)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [companyId, c.name, c.reg_no, c.vat_number, c.city, c.address, c.representative, c.phone, c.email, c.notes, c.country],
        );
        const rows = await loadClients(companyId, ins.rows[0].id);
        refresh();
        return { ok: true, data: rows[0] };
    } catch (error) {
        console.error('createClient', error);
        return { ok: false, error: 'Failed to create the client.' };
    }
}

export async function updateClient(id: number, raw: ClientInput): Promise<ActionResult<ClientRow>> {
    try {
        const companyId = await getActiveCompanyId();
        const prev = await query<{ reg_no: string; vat_number: string }>(
            `SELECT reg_no, vat_number FROM clients WHERE id = $1 AND company_id = $2`,
            [id, companyId],
        );
        if (prev.rows.length === 0) return { ok: false, error: 'Client not found.' };
        const parsed = parseClient(raw, prev.rows[0]);
        if (!parsed.ok) return parsed;
        const c = parsed.value;
        const dup = await duplicateRegNo(companyId, c.reg_no, id);
        if (dup) return { ok: false, error: `There is already a client with this registration number: ${dup}.` };
        const upd = await query<{ id: number }>(
            `UPDATE clients
                SET name = $1, reg_no = $2, vat_number = $3, city = $4, address = $5,
                    representative = $6, phone = $7, email = $8, notes = $9, country = $12
              WHERE id = $10 AND company_id = $11
              RETURNING id`,
            [c.name, c.reg_no, c.vat_number, c.city, c.address, c.representative, c.phone, c.email, c.notes, id, companyId, c.country],
        );
        if (upd.rows.length === 0) return { ok: false, error: 'Client not found.' };
        const rows = await loadClients(companyId, id);
        refresh();
        return { ok: true, data: rows[0] };
    } catch (error) {
        console.error('updateClient', error);
        return { ok: false, error: 'Failed to save the client.' };
    }
}

export async function deleteClient(id: number): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        const res = await query(`DELETE FROM clients WHERE id = $1 AND company_id = $2`, [id, companyId]);
        if (res.rowCount === 0) return { ok: false, error: 'Client not found.' };
        refresh();
        return { ok: true, data: undefined };
    } catch (error) {
        if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503') {
            return {
                ok: false,
                error: 'The client has related contracts or invoices and cannot be deleted.',
            };
        }
        console.error('deleteClient', error);
        return { ok: false, error: 'Failed to delete the client.' };
    }
}

/** Client history (contracts + invoices) for the side panel. */
export async function getClientHistory(clientId: number): Promise<ActionResult<ClientHistory>> {
    try {
        const companyId = await getActiveCompanyId();
        const owner = await query(`SELECT 1 FROM clients WHERE id = $1 AND company_id = $2`, [clientId, companyId]);
        if (owner.rows.length === 0) return { ok: false, error: 'Client not found.' };

        const [contracts, invoices] = await Promise.all([
            query<ClientHistory['contracts'][number]>(
                `SELECT id, COALESCE(contract_number, '') AS contract_number, title, contract_type,
                        start_date, end_date, total_price, status
                   FROM contracts WHERE client_id = $1 AND company_id = $2
                  ORDER BY start_date DESC, id DESC`,
                [clientId, companyId],
            ),
            query<ClientHistory['invoices'][number]>(
                // The type is shown as a prefix to the number (CN/DN/PF); credit notes are negative
                `SELECT id,
                        (CASE doc_type WHEN 'credit_note' THEN 'CN ' WHEN 'debit_note' THEN 'DN ' WHEN 'proforma' THEN 'PF ' ELSE '' END)
                          || COALESCE(invoice_number, '') AS invoice_number,
                        issue_date, due_date,
                        (CASE WHEN doc_type = 'credit_note' THEN -total_amount ELSE total_amount END) AS total_amount, status
                   FROM invoices WHERE client_id = $1 AND company_id = $2
                  ORDER BY issue_date DESC, id DESC`,
                [clientId, companyId],
            ),
        ]);

        return { ok: true, data: { contracts: contracts.rows, invoices: invoices.rows } };
    } catch (error) {
        console.error('getClientHistory', error);
        return { ok: false, error: 'Failed to load the history.' };
    }
}
