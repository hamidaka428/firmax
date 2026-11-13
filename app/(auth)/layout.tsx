import type { ReactNode } from 'react';
import Link from 'next/link';
import { APP_NAME } from '@/app/lib/app';

export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
            <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
                <Link href="/" className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                        {APP_NAME.charAt(0)}
                    </span>
                    <span className="font-semibold">{APP_NAME}</span>
                </Link>
            </header>
            <main className="flex flex-1 items-center justify-center px-4 py-8">{children}</main>
        </div>
    );
}
