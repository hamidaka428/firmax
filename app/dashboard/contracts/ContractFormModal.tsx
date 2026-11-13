'use client';

import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, Eye, FileText, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/app/components/ui/Modal';
import { btnPrimary, btnSecondary, inputCls, labelCls } from '@/app/components/ui/styles';
import { formatDate, formatMoney, formatQty, parseDecimal, round } from '@/app/lib/format';
import { CONTRACT_STATUSES, CONTRACT_TYPES, isValidVatRate } from '@/app/lib/types';
import { CONTRACT_STATUS_LABEL, CONTRACT_TYPE_LABEL, UNITS } from '@/app/lib/labels';
import { BILLING_OPTIONS } from '@/app/lib/recurring-options';
import { VAT_EXEMPT_REASONS, VAT_RATE_SUGGESTIONS } from '@/app/lib/validation';
import ContractDocument from '@/app/components/ContractDocument';
import { PARTY_ROLES, endDateForMonths, renderTemplate } from '@/app/lib/contract-template';
import type { TemplateCompany } from '@/app/lib/contract-template';
import type {
    ClientOption,
    Contract,
    ContractInput,
    ContractTemplate,
    ContractStatus,
    ContractType,
    ProductOption,
    StockUpdate,
} from '@/app/lib/types';
import { createContract, updateContract, uploadContractFile } from './actions';

const MAX_FILE_BYTES = 15 * 1024 * 1024;

