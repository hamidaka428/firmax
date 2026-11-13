'use client';

import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Clock, Eye, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { Drawer, Modal } from '@/app/components/ui/Modal';
import { useToast } from '@/app/components/ui/ToastProvider';
import { useConfirm } from '@/app/components/ui/ConfirmDialog';
import {
    badgeAmber,
    badgeEmerald,
    badgeRose,
    badgeSlate,
    btnPrimary,
    btnSecondary,
    cardCls,
    inputCls,
    labelCls,
} from '@/app/components/ui/styles';
import { contractValidity, formatDate, formatMoney } from '@/app/lib/format';
import type { ClientHistory, ClientInput, ClientRow, ContractType } from '@/app/lib/types';
import { CONTRACT_TYPE_LABEL, invoiceStatusLabel } from '@/app/lib/labels';
import { createClient, deleteClient, getClientHistory, updateClient } from './actions';

const EMPTY_FORM: ClientInput = {
    name: '',
    reg_no: '',
    vat_number: '',
    city: '',
    address: '',
    country: '',
    representative: '',
    phone: '',
    email: '',
    notes: '',
};

function toForm(c: ClientRow): ClientInput {
    return {
        name: c.name,
        reg_no: c.reg_no,
        vat_number: c.vat_number,
        city: c.city,
        address: c.address,
        country: c.country,
        representative: c.representative,
        phone: c.phone,
        email: c.email,
        notes: c.notes,
    };
}

interface ClientsTableProps {
    initialClients: ClientRow[];
    currency: string;
    today: string;
}

