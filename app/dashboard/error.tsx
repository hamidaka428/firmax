'use client';

import { AlertTriangle } from 'lucide-react';
import { btnPrimary } from '@/app/components/ui/styles';

/** Shown when a /dashboard page throws (e.g. the database stopped while in use). */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
                <AlertTriangle className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-xl font-semibold text-slate-100">The page could not be loaded</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
                The most common cause is that the database is not running. Check that Docker Desktop is running and the{' '}
                <span className="font-mono text-slate-300">erp_postgres</span> container is up (<span className="font-mono text-slate-300">docker compose up -d</span>),
                then try again.
            </p>
            {error.digest ? <p className="mt-3 font-mono text-xs text-slate-600">code: {error.digest}</p> : null}
            <button type="button" onClick={reset} className={`${btnPrimary} mt-6`}>
                Try again
            </button>
        </div>
    );
}
