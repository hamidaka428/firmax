'use client';

import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    AlertTriangle,
    ArrowRight,
    Check,
    CheckCircle2,
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
    Trash2,
    Upload,
    X,
} from 'lucide-react';
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
} from '@/app/components/ui/styles';
import { contractValidity, formatDate, formatMoney, round } from '@/app/lib/format';
import type { Validity } from '@/app/lib/format';
import type { ClientOption, Contract, ContractTemplate, ProductOption, StockUpdate } from '@/app/lib/types';
import type { TemplateCompany } from '@/app/lib/contract-template';
import {
    createInvoiceFromContract,
    deleteContract,
    removeContractFile,
    setContractStatus,
    uploadContractFile,
} from './actions';
import ContractFormModal from './ContractFormModal';
import SendContractModal from './SendContractModal';
import type { ContractSaved } from './ContractFormModal';
import FilePreviewModal, { fileUrl } from './FilePreviewModal';
import { billingShort } from '@/app/lib/recurring-options';
import { CONTRACT_TYPE_LABEL } from '@/app/lib/labels';

type Tab = 'all' | 'active' | 'soon' | 'expired' | 'closed';

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function validityBadge(v: Validity): { cls: string; icon: 'clock' | 'alert' | null } {
    switch (v.kind) {
        case 'expired':
            return { cls: badgeRose, icon: 'alert' };
        case 'soon':
            return { cls: badgeAmber, icon: 'clock' };
        case 'closed':
            return { cls: badgeSlate, icon: null };
        default:
            return { cls: badgeEmerald, icon: null };
    }
}

function matchesTab(v: Validity, tab: Tab): boolean {
    switch (tab) {
        case 'all':
            return true;
        case 'active':
            return v.kind === 'indefinite' || v.kind === 'valid' || v.kind === 'soon';
        case 'soon':
            return v.kind === 'soon';
        case 'expired':
            return v.kind === 'expired';
        case 'closed':
            return v.kind === 'closed';
    }
}