export default function ClientsTable({ initialClients, currency, today }: ClientsTableProps) {
    const toast = useToast();
    const confirm = useConfirm();

    const [clients, setClients] = useState<ClientRow[]>(initialClients);
    const [search, setSearch] = useState('');

    // Form
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<ClientRow | null>(null);
    const [form, setForm] = useState<ClientInput>(EMPTY_FORM);
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // History
    const [historyClient, setHistoryClient] = useState<ClientRow | null>(null);
    const [history, setHistory] = useState<ClientHistory | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const historyRequest = useRef(0);

    const visible = useMemo(() => {
        const q = search.trim().toLocaleLowerCase();
        if (!q) return clients;
        return clients.filter((c) =>
            [c.name, c.reg_no, c.vat_number, c.city, c.country, c.representative, c.email, c.phone].some((v) => v.toLocaleLowerCase().includes(q)),
        );
    }, [clients, search]);

    function sortClients(list: ClientRow[]): ClientRow[] {
        return [...list].sort((a, b) => a.name.localeCompare(b.name, 'en'));
    }

    function setField<K extends keyof ClientInput>(key: K, value: string) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    function openCreate() {
        setEditing(null);
        setForm(EMPTY_FORM);
        setFormError(null);
        setModalOpen(true);
    }

    function openEdit(client: ClientRow) {
        setEditing(client);
        setForm(toForm(client));
        setFormError(null);
        setModalOpen(true);
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!form.name.trim()) {
            setFormError('Client name is required.');
            return;
        }

        setSaving(true);
        setFormError(null);
        const res = editing ? await updateClient(editing.id, form) : await createClient(form);
        setSaving(false);

        if (!res.ok) {
            setFormError(res.error);
            return;
        }

        const saved = res.data;
        setClients((prev) => sortClients(editing ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev, saved]));
        setModalOpen(false);
        toast.success(editing ? 'Client updated' : 'Client added', saved.name);
    }

    async function handleDelete(client: ClientRow) {
        const ok = await confirm({
            title: 'Delete client?',
            message: (
                <>
                    Client <strong className="text-slate-100">{client.name}</strong> will be deleted. A client with existing
                    contracts or invoices cannot be deleted.
                </>
            ),
            confirmLabel: 'Delete',
            tone: 'danger',
        });
        if (!ok) return;

        const res = await deleteClient(client.id);
        if (!res.ok) {
            toast.error('Delete failed', res.error);
            return;
        }
        setClients((prev) => prev.filter((c) => c.id !== client.id));
        toast.success('Client deleted', client.name);
    }

    async function openHistory(client: ClientRow) {
        const requestId = ++historyRequest.current;
        setHistoryClient(client);
        setHistory(null);
        setHistoryLoading(true);

        const res = await getClientHistory(client.id);
        if (requestId !== historyRequest.current) return; // another client was opened in the meantime

        setHistoryLoading(false);
        if (!res.ok) {
            toast.error('Failed to load the history', res.error);
            return;
        }
        setHistory(res.data);
    }

    function closeHistory() {
        historyRequest.current++;
        setHistoryClient(null);
        setHistory(null);
        setHistoryLoading(false);
    }

    const totalUnpaid = useMemo(() => clients.reduce((s, c) => s + c.unpaid_total, 0), [clients]);

    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Clients</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-slate-100">{clients.length}</p>
                </div>
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Total invoiced</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-slate-100">
                        {formatMoney(clients.reduce((s, c) => s + c.invoiced_total, 0), currency)}
                    </p>
                </div>
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Unpaid</p>
                    <p className={`mt-1 font-mono text-xl font-semibold ${totalUnpaid > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {formatMoney(totalUnpaid, currency)}
                    </p>
                </div>
            </div>

            <div className={`${cardCls} flex flex-wrap items-center gap-3 p-4`}>
                <div className="relative min-w-56 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name, reg. no., city, contact, email…"
                        className={`${inputCls} pl-9`}
                    />
                </div>
                <button type="button" onClick={openCreate} className={btnPrimary}>
                    <Plus className="h-4 w-4" />
                    New client
                </button>
            </div>

            <div className={`${cardCls} overflow-hidden`}>
                <div className="overflow-x-auto [contain:paint]">
                    <table className="w-full min-w-[56rem] text-sm">
                        <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">Client</th>
                                <th className="px-4 py-3 text-left font-medium">Location</th>
                                <th className="px-4 py-3 text-left font-medium">Contact</th>
                                <th className="px-4 py-3 text-center font-medium">Contracts</th>
                                <th className="px-4 py-3 text-right font-medium">Invoiced</th>
                                <th className="px-4 py-3 text-right font-medium">Unpaid</th>
                                <th className="px-4 py-3 text-right font-medium">
                                    <span className="sr-only">Actions</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {visible.map((c) => (
                                <tr key={c.id} className="transition-colors hover:bg-slate-800/40">
                                    <td className="px-4 py-3">
                                        <button
                                            type="button"
                                            onClick={() => openHistory(c)}
                                            className="text-left font-medium text-slate-100 hover:text-indigo-300"
                                        >
                                            {c.name}
                                        </button>
                                        <p className="font-mono text-xs text-slate-500">
                                            Reg. no.: {c.reg_no || '—'}
                                            {c.vat_number ? ` · ${c.vat_number}` : ''}
                                        </p>
                                    </td>
                                    <td className="px-4 py-3 text-slate-300">{[c.city, c.country].filter(Boolean).join(', ') || '—'}</td>
                                    <td className="px-4 py-3">
                                        <p className="text-slate-300">{c.representative || '—'}</p>
                                        <p className="text-xs text-slate-500">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</p>
                                    </td>
                                    <td className="px-4 py-3 text-center font-mono text-slate-300">{c.contract_count}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-200">{formatMoney(c.invoiced_total, currency)}</td>
                                    <td className={`px-4 py-3 text-right font-mono ${c.unpaid_total > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                                        {formatMoney(c.unpaid_total, currency)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end gap-1">
                                            <button
                                                type="button"
                                                onClick={() => openHistory(c)}
                                                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/10"
                                            >
                                                <Eye className="h-4 w-4" />
                                                History
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => openEdit(c)}
                                                aria-label={`Edit ${c.name}`}
                                                className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(c)}
                                                aria-label={`Delete ${c.name}`}
                                                className="rounded-md p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {visible.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                        <Users className="h-10 w-10 text-slate-600" />
                        <p className="text-sm text-slate-400">
                            {clients.length === 0 ? 'No clients yet. Add your first one.' : 'No clients match your search.'}
                        </p>
                        {clients.length === 0 ? (
                            <button type="button" onClick={openCreate} className={btnPrimary}>
                                <Plus className="h-4 w-4" />
                                New client
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {/* Modal: new / edit */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editing ? 'Edit client' : 'New client'}
                description={editing ? editing.name : 'These details are used on invoices and contracts.'}
                size="lg"
                busy={saving}
                footer={
                    <>
                        <button type="button" className={btnSecondary} onClick={() => setModalOpen(false)} disabled={saving}>
                            Cancel
                        </button>
                        <button type="submit" form="client-form" className={btnPrimary} disabled={saving}>
                            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add client'}
                        </button>
                    </>
                }
            >
                <form id="client-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
                    {formError ? (
                        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 sm:col-span-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            {formError}
                        </div>
                    ) : null}

                    <div className="sm:col-span-2">
                        <label htmlFor="c-name" className={labelCls}>Company / person name *</label>
                        <input id="c-name" className={inputCls} value={form.name} maxLength={255} onChange={(e) => setField('name', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="c-reg_no" className={labelCls}>Registration no. / ID</label>
                        <input id="c-reg_no" className={`${inputCls} font-mono`} value={form.reg_no} maxLength={30} onChange={(e) => setField('reg_no', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="c-vat" className={labelCls}>VAT ID</label>
                        <input id="c-vat" className={`${inputCls} font-mono`} value={form.vat_number} maxLength={30} placeholder="e.g. FR12345678901" onChange={(e) => setField('vat_number', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="c-city" className={labelCls}>City</label>
                        <input id="c-city" className={inputCls} value={form.city} maxLength={100} onChange={(e) => setField('city', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="c-representative" className={labelCls}>Representative</label>
                        <input id="c-representative" className={inputCls} value={form.representative} maxLength={150} onChange={(e) => setField('representative', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="c-address" className={labelCls}>Address</label>
                        <input id="c-address" className={inputCls} value={form.address} maxLength={255} onChange={(e) => setField('address', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="c-country" className={labelCls}>Country</label>
                        <input id="c-country" className={inputCls} value={form.country} maxLength={100} onChange={(e) => setField('country', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="c-phone" className={labelCls}>Phone</label>
                        <input id="c-phone" className={inputCls} value={form.phone} maxLength={50} onChange={(e) => setField('phone', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="c-email" className={labelCls}>Email</label>
                        <input id="c-email" type="email" className={inputCls} value={form.email} maxLength={150} onChange={(e) => setField('email', e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                        <label htmlFor="c-notes" className={labelCls}>Notes</label>
                        <textarea id="c-notes" rows={3} className={inputCls} value={form.notes} maxLength={2000} onChange={(e) => setField('notes', e.target.value)} />
                    </div>
                </form>
            </Modal>

            {/* Client history */}
            <Drawer
                open={historyClient !== null}
                onClose={closeHistory}
                title={historyClient?.name ?? ''}
                description={historyClient ? `Reg. no.: ${historyClient.reg_no || '—'}${historyClient.city ? ` · ${historyClient.city}` : ''}` : undefined}
                width="lg"
            >
                {historyClient ? (
                    <div className="space-y-6">
                        <div className="grid grid-cols-3 gap-3">
                            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                                <p className="text-xs text-slate-400">Contracts</p>
                                <p className="mt-1 font-mono text-lg text-slate-100">{historyClient.contract_count}</p>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                                <p className="text-xs text-slate-400">Invoiced</p>
                                <p className="mt-1 truncate font-mono text-lg text-slate-100">{formatMoney(historyClient.invoiced_total, currency)}</p>
                            </div>
                            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                                <p className="text-xs text-slate-400">Unpaid</p>
                                <p className={`mt-1 truncate font-mono text-lg ${historyClient.unpaid_total > 0 ? 'text-amber-400' : 'text-slate-100'}`}>
                                    {formatMoney(historyClient.unpaid_total, currency)}
                                </p>
                            </div>
                        </div>

                        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                            <dt className="text-slate-500">Representative</dt>
                            <dd className="text-slate-200">{historyClient.representative || '—'}</dd>
                            <dt className="text-slate-500">Address</dt>
                            <dd className="text-slate-200">{[historyClient.address, historyClient.country].filter(Boolean).join(', ') || '—'}</dd>
                            <dt className="text-slate-500">Phone</dt>
                            <dd className="text-slate-200">{historyClient.phone || '—'}</dd>
                            <dt className="text-slate-500">Email</dt>
                            <dd className="break-all text-slate-200">{historyClient.email || '—'}</dd>
                            <dt className="text-slate-500">VAT ID</dt>
                            <dd className="font-mono text-slate-200">{historyClient.vat_number || '—'}</dd>
                            {historyClient.notes ? (
                                <>
                                    <dt className="text-slate-500">Notes</dt>
                                    <dd className="whitespace-pre-wrap text-slate-200">{historyClient.notes}</dd>
                                </>
                            ) : null}
                        </dl>

                        {historyLoading ? (
                            <p className="animate-pulse py-8 text-center text-sm text-slate-500">Loading history…</p>
                        ) : history ? (
                            <>
                                <section>
                                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Contracts ({history.contracts.length})</h3>
                                    {history.contracts.length === 0 ? (
                                        <p className="rounded-lg border border-dashed border-slate-800 px-4 py-5 text-center text-sm text-slate-500">
                                            No contracts with this client.
                                        </p>
                                    ) : (
                                        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                                            {history.contracts.map((ct) => {
                                                const v = contractValidity(ct.end_date, ct.status, today);
                                                const badge =
                                                    v.kind === 'expired'
                                                        ? badgeRose
                                                        : v.kind === 'soon'
                                                          ? badgeAmber
                                                          : v.kind === 'closed'
                                                            ? badgeSlate
                                                            : badgeEmerald;
                                                return (
                                                    <li key={ct.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm text-slate-100">{ct.title}</p>
                                                            <p className="text-xs text-slate-500">
                                                                <span className="font-mono">{ct.contract_number || '—'}</span> · {CONTRACT_TYPE_LABEL[ct.contract_type as ContractType] ?? ct.contract_type} ·{' '}
                                                                {formatDate(ct.start_date)} – {ct.end_date ? formatDate(ct.end_date) : 'open-ended'}
                                                            </p>
                                                        </div>
                                                        <div className="flex shrink-0 flex-col items-end gap-1">
                                                            <span className="font-mono text-sm text-slate-100">{formatMoney(ct.total_price, currency)}</span>
                                                            <span className={badge}>
                                                                {v.kind === 'soon' ? <Clock className="h-3 w-3" /> : null}
                                                                {v.kind === 'expired' ? <AlertTriangle className="h-3 w-3" /> : null}
                                                                {v.label}
                                                            </span>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </section>

                                <section>
                                    <h3 className="mb-2 text-sm font-semibold text-slate-200">Invoices ({history.invoices.length})</h3>
                                    {history.invoices.length === 0 ? (
                                        <p className="rounded-lg border border-dashed border-slate-800 px-4 py-5 text-center text-sm text-slate-500">
                                            No invoices issued to this client.
                                        </p>
                                    ) : (
                                        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                                            {history.invoices.map((inv) => {
                                                const overdue = inv.status === 'pending' && inv.due_date !== null && inv.due_date < today;
                                                const badge =
                                                    inv.status === 'paid'
                                                        ? badgeEmerald
                                                        : inv.status === 'cancelled'
                                                          ? badgeSlate
                                                          : overdue
                                                            ? badgeRose
                                                            : badgeAmber;
                                                return (
                                                    <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                                        <div className="min-w-0">
                                                            <p className="font-mono text-sm text-slate-100">No. {inv.invoice_number || '—'}</p>
                                                            <p className="text-xs text-slate-500">
                                                                Issued {formatDate(inv.issue_date)} · due {formatDate(inv.due_date)}
                                                            </p>
                                                        </div>
                                                        <div className="flex shrink-0 flex-col items-end gap-1">
                                                            <span className="font-mono text-sm text-slate-100">{formatMoney(inv.total_amount, currency)}</span>
                                                            <span className={badge}>{invoiceStatusLabel(inv.status, overdue)}</span>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </section>
                            </>
                        ) : null}
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}
