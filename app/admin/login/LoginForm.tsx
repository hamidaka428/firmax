'use client';

import { useActionState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { adminLogin } from '../actions';
import type { LoginState } from '../actions';
import { btnPrimary, inputCls, labelCls } from '@/app/components/ui/styles';

const INITIAL: LoginState = { error: null };

export default function LoginForm({ configured }: { configured: boolean }) {
    const [state, action, pending] = useActionState(adminLogin, INITIAL);

    return (
        <form action={action} className="space-y-4">
            {!configured ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                    The admin panel is disabled. Add the line{' '}
                    <span className="font-mono">ADMIN_PASSWORD=…</span> (at least 10 characters) to <span className="font-mono">.env.local</span> and restart the server.
                </div>
            ) : null}
            {state.error ? (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {state.error}
                </div>
            ) : null}
            <div>
                <label htmlFor="admin-password" className={labelCls}>Admin password</label>
                <input
                    id="admin-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    autoFocus
                    disabled={!configured || pending}
                    className={inputCls}
                />
            </div>
            <button type="submit" disabled={!configured || pending} className={`${btnPrimary} w-full justify-center`}>
                {pending ? 'Checking…' : 'Sign in'}
                <ArrowRight className="h-4 w-4" />
            </button>
        </form>
    );
}
