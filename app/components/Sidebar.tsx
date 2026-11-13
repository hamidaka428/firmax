'use client';

import { APP_NAME } from '@/app/lib/app';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, LayoutDashboard, Package, Receipt, Settings, Users } from 'lucide-react';

const NAV_ITEMS = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { href: '/dashboard/warehouse', label: 'Inventory', icon: Package, exact: false },
    { href: '/dashboard/clients', label: 'Clients', icon: Users, exact: false },
    { href: '/dashboard/contracts', label: 'Contracts', icon: FileText, exact: false },
    { href: '/dashboard/invoices', label: 'Invoices', icon: Receipt, exact: false },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings, exact: false },
] as const;

export default function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="no-print sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 lg:w-64">
            <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                    {APP_NAME.charAt(0)}
                </div>
                <div className="hidden min-w-0 lg:block">
                    <p className="truncate text-sm font-semibold text-slate-100">{APP_NAME}</p>
                    <p className="truncate text-xs text-slate-500">Invoices · Contracts · Inventory</p>
                </div>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-2 lg:p-3">
                {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
                    const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
                    return (
                        <Link
                            key={href}
                            href={href}
                            title={label}
                            aria-current={active ? 'page' : undefined}
                            className={`flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:justify-start ${
                                active
                                    ? 'bg-indigo-500/15 text-indigo-300'
                                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                            }`}
                        >
                            <Icon className="h-5 w-5 shrink-0" />
                            <span className="hidden lg:inline">{label}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className="hidden border-t border-slate-800 p-4 text-xs text-slate-500 lg:block">
                Each company&apos;s data is visible only to you.
            </div>
        </aside>
    );
}
