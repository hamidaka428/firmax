'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { query } from './db';
import { ACTIVE_COMPANY_COOKIE } from './tenant';
import { getCurrentUser } from './auth';

export interface SwitchCompanyResult {
    ok: boolean;
    error?: string;
}

/** Switches the active company (sets a cookie and refreshes the whole /dashboard). */
export async function switchCompany(companyId: number): Promise<SwitchCompanyResult> {
    if (!Number.isInteger(companyId) || companyId <= 0) {
        return { ok: false, error: 'Invalid company.' };
    }

    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Please sign in again.' };

    // Own companies only — someone else's company is treated as non-existent
    const res = await query<{ id: number }>(`SELECT id FROM companies WHERE id = $1 AND owner_id = $2`, [companyId, user.id]);
    if (res.rows.length === 0) {
        return { ok: false, error: 'Company not found.' };
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_COMPANY_COOKIE, String(companyId), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        secure: process.env.COOKIE_SECURE === 'true',
    });

    revalidatePath('/dashboard', 'layout');
    return { ok: true };
}
