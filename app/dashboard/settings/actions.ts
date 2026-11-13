'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { query } from '@/app/lib/db';
import { ACTIVE_COMPANY_COOKIE, getActiveCompanyId } from '@/app/lib/tenant';
import type { ActionResult, CompanyInput } from '@/app/lib/types';
import { deleteStoredFile, saveUpload } from '@/app/lib/storage';
import { getCurrentUser } from '@/app/lib/auth';
import { normalizeIban, normalizeRegNo, normalizeVatNumber, validateRegNo, validateBic, validateIban, validateVatNumber } from '@/app/lib/validation';

const LIMITS: Record<keyof CompanyInput, number> = {
    name: 255,
    reg_no: 30,
    vat_number: 30,
    city: 100,
    address: 255,
    country: 100,
    representative: 150,
    phone: 50,
    email: 150,
    bank_name: 150,
    iban: 40,
    bic: 20,
    currency: 5,
};

function parseCompany(
    raw: unknown,
    previous?: { reg_no: string; vat_number: string; iban: string },
): { ok: true; value: CompanyInput } | { ok: false; error: string } {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Invalid data.' };
    const r = raw as Record<string, unknown>;
    const get = (key: string) => (typeof r[key] === 'string' ? (r[key] as string).trim() : '');

    const value: CompanyInput = {
        name: get('name'),
        reg_no: normalizeRegNo(get('reg_no')),
        vat_number: normalizeVatNumber(get('vat_number')),
        city: get('city'),
        address: get('address'),
        country: get('country'),
        representative: get('representative'),
        phone: get('phone'),
        email: get('email'),
        bank_name: get('bank_name'),
        iban: normalizeIban(get('iban')),
        bic: get('bic').replace(/\s+/g, '').toUpperCase(),
        currency: (get('currency') || 'EUR').toUpperCase(),
    };

    if (!value.name) return { ok: false, error: 'Company name is required.' };
    for (const key of Object.keys(LIMITS) as (keyof CompanyInput)[]) {
        if (value[key].length > LIMITS[key]) return { ok: false, error: 'One of the fields is too long.' };
    }
    if (value.reg_no !== previous?.reg_no) {
        const e = validateRegNo(value.reg_no);
        if (e) return { ok: false, error: e };
    }
    if (value.vat_number !== previous?.vat_number) {
        const e = validateVatNumber(value.vat_number);
        if (e) return { ok: false, error: e };
    }
    if (value.iban !== previous?.iban) {
        const e = validateIban(value.iban);
        if (e) return { ok: false, error: e };
    }
    const bicError = validateBic(value.bic);
    if (bicError) return { ok: false, error: bicError };
    if (!/^[A-Z]{3}$/.test(value.currency)) return { ok: false, error: 'Currency must be a 3-letter ISO code (e.g. EUR).' };
    if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return { ok: false, error: 'Invalid email address.' };

    return { ok: true, value };
}

/** Duplicate registration numbers are checked only among the same user's companies (we never reveal other users' data). */
async function regNoTaken(ownerId: number, reg_no: string, exceptId: number | null): Promise<boolean> {
    if (!reg_no) return false;
    const res = await query(
        `SELECT 1 FROM companies WHERE owner_id = $1 AND reg_no = $2 AND ($3::int IS NULL OR id <> $3) LIMIT 1`,
        [ownerId, reg_no, exceptId],
    );
    return res.rows.length > 0;
}

/** Saves the active company's details. */
export async function updateCompany(raw: CompanyInput): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        const prev = await query<{ reg_no: string; vat_number: string; iban: string; owner_id: number }>(
            `SELECT reg_no, vat_number, iban, owner_id FROM companies WHERE id = $1`,
            [companyId],
        );
        if (prev.rows.length === 0) return { ok: false, error: 'Company not found.' };
        const parsed = parseCompany(raw, prev.rows[0]);
        if (!parsed.ok) return parsed;
        const c = parsed.value;
        if (await regNoTaken(prev.rows[0].owner_id, c.reg_no, companyId)) return { ok: false, error: 'Another of your companies has the same registration number.' };

        await query(
            `UPDATE companies
                SET name = $1, reg_no = $2, vat_number = $3, city = $4, address = $5, representative = $6,
                    phone = $7, email = $8, bank_name = $9, iban = $10, bic = $11, currency = $12, country = $14
              WHERE id = $13`,
            [c.name, c.reg_no, c.vat_number, c.city, c.address, c.representative, c.phone, c.email, c.bank_name, c.iban, c.bic, c.currency, companyId, c.country],
        );
        revalidatePath('/dashboard', 'layout');
        return { ok: true, data: undefined };
    } catch (error) {
        console.error('updateCompany', error);
        return { ok: false, error: 'Failed to save the details.' };
    }
}

