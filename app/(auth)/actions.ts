'use server';

import { redirect } from 'next/navigation';
import { query } from '@/app/lib/db';
import {
    DUMMY_HASH,
    createSession,
    destroyAllSessions,
    destroySession,
    getCurrentUser,
    loadUser,
    findUserByEmail,
    hashPassword,
    normalizeEmail,
    validateEmail,
    validatePassword,
    verifyPassword,
} from '@/app/lib/auth';
import { consumeToken, createToken } from '@/app/lib/tokens';
import { passwordChangedEmail, resetPasswordEmail, verifyEmail } from '@/app/lib/email';
import { appUrl } from '@/app/lib/app';
import { clearFailures, clientIp, lockedMinutes, registerFailure } from '@/app/lib/rate-limit';

export interface AuthFormState {
    error: string | null;
    /** The password reset request was processed */
    sent?: boolean;
    /** Submitted values, so they are not lost on error */
    values?: Record<string, string>;
}

/** Only allow redirects to internal pages (no open redirect). */
function safeNext(raw: FormDataEntryValue | null): string {
    const v = typeof raw === 'string' ? raw : '';
    return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/dashboard';
}

const LOGIN_MAX = 8;
const LOGIN_WINDOW_MIN = 15;

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
    const email = normalizeEmail(String(formData.get('email') ?? ''));
    const password = String(formData.get('password') ?? '');
    const values = { email };

    const ip = await clientIp();
    const keys = [`login-ip:${ip}`, `login-email:${email}`];
    const locked = Math.max(lockedMinutes(keys[0], LOGIN_MAX * 3), lockedMinutes(keys[1], LOGIN_MAX));
    if (locked > 0) return { error: `Too many failed attempts. Try again in ${locked} min.`, values };

    if (validateEmail(email) || !password) return { error: 'Enter your email and password.', values };

    try {
        const user = await findUserByEmail(email);
        // Compare even when the user doesn't exist — constant time, so we don't reveal which emails are registered
        const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !ok) {
            keys.forEach((k) => registerFailure(k, LOGIN_WINDOW_MIN));
            return { error: 'Wrong email or password.', values };
        }
        clearFailures(keys[1]);
        await createSession(user.id);
    } catch (error) {
        console.error('login', error);
        return { error: `Sign-in failed. Please try again shortly.${devDetail(error)}`, values };
    }
    redirect(safeNext(formData.get('next')));
}

/** In development (npm run dev) shows the real cause of the error to make it easier to fix. */
function devDetail(error: unknown): string {
    if (process.env.NODE_ENV === 'production') return '';
    const msg = error instanceof Error ? error.message : String(error);
    const hint = /does not exist/.test(msg) ? ' — it looks like schema.sql has not been run on the database.' : '';
    return ` [dev: ${msg}${hint}]`;
}

export async function register(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
    const name = String(formData.get('name') ?? '').trim();
    const email = normalizeEmail(String(formData.get('email') ?? ''));
    const password = String(formData.get('password') ?? '');
    const password2 = String(formData.get('password2') ?? '');
    const values = { name, email };

    const ipKey = `register:${await clientIp()}`;
    if (lockedMinutes(ipKey, 10) > 0) return { error: 'Too many sign-ups from this address. Try again later.', values };

    if (!name || name.length > 150) return { error: 'Enter your name (up to 150 characters).', values };
    const emailError = validateEmail(email);
    if (emailError) return { error: emailError, values };
    const passwordError = validatePassword(password);
    if (passwordError) return { error: passwordError, values };
    if (password !== password2) return { error: 'Passwords do not match.', values };

    try {
        if (await findUserByEmail(email)) {
            return { error: 'An account with this email already exists. Sign in or use a different email.', values };
        }
        const hash = await hashPassword(password);
        const ins = await query<{ id: number }>(
            `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id`,
            [email, hash, name],
        );
        registerFailure(ipKey, 60); // counts sign-ups per IP (limit 10 per hour)
        await createSession(ins.rows[0].id);
        // The confirmation email must not fail the sign-up — it can be resent from the dashboard
        try {
            await sendVerification(ins.rows[0].id, email, name);
        } catch (mailError) {
            console.error('register: verification email', mailError);
        }
    } catch (error) {
        if ((error as { code?: string }).code === '23505') {
            return { error: 'An account with this email already exists.', values };
        }
        console.error('register', error);
        return { error: `Sign-up failed. Please try again shortly.${devDetail(error)}`, values };
    }
    redirect('/onboarding');
}

