'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Download, Eye, Search } from 'lucide-react';
import { badgeAmber, badgeEmerald, badgeSlate, btnSecondary, cardCls, inputCls } from '@/app/components/ui/styles';
import { daysBetween, formatDate, formatMoney, todayISO } from '@/app/lib/format';
import type { AdminCompanyRow } from '../data';

type Filter = 'all' | 'active' | 'inactive' | 'empty';
type SortKey = 'created_at' | 'last_activity' | 'name' | 'invoices' | 'invoiced_total' | 'clients';

const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active (30 days)' },
    { id: 'inactive', label: 'Inactive' },
    { id: 'empty', label: 'No invoices' },
];

const SORTS: { id: SortKey; label: string }[] = [
    { id: 'created_at', label: 'Newest' },
    { id: 'last_activity', label: 'Last activity' },
    { id: 'invoices', label: 'Invoice count' },
    { id: 'invoiced_total', label: 'Invoiced amount' },
    { id: 'clients', label: 'Client count' },
    { id: 'name', label: 'Name (A–Z)' },
];

function activityBadge(lastActivity: string, today: string) {
    const days = daysBetween(lastActivity, today);
    if (days <= 7) return <span className={badgeEmerald}>{days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`}</span>;
    if (days <= 30) return <span className={badgeSlate}>{days} days ago</span>;
    return <span className={badgeAmber}>{days} days ago</span>;
}

function toCsv(rows: AdminCompanyRow[]): string {
    const cell = (v: string | number) => {
        const s = String(v);
        const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
        return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const header = ['ID', 'Company', 'Reg. no.', 'City', 'Email', 'Phone', 'Owner', 'Registered', 'Last activity', 'Clients', 'Products', 'Contracts', 'Invoices', 'Invoices (30 days)', 'Invoiced', 'Currency'];
    const lines = rows.map((r) =>
        [r.id, r.name, r.reg_no, r.city, r.email, r.phone, r.owner_email ?? '', r.created_at, r.last_activity, r.clients, r.products, r.contracts, r.invoices, r.invoices_30d, r.invoiced_total.toFixed(2).replace('.', ','), r.currency]
            .map(cell)
            .join(';'),
    );
    return '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n';
}

export default function CompaniesTable({ companies }: { companies: AdminCompanyRow[] }) {
    const today = todayISO();
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [sort, setSort] = useState<SortKey>('created_at');

    const counts = useMemo(() => {
        const active = companies.filter((c) => daysBetween(c.last_activity, today) <= 30).length;
        return {
            all: companies.length,
            active,
            inactive: companies.length - active,
            empty: companies.filter((c) => c.invoices === 0).length,
        } satisfies Record<Filter, number>;
    }, [companies, today]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        const rows = companies.filter((c) => {
            if (q && ![c.name, c.reg_no, c.city, c.email, c.owner_email ?? ''].some((v) => v.toLowerCase().includes(q))) return false;
            const days = daysBetween(c.last_activity, today);
            if (filter === 'active') return days <= 30;
            if (filter === 'inactive') return days > 30;
            if (filter === 'empty') return c.invoices === 0;
            return true;
        });
        return rows.sort((a, b) => {
            switch (sort) {
                case 'name':
                    return a.name.localeCompare(b.name, 'en');
                case 'invoices':
                    return b.invoices - a.invoices;
                case 'invoiced_total':
                    return b.invoiced_total - a.invoiced_total;
                case 'clients':
                    return b.clients - a.clients;
                case 'last_activity':
                    return b.last_activity.localeCompare(a.last_activity);
                default:
                    return b.created_at.localeCompare(a.created_at) || b.id - a.id;
            }
        });
    }, [companies, search, filter, sort, today]);

    function exportCsv() {
        const blob = new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `firmi_${today}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <section className={`${cardCls} overflow-hidden`}>
            <div className="space-y-3 border-b border-slate-800 p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-56 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by name, reg. no., city, email or owner…"
                            aria-label="Search companies"
                            className={`${inputCls} pl-9`}
                        />
                    </div>
                    <div className="relative">
                        <select
                            value={sort}
                            onChange={(e) => setSort(e.target.value as SortKey)}
                            aria-label="Sort by"
                            className={`${inputCls} appearance-none pr-9`}
                        >
                            {SORTS.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.label}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    </div>
                    <button type="button" onClick={exportCsv} className={btnSecondary} disabled={visible.length === 0}>
                        <Download className="h-4 w-4" />
                        CSV
                    </button>
                </div>
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter">
                    {FILTERS.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            role="tab"
                            aria-selected={filter === f.id}
                            onClick={() => setFilter(f.id)}
                            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                                filter === f.id ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/40' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                            }`}
                        >
                            {f.label} <span className="ml-1 font-mono text-xs text-slate-500">{counts[f.id]}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="overflow-x-auto [contain:paint]">
                <table className="w-full min-w-[60rem] text-sm">
                    <thead>
                        <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-3 font-medium">Company</th>
                            <th className="px-4 py-3 font-medium">Registered</th>
                            <th className="px-4 py-3 font-medium">Activity</th>
                            <th className="px-4 py-3 text-right font-medium">Clients</th>
                            <th className="px-4 py-3 text-right font-medium">Contracts</th>
                            <th className="px-4 py-3 text-right font-medium">Invoices</th>
                            <th className="px-4 py-3 text-right font-medium">Invoiced</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {visible.map((c) => (
                            <tr key={c.id} className="transition-colors hover:bg-slate-800/40">
                                <td className="px-4 py-3">
                                    <Link href={`/admin/companies/${c.id}`} className="block min-w-0 hover:text-indigo-300">
                                        <span className="block max-w-[18rem] truncate font-medium text-slate-100">{c.name}</span>
                                        <span className="block font-mono text-xs text-slate-500">
                                            Reg. no. {c.reg_no || '—'}
                                            {c.city ? ` · ${c.city}` : ''}
                                        </span>
                                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                                            <span className="max-w-[14rem] truncate">{c.owner_email ?? 'no owner'}</span>
                                        </span>
                                    </Link>
                                </td>
                                <td className="px-4 py-3 text-slate-300">{formatDate(c.created_at)}</td>
                                <td className="px-4 py-3">{activityBadge(c.last_activity, today)}</td>
                                <td className="px-4 py-3 text-right font-mono text-slate-300">{c.clients}</td>
                                <td className="px-4 py-3 text-right font-mono text-slate-300">{c.contracts}</td>
                                <td className="px-4 py-3 text-right font-mono text-slate-300">
                                    {c.invoices}
                                    {c.invoices_30d ? <span className="ml-1 text-xs text-emerald-400">+{c.invoices_30d}</span> : null}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-slate-100">{formatMoney(c.invoiced_total, c.currency)}</td>
                                <td className="px-4 py-3 text-right">
                                    <Link
                                        href={`/admin/companies/${c.id}`}
                                        aria-label={`Details for ${c.name}`}
                                        className="inline-flex rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                                    >
                                        <Eye className="h-4 w-4" />
                                    </Link>
                                </td>
                            </tr>
                        ))}
                        {visible.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">
                                    No companies match your search.
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
