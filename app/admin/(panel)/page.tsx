import { Building2, FileText, Receipt, TrendingUp, Users } from 'lucide-react';
import type { ComponentType } from 'react';
import { requireAdmin } from '@/app/lib/admin-auth';
import { cardCls } from '@/app/components/ui/styles';
import { formatMoney, formatNumber } from '@/app/lib/format';
import { loadAdminCompanies, loadAdminOverview } from '../data';
import CompaniesTable from './CompaniesTable';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const MONTHS_BG = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Kpi({
    label,
    value,
    hint,
    icon: Icon,
}: {
    label: string;
    value: string;
    hint?: string;
    icon: ComponentType<{ className?: string }>;
}) {
    return (
        <div className={`${cardCls} p-5`}>
            <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">{label}</p>
                <Icon className="h-4 w-4 text-slate-500" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-100">{value}</p>
            {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
    );
}

export default async function AdminHomePage() {
    await requireAdmin();
    const [overview, companies] = await Promise.all([loadAdminOverview(), loadAdminCompanies()]);
    const maxSignups = Math.max(1, ...overview.signups_by_month.map((m) => m.count));

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Registered companies</h1>
                <p className="mt-1 text-sm text-slate-400">Platform overview and activity per company.</p>
            </div>


            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Kpi
                    label="Users"
                    value={formatNumber(overview.users, 0)}
                    hint={`+${overview.new_users_month} this month`}
                    icon={Users}
                />
                <Kpi
                    label="Companies"
                    value={formatNumber(overview.companies, 0)}
                    hint={`+${overview.new_this_month} this month`}
                    icon={Building2}
                />
                <Kpi
                    label="Active (30 days)"
                    value={formatNumber(overview.active_30d, 0)}
                    hint={
                        overview.companies
                            ? `${Math.round((overview.active_30d / overview.companies) * 100)}% of all`
                            : undefined
                    }
                    icon={TrendingUp}
                />
                <Kpi
                    label="Invoices"
                    value={formatNumber(overview.invoices, 0)}
                    hint={`${overview.invoices_30d} in the last 30 days`}
                    icon={Receipt}
                />
                <Kpi
                    label="Clients / contracts"
                    value={`${formatNumber(overview.clients, 0)} / ${formatNumber(overview.contracts, 0)}`}
                    hint="across all companies"
                    icon={Users}
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <section className={`${cardCls} min-w-0 p-5 lg:col-span-2`}>
                    <h2 className="text-sm font-semibold text-slate-200">New companies per month</h2>
                    <div className="mt-5 flex h-40 items-end gap-1.5 sm:gap-2">
                        {overview.signups_by_month.map((m) => {
                            const [y, mo] = m.month.split('-');
                            return (
                                <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                                    <span className="font-mono text-[11px] text-slate-400">{m.count || ''}</span>
                                    <div
                                        className={`w-full rounded-t ${m.count ? 'bg-indigo-500' : 'bg-slate-800'}`}
                                        style={{ height: `${Math.max(4, (m.count / maxSignups) * 110)}px` }}
                                        title={`${MONTHS_BG[Number(mo) - 1]} ${y}: ${m.count}`}
                                    />
                                    <span className="truncate text-[11px] text-slate-500">{MONTHS_BG[Number(mo) - 1]}</span>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className={`${cardCls} p-5`}>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                        <FileText className="h-4 w-4 text-slate-500" />
                        Invoiced through the platform
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">Total of non-cancelled invoices across all companies</p>
                    {overview.invoiced_by_currency.length ? (
                        <ul className="mt-4 space-y-2">
                            {overview.invoiced_by_currency.map((c) => (
                                <li key={c.currency} className="flex items-center justify-between rounded-lg bg-slate-950/60 px-3 py-2">
                                    <span className="text-sm text-slate-400">{c.currency}</span>
                                    <span className="font-mono text-sm text-slate-100">{formatMoney(c.total, c.currency)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mt-4 text-sm text-slate-500">No invoices yet.</p>
                    )}
                </section>
            </div>

            <CompaniesTable companies={companies} />
        </div>
    );
}
