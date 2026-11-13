// app/lib/auth.ts
// Users and sessions: scrypt passwords, session token in an httpOnly cookie;
// only the SHA-256 of the token is stored (a database leak ≠ a session leak).

import { SQL_TZ } from './format';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { query } from './db';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const SESSION_COOKIE = 'erp_session';
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export interface User {
    id: number;
    email: string;
    name: string;
    created_at: string;
    email_verified: boolean;
}

const USER_COLUMNS = `u.id, u.email, u.name,
       to_char(u.created_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD') AS created_at,
       (u.email_verified_at IS NOT NULL) AS email_verified`;

/* ----------------------------------------------------------------------------
 * Passwords
 * ------------------------------------------------------------------------- */

const b64 = (buf: Buffer) => buf.toString('base64url');

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash used for comparison when the user doesn't exist (constant response time). */
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

export function validatePassword(password: string): string | null {
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password.length > 200) return 'Password is too long.';
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one digit.';
    return null;
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function validateEmail(email: string): string | null {
    if (!email) return 'Enter your email.';
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email address.';
    return null;
}

/* ----------------------------------------------------------------------------
 * Sessions
 * ------------------------------------------------------------------------- */

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: number): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const h = await headers();
    await query(
        `INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
        [userId, tokenHash(token), (h.get('user-agent') ?? '').slice(0, 255), SESSION_DAYS],
    );
    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
    // clean up this user's expired sessions
    await query(`DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()`, [userId]);

    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        path: '/',
        maxAge: SESSION_DAYS * 86400,
    });
}

export async function destroySession(): Promise<void> {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash(token)]);
    store.delete(SESSION_COOKIE);
}

/** Signs out of all devices (after resetting a forgotten password). */
export async function destroyAllSessions(userId: number): Promise<void> {
    await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

/** Signs out of all devices except the current one (after a password change). */
export async function destroyOtherSessions(userId: number): Promise<void> {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value ?? '';
    await query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [userId, tokenHash(token)]);
}

/** The current user (cached for the duration of one request). */
export const getCurrentUser = cache(async (): Promise<User | null> => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token || token.length > 100) return null;
    const res = await query<User>(
        `SELECT ${USER_COLUMNS}
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [tokenHash(token)],
    );
    return res.rows[0] ?? null;
});

/** For pages and actions: not signed in → redirect to /login. */
export async function requireUser(): Promise<User> {
    const user = await getCurrentUser();
    if (!user) redirect('/login');
    return user;
}

export async function findUserByEmail(email: string): Promise<{ id: number; password_hash: string } | null> {
    const res = await query<{ id: number; password_hash: string }>(
        `SELECT id, password_hash FROM users WHERE lower(email) = $1`,
        [normalizeEmail(email)],
    );
    return res.rows[0] ?? null;
}

export async function loadUser(id: number): Promise<User | null> {
    const res = await query<User>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
    return res.rows[0] ?? null;
}
