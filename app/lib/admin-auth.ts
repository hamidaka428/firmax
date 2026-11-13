// app/lib/admin-auth.ts
// Sign-in for the platform owner (admin panel at /admin).
// The password is set in .env.local → ADMIN_PASSWORD. Without it the admin panel is disabled.
// The session is a cookie with an HMAC-SHA256-signed expiry — no database tables needed.

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const ADMIN_COOKIE = 'erp_admin_session';
const SESSION_HOURS = 8;

export function adminConfigured(): boolean {
    return (process.env.ADMIN_PASSWORD ?? '').length >= 10;
}

function secret(): string {
    const explicit = process.env.ADMIN_SESSION_SECRET;
    if (explicit && explicit.length >= 32) return explicit;
    // Derived key: changing the password automatically invalidates all old sessions
    return createHash('sha256').update(`erp-admin-session:${process.env.ADMIN_PASSWORD ?? ''}`).digest('hex');
}

function sign(payload: string): string {
    return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return timingSafeEqual(ha, hb);
}

export function createSessionToken(now = Date.now()): string {
    const expires = String(now + SESSION_HOURS * 3_600_000);
    return `${expires}.${sign(expires)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
    if (!token || !adminConfigured()) return false;
    const [expires, signature] = token.split('.');
    if (!expires || !signature || !/^\d+$/.test(expires)) return false;
    if (!safeEqual(signature, sign(expires))) return false;
    return Number(expires) > now;
}

export function checkPassword(candidate: string): boolean {
    if (!adminConfigured()) return false;
    return safeEqual(candidate, process.env.ADMIN_PASSWORD ?? '');
}

export async function isAdmin(): Promise<boolean> {
    const store = await cookies();
    return verifySessionToken(store.get(ADMIN_COOKIE)?.value);
}

/** For every admin page and action: no valid session → redirect to sign-in. */
export async function requireAdmin(): Promise<void> {
    if (!(await isAdmin())) redirect('/admin/login');
}

export async function setAdminSession(): Promise<void> {
    const store = await cookies();
    store.set(ADMIN_COOKIE, createSessionToken(), {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.COOKIE_SECURE === 'true',
        path: '/',
        maxAge: SESSION_HOURS * 3600,
    });
}

export async function clearAdminSession(): Promise<void> {
    const store = await cookies();
    store.delete(ADMIN_COOKIE);
}

/* Password-guessing protection: 5 wrong attempts → 15-minute lockout (per IP). */
export const ADMIN_MAX_ATTEMPTS = 5;
export const ADMIN_LOCK_MINUTES = 15;
