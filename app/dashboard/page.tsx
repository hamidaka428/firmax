import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Clock, FileText, Package, Receipt, TrendingUp } from 'lucide-react';
import { query } from '@/app/lib/db';
import { requireActiveCompany } from '@/app/lib/tenant';
import { runRecurringBillingLazy } from '@/app/lib/recurring';
import { invoiceStatusLabel } from '@/app/lib/labels';
import {
    MONTHS_SHORT,
    SQL_TODAY,
    daysBetween,
    formatCompact,
    formatDate,
    formatMoney,
    formatQty,
    pluralDays,
    todayISO,
} from '@/app/lib/format';
import { badgeAmber, badgeEmerald, badgeRose, badgeSlate, cardCls } from '@/app/components/ui/styles';

export const metadata = { title: 'Dashboard' };

interface StockStats { products: number; stock_value: number; critical: number }
interface ContractStats { active: number; expiring: number; expired: number }
interface InvoiceStats {
    pending_count: number;
    pending_amount: number;
    overdue_count: number;
    overdue_amount: number;
    month_revenue: number;
    paid_total: number;
}
interface MonthRow { ym: string; total: number }
interface LowStockRow { id: number; sku: string; name: string; unit: string; qty_in_stock: number; min_stock_level: number }
interface AttentionContract { id: number; contract_number: string; title: string; end_date: string; client_name: string }
interface RecentInvoice {
    id: number;
    invoice_number: string;
    issue_date: string;
    due_date: string | null;
    total_amount: number;
    status: string;
    client_name: string;
}

type Tone = 'indigo' | 'emerald' | 'amber' | 'rose';
const TONE_ICON: Record<Tone, string> = {
    indigo: 'bg-indigo-500/10 text-indigo-300',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-400',
    rose: 'bg-rose-500/10 text-rose-400',
};

function KpiCard({
    href,
    icon,
    label,
    value,
    hint,
    tone,
}: {
    href: string;
    icon: ReactNode;
    label: string;
    value: string;
    hint: ReactNode;
    tone: Tone;
}) {
    return (
        <Link href={href} className={`${cardCls} group block p-5 transition-colors hover:border-slate-700`}>
            <div className="flex items-start justify-between">
                <p className="text-sm text-slate-400">{label}</p>
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>{icon}</span>
            </div>
            <p className="mt-3 truncate font-mono text-2xl font-semibold text-slate-100">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </Link>
    );
}

