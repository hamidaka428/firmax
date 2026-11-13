'use client';

import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Paperclip, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/app/components/ui/Modal';
import { btnPrimary, btnSecondary, inputCls, labelCls } from '@/app/components/ui/styles';
import { formatDate, formatMoney, formatQty, parseDecimal, round } from '@/app/lib/format';
import { amountInWords, VAT_EXEMPT_REASONS, VAT_RATE_SUGGESTIONS } from '@/app/lib/validation';
import { PAYMENT_METHODS, isValidVatRate } from '@/app/lib/types';
import { PAYMENT_METHOD_LABEL, UNITS } from '@/app/lib/labels';
import type { BankAccount, ContractOption, DocType, Invoice, InvoiceInput, InvoiceSeries, PaymentMethod, ProductOption } from '@/app/lib/types';
import { formatIban } from '@/app/lib/validation';
import { DOC_LABEL, isNote } from '@/app/lib/documents';
import { createInvoice, updateInvoice, uploadInvoiceFile } from './actions';

const MAX_FILE_BYTES = 15 * 1024 * 1024;

interface RowState {
    key: number;
    product_id: string;
    description: string;
    unit: string;
    quantity: string;
    unit_price: string;
}

let rowKeySeq = 0;
const nextRowKey = () => ++rowKeySeq;

function emptyRow(): RowState {
    return { key: nextRowKey(), product_id: '', description: '', unit: 'pcs', quantity: '1', unit_price: '0' };
}

function num(value: string): number {
    return parseDecimal(value) ?? 0;
}

