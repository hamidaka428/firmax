import { cookies } from 'next/headers';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { query } from './db';
import { getCurrentUser, requireUser } from './auth';

/** Name of the cookie holding the active company (set by switchCompany in tenant-actions.ts). */
export const ACTIVE_COMPANY_COOKIE = 'erp_active_company';

export interface Company {
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
    bank_name: string;
    iban: string;
    bic: string;
    currency: string;
    /** Relative path to the logo (logos/<uuid>.png) or null */
    logo_path: string | null;
}

const COMPANY_COLUMNS = `id, name, reg_no, vat_number, city, address, country, representative, phone, email, bank_name, iban, bic, currency, logo_path`;

/** URL for displaying the logo (through the protected /api/files route). */
export function logoUrl(logoPath: string | null): string | null {
    return logoPath ? `/api/files/${logoPath}` : null;
}

/**
 * The current user's companies (for the company switcher). Cached for the duration of one request.
 * Not signed in → empty list.
 */
export const listCompanies = cache(async (): Promise<Company[]> => {
    const user = await getCurrentUser();
    if (!user) return [];
    const res = await query<Company>(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE owner_id = $1 ORDER BY name ASC`, [user.id]);
    return res.rows;
});

/**
 * The current user's active company: from the cookie (only if it's THEIR company),
 * otherwise their first company. null when not signed in or the user has no company yet.
 * In Next.js 16 cookies() is a Promise and is ALWAYS awaited.
 */
export const getActiveCompany = cache(async (): Promise<Company | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    const cookieStore = await cookies();
    const raw = cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value;
    const id = raw ? Number.parseInt(raw, 10) : Number.NaN;

    if (Number.isInteger(id)) {
        const res = await query<Company>(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = $1 AND owner_id = $2`, [id, user.id]);
        if (res.rows[0]) return res.rows[0];
    }

    const fallback = await query<Company>(
        `SELECT ${COMPANY_COLUMNS} FROM companies WHERE owner_id = $1 ORDER BY id ASC LIMIT 1`,
        [user.id],
    );
    return fallback.rows[0] ?? null;
});

/**
 * For pages and Server Actions: requires sign-in and at least one company.
 * Not signed in → /login; no company → /onboarding (create the first company).
 */
export async function requireActiveCompany(): Promise<Company> {
    await requireUser();
    const company = await getActiveCompany();
    if (!company) redirect('/onboarding');
    return company;
}

/** Just the active company id — used in every query for tenant isolation. */
export async function getActiveCompanyId(): Promise<number> {
    return (await requireActiveCompany()).id;
}