function SectionCard({
    title,
    action,
    children,
}: {
    title: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className={`${cardCls} p-5`}>
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

function SeeAll({ href, label }: { href: string; label: string }) {
    return (
        <Link href={href} className="flex items-center gap-1 text-xs font-medium text-indigo-300 hover:text-indigo-200">
            {label}
            <ArrowRight className="h-3.5 w-3.5" />
        </Link>
    );
}

export default async function DashboardPage() {
    const company = await requireActiveCompany();
    await runRecurringBillingLazy(company.id); // due recurring invoices from contracts
    const cid = company.id;
    const cur = company.currency;
    const today = todayISO();

    const [stock, contracts, invoices, months, lowStock, attention, recent] = await Promise.all([
        query<StockStats>(
            `SELECT COUNT(*) AS products,
                    COALESCE(SUM(qty_in_stock * unit_price), 0) AS stock_value,
                    COUNT(*) FILTER (WHERE qty_in_stock <= min_stock_level) AS critical
               FROM products WHERE company_id = $1`,
            [cid],
        ),
        query<ContractStats>(
            `SELECT COUNT(*) FILTER (WHERE status = 'active' AND (end_date IS NULL OR end_date >= ${SQL_TODAY})) AS active,
                    COUNT(*) FILTER (WHERE status = 'active' AND end_date >= ${SQL_TODAY}
                                       AND end_date <= ${SQL_TODAY} + 14) AS expiring,
                    COUNT(*) FILTER (WHERE status = 'active' AND end_date < ${SQL_TODAY}) AS expired
               FROM contracts WHERE company_id = $1`,
            [cid],
        ),
        query<InvoiceStats>(
            // Proformas are not tax documents; credit notes reduce revenue and receivables
            `SELECT COUNT(*) FILTER (WHERE status = 'pending' AND doc_type IN ('invoice', 'debit_note')) AS pending_count,
                    COALESCE(SUM((CASE WHEN doc_type = 'credit_note' THEN -total_amount ELSE total_amount END)) FILTER (WHERE status = 'pending'), 0) AS pending_amount,
                    COUNT(*) FILTER (WHERE status = 'pending' AND doc_type IN ('invoice', 'debit_note') AND due_date < ${SQL_TODAY}) AS overdue_count,
                    COALESCE(SUM(total_amount) FILTER (WHERE status = 'pending' AND doc_type IN ('invoice', 'debit_note') AND due_date < ${SQL_TODAY}), 0) AS overdue_amount,
                    COALESCE(SUM((CASE WHEN doc_type = 'credit_note' THEN -total_amount ELSE total_amount END)) FILTER (WHERE status <> 'cancelled'
                              AND to_char(issue_date, 'YYYY-MM') = to_char(${SQL_TODAY}, 'YYYY-MM')), 0) AS month_revenue,
                    COALESCE(SUM((CASE WHEN doc_type = 'credit_note' THEN -total_amount ELSE total_amount END)) FILTER (WHERE status = 'paid'), 0) AS paid_total
               FROM invoices WHERE company_id = $1 AND doc_type <> 'proforma'`,
            [cid],
        ),
        query<MonthRow>(
            `SELECT to_char(m, 'YYYY-MM') AS ym, COALESCE(SUM((CASE WHEN i.doc_type = 'credit_note' THEN -i.total_amount ELSE i.total_amount END)), 0) AS total
               FROM generate_series(date_trunc('month', ${SQL_TODAY}::timestamp) - interval '5 months',
                                    date_trunc('month', ${SQL_TODAY}::timestamp),
                                    interval '1 month') AS m
               LEFT JOIN invoices i
                      ON i.company_id = $1 AND i.status <> 'cancelled' AND i.doc_type <> 'proforma'
                     AND to_char(i.issue_date, 'YYYY-MM') = to_char(m, 'YYYY-MM')
              GROUP BY m ORDER BY m`,
            [cid],
        ),
        query<LowStockRow>(
            `SELECT id, COALESCE(sku, '') AS sku, name, unit, qty_in_stock, min_stock_level
               FROM products
              WHERE company_id = $1 AND qty_in_stock <= min_stock_level
              ORDER BY (qty_in_stock - min_stock_level) ASC, name ASC LIMIT 5`,
            [cid],
        ),
        query<AttentionContract>(
            `SELECT c.id, COALESCE(c.contract_number, '') AS contract_number, c.title, c.end_date,
                    COALESCE(cl.name, '—') AS client_name
               FROM contracts c LEFT JOIN clients cl ON cl.id = c.client_id
              WHERE c.company_id = $1 AND c.status = 'active' AND c.end_date IS NOT NULL
                AND c.end_date <= ${SQL_TODAY} + 14
              ORDER BY c.end_date ASC LIMIT 6`,
            [cid],
        ),
        query<RecentInvoice>(
            `SELECT i.id, COALESCE(i.invoice_number, '') AS invoice_number, i.issue_date, i.due_date,
                    i.total_amount, i.status, COALESCE(cl.name, '—') AS client_name
               FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
              WHERE i.company_id = $1
              ORDER BY i.issue_date DESC, i.id DESC LIMIT 6`,
            [cid],
        ),
    ]);

    const s = stock.rows[0];
    const c = contracts.rows[0];
    const inv = invoices.rows[0];
    const maxMonth = Math.max(1, ...months.rows.map((m) => m.total));
    const currentYm = today.slice(0, 7);

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>
                <p className="mt-1 text-sm text-slate-400">Overview for {company.name}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                    href="/dashboard/warehouse"
                    tone="indigo"
                    icon={<Package className="h-5 w-5" />}
                    label="Inventory value"
                    value={formatMoney(s.stock_value, cur)}
                    hint={
                        s.critical > 0 ? (
                            <span className="text-amber-400">{s.critical} low on stock</span>
                        ) : (
                            `${s.products} products`
                        )
                    }
                />
                <KpiCard
                    href="/dashboard/contracts"
                    tone="emerald"
                    icon={<FileText className="h-5 w-5" />}
                    label="Active contracts"
                    value={String(c.active)}
                    hint={
                        c.expiring + c.expired > 0 ? (
                            <span className="text-amber-400">
                                {c.expiring} expiring · {c.expired} expired
                            </span>
                        ) : (
                            'No contracts need attention'
                        )
                    }
                />
                <KpiCard
                    href="/dashboard/invoices"
                    tone={inv.overdue_count > 0 ? 'rose' : 'amber'}
                    icon={<Receipt className="h-5 w-5" />}
                    label="Unpaid invoices"
                    value={formatMoney(inv.pending_amount, cur)}
                    hint={
                        inv.overdue_count > 0 ? (
                            <span className="text-rose-400">
                                {inv.overdue_count} overdue, totalling {formatMoney(inv.overdue_amount, cur)}
                            </span>
                        ) : (
                            `${inv.pending_count} awaiting payment`
                        )
                    }
                />
                <KpiCard
                    href="/dashboard/invoices"
                    tone="emerald"
                    icon={<TrendingUp className="h-5 w-5" />}
                    label="Invoiced this month"
                    value={formatMoney(inv.month_revenue, cur)}
                    hint={`Payments received in total: ${formatMoney(inv.paid_total, cur)}`}
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                    <SectionCard title="Invoiced over the last 6 months">
                        <div className="flex h-48 items-stretch gap-3">
                            {months.rows.map((m) => {
                                const pct = m.total > 0 ? Math.max(4, Math.round((m.total / maxMonth) * 100)) : 0;
                                const monthIndex = Number(m.ym.slice(5, 7)) - 1;
                                const isCurrent = m.ym === currentYm;
                                return (
                                    <div key={m.ym} className="flex min-w-0 flex-1 flex-col items-center gap-2" title={formatMoney(m.total, cur)}>
                                        <span className="h-4 font-mono text-[11px] text-slate-400">
                                            {m.total > 0 ? formatCompact(m.total) : ''}
                                        </span>
                                        <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                                            <div
                                                className={`w-full max-w-14 rounded-t-md ${isCurrent ? 'bg-indigo-500' : 'bg-indigo-500/40'}`}
                                                style={{ height: `${pct}%` }}
                                            />
                                        </div>
                                        <span className={`text-xs ${isCurrent ? 'font-semibold text-slate-200' : 'text-slate-500'}`}>
                                            {MONTHS_SHORT[monthIndex]}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </SectionCard>
                </div>

                <SectionCard title="Low stock" action={<SeeAll href="/dashboard/warehouse?filter=critical" label="All" />}>
                    {lowStock.rows.length === 0 ? (
                        <p className="py-6 text-center text-sm text-slate-500">All products are above their minimum stock level.</p>
                    ) : (
                        <ul className="divide-y divide-slate-800">
                            {lowStock.rows.map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm text-slate-200">{p.name}</p>
                                        <p className="font-mono text-xs text-slate-500">{p.sku || '—'}</p>
                                    </div>
                                    <span className={`shrink-0 whitespace-nowrap ${p.qty_in_stock <= 0 ? badgeRose : badgeAmber}`}>
                                        <span className="font-mono">
                                            {formatQty(p.qty_in_stock)} / {formatQty(p.min_stock_level)}
                                        </span>
                                        {p.unit}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </SectionCard>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SectionCard title="Contracts needing attention" action={<SeeAll href="/dashboard/contracts" label="All contracts" />}>
                    {attention.rows.length === 0 ? (
                        <p className="py-6 text-center text-sm text-slate-500">No expiring or expired contracts.</p>
                    ) : (
                        <ul className="divide-y divide-slate-800">
                            {attention.rows.map((ct) => {
                                const days = daysBetween(today, ct.end_date);
                                return (
                                    <li key={ct.id} className="flex items-center justify-between gap-3 py-2.5">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm text-slate-200">{ct.title}</p>
                                            <p className="truncate text-xs text-slate-500">
                                                <span className="font-mono">{ct.contract_number || '—'}</span> · {ct.client_name} · until {formatDate(ct.end_date)}
                                            </p>
                                        </div>
                                        {days < 0 ? (
                                            <span className={badgeRose}>
                                                <AlertTriangle className="h-3 w-3" />
                                                Expired {pluralDays(days)} ago
                                            </span>
                                        ) : (
                                            <span className={badgeAmber}>
                                                <Clock className="h-3 w-3" />
                                                {days === 0 ? 'Expires today' : `Expires in ${pluralDays(days)}`}
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </SectionCard>

                <SectionCard title="Recent invoices" action={<SeeAll href="/dashboard/invoices" label="All invoices" />}>
                    {recent.rows.length === 0 ? (
                        <p className="py-6 text-center text-sm text-slate-500">No invoices issued yet.</p>
                    ) : (
                        <ul className="divide-y divide-slate-800">
                            {recent.rows.map((i) => {
                                const overdue = i.status === 'pending' && i.due_date !== null && i.due_date < today;
                                const badge =
                                    i.status === 'paid'
                                        ? badgeEmerald
                                        : i.status === 'cancelled'
                                          ? badgeSlate
                                          : overdue
                                            ? badgeRose
                                            : badgeAmber;
                                const label = invoiceStatusLabel(i.status, overdue);
                                return (
                                    <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm text-slate-200">
                                                <span className="font-mono">No. {i.invoice_number || '—'}</span> · {i.client_name}
                                            </p>
                                            <p className="text-xs text-slate-500">Issued on {formatDate(i.issue_date)}</p>
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-1">
                                            <span className="font-mono text-sm text-slate-100">{formatMoney(i.total_amount, cur)}</span>
                                            <span className={badge}>{label}</span>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </SectionCard>
            </div>
        </div>
    );
}