/** Next number in the form CT-YYYY-0001 for the current year. */
function suggestNumber(contracts: Contract[], year: string): string {
    const prefix = `CT-${year}-`;
    let max = 0;
    for (const c of contracts) {
        if (c.contract_number.startsWith(prefix)) {
            const n = Number.parseInt(c.contract_number.slice(prefix.length), 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
    }
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

interface ContractsViewProps {
    initialContracts: Contract[];
    clients: ClientOption[];
    initialProducts: ProductOption[];
    templates: ContractTemplate[];
    company: TemplateCompany;
    currency: string;
    today: string;
    initialTab: Tab;
    /** Opens the new-contract form straight away (from "New contract" on the Templates page). */
    openNew: boolean;
    initialTemplateId: number | null;
    origin: string;
}

export default function ContractsView({
    initialContracts,
    clients,
    initialProducts,
    templates,
    company,
    currency,
    today,
    initialTab,
    openNew,
    initialTemplateId,
    origin,
}: ContractsViewProps) {
    const router = useRouter();
    const toast = useToast();
    const confirm = useConfirm();

    const [contracts, setContracts] = useState<Contract[]>(initialContracts);
    const [products, setProducts] = useState<ProductOption[]>(initialProducts);
    const [tab, setTab] = useState<Tab>(initialTab);
    const [search, setSearch] = useState('');
    const [sending, setSending] = useState<Contract | null>(null);

    const [formOpen, setFormOpen] = useState(openNew);
    const [startTemplateId, setStartTemplateId] = useState<number | null>(openNew ? initialTemplateId : null);
    const [editing, setEditing] = useState<Contract | null>(null);
    const [preview, setPreview] = useState<Contract | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const uploadTarget = useRef<number | null>(null);

    const withValidity = useMemo(
        () => contracts.map((c) => ({ contract: c, validity: contractValidity(c.end_date, c.status, today) })),
        [contracts, today],
    );

    const counts = useMemo(() => {
        const base: Record<Tab, number> = { all: 0, active: 0, soon: 0, expired: 0, closed: 0 };
        for (const { validity } of withValidity) {
            (Object.keys(base) as Tab[]).forEach((t) => {
                if (matchesTab(validity, t)) base[t]++;
            });
        }
        return base;
    }, [withValidity]);

    const visible = useMemo(() => {
        const q = search.trim().toLocaleLowerCase();
        return withValidity.filter(({ contract, validity }) => {
            if (!matchesTab(validity, tab)) return false;
            if (!q) return true;
            return [contract.contract_number, contract.title, contract.client_name].some((v) =>
                v.toLocaleLowerCase().includes(q),
            );
        });
    }, [withValidity, tab, search]);

    const tabs: { id: Tab; label: string }[] = [
        { id: 'all', label: 'All' },
        { id: 'active', label: 'Active' },
        { id: 'soon', label: 'Expiring soon (≤ 14 days)' },
        { id: 'expired', label: 'Expired' },
        { id: 'closed', label: 'Completed' },
    ];

    function applyStock(updates: StockUpdate[]) {
        if (updates.length === 0) return;
        const map = new Map(updates.map((u) => [u.id, u.qty_in_stock]));
        setProducts((prev) => prev.map((p) => (map.has(p.id) ? { ...p, qty_in_stock: map.get(p.id) as number } : p)));
    }

    function patchContract(id: number, patch: Partial<Contract>) {
        setContracts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    }

    // --- Form -------------------------------------------------------------
    function openCreate() {
        setEditing(null);
        setStartTemplateId(null);
        setFormOpen(true);
    }

    function closeForm() {
        setFormOpen(false);
        // remove ?new=1&template=… from the URL so it doesn't reopen on refresh
        if (openNew) router.replace('/dashboard/contracts', { scroll: false });
    }

    function openEdit(contract: Contract) {
        setEditing(contract);
        setFormOpen(true);
    }

    function handleSaved({ contract, stock, wasEdit, fileWarning, generated }: ContractSaved) {
        setContracts((prev) => (wasEdit ? prev.map((c) => (c.id === contract.id ? contract : c)) : [contract, ...prev]));
        applyStock(stock);
        closeForm();
        toast.success(wasEdit ? 'Contract updated' : 'Contract created', `${contract.contract_number} · ${contract.title}`);
        if (fileWarning) toast.warning('Contract saved, but the file was not uploaded', fileWarning);
        if (generated.length) {
            toast.success(
                generated.length === 1 ? `Recurring invoice no. ${generated[0]} issued` : `${generated.length} recurring invoices issued`,
                'See the Invoices section.',
            );
        }
    }

    // --- Status ------------------------------------------------------------
    async function toggleStatus(contract: Contract) {
        const next = contract.status === 'active' ? 'completed' : 'active';
        setBusyId(contract.id);
        const res = await setContractStatus(contract.id, next);
        setBusyId(null);
        if (!res.ok) {
            toast.error('Failed to change the status', res.error);
            return;
        }
        patchContract(contract.id, { status: next });
        toast.success(next === 'completed' ? 'Contract completed' : 'Contract reactivated', contract.contract_number);
    }

    // --- Delete ---------------------------------------------------------
    async function handleDelete(contract: Contract) {
        const ok = await confirm({
            title: 'Delete contract?',
            message: (
                <>
                    Contract <strong className="text-slate-100">{contract.contract_number}</strong> ({contract.title}) will be deleted
                    together with the attached file.
                    {contract.deducted_count > 0 ? ' Quantities deducted from inventory will be returned.' : ''}
                    {contract.invoice_count > 0 ? ' Issued invoices are kept.' : ''}
                </>
            ),
            confirmLabel: 'Delete',
            tone: 'danger',
        });
        if (!ok) return;

        setBusyId(contract.id);
        const res = await deleteContract(contract.id);
        setBusyId(null);
        if (!res.ok) {
            toast.error('Delete failed', res.error);
            return;
        }
        setContracts((prev) => prev.filter((c) => c.id !== contract.id));
        applyStock(res.data.stock);
        toast.success('Contract deleted', contract.contract_number);
    }

    // --- Files -----------------------------------------------------------
    function pickFile(contract: Contract) {
        uploadTarget.current = contract.id;
        fileInputRef.current?.click();
    }

    async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
        const file = e.currentTarget.files?.[0] ?? null;
        e.currentTarget.value = ''; // allows choosing the same file again
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
        const res = await uploadContractFile(id, fd);
        setBusyId(null);

        if (!res.ok) {
            toast.error('Failed to upload the file', res.error);
            return;
        }
        patchContract(id, { file_path: res.data.file_path, file_name: res.data.file_name });
        toast.success('File uploaded', res.data.file_name);
    }

    async function handleRemoveFile(contract: Contract) {
        const ok = await confirm({
            title: 'Remove file?',
            message: (
                <>
                    The file <strong className="text-slate-100">{contract.file_name}</strong> will be deleted from the server. The contract is kept.
                </>
            ),
            confirmLabel: 'Remove',
            tone: 'danger',
        });
        if (!ok) return;

        setBusyId(contract.id);
        const res = await removeContractFile(contract.id);
        setBusyId(null);
        if (!res.ok) {
            toast.error('Remove failed', res.error);
            return;
        }
        patchContract(contract.id, { file_path: null, file_name: null });
        toast.success('File removed', contract.contract_number);
    }

    // --- Issue invoice -----------------------------------------------------
    async function handleInvoice(contract: Contract) {
        const vatRate = contract.billing_vat_rate;
        const vat = round((contract.total_price * vatRate) / 100, 2);
        const ok = await confirm({
            title: 'Issue invoice',
            message: (
                <div className="space-y-2">
                    <p>
                        An invoice will be issued to <strong className="text-slate-100">{contract.client_name}</strong> under contract{' '}
                        <span className="font-mono">{contract.contract_number}</span> with the contract lines:
                    </p>
                    <p className="rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
                        Net {formatMoney(contract.total_price, currency)} + VAT {vatRate}% {formatMoney(vat, currency)} ={' '}
                        <span className="text-slate-100">{formatMoney(round(contract.total_price + vat, 2), currency)}</span>
                    </p>
                    {contract.invoice_count > 0 ? (
                        <p className="text-amber-400">
                            Note: {contract.invoice_count} invoice(s) have already been issued under this contract.
                        </p>
                    ) : null}
                    <p className="text-xs text-slate-500">Payment term: 14 days. You can edit it in the Invoices section.</p>
                </div>
            ),
            confirmLabel: 'Issue invoice',
            tone: 'primary',
        });
        if (!ok) return;

        setBusyId(contract.id);
        const res = await createInvoiceFromContract(contract.id);
        setBusyId(null);
        if (!res.ok) {
            toast.error('Failed to issue the invoice', res.error);
            return;
        }
        patchContract(contract.id, { invoice_count: contract.invoice_count + 1 });
        toast.success(`Invoice no. ${res.data.invoice_number} issued`, formatMoney(res.data.total_amount, currency));
        router.push(`/dashboard/invoices?highlight=${res.data.id}`);
    }

    // -----------------------------------------------------------------------
    return (
        <div className="space-y-4">
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/*"
                className="hidden"
                onChange={onFileChosen}
            />

            {/* Tabs */}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by validity">
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
                        placeholder="Search by number, subject or client…"
                        className={`${inputCls} pl-9`}
                    />
                </div>
                <Link href="/dashboard/contracts/templates" className={btnSecondary}>
                    <FileText className="h-4 w-4" />
                    Templates
                </Link>
                <button type="button" onClick={openCreate} className={btnPrimary}>
                    <Plus className="h-4 w-4" />
                    New contract
                </button>
            </div>

            {/* Table */}
            <div className={`${cardCls} overflow-hidden`}>
                <div className="overflow-x-auto [contain:paint]">
                    <table className="w-full min-w-[68rem] text-sm">
                        <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">Contract</th>
                                <th className="px-4 py-3 text-left font-medium">Client</th>
                                <th className="px-4 py-3 text-left font-medium">Term & validity</th>
                                <th className="px-4 py-3 text-right font-medium">Value</th>
                                <th className="px-4 py-3 text-left font-medium">File</th>
                                <th className="px-4 py-3 text-right font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {visible.map(({ contract: c, validity }) => {
                                const badge = validityBadge(validity);
                                const busy = busyId === c.id;
                                return (
                                    <tr key={c.id} className={`align-top transition-colors hover:bg-slate-800/40 ${busy ? 'opacity-60' : ''}`}>
                                        <td className="px-4 py-3">
                                            <p className="font-mono text-xs text-slate-400">{c.contract_number || '—'}</p>
                                            <p className="mt-0.5 font-medium text-slate-100">{c.title}</p>
                                            <span className={`${badgeSlate} mt-1`}>{CONTRACT_TYPE_LABEL[c.contract_type]}</span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-300">{c.client_name}</td>
                                        <td className="px-4 py-3">
                                            <p className="text-xs text-slate-400">
                                                {formatDate(c.start_date)} – {c.end_date ? formatDate(c.end_date) : '…'}
                                            </p>
                                            <span className={`${badge.cls} mt-1`}>
                                                {badge.icon === 'clock' ? <Clock className="h-3 w-3" /> : null}
                                                {badge.icon === 'alert' ? <AlertTriangle className="h-3 w-3" /> : null}
                                                {validity.label}
                                            </span>
                                            {c.billing_months > 0 ? (
                                                <p className="mt-1.5 flex items-center gap-1 text-xs text-indigo-300" title="Recurring billing">
                                                    <Receipt className="h-3 w-3 shrink-0" />
                                                    {billingShort(c.billing_months)}
                                                    {c.billing_next
                                                        ? ` · next ${formatDate(c.billing_next)}`
                                                        : c.status === 'completed'
                                                          ? ' · stopped'
                                                          : ' · all periods invoiced'}
                                                </p>
                                            ) : null}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-100">{formatMoney(c.total_price, currency)}</td>

                                        <td className="px-4 py-3">
                                            {c.file_path ? (
                                                <div className="space-y-1.5">
                                                    <p className="max-w-44 truncate text-xs text-slate-400" title={c.file_name ?? undefined}>
                                                        <FileText className="mr-1 inline h-3.5 w-3.5" />
                                                        {c.file_name}
                                                    </p>
                                                    <div className="flex gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => setPreview(c)}
                                                            title="View"
                                                            aria-label={`View the file for ${c.contract_number}`}
                                                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-indigo-300"
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </button>
                                                        <a
                                                            href={fileUrl(c.file_path, true)}
                                                            title="Download"
                                                            aria-label={`Download the file for ${c.contract_number}`}
                                                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-indigo-300"
                                                        >
                                                            <Download className="h-4 w-4" />
                                                        </a>
                                                        <button
                                                            type="button"
                                                            onClick={() => pickFile(c)}
                                                            disabled={busy}
                                                            title="Replace file"
                                                            aria-label={`Replace the file for ${c.contract_number}`}
                                                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-indigo-300 disabled:opacity-40"
                                                        >
                                                            <Upload className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveFile(c)}
                                                            disabled={busy}
                                                            title="Remove file"
                                                            aria-label={`Remove the file for ${c.contract_number}`}
                                                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => pickFile(c)}
                                                    disabled={busy}
                                                    className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:border-indigo-500/50 hover:text-indigo-300 disabled:opacity-40"
                                                >
                                                    <Paperclip className="h-3.5 w-3.5" />
                                                    Attach file
                                                </button>
                                            )}
                                        </td>

                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap items-center justify-end gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => handleInvoice(c)}
                                                    disabled={busy}
                                                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600/90 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
                                                >
                                                    <Receipt className="h-3.5 w-3.5" />
                                                    Issue invoice
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleStatus(c)}
                                                    disabled={busy}
                                                    title={c.status === 'active' ? 'Mark as completed' : 'Reactivate'}
                                                    aria-label={c.status === 'active' ? `Complete ${c.contract_number}` : `Reactivate ${c.contract_number}`}
                                                    className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-400 disabled:opacity-40"
                                                >
                                                    {c.status === 'active' ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                                                </button>
                                                {c.body ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSending(c)}
                                                        disabled={busy}
                                                        title={c.viewed_at ? 'Opened by the client' : c.sent_at ? `Sent to ${c.sent_to}` : 'Send to the client'}
                                                        aria-label={`Email ${c.contract_number}`}
                                                        className={`rounded-md p-2 transition-colors hover:bg-slate-800 disabled:opacity-40 ${
                                                            c.sent_at ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-100'
                                                        }`}
                                                    >
                                                        {c.viewed_at ? <Eye className="h-4 w-4" /> : c.sent_at ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                                                    </button>
                                                ) : null}
                                                <Link
                                                    href={`/dashboard/contracts/${c.id}/print`}
                                                    title={c.body ? 'Print contract' : 'Print (the contract has no template text yet)'}
                                                    aria-label={`Print ${c.contract_number}`}
                                                    className={`rounded-md p-2 transition-colors hover:bg-slate-800 hover:text-slate-100 ${c.body ? 'text-slate-400' : 'text-slate-600'}`}
                                                >
                                                    <Printer className="h-4 w-4" />
                                                </Link>
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(c)}
                                                    disabled={busy}
                                                    aria-label={`Edit ${c.contract_number}`}
                                                    className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(c)}
                                                    disabled={busy}
                                                    aria-label={`Delete ${c.contract_number}`}
                                                    className="rounded-md p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
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
                        <FileText className="h-10 w-10 text-slate-600" />
                        <p className="text-sm text-slate-400">
                            {contracts.length === 0 ? 'No contracts yet. Create your first one.' : 'No contracts in this filter.'}
                        </p>
                        {contracts.length === 0 ? (
                            <button type="button" onClick={openCreate} className={btnPrimary}>
                                <Plus className="h-4 w-4" />
                                New contract
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {/* New / edit (remounted on every open — clean form) */}
            {formOpen ? (
                <ContractFormModal
                    key={editing?.id ?? 'new'}
                    editing={editing}
                    clients={clients}
                    products={products}
                    templates={templates}
                    company={company}
                    initialTemplateId={editing ? null : startTemplateId}
                    currency={currency}
                    today={today}
                    suggestedNumber={suggestNumber(contracts, today.slice(0, 4))}
                    onClose={closeForm}
                    onSaved={handleSaved}
                />
            ) : null}

            {sending ? (
                <SendContractModal
                    contract={sending}
                    clientEmail={clients.find((x) => x.id === sending.client_id)?.email ?? ''}
                    companyName={company.name}
                    origin={origin}
                    onClose={() => setSending(null)}
                    onChanged={(patch) => patchContract(sending.id, patch)}
                />
            ) : null}

            <FilePreviewModal
                filePath={preview?.file_path ?? null}
                fileName={preview?.file_name ?? null}
                title={preview ? `${preview.contract_number} · ${preview.title}` : ''}
                onClose={() => setPreview(null)}
            />
        </div>
    );
}
