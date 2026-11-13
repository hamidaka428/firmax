'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSession, normalizeEmail } from '@/app/lib/auth';
import { query } from '@/app/lib/db';
import { ACTIVE_COMPANY_COOKIE } from '@/app/lib/tenant';
import {
    ADMIN_LOCK_MINUTES,
    ADMIN_MAX_ATTEMPTS,
    adminConfigured,
    checkPassword,
    clearAdminSession,
    requireAdmin,
    setAdminSession,
} from '@/app/lib/admin-auth';
import { clearFailures, clientIp, lockedMinutes, registerFailure } from '@/app/lib/rate-limit';

export interface LoginState {
    error: string | null;
}

export async function adminLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
    if (!adminConfigured()) {
        return { error: 'The admin panel is not configured. Add ADMIN_PASSWORD (at least 10 characters) to .env.local and restart the server.' };
    }
    const ip = `admin:${await clientIp()}`;
    const locked = lockedMinutes(ip, ADMIN_MAX_ATTEMPTS);
    if (locked > 0) return { error: `Too many wrong attempts. Try again in ${locked} min.` };

    const password = formData.get('password');
    if (typeof password !== 'string' || !checkPassword(password)) {
        registerFailure(ip, ADMIN_LOCK_MINUTES);
        // a small delay against automated guessing
        await new Promise((r) => setTimeout(r, 600));
        return { error: 'Wrong password.' };
    }

    clearFailures(ip);
    await setAdminSession();
    redirect('/admin');
}

export async function adminLogout(): Promise<void> {
    await clearAdminSession();
    redirect('/admin/login');
}

/**
 * Support: signs in as the company owner (creates a session for them in this browser)
 * and makes the company active. The current user sign-in in this browser is replaced.
 */
export async function openAsCompany(companyId: number): Promise<void> {
    await requireAdmin();
    if (!Number.isInteger(companyId) || companyId <= 0) return;
    const res = await query<{ owner_id: number | null }>(`SELECT owner_id FROM companies WHERE id = $1`, [companyId]);
    const ownerId = res.rows[0]?.owner_id;
    if (!ownerId) return;
    console.warn(`[admin] Signed in as the owner of company #${companyId} (user #${ownerId})`);
    await createSession(ownerId);
    const store = await cookies();
    store.set(ACTIVE_COMPANY_COOKIE, String(companyId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
    });
    redirect('/dashboard');
}

export interface AssignOwnerState {
    error: string | null;
    ok?: boolean;
}

/** Transfers a company to another user (by email) — e.g. a company created before sign-up existed. */
export async function assignOwner(companyId: number, _prev: AssignOwnerState, formData: FormData): Promise<AssignOwnerState> {
    await requireAdmin();
    const email = normalizeEmail(String(formData.get('email') ?? ''));
    if (!email) return { error: 'Enter a user email.' };
    const user = await query<{ id: number }>(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
    if (user.rows.length === 0) return { error: 'No registered user with this email.' };
    const upd = await query(`UPDATE companies SET owner_id = $1 WHERE id = $2`, [user.rows[0].id, companyId]);
    if (upd.rowCount === 0) return { error: 'Company not found.' };
    revalidatePath('/admin', 'layout');
    return { error: null, ok: true };
}