function addDays(iso: string, days: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface InvoiceSaved {
    invoice: Invoice;
    wasEdit: boolean;
    fileWarning: string | null;
}

const NOTE_REASONS: Record<'credit_note' | 'debit_note', string[]> = {
    credit_note: ['Returned goods', 'Price discount', 'Price error', 'Quantity error', 'Cancellation of the sale', 'Unsatisfactory service'],
    debit_note: ['Additional goods delivered', 'Additional services performed', 'Price increase', 'Price error (undercharged)'],
};

interface InvoiceFormModalProps {
    editing: Invoice | null;
    /** Type of the new document (taken from editing when editing) */
    docType: DocType;
    /** The invoice a note is issued against */
    related: Invoice | null;
    /** Already credited against related (excluding cancelled) minus debited — for the balance check */
    relatedRemaining: number | null;
    clients: { id: number; name: string }[];
    contracts: ContractOption[];
    products: ProductOption[];
    currency: string;
    today: string;
    bankAccounts: BankAccount[];
    series: InvoiceSeries[];
    mainIban: string;
    onClose: () => void;
    onSaved: (result: InvoiceSaved) => void;
}

export default function InvoiceFormModal({
    editing,
    docType: docTypeProp,
    related,
    relatedRemaining,
    clients,
    contracts,
    products,
    currency,
    today,
    bankAccounts,
    series,
    mainIban,
    onClose,
    onSaved,
}: InvoiceFormModalProps) {
    const docType: DocType = editing?.doc_type ?? docTypeProp;
    const note = isNote(docType);
    // Source of the locked fields for a note: the note itself (editing) or the invoice
    const base = editing ?? related;
    const [clientId, setClientId] = useState(base?.client_id ? String(base.client_id) : '');
    const [contractId, setContractId] = useState(base?.contract_id ? String(base.contract_id) : '');
    const [issueDate, setIssueDate] = useState(editing?.issue_date ?? today);
    const [dueDate, setDueDate] = useState(editing?.due_date ?? addDays(today, 14));
    const [method, setMethod] = useState<PaymentMethod>(base?.payment_method ?? 'bank_transfer');
    const [vatRate, setVatRate] = useState<string>(String(base?.vat_rate ?? 20));
    const [notes, setNotes] = useState(editing?.notes ?? '');
    const [vatReason, setVatReason] = useState(base?.vat_exempt_reason ?? '');
    const [noteReason, setNoteReason] = useState(editing?.note_reason ?? '');
    const [bankAccountId, setBankAccountId] = useState(base?.bank_account_id ? String(base.bank_account_id) : '');
    const [seriesId, setSeriesId] = useState('');
    // A series is chosen only for a new invoice (notes use their invoice's series, proformas their own)
    const canPickSeries = !editing && docType === 'invoice' && series.length > 0;
    const relatedNumber = editing?.related_number ?? related?.invoice_number ?? '';
    const relatedDate = editing?.related_date ?? related?.issue_date ?? null;
    // A credit note copies the invoice lines by default (then quantities/prices are adjusted)
    const sourceItems = editing ? editing.items : docType === 'credit_note' && related ? related.items : [];
    const [rows, setRows] = useState<RowState[]>(() =>
        sourceItems.length > 0
            ? sourceItems.map((it) => ({
                  key: nextRowKey(),
                  product_id: it.product_id !== null ? String(it.product_id) : '',
                  description: it.description,
                  unit: it.unit,
                  quantity: String(it.quantity),
                  unit_price: String(it.unit_price),
              }))
            : [emptyRow()],
    );
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
    const contractById = useMemo(() => new Map(contracts.map((c) => [c.id, c])), [contracts]);

    // Contracts of the selected client (or all, if no client is selected yet)
    const contractChoices = useMemo(
        () => contracts.filter((c) => !clientId || c.client_id === null || String(c.client_id) === clientId),
        [contracts, clientId],
    );

    const lineTotals = rows.map((r) => round(num(r.quantity) * num(r.unit_price), 2));
    const subtotal = round(lineTotals.reduce((a, b) => a + b, 0), 2);
    const rate = Number(vatRate);
    const vatAmount = round((subtotal * rate) / 100, 2);
    const total = round(subtotal + vatAmount, 2);

    function patchRow(key: number, patch: Partial<RowState>) {
        setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    }

    function chooseProduct(key: number, value: string) {
        if (!value) {
            patchRow(key, { product_id: '' });
            return;
        }
        const p = productById.get(Number(value));
        if (!p) return;
        patchRow(key, {
            product_id: value,
            description: p.name,
            unit: p.unit,
            unit_price: String(p.unit_price),
        });
    }

    function fillFromContract(id: number) {
        const c = contractById.get(id);
        if (!c) return;
        if (c.client_id !== null) setClientId(String(c.client_id));
        if (c.items.length > 0) {
            setRows(
                c.items.map((it) => ({
                    key: nextRowKey(),
                    product_id: it.product_id !== null ? String(it.product_id) : '',
                    description: it.description,
                    unit: it.unit,
                    quantity: String(it.quantity),
                    unit_price: String(it.unit_price),
                })),
            );
        }
    }

    function chooseContract(value: string) {
        setContractId(value);
        if (!value) return;
        const untouched = rows.every((r) => !r.description.trim() && !r.product_id);
        if (untouched) fillFromContract(Number(value));
        else {
            const c = contractById.get(Number(value));
            if (c && c.client_id !== null && !clientId) setClientId(String(c.client_id));
        }
    }

    function pickFile(selected: File | null) {
        if (selected && selected.size > MAX_FILE_BYTES) {
            setError('The file is larger than 15 MB.');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }
        setError(null);
        setFile(selected);
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (!clientId) return setError('Select a client.');
        const needsDue = docType !== 'credit_note';
        if (!issueDate || (needsDue && !dueDate)) return setError('Fill in the issue date and the due date.');
        if (needsDue && dueDate < issueDate) return setError('The due date cannot be before the issue date.');
        if (note && noteReason.trim().length < 3) return setError('Enter a reason for the note.');
        if (note && relatedDate && issueDate < relatedDate) return setError('The note cannot be dated before the invoice.');
        if (!isValidVatRate(Number(vatRate))) return setError('VAT rate must be between 0 and 100%.');
        if (Number(vatRate) === 0 && !vatReason.trim()) return setError('With 0% VAT, enter the VAT exemption note.');

        const items: InvoiceInput['items'] = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const quantity = parseDecimal(r.quantity);
            const unitPrice = parseDecimal(r.unit_price);
            if (!r.description.trim()) return setError(`Line ${i + 1}: enter a description or choose a product.`);
            if (quantity === null || quantity <= 0) return setError(`Line ${i + 1}: quantity must be a positive number.`);
            if (unitPrice === null) return setError(`Line ${i + 1}: invalid unit price.`);
            items.push({
                product_id: r.product_id ? Number(r.product_id) : null,
                description: r.description.trim(),
                unit: r.unit.trim() || 'pcs',
                quantity,
                unit_price: unitPrice,
            });
        }

        if (docType === 'credit_note' && relatedRemaining !== null && round(total, 2) > relatedRemaining + 0.001) {
            return setError(`The amount (${formatMoney(total, currency)}) exceeds the remaining invoice balance (${formatMoney(relatedRemaining, currency)}).`);
        }

        const input: InvoiceInput = {
            doc_type: docType,
            related_invoice_id: note ? (editing?.related_invoice_id ?? related?.id ?? null) : null,
            note_reason: note ? noteReason.trim() : '',
            client_id: Number(clientId),
            contract_id: contractId ? Number(contractId) : null,
            issue_date: issueDate,
            due_date: needsDue ? dueDate : null,
            payment_method: method,
            vat_rate: rate,
            vat_exempt_reason: rate === 0 ? vatReason.trim() : '',
            notes: notes.trim(),
            items,
            series_id: canPickSeries && seriesId ? Number(seriesId) : null,
            bank_account_id: bankAccountId && method === 'bank_transfer' ? Number(bankAccountId) : null,
        };

        setSaving(true);
        setError(null);
        const res = editing ? await updateInvoice(editing.id, input) : await createInvoice(input);
        if (!res.ok) {
            setSaving(false);
            setError(res.error);
            return;
        }

        let saved = res.data;
        let fileWarning: string | null = null;
        if (!editing && file) {
            const fd = new FormData();
            fd.set('file', file);
            const up = await uploadInvoiceFile(saved.id, fd);
            if (up.ok) saved = { ...saved, file_path: up.data.file_path, file_name: up.data.file_name };
            else fileWarning = up.error;
        }

        setSaving(false);
        onSaved({ invoice: saved, wasEdit: editing !== null, fileWarning });
    }

    return (
        <Modal
            open
            onClose={onClose}
            title={editing ? `Edit ${DOC_LABEL[docType].toLowerCase()} no. ${editing.invoice_number}` : `New ${DOC_LABEL[docType].toLowerCase()}`}
            description={
                docType === 'proforma'
                    ? 'A proforma is not a tax invoice and has its own numbering. Later you can turn it into an invoice with one click.'
                    : note
                      ? 'The note gets the next number in the invoice sequence.'
                      : editing
                        ? 'Only pending invoices can be edited.'
                        : 'The number is assigned automatically when you save.'
            }
            size="2xl"
            busy={saving}
            footer={
                <>
                    <div className="mr-auto text-sm text-slate-400">
                        {docType === 'credit_note' ? 'Credit total:' : 'Total due:'}{' '}
                        <span className="font-mono text-lg font-semibold text-slate-100">{formatMoney(total, currency)}</span>
                    </div>
                    <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button type="submit" form="invoice-form" className={btnPrimary} disabled={saving}>
                        {saving ? 'Saving…' : editing ? 'Save changes' : note ? 'Issue note' : docType === 'proforma' ? 'Issue proforma' : 'Issue invoice'}
                    </button>
                </>
            }
        >
            <form id="invoice-form" onSubmit={handleSubmit} className="space-y-6">
                {error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {error}
                    </div>
                ) : null}

                {note ? (
                    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 text-sm">
                        <p className="text-slate-200">
                            Relating to invoice <span className="font-mono font-semibold">no. {relatedNumber}</span>
                            {relatedDate ? <> of {formatDate(relatedDate)}</> : null} ·{' '}
                            {clients.find((c) => String(c.id) === clientId)?.name ?? ''}
                        </p>
                        {docType === 'credit_note' && relatedRemaining !== null ? (
                            <p className="mt-1 text-xs text-slate-400">
                                Invoice balance available to credit: <span className="font-mono text-slate-200">{formatMoney(relatedRemaining, currency)}</span>
                            </p>
                        ) : null}
                        <div className="mt-3">
                            <label htmlFor="inv-note-reason" className={labelCls}>Reason for the note *</label>
                            <input
                                id="inv-note-reason"
                                list="inv-note-reasons"
                                className={inputCls}
                                value={noteReason}
                                maxLength={500}
                                placeholder="e.g. Returned goods"
                                onChange={(e) => setNoteReason(e.target.value)}
                            />
                            <datalist id="inv-note-reasons">
                                {NOTE_REASONS[docType as 'credit_note' | 'debit_note'].map((r) => (
                                    <option key={r} value={r} />
                                ))}
                            </datalist>
                            <p className="mt-1 text-xs text-slate-500">The recipient, contract and VAT rate are the same as on the invoice.</p>
                        </div>
                    </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-6">
                    <div className="sm:col-span-3">
                        <label htmlFor="inv-client" className={labelCls}>Client (recipient) *</label>
                        <select
                            id="inv-client"
                            className={inputCls}
                            value={clientId}
                            disabled={note}
                            onChange={(e) => {
                                setClientId(e.target.value);
                                setContractId('');
                            }}
                        >
                            <option value="">— Select a client —</option>
                            {clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="sm:col-span-3">
                        <label htmlFor="inv-contract" className={labelCls}>Contract (optional)</label>
                        <div className="flex gap-2">
                            <select id="inv-contract" className={inputCls} value={contractId} disabled={note} onChange={(e) => chooseContract(e.target.value)}>
                                <option value="">— No contract —</option>
                                {contractChoices.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.contract_number} · {c.title}
                                    </option>
                                ))}
                            </select>
                            {contractId && !note ? (
                                <button
                                    type="button"
                                    className={`${btnSecondary} shrink-0 px-3`}
                                    onClick={() => fillFromContract(Number(contractId))}
                                    title="Replaces the lines with those from the contract"
                                >
                                    Fill in
                                </button>
                            ) : null}
                        </div>
                    </div>

                    <div className="sm:col-span-2">
                        <label htmlFor="inv-issue" className={labelCls}>Issue date *</label>
                        <input id="inv-issue" type="date" className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                    </div>
                    {docType !== 'credit_note' ? (
                        <div className="sm:col-span-2">
                            <label htmlFor="inv-due" className={labelCls}>Due date *</label>
                            <input id="inv-due" type="date" className={inputCls} value={dueDate} min={issueDate || undefined} onChange={(e) => setDueDate(e.target.value)} />
                        </div>
                    ) : (
                        <div className="sm:col-span-2" />
                    )}
                    <div className="sm:col-span-2">
                        <label htmlFor="inv-method" className={labelCls}>Payment method</label>
                        <select id="inv-method" className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                            {PAYMENT_METHODS.map((m) => (
                                <option key={m} value={m}>
                                    {PAYMENT_METHOD_LABEL[m]}
                                </option>
                            ))}
                        </select>
                    </div>
                    {bankAccounts.length > 0 && method === 'bank_transfer' && docType !== 'credit_note' ? (
                        <div className="sm:col-span-3">
                            <label htmlFor="inv-bank" className={labelCls}>Payment account</label>
                            <select id="inv-bank" className={inputCls} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                                <option value="">Main{mainIban ? ` · ${formatIban(mainIban)}` : ''}</option>
                                {bankAccounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.label || a.bank_name || 'Account'} · {formatIban(a.iban)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                    {canPickSeries ? (
                        <div className="sm:col-span-3">
                            <label htmlFor="inv-series" className={labelCls}>Number series</label>
                            <select id="inv-series" className={inputCls} value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                                <option value="">Main</option>
                                {series.map((sr) => (
                                    <option key={sr.id} value={sr.id}>
                                        {sr.name} · no. {String(sr.next_number).padStart(10, '0')}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                </div>

                <section>
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-200">
                            {docType === 'credit_note' ? 'Lines to credit (adjust quantities/prices)' : 'Document lines'}
                        </h3>
                        <button type="button" onClick={() => setRows((prev) => [...prev, emptyRow()])} className={`${btnSecondary} px-3 py-1.5`}>
                            <Plus className="h-4 w-4" />
                            Add line
                        </button>
                    </div>

                    <div className="space-y-3">
                        {rows.map((r, index) => (
                            <div key={r.key} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 md:grid-cols-12">
                                <div className="md:col-span-5">
                                    <label htmlFor={`irow-product-${r.key}`} className="sr-only">Product, line {index + 1}</label>
                                    <select id={`irow-product-${r.key}`} className={inputCls} value={r.product_id} onChange={(e) => chooseProduct(r.key, e.target.value)}>
                                        <option value="">— Free-text line (service / manual) —</option>
                                        {products.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.sku ? `${p.sku} · ` : ''}
                                                {p.name} ({formatQty(p.qty_in_stock)} {p.unit})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="md:col-span-7">
                                    <label htmlFor={`irow-desc-${r.key}`} className="sr-only">Description, line {index + 1}</label>
                                    <input id={`irow-desc-${r.key}`} className={inputCls} value={r.description} maxLength={255} placeholder="Description" onChange={(e) => patchRow(r.key, { description: e.target.value })} />
                                </div>
                                <div className="flex items-center gap-2 md:col-span-3">
                                    <label htmlFor={`irow-qty-${r.key}`} className="sr-only">Quantity, line {index + 1}</label>
                                    <input id={`irow-qty-${r.key}`} inputMode="decimal" className={`${inputCls} text-right font-mono`} value={r.quantity} onChange={(e) => patchRow(r.key, { quantity: e.target.value })} />
                                    <input aria-label={`Unit, line ${index + 1}`} list="inv-units" className={`${inputCls} w-20`} value={r.unit} maxLength={20} onChange={(e) => patchRow(r.key, { unit: e.target.value })} />
                                </div>
                                <div className="md:col-span-3">
                                    <label htmlFor={`irow-price-${r.key}`} className="sr-only">Unit price, line {index + 1}</label>
                                    <input id={`irow-price-${r.key}`} inputMode="decimal" className={`${inputCls} text-right font-mono`} value={r.unit_price} onChange={(e) => patchRow(r.key, { unit_price: e.target.value })} />
                                </div>
                                <div className="flex items-center justify-between gap-2 md:col-span-6">
                                    <span className="font-mono text-sm text-slate-100">{formatMoney(lineTotals[index], currency)}</span>
                                    <button
                                        type="button"
                                        onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== r.key) : prev))}
                                        disabled={rows.length === 1}
                                        aria-label={`Remove line ${index + 1}`}
                                        className="rounded-md p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-30"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <datalist id="inv-units">
                    {UNITS.map((u) => (
                        <option key={u} value={u} />
                    ))}
                </datalist>

                {/* VAT and totals */}
                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor="inv-vat" className={labelCls}>VAT rate (%)</label>
                        <input id="inv-vat" type="number" min={0} max={100} step={0.01} list="inv-vat-rates" className={inputCls}
                            value={vatRate} disabled={note} onChange={(e) => setVatRate(e.target.value)} />
                        <datalist id="inv-vat-rates">
                            {VAT_RATE_SUGGESTIONS.map((v) => (
                                <option key={v} value={v} />
                            ))}
                        </datalist>
                        {rate === 0 ? (
                            <div className="mt-3">
                                <label htmlFor="inv-vat-reason" className={labelCls}>VAT exemption note *</label>
                                <input
                                    id="inv-vat-reason"
                                    list="inv-vat-reasons"
                                    className={inputCls}
                                    value={vatReason}
                                    maxLength={255}
                                    placeholder="Choose or type a note"
                                    disabled={note}
                                    onChange={(e) => setVatReason(e.target.value)}
                                />
                                <datalist id="inv-vat-reasons">
                                    {VAT_EXEMPT_REASONS.map((r) => (
                                        <option key={r} value={r} />
                                    ))}
                                </datalist>
                                <p className="mt-1 text-xs text-slate-500">Required in most jurisdictions when no VAT is charged. Printed on the invoice.</p>
                            </div>
                        ) : null}
                    </div>
                    <dl className="space-y-1 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
                        <div className="flex justify-between">
                            <dt className="text-slate-400">Subtotal</dt>
                            <dd className="font-mono text-slate-200">{formatMoney(subtotal, currency)}</dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-slate-400">VAT {rate}%</dt>
                            <dd className="font-mono text-slate-200">{formatMoney(vatAmount, currency)}</dd>
                        </div>
                        <div className="flex justify-between border-t border-slate-800 pt-1 font-semibold">
                            <dt className="text-slate-200">{docType === 'credit_note' ? 'Credit total' : docType === 'debit_note' ? 'Additional charge' : 'Total due'}</dt>
                            <dd className="font-mono text-slate-100">{formatMoney(total, currency)}</dd>
                        </div>
                        <p className="pt-1 text-xs italic text-slate-500">In words: {amountInWords(total, currency)}</p>
                    </dl>
                </div>

                <div>
                    <label htmlFor="inv-notes" className={labelCls}>Notes</label>
                    <textarea id="inv-notes" rows={2} className={inputCls} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
                </div>

                {!editing ? (
                    <div>
                        <span className={labelCls}>External invoice / document (PDF or image, up to 15 MB)</span>
                        <div className="flex flex-wrap items-center gap-3">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/*"
                                className="hidden"
                                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                            />
                            <button type="button" className={btnSecondary} onClick={() => fileInputRef.current?.click()}>
                                <Paperclip className="h-4 w-4" />
                                {file ? 'Change file' : 'Choose file'}
                            </button>
                            <span className="min-w-0 truncate text-sm text-slate-400">{file ? file.name : 'No file selected (you can attach one later)'}</span>
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-slate-500">The invoice file is managed from the table (Attach / Replace / View).</p>
                )}
            </form>
        </Modal>
    );
}