export async function logout(): Promise<void> {
    await destroySession();
    redirect('/login');
}

/* ----------------------------------------------------------------------------
 * Email confirmation
 * ------------------------------------------------------------------------- */

const VERIFY_TTL_MIN = 7 * 24 * 60;

async function sendVerification(userId: number, email: string, name: string): Promise<void> {
    const token = await createToken(userId, 'verify', VERIFY_TTL_MIN);
    await verifyEmail(email, name, `${appUrl()}/verify-email?token=${token}`);
}

export interface SimpleResult {
    ok: boolean;
    message: string;
}

/** Resends the confirmation link (up to 3 times per hour). */
export async function resendVerification(): Promise<SimpleResult> {
    const user = await getCurrentUser();
    if (!user) return { ok: false, message: 'Please sign in.' };
    if (user.email_verified) return { ok: true, message: 'Your email is already confirmed.' };
    const key = `verify-resend:${user.id}`;
    if (lockedMinutes(key, 3) > 0) return { ok: false, message: 'We have sent several emails. Check your spam folder or try again shortly.' };
    registerFailure(key, 60);
    try {
        await sendVerification(user.id, user.email, user.name);
    } catch (error) {
        console.error('resendVerification', error);
        return { ok: false, message: 'Sending failed. Please try again.' };
    }
    return { ok: true, message: `We sent a new link to ${user.email}.` };
}

/** Confirms the email from the link in the message. */
export async function confirmEmail(token: string): Promise<boolean> {
    const userId = await consumeToken(token, 'verify');
    if (!userId) return false;
    await query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [userId]);
    return true;
}

/* ----------------------------------------------------------------------------
 * Forgot password
 * ------------------------------------------------------------------------- */

const RESET_TTL_MIN = 60;

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
    const email = normalizeEmail(String(formData.get('email') ?? ''));
    const values = { email };
    if (validateEmail(email)) return { error: 'Enter a valid email.', values };

    const ipKey = `reset-ip:${await clientIp()}`;
    const emailKey = `reset-email:${email}`;
    if (lockedMinutes(ipKey, 10) > 0 || lockedMinutes(emailKey, 3) > 0) {
        return { error: 'Too many requests. Please try again shortly.', values };
    }
    registerFailure(ipKey, 60);
    registerFailure(emailKey, 60);

    try {
        const user = await findUserByEmail(email);
        if (user) {
            const full = await loadUser(user.id);
            const token = await createToken(user.id, 'reset', RESET_TTL_MIN);
            await resetPasswordEmail(email, full?.name ?? '', `${appUrl()}/reset-password?token=${token}`);
        }
    } catch (error) {
        console.error('requestPasswordReset', error);
    }
    // Same response whether or not the email exists — we don't reveal which emails are registered
    return { error: null, values, sent: true };
}

export async function resetPassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
    const token = String(formData.get('token') ?? '');
    const password = String(formData.get('password') ?? '');
    const password2 = String(formData.get('password2') ?? '');
    const invalid = validatePassword(password);
    if (invalid) return { error: invalid };
    if (password !== password2) return { error: 'Passwords do not match.' };

    let userId: number | null;
    try {
        userId = await consumeToken(token, 'reset');
        if (!userId) return { error: 'The link is invalid or has expired. Request a new one via "Forgot password".' };
        await query(`UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2`, [
            await hashPassword(password),
            userId,
        ]);
        await destroyAllSessions(userId);
        await createSession(userId);
        const user = await loadUser(userId);
        if (user) await passwordChangedEmail(user.email, user.name);
    } catch (error) {
        console.error('resetPassword', error);
        return { error: 'Password change failed. Please try again.' };
    }
    redirect('/dashboard');
}
