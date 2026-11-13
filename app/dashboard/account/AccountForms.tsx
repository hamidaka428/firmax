'use client';

import { useActionState, useState } from 'react';
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { btnSecondary, inputCls, labelCls } from '@/app/components/ui/styles';
import { changePassword, deleteAccount, updateProfile } from './actions';
import type { FormState } from './actions';

const INITIAL: FormState = { error: null };

function Message({ state }: { state: FormState }) {
    if (state.error) {
        return (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-rose-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {state.error}
            </p>
        );
    }
    if (state.success) {
        return (
            <p role="status" className="flex items-start gap-1.5 text-sm text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                {state.success}
            </p>
        );
    }
    return null;
}

/* ----------------------------------------------------------------------------
 * Profile, password, deletion
 * ------------------------------------------------------------------------- */

export function ProfileForm({ name, email }: { name: string; email: string }) {
    const [state, action, pending] = useActionState(updateProfile, INITIAL);
    return (
        <form action={action} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor="acc-name" className={labelCls}>Name</label>
                    <input id="acc-name" name="name" defaultValue={name} maxLength={150} required className={inputCls} />
                </div>
                <div>
                    <label htmlFor="acc-email" className={labelCls}>Email</label>
                    <input id="acc-email" value={email} readOnly className={`${inputCls} opacity-70`} />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={pending} className={btnSecondary}>
                    {pending ? 'Saving…' : 'Save name'}
                </button>
                <Message state={state} />
            </div>
        </form>
    );
}

export function PasswordForm() {
    const [state, action, pending] = useActionState(changePassword, INITIAL);
    return (
        <form action={action} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
                <div>
                    <label htmlFor="pw-current" className={labelCls}>Current password</label>
                    <input id="pw-current" name="current" type="password" autoComplete="current-password" required className={inputCls} />
                </div>
                <div>
                    <label htmlFor="pw-next" className={labelCls}>New password</label>
                    <input id="pw-next" name="next" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
                </div>
                <div>
                    <label htmlFor="pw-next2" className={labelCls}>Repeat new password</label>
                    <input id="pw-next2" name="next2" type="password" autoComplete="new-password" required minLength={8} className={inputCls} />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={pending} className={btnSecondary}>
                    {pending ? 'Changing…' : 'Change password'}
                </button>
                <Message state={state} />
            </div>
        </form>
    );
}

export function DeleteAccountForm() {
    const [state, action, pending] = useActionState(deleteAccount, INITIAL);
    const [open, setOpen] = useState(false);
    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 px-4 py-2 text-sm text-rose-300 transition-colors hover:bg-rose-500/10">
                <Trash2 className="h-4 w-4" />
                Delete account
            </button>
        );
    }
    return (
        <form action={action} className="space-y-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
            <p className="text-sm text-rose-200">
                Your account, all companies, clients, contracts, invoices and uploaded files will be permanently deleted. <strong>Most countries require you to keep invoices for several years — download them (CSV/PDF) first.</strong>
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor="del-password" className={labelCls}>Password</label>
                    <input id="del-password" name="password" type="password" autoComplete="current-password" required className={inputCls} />
                </div>
                <div>
                    <label htmlFor="del-confirm" className={labelCls}>Type DELETE</label>
                    <input id="del-confirm" name="confirm" required autoComplete="off" className={inputCls} />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-60">
                    <Trash2 className="h-4 w-4" />
                    {pending ? 'Deleting…' : 'Delete permanently'}
                </button>
                <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
                    Cancel
                </button>
                <Message state={state} />
            </div>
        </form>
    );
}