/** Creates a new company and makes it active. */
export async function createCompany(raw: CompanyInput): Promise<ActionResult<{ id: number }>> {
    const parsed = parseCompany(raw);
    if (!parsed.ok) return parsed;
    const c = parsed.value;

    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Please sign in again.' };

    try {
        if (await regNoTaken(user.id, c.reg_no, null)) return { ok: false, error: 'You already have a company with this registration number.' };

        const ins = await query<{ id: number }>(
            `INSERT INTO companies (name, reg_no, vat_number, city, address, representative, phone, email, bank_name, iban, bic, currency, owner_id, country)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
            [c.name, c.reg_no, c.vat_number, c.city, c.address, c.representative, c.phone, c.email, c.bank_name, c.iban, c.bic, c.currency, user.id, c.country],
        );
        const id = ins.rows[0].id;

        const cookieStore = await cookies();
        cookieStore.set(ACTIVE_COMPANY_COOKIE, String(id), {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 60 * 60 * 24 * 365,
            secure: process.env.COOKIE_SECURE === 'true',
        });

        revalidatePath('/dashboard', 'layout');
        return { ok: true, data: { id } };
    } catch (error) {
        console.error('createCompany', error);
        return { ok: false, error: 'Failed to create the company.' };
    }
}

// ---------------------------------------------------------------------------
// Company logo
// ---------------------------------------------------------------------------

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

function isFileLike(value: unknown): value is File {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as File).arrayBuffer === 'function' &&
        typeof (value as File).name === 'string' &&
        typeof (value as File).size === 'number'
    );
}

/** Uploads/replaces the active company's logo (PNG, JPG, WEBP or GIF up to 2 MB). */
export async function uploadCompanyLogo(formData: FormData): Promise<ActionResult<{ logo_path: string }>> {
    const file = formData.get('logo');
    if (!isFileLike(file) || file.size === 0) return { ok: false, error: 'No file selected.' };

    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Please sign in again.' };

    let savedPath: string | null = null;
    try {
        const companyId = await getActiveCompanyId();
        const saved = await saveUpload('logos', file, { maxBytes: MAX_LOGO_BYTES, imagesOnly: true });
        savedPath = saved.filePath;

        const prev = await query<{ logo_path: string | null }>(`SELECT logo_path FROM companies WHERE id = $1`, [companyId]);
        await query(`UPDATE companies SET logo_path = $1 WHERE id = $2`, [saved.filePath, companyId]);
        savedPath = null; // already saved in the database — don't delete it on an error below
        await deleteStoredFile(prev.rows[0]?.logo_path);

        revalidatePath('/dashboard', 'layout');
        return { ok: true, data: { logo_path: saved.filePath } };
    } catch (error) {
        if (savedPath) await deleteStoredFile(savedPath);
        if (error instanceof Error && /The file|Only .* allowed|No file selected/.test(error.message)) {
            return { ok: false, error: error.message };
        }
        console.error('uploadCompanyLogo', error);
        return { ok: false, error: 'Failed to upload the logo.' };
    }
}

export async function removeCompanyLogo(): Promise<ActionResult> {
    try {
        const companyId = await getActiveCompanyId();
        const prev = await query<{ logo_path: string | null }>(
            `UPDATE companies c SET logo_path = NULL FROM (SELECT logo_path FROM companies WHERE id = $1) old
              WHERE c.id = $1 RETURNING old.logo_path`,
            [companyId],
        );
        await deleteStoredFile(prev.rows[0]?.logo_path);
        revalidatePath('/dashboard', 'layout');
        return { ok: true, data: undefined };
    } catch (error) {
        console.error('removeCompanyLogo', error);
        return { ok: false, error: 'Failed to remove the logo.' };
    }
}
