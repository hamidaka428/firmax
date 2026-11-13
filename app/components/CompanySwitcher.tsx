'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import { switchCompany } from '@/app/lib/tenant-actions';
import { useToast } from '@/app/components/ui/ToastProvider';

export interface SwitcherCompany {
    id: number;
    name: string;
    reg_no: string;
}

interface CompanySwitcherProps {
    companies: SwitcherCompany[];
    activeId: number;
    activeLogoUrl?: string | null;
}

export default function CompanySwitcher({ companies, activeId, activeLogoUrl = null }: CompanySwitcherProps) {
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();
    const rootRef = useRef<HTMLDivElement | null>(null);

    const active = companies.find((c) => c.id === activeId) ?? companies[0];

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    function handleSelect(company: SwitcherCompany) {
        setOpen(false);
        if (company.id === activeId) return;

        startTransition(async () => {
            const result = await switchCompany(company.id);
            if (result.ok) {
                toast.success('Company switched', company.name);
            } else {
                toast.error('Could not switch company', result.error);
            }
        });
    }

    return (
        <div ref={rootRef} className="relative min-w-0">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={isPending}
                className={`flex max-w-full items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-left transition-colors hover:bg-slate-800 disabled:opacity-60 ${
                    isPending ? 'animate-pulse' : ''
                }`}
            >
                {activeLogoUrl && !isPending ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-0.5">
                        {/* eslint-disable-next-line @next/next/no-img-element -- the logo comes from the protected /api/files route */}
                        <img src={activeLogoUrl} alt="" className="max-h-full max-w-full object-contain" />
                    </span>
                ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-indigo-300">
                        <Building2 className="h-4 w-4" />
                    </span>
                )}
                <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                        {isPending ? 'Switching…' : (active?.name ?? 'No company')}
                    </span>
                    <span className="block font-mono text-xs text-slate-500">Reg. no.: {active?.reg_no || '---'}</span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open ? (
                <div
                    role="listbox"
                    className="absolute left-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] animate-pop-in overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
                >
                    <p className="border-b border-slate-800 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Switch active company
                    </p>
                    <ul className="max-h-72 overflow-y-auto py-1">
                        {companies.map((company) => {
                            const isActive = company.id === activeId;
                            return (
                                <li key={company.id}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={isActive}
                                        onClick={() => handleSelect(company)}
                                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-800"
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-slate-100">{company.name}</span>
                                            <span className="block font-mono text-xs text-slate-500">Reg. no.: {company.reg_no || '---'}</span>
                                        </span>
                                        {isActive ? <Check className="h-4 w-4 shrink-0 text-emerald-400" /> : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <Link
                        href="/dashboard/settings?new=1"
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-2 border-t border-slate-800 px-4 py-3 text-sm font-medium text-indigo-300 transition-colors hover:bg-slate-800"
                    >
                        <Plus className="h-4 w-4" />
                        New company
                    </Link>
                </div>
            ) : null}
        </div>
    );
}
