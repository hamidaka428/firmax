import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Settings } from 'lucide-react';
import { requireAdmin } from '@/app/lib/admin-auth';
import { adminLogout } from '../actions';

export const metadata = { title: { default: 'Admin panel', template: '%s · Admin' }, robots: { index: false, follow: false } };

export default async function AdminPanelLayout({ children }: { children: ReactNode }) {
    await requireAdmin();

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
                    <Link href="/admin" className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600">
                            <Settings className="h-4 w-4 text-white" />
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">Admin panel</span>
                            <span className="block truncate text-xs text-slate-500">All companies on the platform</span>
                        </span>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                        <Link
                            href="/dashboard"
                            className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 sm:inline-flex"
                        >
                            Go to the app
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <form action={adminLogout}>
                            <button
                                type="submit"
                                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
                            >
                                Sign out
                            </button>
                        </form>
                    </div>
                </div>
            </header>
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        </div>
    );
}
