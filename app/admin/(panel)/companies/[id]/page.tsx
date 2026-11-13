import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Eye } from 'lucide-react';
import { requireAdmin } from '@/app/lib/admin-auth';
import { badgeAmber, badgeEmerald, badgeRose, badgeSlate, cardCls } from '@/app/components/ui/styles';
import { formatDate, formatMoney } from '@/app/lib/format';
import { formatIban } from '@/app/lib/validation';
import { openAsCompany } from '../../../actions';
import { loadAdminCompany } from '../../../data';
import AssignOwnerForm from './AssignOwnerForm';

export const dynamic = 'force-dynamic';

const MONTHS_BG = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function statusBadge(status: string) {
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    if (status === 'paid' || status === 'active') return <span className={badgeEmerald}>{label}</span>;
    if (status === 'cancelled') return <span className={badgeRose}>{label}</span>;
    if (status === 'pending') return <span className={badgeAmber}>{label}</span>;
    return <span className={badgeSlate}>{label}</span>;
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className={`mt-0.5 break-words text-sm text-slate-200 ${mono ? 'font-mono' : ''}`}>{value || '—'}</dd>
        </div>
    );
}

export default async function AdminCompanyPage({ params }: { params: Promise<{ id: string }> }) {
    await requireAdmin();
    const { id: rawId } = await params;
    if (!/^\d+$/.test(rawId)) notFound();
    const detail = await loadAdminCompany(Number(rawId));
    if (!detail) notFound();

    const { company: c, recentInvoices, recentContracts, invoicedByMonth } = detail;
    const maxMonth = Math.max(1, ...invoicedByMonth.map((m) => m.total));
    const openAction = openAsCompany.bind(null, c.id);

    return (
        <div className="space-y-6">
            <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-100">
                <ArrowRight className="h-4 w-4 rotate-180" />
                All companies
            </Link>

            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="break-words text-2xl font-semibold">{c.name}</h1>
                    <p className="mt-1 text-sm text-slate-400">
                        Registered on {formatDate(c.created_at)} · last activity {formatDate(c.last_activity)}
                    </p>
                </div>
                <form action={openAction} className={c.owner_email ? '' : 'hidden'}>
                    <button
                        type="submit"
                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
                        title="Support: signs in to the app as the company owner (in this browser)"
                    >
                        <Eye className="h-4 w-4" />
                        Sign in as owner
                    </button>
                </form>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                {[
                    ['Clients', c.clients],
                    ['Products', c.products],
                    ['Contracts', c.contracts],
                    ['Templates', c.templates],
                    ['Invoices', c.invoices],
                    ['Invoices (30 days)', c.invoices_30d],
                ].map(([label, value]) => (
                    <div key={label} className={`${cardCls} p-4`}>
                        <p className="text-xs text-slate-500">{label}</p>
                        <p className="mt-1 font-mono text-xl font-semibold text-slate-100">{value}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <section className={`${cardCls} p-5`}>
                    <h2 className="mb-4 text-sm font-semibold text-slate-200">Company details</h2>
                    <dl className="grid grid-cols-2 gap-4">
                        <Info label="Reg. no." value={c.reg_no} mono />
                        <Info label="VAT ID" value={c.vat_number} mono />
                        <Info label="Representative" value={c.representative} />
                        <Info label="City" value={c.city} />
                        <div className="col-span-2">
                            <Info label="Address" value={c.address} />
                        </div>
                        <Info label="Phone" value={c.phone} />
                        <Info label="Email" value={c.email} />
                        <div className="col-span-2">
                            <Info label="IBAN" value={c.iban ? formatIban(c.iban) : ''} mono />
                        </div>
                        <Info label="Currency" value={c.currency} />
                        <Info label="Logo" value={c.has_logo ? 'Uploaded' : 'None'} />
                    </dl>
                    <div className="mt-5 border-t border-slate-800 pt-4">
                        <p className="text-xs text-slate-500">Owner</p>
                        <p className="mt-0.5 break-all text-sm text-slate-200">
                            {c.owner_email ?? 'no owner'}
                        </p>
                        <div className="mt-3">
                            <AssignOwnerForm companyId={c.id} />
                        </div>
                    </div>
                </section>

                <section className={`${cardCls} min-w-0 p-5 lg:col-span-2`}>
                    <div className="flex items-baseline justify-between gap-3">
                        <h2 className="text-sm font-semibold text-slate-200">Invoiced per month</h2>
                        <p className="font-mono text-sm text-slate-300">Total: {formatMoney(c.invoiced_total, c.currency)}</p>
                    </div>
                    <div className="mt-5 flex h-44 items-end gap-3">
                        {invoicedByMonth.map((m) => {
                            const [y, mo] = m.month.split('-');
                            return (
                                <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                                    <span className="truncate font-mono text-[11px] text-slate-400">{m.total ? formatMoney(m.total, c.currency) : ''}</span>
                                    <div
                                        className={`w-full rounded-t ${m.total ? 'bg-indigo-500' : 'bg-slate-800'}`}
                                        style={{ height: `${Math.max(4, (m.total / maxMonth) * 110)}px` }}
                                        title={`${MONTHS_BG[Number(mo) - 1]} ${y}: ${m.count} invoices`}
                                    />
                                    <span className="text-[11px] text-slate-500">
                                        {MONTHS_BG[Number(mo) - 1]} · {m.count}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <section className={`${cardCls} min-w-0 overflow-hidden`}>
                    <h2 className="border-b border-slate-800 px-5 py-3 text-sm font-semibold text-slate-200">Recent invoices</h2>
                    {recentInvoices.length ? (
                        <div className="overflow-x-auto [contain:paint]">
                            <table className="w-full min-w-[34rem] whitespace-nowrap text-sm">
                                <tbody className="divide-y divide-slate-800">
                                    {recentInvoices.map((i) => (
                                        <tr key={i.id}>
                                            <td className="px-5 py-2.5 font-mono text-slate-300">{i.invoice_number}</td>
                                            <td className="px-2 py-2.5 text-slate-400">{formatDate(i.issue_date)}</td>
                                            <td className="max-w-[12rem] truncate px-2 py-2.5 text-slate-300">{i.client_name}</td>
                                            <td className="px-2 py-2.5 text-right font-mono text-slate-100">{formatMoney(i.total_amount, c.currency)}</td>
                                            <td className="px-5 py-2.5 text-right">{statusBadge(i.status)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="px-5 py-8 text-center text-sm text-slate-500">No invoices.</p>
                    )}
                </section>

                <section className={`${cardCls} min-w-0 overflow-hidden`}>
                    <h2 className="border-b border-slate-800 px-5 py-3 text-sm font-semibold text-slate-200">Recent contracts</h2>
                    {recentContracts.length ? (
                        <div className="overflow-x-auto [contain:paint]">
                            <table className="w-full min-w-[34rem] whitespace-nowrap text-sm">
                                <tbody className="divide-y divide-slate-800">
                                    {recentContracts.map((ct) => (
                                        <tr key={ct.id}>
                                            <td className="px-5 py-2.5 font-mono text-slate-300">{ct.contract_number}</td>
                                            <td className="max-w-[12rem] truncate px-2 py-2.5 text-slate-300" title={ct.title}>
                                                {ct.client_name}
                                            </td>
                                            <td className="px-2 py-2.5 text-slate-400">{formatDate(ct.start_date)}</td>
                                            <td className="px-2 py-2.5 text-right font-mono text-slate-100">{formatMoney(ct.total_price, c.currency)}</td>
                                            <td className="px-5 py-2.5 text-right">{statusBadge(ct.status)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="px-5 py-8 text-center text-sm text-slate-500">No contracts.</p>
                    )}
                </section>
            </div>
        </div>
    );
}
