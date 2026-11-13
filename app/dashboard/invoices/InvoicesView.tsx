'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Link from 'next/link';
import {
    AlertTriangle,
    ArrowRight,
    Check,
    CheckCircle2,
    ChevronDown,
    Clock,
    Download,
    Eye,
    FileText,
    Paperclip,
    Pencil,
    Plus,
    Printer,
    Receipt,
    Search,
    Upload,
    X,
    XCircle,
} from 'lucide-react';
import { useToast } from '@/app/components/ui/ToastProvider';
import { useConfirm } from '@/app/components/ui/ConfirmDialog';
import { badgeAmber, badgeEmerald, badgeRose, badgeSlate, btnPrimary, btnSecondary, cardCls, inputCls } from '@/app/components/ui/styles';
import { daysBetween, formatDate, formatMoney, pluralDays } from '@/app/lib/format';
import type { BankAccount, ContractOption, DocType, Invoice, InvoiceSeries, InvoiceStatus, ProductOption } from '@/app/lib/types';
import { DOC_LABEL, DOC_SHORT, countsInRevenue, hasDueDate, isNote, signedAmount } from '@/app/lib/documents';
import { PAYMENT_METHOD_LABEL } from '@/app/lib/labels';
import FilePreviewModal, { fileUrl } from '../contracts/FilePreviewModal';
import { convertProforma, removeInvoiceFile, setInvoiceStatus, uploadInvoiceFile } from './actions';
import InvoiceFormModal from './InvoiceFormModal';
import SendInvoiceModal from './SendInvoiceModal';
import type { InvoiceSaved } from './InvoiceFormModal';

type Tab = 'all' | 'pending' | 'paid' | 'overdue' | 'cancelled';
type DocFilter = 'all' | 'invoice' | 'notes' | 'proforma';

function matchesDoc(inv: Invoice, f: DocFilter): boolean {
    if (f === 'all') return true;
    if (f === 'notes') return isNote(inv.doc_type);
    return inv.doc_type === f;
}

