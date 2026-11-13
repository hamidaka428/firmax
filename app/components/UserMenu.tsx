'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, Settings } from 'lucide-react';
import { logout } from '@/app/(auth)/actions';

interface UserMenuProps {
    name: string;
    email: string;
}

export default function UserMenu({ name, email }: UserMenuProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const initials = (name || email).trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Account menu"
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-800"
            >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-200">
                    {initials}
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open ? (
                <div role="menu" className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
                    <div className="border-b border-slate-800 px-4 py-3">
                        <p className="truncate text-sm font-medium text-slate-100">{name || 'No name'}</p>
                        <p className="truncate text-xs text-slate-500">{email}</p>
                    </div>
                    <Link
                        href="/dashboard/account"
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800"
                    >
                        <Settings className="h-4 w-4 text-slate-500" />
                        Account
                    </Link>
                    <form action={logout} className="border-t border-slate-800">
                        <button type="submit" role="menuitem" className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800">
                            <ArrowRight className="h-4 w-4 text-slate-500" />
                            Sign out
                        </button>
                    </form>
                </div>
            ) : null}
        </div>
    );
}