interface RowState {
    key: number;
    product_id: string; // '' = free-text line
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

export interface ContractSaved {
    contract: Contract;
    stock: StockUpdate[];
    wasEdit: boolean;
    fileWarning: string | null;
    generated: string[];
}

interface ContractFormModalProps {
    editing: Contract | null;
    clients: ClientOption[];
    products: ProductOption[];
    templates: ContractTemplate[];
    company: TemplateCompany;
    /** Template chosen in advance (new contract from the Templates page) */
    initialTemplateId: number | null;
    currency: string;
    today: string;
    suggestedNumber: string;
    onClose: () => void;
    onSaved: (result: ContractSaved) => void;
}

export default function ContractFormModal({
    editing,
    clients,
    products,
    templates,
    company,
    initialTemplateId,
    currency,
    today,
    suggestedNumber,
    onClose,
    onSaved,
}: ContractFormModalProps) {
    // Template chosen when opening (new contracts only) — provides the initial type, subject and term
    const startTemplate = !editing && initialTemplateId !== null ? templates.find((t) => t.id === initialTemplateId) ?? null : null;

    const [number, setNumber] = useState(editing?.contract_number ?? suggestedNumber);
    const [title, setTitle] = useState(editing?.title ?? startTemplate?.default_title ?? '');
    const [clientId, setClientId] = useState(editing?.client_id ? String(editing.client_id) : '');
    const [type, setType] = useState<ContractType>(editing?.contract_type ?? startTemplate?.contract_type ?? 'sale');
    const [status, setStatus] = useState<ContractStatus>(editing?.status ?? 'active');
    const [startDate, setStartDate] = useState(editing?.start_date ?? today);
    const [endDate, setEndDate] = useState(
        editing?.end_date ?? (startTemplate?.default_months ? endDateForMonths(today, startTemplate.default_months) : ''),
    );
    const [templateId, setTemplateId] = useState<string>(
        editing?.template_id && templates.some((t) => t.id === editing.template_id)
            ? String(editing.template_id)
            : startTemplate
              ? String(startTemplate.id)
              : '',
    );
    // The saved text of an edited contract is never overwritten automatically
    const [bodyEdited, setBodyEdited] = useState(Boolean(editing?.body));
    const [bodyText, setBodyText] = useState(editing?.body ?? '');
    const [bodyView, setBodyView] = useState<'edit' | 'preview'>('edit');
    const [notes, setNotes] = useState(editing?.notes ?? '');
    const [deduct, setDeduct] = useState(editing ? editing.deducted_count > 0 : false);
    // Recurring billing
    const [billingMonths, setBillingMonths] = useState<number>(editing?.billing_months ?? 0);
    const [billingStart, setBillingStart] = useState(editing?.billing_next ?? '');
    const [billingDueDays, setBillingDueDays] = useState(String(editing?.billing_due_days ?? 14));
    const [billingVat, setBillingVat] = useState<number>(editing?.billing_vat_rate ?? 20);
    const [billingVatReason, setBillingVatReason] = useState(editing?.billing_vat_exempt_reason ?? '');
    const [billingAutoEmail, setBillingAutoEmail] = useState(editing?.billing_auto_email ?? false);
    const [rows, setRows] = useState<RowState[]>(() =>
        editing && editing.items.length > 0
            ? editing.items.map((it) => ({
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

    // Quantities this contract already deducted (restored when the edit is saved)
    const previouslyDeducted = useMemo(() => {
        const map = new Map<number, number>();
        for (const it of editing?.items ?? []) {
            if (it.stock_deducted && it.product_id !== null) {
                map.set(it.product_id, round((map.get(it.product_id) ?? 0) + it.quantity, 3));
            }
        }
        return map;
    }, [editing]);

    const neededByProduct = useMemo(() => {
        const map = new Map<number, number>();
        for (const r of rows) {
            if (!r.product_id) continue;
            const id = Number(r.product_id);
            map.set(id, round((map.get(id) ?? 0) + num(r.quantity), 3));
        }
        return map;
    }, [rows]);

    const template = templateId ? templates.find((t) => String(t.id) === templateId) ?? null : null;
    const selectedClient = clientId ? clients.find((c) => String(c.id) === clientId) ?? null : null;
    const docItems = rows
        .filter((r) => r.description.trim())
        .map((r) => ({ description: r.description.trim(), unit: r.unit.trim() || 'pcs', quantity: num(r.quantity), unit_price: num(r.unit_price) }));

    const lineTotals = rows.map((r) => round(num(r.quantity) * num(r.unit_price), 2));
    const total = round(lineTotals.reduce((a, b) => a + b, 0), 2);

    const generated = template
        ? renderTemplate(template.body, {
              company,
              client: selectedClient,
              contract: {
                  number: number.trim(),
                  title: title.trim(),
                  type,
                  start_date: startDate || today,
                  end_date: endDate || null,
                  total,
                  notes: notes.trim(),
                  vat_rate: billingVat,
              },
              today,
          })
        : '';
    const effectiveBody = bodyEdited ? bodyText : generated;
    const emptyFieldCount = (effectiveBody.match(/………………/g) ?? []).length;
    const [companyRole, clientRole] = PARTY_ROLES[type];

    function chooseTemplate(value: string) {
        setTemplateId(value);
        setBodyEdited(false); // new template → the text is regenerated
        const t = templates.find((x) => String(x.id) === value);
        if (!t) return;
        setType(t.contract_type);
        if (!title.trim() && t.default_title) setTitle(t.default_title);
        if (t.default_months && startDate) setEndDate(endDateForMonths(startDate, t.default_months));
    }

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

    function shortage(row: RowState): string | null {
        if (!deduct || !row.product_id) return null;
        const id = Number(row.product_id);
        const p = productById.get(id);
        if (!p) return null;
        const available = round(p.qty_in_stock + (previouslyDeducted.get(id) ?? 0), 3);
        const needed = neededByProduct.get(id) ?? 0;
        return needed > available ? `${formatQty(available)} ${p.unit} available, ${formatQty(needed)} needed` : null;
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

        if (!number.trim() || !title.trim()) return setError('Contract number and subject are required.');
        if (!clientId) return setError('Select a client.');
        if (!startDate) return setError('Start date is required.');
        if (endDate && endDate < startDate) return setError('The end date cannot be before the start date.');

        const items: ContractInput['items'] = [];
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

        const dueDays = Number(billingDueDays);
        if (billingMonths > 0) {
            if (!billingStart) return setError('Enter the date of the next recurring invoice.');
            if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) return setError('The payment term must be between 0 and 365 days.');
            if (!isValidVatRate(billingVat)) return setError('VAT rate must be between 0 and 100%.');
            if (billingVat === 0 && !billingVatReason.trim()) return setError('With 0% VAT, enter the VAT exemption note.');
        }

        const input: ContractInput = {
            contract_number: number.trim(),
            title: title.trim(),
            client_id: Number(clientId),
            contract_type: type,
            start_date: startDate,
            end_date: endDate || null,
            status,
            notes: notes.trim(),
            template_id: template ? template.id : null,
            body: effectiveBody.trim() ? effectiveBody : '',
            items,
            deduct_stock: deduct,
            billing_months: billingMonths,
            billing_start: billingMonths > 0 ? billingStart : null,
            billing_due_days: billingMonths > 0 ? dueDays : 14,
            billing_vat_rate: billingVat,
            billing_vat_exempt_reason: billingVat === 0 ? billingVatReason.trim() : '',
            billing_auto_email: billingMonths > 0 && billingAutoEmail,
        };

        setSaving(true);
        setError(null);
        const res = editing ? await updateContract(editing.id, input) : await createContract(input);

        if (!res.ok) {
            setSaving(false);
            setError(res.error);
            return;
        }

        let saved = res.data.contract;
        let fileWarning: string | null = null;
        if (!editing && file) {
            const fd = new FormData();
            fd.set('file', file);
            const up = await uploadContractFile(saved.id, fd);
            if (up.ok) saved = { ...saved, file_path: up.data.file_path, file_name: up.data.file_name };
            else fileWarning = up.error;
        }

        setSaving(false);
        onSaved({ contract: saved, stock: res.data.stock, wasEdit: editing !== null, fileWarning, generated: res.data.generated });
    }

    return (
        <Modal
            open
            onClose={onClose}
            title={editing ? `Edit contract ${editing.contract_number}` : 'New contract'}
            description="Pick lines from inventory or enter them by hand (services). The total is calculated automatically."
            size="2xl"
            busy={saving}
            footer={
                <>
                    <div className="mr-auto text-sm text-slate-400">
                        Total:{' '}
                        <span className="font-mono text-lg font-semibold text-slate-100">{formatMoney(total, currency)}</span>
                        <span className="ml-1 text-xs text-slate-500">(excl. VAT)</span>
                    </div>
                    <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button type="submit" form="contract-form" className={btnPrimary} disabled={saving}>
                        {saving ? 'Saving…' : editing ? 'Save changes' : 'Create contract'}
                    </button>
                </>
            }
        >
            <form id="contract-form" onSubmit={handleSubmit} className="space-y-6">
                {error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {error}
                    </div>
                ) : null}

                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
                    <div className="min-w-64 flex-1">
                        <label htmlFor="ct-template" className={labelCls}>Contract template</label>
                        <select id="ct-template" className={inputCls} value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
                            <option value="">— No template (details only / own text) —</option>
                            {templates.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name} · {t.contract_type}
                                </option>
                            ))}
                        </select>
                    </div>
                    <Link href="/dashboard/contracts/templates" className="inline-flex items-center gap-1.5 pb-2 text-xs text-indigo-300 hover:text-indigo-200">
                        <FileText className="h-3.5 w-3.5" />
                        Manage templates
                    </Link>
                    <p className="w-full text-xs text-slate-500">
                        Choose a template — the type, subject and term are filled in, and the contract text is generated from the client details, dates and lines.
                    </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-6">
                    <div className="sm:col-span-2">
                        <label htmlFor="ct-number" className={labelCls}>Number *</label>
                        <input id="ct-number" className={`${inputCls} font-mono`} value={number} maxLength={50} onChange={(e) => setNumber(e.target.value)} />
                    </div>
                    <div className="sm:col-span-4">
                        <label htmlFor="ct-title" className={labelCls}>Contract subject *</label>
                        <input id="ct-title" className={inputCls} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
                    </div>

                    <div className="sm:col-span-3">
                        <label htmlFor="ct-client" className={labelCls}>Client *</label>
                        <select id="ct-client" className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                            <option value="">— Select a client —</option>
                            {clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                        {clients.length === 0 ? (
                            <p className="mt-1 text-xs text-amber-400">No clients yet. Add a client under Clients first.</p>
                        ) : null}
                    </div>
                    <div className="sm:col-span-3">
                        <label htmlFor="ct-type" className={labelCls}>Type</label>
                        <select id="ct-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as ContractType)}>
                            {CONTRACT_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {CONTRACT_TYPE_LABEL[t]}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="sm:col-span-2">
                        <label htmlFor="ct-start" className={labelCls}>Start date *</label>
                        <input id="ct-start" type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    <div className="sm:col-span-2">
                        <label htmlFor="ct-end" className={labelCls}>End date</label>
                        <input id="ct-end" type="date" className={inputCls} value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
                        <p className="mt-1 text-xs text-slate-500">Empty = open-ended contract.</p>
                    </div>
                    <div className="sm:col-span-2">
                        <label htmlFor="ct-status" className={labelCls}>Status</label>
                        <select id="ct-status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as ContractStatus)}>
                            {CONTRACT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {CONTRACT_STATUS_LABEL[s]}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Contract lines */}
                <section>
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-200">Contract lines</h3>
                        <button type="button" onClick={() => setRows((prev) => [...prev, emptyRow()])} className={`${btnSecondary} px-3 py-1.5`}>
                            <Plus className="h-4 w-4" />
                            Add line
                        </button>
                    </div>

                    <div className="space-y-3">
                        {rows.map((r, index) => {
                            const warn = shortage(r);
                            return (
                                <div key={r.key} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 md:grid-cols-12">
                                    <div className="md:col-span-5">
                                        <label htmlFor={`row-product-${r.key}`} className="sr-only">Product, line {index + 1}</label>
                                        <select
                                            id={`row-product-${r.key}`}
                                            className={inputCls}
                                            value={r.product_id}
                                            onChange={(e) => chooseProduct(r.key, e.target.value)}
                                        >
                                            <option value="">— Free-text line (service / manual) —</option>
                                            {products.map((p) => (
                                                <option key={p.id} value={p.id}>
                                                    {p.sku ? `${p.sku} · ` : ''}
                                                    {p.name} (in stock: {formatQty(p.qty_in_stock)} {p.unit})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="md:col-span-7">
                                        <label htmlFor={`row-desc-${r.key}`} className="sr-only">Description, line {index + 1}</label>
                                        <input
                                            id={`row-desc-${r.key}`}
                                            className={inputCls}
                                            value={r.description}
                                            maxLength={255}
                                            placeholder="Description"
                                            onChange={(e) => patchRow(r.key, { description: e.target.value })}
                                        />
                                    </div>

                                    <div className="flex items-center gap-2 md:col-span-3">
                                        <label htmlFor={`row-qty-${r.key}`} className="sr-only">Quantity, line {index + 1}</label>
                                        <input
                                            id={`row-qty-${r.key}`}
                                            inputMode="decimal"
                                            className={`${inputCls} text-right font-mono`}
                                            value={r.quantity}
                                            onChange={(e) => patchRow(r.key, { quantity: e.target.value })}
                                        />
                                        <input
                                            aria-label={`Unit, line ${index + 1}`}
                                            list="ct-units"
                                            className={`${inputCls} w-20`}
                                            value={r.unit}
                                            maxLength={20}
                                            onChange={(e) => patchRow(r.key, { unit: e.target.value })}
                                        />
                                    </div>
                                    <div className="md:col-span-3">
                                        <label htmlFor={`row-price-${r.key}`} className="sr-only">Unit price, line {index + 1}</label>
                                        <input
                                            id={`row-price-${r.key}`}
                                            inputMode="decimal"
                                            className={`${inputCls} text-right font-mono`}
                                            value={r.unit_price}
                                            onChange={(e) => patchRow(r.key, { unit_price: e.target.value })}
                                        />
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

                                    {warn ? (
                                        <p className="flex items-center gap-1.5 text-xs text-amber-400 md:col-span-12">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            {warn}
                                        </p>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>

                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                        <input
                            type="checkbox"
                            checked={deduct}
                            onChange={(e) => setDeduct(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 accent-indigo-500"
                        />
                        <span className="text-sm">
                            <span className="font-medium text-slate-200">Deduct from inventory automatically</span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                                Quantities of the selected inventory products are deducted in one transaction. If stock is insufficient,
                                the contract is not saved.
                                {editing ? ' When editing, the previous deductions are first returned to inventory.' : ''}
                            </span>
                        </span>
                    </label>
                </section>

                <datalist id="ct-units">
                    {UNITS.map((u) => (
                        <option key={u} value={u} />
                    ))}
                </datalist>

                {/* Recurring billing */}
                <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-200">Recurring invoices</h3>
                            <p className="mt-0.5 text-xs text-slate-500">
                                For rentals, subscriptions or maintenance: an invoice with the contract lines is issued automatically every period.
                            </p>
                        </div>
                        <select
                            aria-label="Billing period"
                            className={`${inputCls} w-auto`}
                            value={billingMonths}
                            onChange={(e) => {
                                const m = Number(e.target.value);
                                setBillingMonths(m);
                                if (m > 0 && !billingStart) setBillingStart(startDate > today ? startDate : today);
                            }}
                        >
                            {BILLING_OPTIONS.map((o) => (
                                <option key={o.months} value={o.months}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                    {billingMonths > 0 ? (
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div>
                                <label htmlFor="ct-bill-start" className={labelCls}>Next invoice on</label>
                                <input id="ct-bill-start" type="date" className={inputCls} value={billingStart} min={today}
                                    onChange={(e) => setBillingStart(e.target.value)} />
                            </div>
                            <div>
                                <label htmlFor="ct-bill-due" className={labelCls}>Payment term (days)</label>
                                <input id="ct-bill-due" type="number" inputMode="numeric" min={0} max={365} className={inputCls}
                                    value={billingDueDays} onChange={(e) => setBillingDueDays(e.target.value)} />
                            </div>
                            <div>
                                <label htmlFor="ct-bill-vat" className={labelCls}>VAT rate (%)</label>
                                <input id="ct-bill-vat" type="number" min={0} max={100} step={0.01} list="ct-vat-rates" className={inputCls}
                                    value={billingVat} onChange={(e) => setBillingVat(e.target.value === '' ? 0 : Number(e.target.value))} />
                                <datalist id="ct-vat-rates">
                                    {VAT_RATE_SUGGESTIONS.map((v) => (
                                        <option key={v} value={v} />
                                    ))}
                                </datalist>
                            </div>
                            {billingVat === 0 ? (
                                <div className="sm:col-span-3">
                                    <label htmlFor="ct-bill-vat-reason" className={labelCls}>VAT exemption note</label>
                                    <input id="ct-bill-vat-reason" list="ct-vat-reasons" className={inputCls} value={billingVatReason} maxLength={255}
                                        onChange={(e) => setBillingVatReason(e.target.value)} />
                                    <datalist id="ct-vat-reasons">
                                        {VAT_EXEMPT_REASONS.map((r) => (
                                            <option key={r} value={r} />
                                        ))}
                                    </datalist>
                                </div>
                            ) : null}
                            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300 sm:col-span-3">
                                <input type="checkbox" checked={billingAutoEmail} onChange={(e) => setBillingAutoEmail(e.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 accent-indigo-500" />
                                <span>
                                    Email the invoice to the client automatically
                                    <span className="block text-xs text-slate-500">
                                        {selectedClient?.email ? `To ${selectedClient.email}.` : 'The client has no email — add it under Clients.'}
                                    </span>
                                </span>
                            </label>
                            <p className="text-xs text-slate-500 sm:col-span-3">
                                Amount per period: <span className="font-mono text-slate-300">{formatMoney(total, currency)}</span> excl. VAT.
                                {endDate ? ` Invoices are issued until the contract ends (${formatDate(endDate)}).` : ' No end date — until the contract is completed.'}
                                {' '}Each invoice carries its issue date and the next number in the main series; the period is stated on it. The VAT rate also applies to &quot;Issue invoice&quot;.
                            </p>
                        </div>
                    ) : null}
                </section>

                <div>
                    <label htmlFor="ct-notes" className={labelCls}>Notes</label>
                    <textarea id="ct-notes" rows={2} className={inputCls} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
                </div>

                {/* Contract text */}
                <section>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-200">Contract text</h3>
                        <div className="flex flex-wrap items-center gap-2">
                            {template && bodyEdited && bodyText !== generated ? (
                                <button type="button" onClick={() => setBodyEdited(false)} className={`${btnSecondary} px-2.5 py-1 text-xs`}>
                                    Regenerate from template
                                </button>
                            ) : null}
                            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5" role="tablist" aria-label="Text view">
                                {(
                                    [
                                        ['edit', 'Edit', Pencil],
                                        ['preview', 'Preview', Eye],
                                    ] as const
                                ).map(([id, label, Icon]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        role="tab"
                                        aria-selected={bodyView === id}
                                        onClick={() => setBodyView(id)}
                                        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                                            bodyView === id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-100'
                                        }`}
                                    >
                                        <Icon className="h-3.5 w-3.5" />
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {bodyView === 'edit' ? (
                        <>
                            <label htmlFor="ct-body" className="sr-only">Contract text</label>
                            <textarea
                                id="ct-body"
                                rows={12}
                                lang="en"
                                className={`${inputCls} font-mono text-[13px] leading-relaxed`}
                                value={effectiveBody}
                                placeholder={'Choose a template above or type the text here.\n# Title · ## Section · **bold** · blank line = new paragraph'}
                                onChange={(e) => {
                                    setBodyText(e.target.value);
                                    setBodyEdited(true);
                                }}
                            />
                        </>
                    ) : effectiveBody.trim() ? (
                        <div className="max-h-[28rem] overflow-y-auto rounded-lg bg-slate-950 p-3">
                            <div className="mx-auto max-w-[210mm] rounded bg-white p-6">
                                <ContractDocument
                                    text={effectiveBody}
                                    items={docItems}
                                    currency={currency}
                                    compact
                                    signatures={[
                                        { role: companyRole, name: company.name, person: company.representative },
                                        { role: clientRole, name: selectedClient?.name ?? '', person: selectedClient?.representative ?? '' },
                                    ]}
                                />
                            </div>
                        </div>
                    ) : (
                        <p className="rounded-lg border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">No text to preview.</p>
                    )}

                    <div className="mt-1.5 space-y-1 text-xs">
                        {template && !bodyEdited ? (
                            <p className="text-slate-500">The text updates automatically as you fill in the form. You can edit it for this contract only.</p>
                        ) : null}
                        {template && bodyEdited && bodyText !== generated ? (
                            <p className="text-amber-400/90">The text was edited by hand and no longer follows the form. &quot;Regenerate from template&quot; rebuilds it.</p>
                        ) : null}
                        {emptyFieldCount > 0 ? (
                            <p className="flex items-center gap-1.5 text-amber-400">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {emptyFieldCount} {emptyFieldCount === 1 ? 'field is empty' : 'fields are empty'} (&quot;………………&quot;) — fill in the client/company details or leave them to complete by hand.
                            </p>
                        ) : null}
                    </div>
                </section>

                {!editing ? (
                    <div>
                        <span className={labelCls}>Signed contract (PDF or image, up to 15 MB)</span>
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
                    <p className="text-xs text-slate-500">The contract file is managed from the table (Attach / Replace / View).</p>
                )}
            </form>
        </Modal>
    );
}
