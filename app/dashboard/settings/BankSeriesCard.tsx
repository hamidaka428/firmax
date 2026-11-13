'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Building2, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/app/components/ui/Modal';
import { useToast } from '@/app/components/ui/ToastProvider';
import { useConfirm } from '@/app/components/ui/ConfirmDialog';
import { badgeSlate, btnPrimary, btnSecondary, cardCls, inputCls, labelCls } from '@/app/components/ui/styles';
import { formatIban } from '@/app/lib/validation';
import type { BankAccount, InvoiceSeries } from '@/app/lib/types';
import { deleteBankAccount, deleteInvoiceSeries, saveBankAccount, saveInvoiceSeries } from './billing-actions';

type Editing =
    | { kind: 'bank'; id: number | null; label: string; bank_name: string; iban: string; bic: string }
    | { kind: 'series'; id: number | null; name: string; start: string; locked: boolean };

const iconBtn = 'rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40';

export default function BankSeriesCard({
    mainBank,
    mainNext,
    initialAccounts,
    initialSeries,
}: {
    mainBank: { bank_name: string; iban: string };
    mainNext: string;
    initialAccounts: BankAccount[];
    initialSeries: InvoiceSeries[];
}) {
    const toast = useToast();
    const confirm = useConfirm();
    const [accounts, setAccounts] = useState(initialAccounts);
    const [series, setSeries] = useState(initialSeries);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    function open(e: Editing) {
        setError(null);
        setEditing(e);
    }

    async function handleSubmit(ev: FormEvent) {
        ev.preventDefault();
        if (!editing) return;
        setBusy(true);
        setError(null);
        if (editing.kind === 'bank') {
            const res = await saveBankAccount(editing.id, editing);
            setBusy(false);
            if (!res.ok) return setError(res.error);
            setAccounts(res.data);
            toast.success(editing.id ? 'Account updated' : 'Account added', formatIban(editing.iban));
        } else {
            const start = Number(editing.start.replace(/\s+/g, ''));
            const res = await saveInvoiceSeries(editing.id, { name: editing.name, start });
            setBusy(false);
            if (!res.ok) return setError(res.error);
            setSeries(res.data);
            toast.success(editing.id ? 'Series updated' : 'Series added', editing.name);
        }
        setEditing(null);
    }

    async function removeAccount(a: BankAccount) {
        const ok = await confirm({ title: 'Delete account?', message: formatIban(a.iban), confirmLabel: 'Delete', tone: 'danger' });
        if (!ok) return;
        const res = await deleteBankAccount(a.id);
        if (!res.ok) return toast.error('Delete failed', res.error);
        setAccounts(res.data);
        toast.success('Account deleted');
    }

    async function removeSeries(s: InvoiceSeries) {
        const ok = await confirm({ title: 'Delete series?', message: s.name, confirmLabel: 'Delete', tone: 'danger' });
        if (!ok) return;
        const res = await deleteInvoiceSeries(s.id);
        if (!res.ok) return toast.error('Delete failed', res.error);
        setSeries(res.data);
        toast.success('Series deleted');
    }

    return (
        <section className={`${cardCls} p-6`}>
            <h2 className="text-lg font-semibold text-slate-100">Bank accounts and number series</h2>
            <p className="mt-0.5 text-sm text-slate-400">
                Additional payment accounts and separate numbering ranges (e.g. per branch or office). You pick them when issuing an invoice.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Accounts */}
                <div className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                            <Building2 className="h-4 w-4 text-slate-500" />
                            Bank accounts
                        </h3>
                        <button
                            type="button"
                            className={`${btnSecondary} px-3 py-1.5 text-xs`}
                            onClick={() => open({ kind: 'bank', id: null, label: '', bank_name: '', iban: '', bic: '' })}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add account
                        </button>
                    </div>
                    <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                        <li className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0">
                                <p className="truncate font-mono text-sm text-slate-200">{mainBank.iban ? formatIban(mainBank.iban) : 'No IBAN entered'}</p>
                                <p className="text-xs text-slate-500">{mainBank.bank_name || 'Main account'} · default</p>
                            </div>
                            <span className={badgeSlate}>Main</span>
                        </li>
                        {accounts.map((a) => (
                            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                <div className="min-w-0">
                                    <p className="truncate font-mono text-sm text-slate-200">{formatIban(a.iban)}</p>
                                    <p className="truncate text-xs text-slate-500">
                                        {[a.label, a.bank_name].filter(Boolean).join(' · ') || 'Additional account'}
                                        {a.invoices ? ` · ${a.invoices} invoices` : ''}
                                    </p>
                                </div>
                                <div className="flex shrink-0">
                                    <button type="button" className={iconBtn} aria-label={`Edit account ${a.iban}`}
                                        onClick={() => open({ kind: 'bank', id: a.id, label: a.label, bank_name: a.bank_name, iban: a.iban, bic: a.bic })}>
                                        <Pencil className="h-4 w-4" />
                                    </button>
                                    <button type="button" className={`${iconBtn} hover:text-rose-400`} aria-label={`Delete account ${a.iban}`} onClick={() => removeAccount(a)}>
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs text-slate-500">Change the main account under &quot;Company details&quot; above.</p>
                </div>

                {/* Number series */}
                <div className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                            <FileText className="h-4 w-4 text-slate-500" />
                            Number series
                        </h3>
                        <button
                            type="button"
                            className={`${btnSecondary} px-3 py-1.5 text-xs`}
                            onClick={() => open({ kind: 'series', id: null, name: '', start: String((series.length + 2) * 1_000_000_000 + 1), locked: false })}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add series
                        </button>
                    </div>
                    <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                        <li className="flex items-center justify-between gap-3 px-3 py-2.5">
                            <div className="min-w-0">
                                <p className="text-sm text-slate-200">Main</p>
                                <p className="text-xs text-slate-500">next no. <span className="font-mono">{mainNext}</span></p>
                            </div>
                            <span className={badgeSlate}>Default</span>
                        </li>
                        {series.map((s) => (
                            <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                <div className="min-w-0">
                                    <p className="truncate text-sm text-slate-200">{s.name}</p>
                                    <p className="text-xs text-slate-500">
                                        next no. <span className="font-mono">{String(s.next_number).padStart(10, '0')}</span>
                                        {s.invoices ? ` · ${s.invoices} documents` : ''}
                                    </p>
                                </div>
                                <div className="flex shrink-0">
                                    <button type="button" className={iconBtn} aria-label={`Edit series ${s.name}`}
                                        onClick={() => open({ kind: 'series', id: s.id, name: s.name, start: String(s.next_number), locked: s.invoices > 0 })}>
                                        <Pencil className="h-4 w-4" />
                                    </button>
                                    <button type="button" className={`${iconBtn} hover:text-rose-400`} aria-label={`Delete series ${s.name}`} onClick={() => removeSeries(s)}>
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs text-slate-500">
                        Each series has its own continuous sequence. Number ranges must not overlap.
                    </p>
                </div>
            </div>

            <Modal
                open={editing !== null}
                onClose={() => setEditing(null)}
                title={
                    editing?.kind === 'bank'
                        ? editing.id ? 'Edit account' : 'New bank account'
                        : editing?.id ? 'Edit series' : 'New series'
                }
                busy={busy}
                footer={
                    <>
                        <button type="button" className={btnSecondary} onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                        <button type="submit" form="bank-series-form" className={btnPrimary} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                    </>
                }
            >
                <form id="bank-series-form" onSubmit={handleSubmit} className="space-y-4">
                    {error ? (
                        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            {error}
                        </div>
                    ) : null}
                    {editing?.kind === 'bank' ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <label htmlFor="ba-iban" className={labelCls}>IBAN *</label>
                                <input id="ba-iban" className={`${inputCls} font-mono`} value={editing.iban} maxLength={40}
                                    onChange={(e) => setEditing({ ...editing, iban: e.target.value })} />
                            </div>
                            <div>
                                <label htmlFor="ba-bank" className={labelCls}>Bank</label>
                                <input id="ba-bank" className={inputCls} value={editing.bank_name} maxLength={150}
                                    onChange={(e) => setEditing({ ...editing, bank_name: e.target.value })} />
                            </div>
                            <div>
                                <label htmlFor="ba-bic" className={labelCls}>BIC</label>
                                <input id="ba-bic" className={`${inputCls} font-mono`} value={editing.bic} maxLength={20}
                                    onChange={(e) => setEditing({ ...editing, bic: e.target.value })} />
                            </div>
                            <div className="sm:col-span-2">
                                <label htmlFor="ba-label" className={labelCls}>Label (for you)</label>
                                <input id="ba-label" className={inputCls} value={editing.label} maxLength={100} placeholder="e.g. USD account, Rentals"
                                    onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                            </div>
                        </div>
                    ) : editing?.kind === 'series' ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="sr-name" className={labelCls}>Name *</label>
                                <input id="sr-name" className={inputCls} value={editing.name} maxLength={100} placeholder="e.g. Berlin branch"
                                    onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                            </div>
                            <div>
                                <label htmlFor="sr-start" className={labelCls}>{editing.locked ? 'Next number' : 'Start number *'}</label>
                                <input id="sr-start" inputMode="numeric" className={`${inputCls} font-mono`} value={editing.start} disabled={editing.locked}
                                    onChange={(e) => setEditing({ ...editing, start: e.target.value.replace(/[^\d]/g, '') })} />
                            </div>
                            <p className="text-xs text-slate-500 sm:col-span-2">
                                {editing.locked
                                    ? 'The series has documents, so the number cannot be changed.'
                                    : 'Choose a start the main series will never reach — e.g. 2000000001.'}
                            </p>
                        </div>
                    ) : null}
                </form>
            </Modal>
        </section>
    );
}