/** Invoice balance available to credit: amount + debit notes − credit notes (excluding cancelled). */
function remainingFor(invoice: Invoice, all: Invoice[]): number {
    let rest = invoice.total_amount;
    for (const n of all) {
        if (n.related_invoice_id !== invoice.id || n.status === 'cancelled') continue;
        if (n.doc_type === 'credit_note') rest -= n.total_amount;
        if (n.doc_type === 'debit_note') rest += n.total_amount;
    }
    return Math.round(rest * 100) / 100;
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function isOverdue(inv: Invoice, today: string): boolean {
    return inv.doc_type !== 'proforma' && hasDueDate(inv.doc_type) && inv.status === 'pending' && inv.due_date !== null && inv.due_date < today;
}

function matchesTab(inv: Invoice, tab: Tab, today: string): boolean {
    switch (tab) {
        case 'all':
            return true;
        case 'pending':
            return inv.status === 'pending';
        case 'paid':
            return inv.status === 'paid';
        case 'overdue':
            return isOverdue(inv, today);
        case 'cancelled':
            return inv.status === 'cancelled';
    }
}

interface InvoicesViewProps {
    initialInvoices: Invoice[];
    clients: { id: number; name: string; email?: string }[];
    bankAccounts: BankAccount[];
    series: InvoiceSeries[];
    mainIban: string;
    companyName: string;
    origin: string;
    contracts: ContractOption[];
    products: ProductOption[];
    currency: string;
    today: string;
    initialTab: Tab;
    highlightId: number | null;
}

export default function InvoicesView({
    initialInvoices,
    clients,
    bankAccounts,
    series,
    mainIban,
    companyName,
    origin,
    contracts,
    products,
    currency,
    today,
    initialTab,
    highlightId,
}: InvoicesViewProps) {
    const toast = useToast();
    const confirm = useConfirm();

    const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
    const [tab, setTab] = useState<Tab>(highlightId !== null ? 'all' : initialTab);
    const [search, setSearch] = useState('');
    const [exportMonth, setExportMonth] = useState('');
    const [highlighted, setHighlighted] = useState<number | null>(highlightId);
    const [docFilter, setDocFilter] = useState<DocFilter>('all');
    const [formDocType, setFormDocType] = useState<DocType>('invoice');
    const [formRelated, setFormRelated] = useState<Invoice | null>(null);
    const [noteMenuFor, setNoteMenuFor] = useState<number | null>(null);
    const [sending, setSending] = useState<Invoice | null>(null);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Invoice | null>(null);
    const [preview, setPreview] = useState<Invoice | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const uploadTarget = useRef<number | null>(null);

    // Highlights and scrolls to a newly issued invoice (?highlight=ID), then fades the highlight
    useEffect(() => {
        if (highlightId === null) return;
        document.getElementById(`invoice-row-${highlightId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const timer = window.setTimeout(() => setHighlighted(null), 5000);
        return () => window.clearTimeout(timer);
    }, [highlightId]);

    // Closes the "Note" menu on an outside click or Escape
    useEffect(() => {
        if (noteMenuFor === null) return;
        const close = (e: MouseEvent | KeyboardEvent) => {
            if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
            if (e instanceof MouseEvent && (e.target as HTMLElement).closest('[role=menu], [aria-haspopup=menu]')) return;
            setNoteMenuFor(null);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', close);
        };
    }, [noteMenuFor]);

    const counts = useMemo(() => {
        const base: Record<Tab, number> = { all: 0, pending: 0, paid: 0, overdue: 0, cancelled: 0 };
        for (const inv of invoices) {
            if (!matchesDoc(inv, docFilter)) continue;
            (Object.keys(base) as Tab[]).forEach((t) => {
                if (matchesTab(inv, t, today)) base[t]++;
            });
        }
        return base;
    }, [invoices, today, docFilter]);

    const docCounts = useMemo(() => {
        const base: Record<DocFilter, number> = { all: invoices.length, invoice: 0, notes: 0, proforma: 0 };
        for (const inv of invoices) {
            if (inv.doc_type === 'invoice') base.invoice++;
            else if (inv.doc_type === 'proforma') base.proforma++;
            else base.notes++;
        }
        return base;
    }, [invoices]);

    const sums = useMemo(() => {
        let pending = 0;
        let overdue = 0;
        let paid = 0;
        for (const inv of invoices) {
            // Proformas are not receivables; credit notes reduce them
            if (!countsInRevenue(inv.doc_type)) continue;
            const v = signedAmount(inv.doc_type, inv.total_amount);
            if (inv.status === 'pending') pending += v;
            if (isOverdue(inv, today)) overdue += inv.total_amount;
            if (inv.status === 'paid') paid += v;
        }
        return { pending, overdue, paid };
    }, [invoices, today]);

    const visible = useMemo(() => {
        const q = search.trim().toLocaleLowerCase();
        return invoices.filter((inv) => {
            if (!matchesDoc(inv, docFilter) || !matchesTab(inv, tab, today)) return false;
            if (!q) return true;
            return [inv.invoice_number, inv.client_name, inv.contract_number].some((v) => v.toLocaleLowerCase().includes(q));
        });
    }, [invoices, tab, search, today, docFilter]);

    const tabs: { id: Tab; label: string }[] = [
        { id: 'all', label: 'All' },
        { id: 'pending', label: 'Pending' },
        { id: 'paid', label: 'Paid' },
        { id: 'overdue', label: 'Overdue' },
        { id: 'cancelled', label: 'Cancelled' },
    ];

    function patchInvoice(id: number, patch: Partial<Invoice>) {
        setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    }

    function openCreate(docType: DocType = 'invoice') {
        setEditing(null);
        setFormDocType(docType);
        setFormRelated(null);
        setFormOpen(true);
    }

    function openNote(inv: Invoice, docType: 'credit_note' | 'debit_note') {
        setNoteMenuFor(null);
        setEditing(null);
        setFormDocType(docType);
        setFormRelated(inv);
        setFormOpen(true);
    }

    function openEdit(inv: Invoice) {
        setEditing(inv);
        setFormDocType(inv.doc_type);
        setFormRelated(inv.related_invoice_id ? invoices.find((i) => i.id === inv.related_invoice_id) ?? null : null);
        setFormOpen(true);
    }

    function handleSaved({ invoice, wasEdit, fileWarning }: InvoiceSaved) {
        setInvoices((prev) => (wasEdit ? prev.map((i) => (i.id === invoice.id ? invoice : i)) : [invoice, ...prev]));
        setFormOpen(false);
        const label = DOC_LABEL[invoice.doc_type];
        toast.success(wasEdit ? `${label} updated` : `${label} no. ${invoice.invoice_number} issued`, `${invoice.client_name} · ${formatMoney(invoice.total_amount, currency)}`);
        if (fileWarning) toast.warning('Document saved, but the file was not uploaded', fileWarning);
        if (!wasEdit) setHighlighted(invoice.id);
    }

    async function handleConvert(pf: Invoice) {
        const ok = await confirm({
            title: 'Issue an invoice from this proforma?',
            message: (
                <>
                    An invoice dated today with the next number will be issued from proforma <strong className="text-slate-100">no. {pf.invoice_number}</strong>{' '}
                    ({formatMoney(pf.total_amount, currency)}).{pf.status === 'paid' ? ' The proforma is paid, so the invoice will be marked as paid.' : ''}
                </>
            ),
            confirmLabel: 'Issue invoice',
        });
        if (!ok) return;
        setBusyId(pf.id);
        const res = await convertProforma(pf.id, today);
        setBusyId(null);
        if (!res.ok) {
            toast.error('Invoice not issued', res.error);
            return;
        }
        setInvoices((prev) => [res.data, ...prev.map((i) => (i.id === pf.id ? { ...i, converted_number: res.data.invoice_number } : i))]);
        setDocFilter('all');
        setTab('all');
        setHighlighted(res.data.id);
        toast.success(`Invoice no. ${res.data.invoice_number} issued`, `from proforma no. ${pf.invoice_number}`);
    }

    // --- One-click status ----------------------------------------------------
    async function changeStatus(inv: Invoice, status: InvoiceStatus) {
        if (status === 'cancelled') {
            const ok = await confirm({
                title: `Cancel ${DOC_LABEL[inv.doc_type].toLowerCase()}?`,
                message: (
                    <>
                        {DOC_LABEL[inv.doc_type]} <strong className="text-slate-100">no. {inv.invoice_number}</strong> ({formatMoney(inv.total_amount, currency)}) will be marked as cancelled.
                        The number is kept and never reused.
                    </>
                ),
                confirmLabel: 'Cancel document',
                tone: 'danger',
            });
            if (!ok) return;
        }

        setBusyId(inv.id);
        const res = await setInvoiceStatus(inv.id, status);
        setBusyId(null);
        if (!res.ok) {
            toast.error('Failed to change the status', res.error);
            return;
        }
        patchInvoice(inv.id, { status, paid_date: res.data.paid_date });
        toast.success(
            status === 'paid' ? 'Marked as paid' : status === 'cancelled' ? 'Document cancelled' : 'Moved back to pending',
            `No. ${inv.invoice_number}`,
        );
    }

    // --- Files ------------------------------------------------------------
    function pickFile(inv: Invoice) {
        uploadTarget.current = inv.id;
        fileInputRef.current?.click();
    }

    async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
        const file = e.currentTarget.files?.[0] ?? null;
        e.currentTarget.value = '';
        const id = uploadTarget.current;
        uploadTarget.current = null;
        if (!file || id === null) return;

        if (file.size > MAX_FILE_BYTES) {
            toast.error('File too large', 'The maximum size is 15 MB.');
            return;
        }

        setBusyId(id);
        const fd = new FormData();
        fd.set('file', file);
        const res = await uploadInvoiceFile(id, fd);
        setBusyId(null);
        if (!res.ok) {
            toast.error('Failed to upload the file', res.error);
            return;
        }
        patchInvoice(id, { file_path: res.data.file_path, file_name: res.data.file_name });
        toast.success('File uploaded', res.data.file_name);
    }

    async function handleRemoveFile(inv: Invoice) {
        const ok = await confirm({
            title: 'Remove file?',
            message: (
                <>
                    The file <strong className="text-slate-100">{inv.file_name}</strong> will be deleted from the server. The invoice is kept.
                </>
            ),
            confirmLabel: 'Remove',
            tone: 'danger',
        });
        if (!ok) return;

        setBusyId(inv.id);
        const res = await removeInvoiceFile(inv.id);
        setBusyId(null);
        if (!res.ok) {
            toast.error('Remove failed', res.error);
            return;
        }
        patchInvoice(inv.id, { file_path: null, file_name: null });
        toast.success('File removed', `No. ${inv.invoice_number}`);
    }

    // -------------------------------------------------------------------------
    return (
        <div className="space-y-4">
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/*"
                className="hidden"
                onChange={onFileChosen}
            />

            <div className="grid gap-4 sm:grid-cols-3">
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Unpaid (pending)</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-amber-400">{formatMoney(sums.pending, currency)}</p>
                </div>
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Of which overdue</p>
                    <p className={`mt-1 font-mono text-xl font-semibold ${sums.overdue > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                        {formatMoney(sums.overdue, currency)}
                    </p>
                </div>
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Paid</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-emerald-400">{formatMoney(sums.paid, currency)}</p>
                </div>
            </div>

            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Document type">
                {(
                    [
                        ['all', 'All documents'],
                        ['invoice', 'Invoices'],
                        ['notes', 'Notes'],
                        ['proforma', 'Proformas'],
                    ] as const
                ).map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={docFilter === id}
                        onClick={() => setDocFilter(id)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            docFilter === id ? 'bg-slate-100 text-slate-900' : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                    >
                        {label} <span className="ml-1 font-mono opacity-70">{docCounts[id]}</span>
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                            tab === t.id
                                ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                                : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                    >
                        {t.label}
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">{counts[t.id]}</span>
                    </button>
                ))}
            </div>

            <div className={`${cardCls} flex flex-wrap items-center gap-3 p-4`}>
                <div className="relative min-w-56 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by number, client or contract…"
                        className={`${inputCls} pl-9`}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="month"
                        value={exportMonth}
                        onChange={(e) => setExportMonth(e.target.value)}
                        aria-label="Month to export (empty = all)"
                        title="Month to export (empty = all)"
                        className={`${inputCls} w-40`}
                    />
                    <a
                        href={`/api/export/invoices${exportMonth ? `?month=${exportMonth}` : ''}`}
                        className={btnSecondary}
                        title="CSV for your accountant (opens in Excel)"
                    >
                        <Download className="h-4 w-4" />
                        Export CSV
                    </a>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openCreate('proforma')} className={btnSecondary} title="Proforma invoice (not a tax invoice)">
                        <FileText className="h-4 w-4" />
                        Proforma
                    </button>
                    <button type="button" onClick={() => openCreate('invoice')} className={btnPrimary}>
                        <Plus className="h-4 w-4" />
                        New invoice
                    </button>
                </div>
            </div>

            <div className={`${cardCls} overflow-hidden`}>
                <div className="overflow-x-auto [contain:paint]">
                    <table className="w-full min-w-[68rem] text-sm">
                        <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">Document</th>
                                <th className="px-4 py-3 text-left font-medium">Client</th>
                                <th className="px-4 py-3 text-left font-medium">Dates</th>
                                <th className="px-4 py-3 text-right font-medium">Amount</th>
                                <th className="px-4 py-3 text-left font-medium">Status</th>
                                <th className="px-4 py-3 text-left font-medium">File</th>
                                <th className="px-4 py-3 text-right font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {visible.map((inv) => {
                                const busy = busyId === inv.id;
                                const overdue = isOverdue(inv, today);
                                const overdueDays = overdue && inv.due_date ? -daysBetween(today, inv.due_date) : 0;
                                const daysLeft = inv.status === 'pending' && inv.due_date && !overdue ? daysBetween(today, inv.due_date) : null;
                                return (
                                    <tr
                                        key={inv.id}
                                        id={`invoice-row-${inv.id}`}
                                        className={`align-top transition-colors hover:bg-slate-800/40 ${busy ? 'opacity-60' : ''} ${
                                            highlighted === inv.id ? 'bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/50' : ''
                                        } ${inv.status === 'cancelled' ? 'text-slate-500' : ''}`}
                                    >
                                        <td className="px-4 py-3">
                                            <p className={`flex items-center gap-2 font-mono text-sm ${inv.status === 'cancelled' ? 'text-slate-500 line-through' : 'text-slate-100'}`}>
                                                {inv.doc_type !== 'invoice' ? (
                                                    <span
                                                        title={DOC_LABEL[inv.doc_type]}
                                                        className={`rounded px-1.5 py-0.5 font-sans text-[10px] font-semibold no-underline ${
                                                            inv.doc_type === 'credit_note'
                                                                ? 'bg-rose-500/15 text-rose-300'
                                                                : inv.doc_type === 'debit_note'
                                                                  ? 'bg-amber-500/15 text-amber-300'
                                                                  : 'bg-sky-500/15 text-sky-300'
                                                        }`}
                                                    >
                                                        {DOC_SHORT[inv.doc_type]}
                                                    </span>
                                                ) : null}
                                                {inv.invoice_number || '—'}
                                            </p>
                                            {isNote(inv.doc_type) && inv.related_number ? (
                                                <p className="mt-0.5 text-xs text-slate-500">
                                                    for invoice <span className="font-mono">{inv.related_number}</span>
                                                </p>
                                            ) : null}
                                            {inv.doc_type === 'proforma' && inv.converted_number ? (
                                                <p className="mt-0.5 text-xs text-emerald-400/80">
                                                    → invoice <span className="font-mono">{inv.converted_number}</span>
                                                </p>
                                            ) : null}
                                            {inv.contract_number ? (
                                                <p className="mt-0.5 text-xs text-slate-500">
                                                    Contract <span className="font-mono">{inv.contract_number}</span>
                                                </p>
                                            ) : null}
                                        </td>
                                        <td className="px-4 py-3 text-slate-300">{inv.client_name}</td>
                                        <td className="px-4 py-3 text-xs text-slate-400">
                                            <p>Issued: {formatDate(inv.issue_date)}</p>
                                            {inv.doc_type !== 'credit_note' ? <p>Due: {formatDate(inv.due_date)}</p> : null}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <p className={`font-mono ${inv.doc_type === 'credit_note' ? 'text-rose-300' : 'text-slate-100'}`}>
                                                {formatMoney(signedAmount(inv.doc_type, inv.total_amount), currency)}
                                            </p>
                                            <p className="font-mono text-xs text-slate-500">
                                                net {formatMoney(inv.subtotal, currency)} · VAT {inv.vat_rate}%
                                            </p>
                                        </td>
                                        <td className="px-4 py-3">
                                            {inv.status === 'paid' ? (
                                                <>
                                                    <span className={badgeEmerald}>
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        {inv.doc_type === 'credit_note' ? 'Settled' : 'Paid'}
                                                    </span>
                                                    <p className="mt-1 text-xs text-slate-500">
                                                        {inv.paid_date ? `on ${formatDate(inv.paid_date)} · ` : ''}
                                                        {PAYMENT_METHOD_LABEL[inv.payment_method] ?? inv.payment_method}
                                                    </p>
                                                </>
                                            ) : inv.status === 'cancelled' ? (
                                                <span className={badgeSlate}>
                                                    <XCircle className="h-3 w-3" />
                                                    Cancelled
                                                </span>
                                            ) : overdue ? (
                                                <>
                                                    <span className={badgeRose}>
                                                        <AlertTriangle className="h-3 w-3" />
                                                        Overdue
                                                    </span>
                                                    <p className="mt-1 text-xs text-rose-400">by {pluralDays(overdueDays)}</p>
                                                </>
                                            ) : (
                                                <>
                                                    <span className={badgeAmber}>
                                                        <Clock className="h-3 w-3" />
                                                        {inv.doc_type === 'credit_note' ? 'Unsettled' : 'Awaiting payment'}
                                                    </span>
                                                    {daysLeft !== null ? (
                                                        <p className="mt-1 text-xs text-slate-500">
                                                            {daysLeft === 0 ? 'due today' : `${pluralDays(daysLeft)} left`}
                                                        </p>
                                                    ) : null}
                                                </>
                                            )}
                                        </td>

                                        <td className="px-4 py-3">
                                            {inv.file_path ? (
                                                <div className="space-y-1.5">
                                                    <p className="max-w-40 truncate text-xs text-slate-400" title={inv.file_name ?? undefined}>
                                                        <FileText className="mr-1 inline h-3.5 w-3.5" />
                                                        {inv.file_name}
                                                    </p>
                                                    <div className="flex gap-1">
                                                        <button type="button" onClick={() => setPreview(inv)} title="View" aria-label={`View the file for invoice ${inv.invoice_number}`} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-indigo-300">
                                                            <Eye className="h-4 w-4" />
                                                        </button>
                                                        <a href={fileUrl(inv.file_path, true)} title="Download" aria-label={`Download the file for invoice ${inv.invoice_number}`} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-indigo-300">
                                                            <Download className="h-4 w-4" />
                                                        </a>
                                                        <button type="button" onClick={() => pickFile(inv)} disabled={busy} title="Replace file" aria-label={`Replace the file for invoice ${inv.invoice_number}`} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-indigo-300 disabled:opacity-40">
                                                            <Upload className="h-4 w-4" />
                                                        </button>
                                                        <button type="button" onClick={() => handleRemoveFile(inv)} disabled={busy} title="Remove file" aria-label={`Remove the file for invoice ${inv.invoice_number}`} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40">
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button type="button" onClick={() => pickFile(inv)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:border-indigo-500/50 hover:text-indigo-300 disabled:opacity-40">
                                                    <Paperclip className="h-3.5 w-3.5" />
                                                    Attach file
                                                </button>
                                            )}
                                        </td>

                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap items-center justify-end gap-1">
                                                {inv.doc_type === 'proforma' && inv.status !== 'cancelled' && !inv.converted_number ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleConvert(inv)}
                                                        disabled={busy}
                                                        title="Issue an invoice from the proforma"
                                                        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600/90 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
                                                    >
                                                        Invoice
                                                        <ArrowRight className="h-3.5 w-3.5" />
                                                    </button>
                                                ) : null}
                                                {inv.doc_type === 'invoice' && inv.status !== 'cancelled' ? (
                                                    <div className="relative">
                                                        <button
                                                            type="button"
                                                            onClick={() => setNoteMenuFor(noteMenuFor === inv.id ? null : inv.id)}
                                                            disabled={busy}
                                                            aria-haspopup="menu"
                                                            aria-expanded={noteMenuFor === inv.id}
                                                            aria-label={`Note for invoice ${inv.invoice_number}`}
                                                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
                                                        >
                                                            Note
                                                            <ChevronDown className="h-3.5 w-3.5" />
                                                        </button>
                                                        {noteMenuFor === inv.id ? (
                                                            <div role="menu" className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-left shadow-2xl">
                                                                <button type="button" role="menuitem" onClick={() => openNote(inv, 'credit_note')} className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
                                                                    Credit note
                                                                    <span className="block text-xs text-slate-500">decrease / return</span>
                                                                </button>
                                                                <button type="button" role="menuitem" onClick={() => openNote(inv, 'debit_note')} className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
                                                                    Debit note
                                                                    <span className="block text-xs text-slate-500">increase</span>
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                                {inv.status === 'pending' ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => changeStatus(inv, 'paid')}
                                                            disabled={busy}
                                                            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/90 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                                                        >
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                            {inv.doc_type === 'credit_note' ? 'Settled' : 'Paid'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => changeStatus(inv, 'cancelled')}
                                                            disabled={busy}
                                                            title="Cancel"
                                                            aria-label={`Cancel invoice ${inv.invoice_number}`}
                                                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                                                        >
                                                            <XCircle className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => openEdit(inv)}
                                                            disabled={busy}
                                                            title="Edit"
                                                            aria-label={`Edit invoice ${inv.invoice_number}`}
                                                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => changeStatus(inv, 'pending')}
                                                        disabled={busy}
                                                        title="Move back to pending"
                                                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
                                                    >
                                                        <Clock className="h-3.5 w-3.5" />
                                                        To pending
                                                    </button>
                                                )}
                                                {inv.status !== 'cancelled' ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSending(inv)}
                                                        disabled={busy}
                                                        title={inv.sent_at ? `Sent to ${inv.sent_to}` : 'Send to the client'}
                                                        aria-label={`Email ${inv.invoice_number}`}
                                                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                                                            inv.sent_at
                                                                ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10'
                                                                : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                                                        }`}
                                                    >
                                                        {inv.viewed_at ? <Eye className="h-3.5 w-3.5" /> : inv.sent_at ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                                                        {inv.viewed_at ? 'Viewed' : inv.sent_at ? 'Sent' : 'Send'}
                                                    </button>
                                                ) : null}
                                                <Link
                                                    href={`/dashboard/invoices/${inv.id}/print`}
                                                    title="Print (A4)"
                                                    aria-label={`Print invoice ${inv.invoice_number}`}
                                                    className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-indigo-300"
                                                >
                                                    <Printer className="h-4 w-4" />
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {visible.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                        <Receipt className="h-10 w-10 text-slate-600" />
                        <p className="text-sm text-slate-400">
                            {invoices.length === 0 ? 'No invoices yet. Issue your first one.' : 'No documents in this filter.'}
                        </p>
                        {invoices.length === 0 ? (
                            <button type="button" onClick={() => openCreate('invoice')} className={btnPrimary}>
                                <Plus className="h-4 w-4" />
                                New invoice
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {sending ? (
                <SendInvoiceModal
                    invoice={sending}
                    clientEmail={clients.find((c) => c.id === sending.client_id)?.email ?? ''}
                    companyName={companyName}
                    currency={currency}
                    origin={origin}
                    onClose={() => setSending(null)}
                    onChanged={({ id, patch }) => setInvoices((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))}
                />
            ) : null}

            {formOpen ? (
                <InvoiceFormModal
                    key={editing?.id ?? `new-${formDocType}-${formRelated?.id ?? 0}`}
                    editing={editing}
                    docType={formDocType}
                    related={formRelated}
                    relatedRemaining={
                        formRelated
                            ? remainingFor(formRelated, invoices) + (editing && editing.doc_type === 'credit_note' ? editing.total_amount : 0)
                            : null
                    }
                    clients={clients}
                    contracts={contracts}
                    products={products}
                    currency={currency}
                    today={today}
                    bankAccounts={bankAccounts}
                    series={series}
                    mainIban={mainIban}
                    onClose={() => setFormOpen(false)}
                    onSaved={handleSaved}
                />
            ) : null}

            <FilePreviewModal
                filePath={preview?.file_path ?? null}
                fileName={preview?.file_name ?? null}
                title={preview ? `${DOC_LABEL[preview.doc_type]} no. ${preview.invoice_number} · ${preview.client_name}` : ''}
                onClose={() => setPreview(null)}
            />
        </div>
    );
}
