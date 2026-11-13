'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { btnPrimary, inputCls, labelCls } from '@/app/components/ui/styles';
import { login, register, requestPasswordReset, resetPassword } from './actions';
import type { AuthFormState } from './actions';

const INITIAL: AuthFormState = { error: null };

function ErrorBox({ message }: { message: string | null }) {
    if (!message) return null;
    return (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {message}
        </div>
    );
}

export function LoginForm({ next }: { next: string }) {
    const [state, action, pending] = useActionState(login, INITIAL);
    return (
        <form action={action} className="space-y-4">
            <ErrorBox message={state.error} />
            <input type="hidden" name="next" value={next} />
            <div>
                <label htmlFor="login-email" className={labelCls}>Email</label>
                <input id="login-email" name="email" type="email" autoComplete="email" required autoFocus defaultValue={state.values?.email} className={inputCls} />
            </div>
            <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                    <label htmlFor="login-password" className="text-xs font-medium text-slate-400">Password</label>
                    <Link href="/forgot-password" className="text-xs text-indigo-300 hover:text-indigo-200">
                        Forgot password?
                    </Link>
                </div>
                <input id="login-password" name="password" type="password" autoComplete="current-password" required className={inputCls} />
            </div>
            <button type="submit" disabled={pending} className={`${btnPrimary} w-full justify-center py-2.5`}>
                {pending ? 'Signing in…' : 'Sign in'}
                <ArrowRight className="h-4 w-4" />
            </button>
            <p className="text-center text-sm text-slate-400">
                Don&apos;t have an account?{' '}
                <Link href="/register" className="font-medium text-indigo-300 hover:text-indigo-200">
                    Sign up for free
                </Link>
            </p>
        </form>
    );
}

export function RegisterForm() {
    const [state, action, pending] = useActionState(register, INITIAL);
    return (
        <form action={action} className="space-y-4">
            <ErrorBox message={state.error} />
            <div>
                <label htmlFor="reg-name" className={labelCls}>Full name</label>
                <input id="reg-name" name="name" autoComplete="name" required maxLength={150} defaultValue={state.values?.name} className={inputCls} />
            </div>
            <div>
                <label htmlFor="reg-email" className={labelCls}>Email</label>
                <input id="reg-email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} className={inputCls} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor="reg-password" className={labelCls}>Password</label>
                    <input id="reg-password" name="password" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
                </div>
                <div>
                    <label htmlFor="reg-password2" className={labelCls}>Repeat password</label>
                    <input id="reg-password2" name="password2" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
                </div>
            </div>
            <p className="-mt-2 text-xs text-slate-500">At least 8 characters, with at least one letter and one digit.</p>
            <button type="submit" disabled={pending} className={`${btnPrimary} w-full justify-center py-2.5`}>
                {pending ? 'Creating…' : 'Create account'}
                <ArrowRight className="h-4 w-4" />
            </button>
            <p className="text-center text-sm text-slate-400">
                Already have an account?{' '}
                <Link href="/login" className="font-medium text-indigo-300 hover:text-indigo-200">
                    Sign in
                </Link>
            </p>
        </form>
    );
}

export function ForgotPasswordForm() {
    const [state, action, pending] = useActionState(requestPasswordReset, INITIAL);
    if (state.sent) {
        return (
            <div className="space-y-4 text-center">
                <p className="text-sm leading-relaxed text-slate-300">
                    If an account exists for <span className="font-medium text-slate-100">{state.values?.email}</span>, we sent a password reset
                    link. The link is valid for 1 hour. Check your spam folder too.
                </p>
                <Link href="/login" className="inline-flex text-sm font-medium text-indigo-300 hover:text-indigo-200">
                    Back to sign in
                </Link>
            </div>
        );
    }
    return (
        <form action={action} className="space-y-4">
            <ErrorBox message={state.error} />
            <div>
                <label htmlFor="forgot-email" className={labelCls}>Account email</label>
                <input id="forgot-email" name="email" type="email" autoComplete="email" required autoFocus defaultValue={state.values?.email} className={inputCls} />
            </div>
            <button type="submit" disabled={pending} className={`${btnPrimary} w-full justify-center py-2.5`}>
                {pending ? 'Sending…' : 'Send link'}
                <ArrowRight className="h-4 w-4" />
            </button>
            <p className="text-center text-sm text-slate-400">
                <Link href="/login" className="text-indigo-300 hover:text-indigo-200">
                    Back to sign in
                </Link>
            </p>
        </form>
    );
}

export function ResetPasswordForm({ token }: { token: string }) {
    const [state, action, pending] = useActionState(resetPassword, INITIAL);
    return (
        <form action={action} className="space-y-4">
            <ErrorBox message={state.error} />
            <input type="hidden" name="token" value={token} />
            <div>
                <label htmlFor="reset-password" className={labelCls}>New password</label>
                <input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus className={inputCls} />
            </div>
            <div>
                <label htmlFor="reset-password2" className={labelCls}>Repeat new password</label>
                <input id="reset-password2" name="password2" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
            </div>
            <p className="-mt-2 text-xs text-slate-500">At least 8 characters, with at least one letter and one digit. You&apos;ll be signed out of all other devices.</p>
            <button type="submit" disabled={pending} className={`${btnPrimary} w-full justify-center py-2.5`}>
                {pending ? 'Saving…' : 'Save new password'}
                <ArrowRight className="h-4 w-4" />
            </button>
        </form>
    );
}
