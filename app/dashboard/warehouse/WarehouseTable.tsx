'use client';

import { UNITS } from '@/app/lib/labels';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { AlertTriangle, Minus, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Modal } from '@/app/components/ui/Modal';
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
import { formatMoney, formatQty, parseDecimal, round } from '@/app/lib/format';
import type { Product, ProductInput } from '@/app/lib/types';
import {
    adjustProductQuantity,
    createProduct,
    deleteProduct,
    setProductPrice,
    setProductQuantity,
    updateProduct,
} from './actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type StockStatus = 'out' | 'critical' | 'ok';

function stockStatus(p: Product): StockStatus {
    if (p.qty_in_stock <= 0) return 'out';
    if (p.qty_in_stock <= p.min_stock_level) return 'critical';
    return 'ok';
}

function sortProducts(list: Product[]): Product[] {
    return [...list].sort(
        (a, b) => a.category.localeCompare(b.category, 'en') || a.name.localeCompare(b.name, 'en'),
    );
}

const UNIT_SUGGESTIONS = UNITS;

interface FormState {
    sku: string;
    name: string;
    category: string;
    unit: string;
    qty: string;
    min: string;
    price: string;
}

const EMPTY_FORM: FormState = { sku: '', name: '', category: '', unit: 'pcs', qty: '0', min: '0', price: '0' };

function formFromProduct(p: Product): FormState {
    return {
        sku: p.sku,
        name: p.name,
        category: p.category,
        unit: p.unit,
        qty: String(p.qty_in_stock),
        min: String(p.min_stock_level),
        price: String(p.unit_price),
    };
}

// ---------------------------------------------------------------------------
// Inline click-to-edit number
// ---------------------------------------------------------------------------
interface InlineNumberProps {
    value: number;
    display: string;
    ariaLabel: string;
    onCommit: (next: number) => void;
    onInvalid: () => void;
    inputClassName?: string;
}

function InlineNumber({ value, display, ariaLabel, onCommit, onInvalid, inputClassName = 'w-20' }: InlineNumberProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const finished = useRef(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (editing) inputRef.current?.select();
    }, [editing]);

    function start() {
        finished.current = false;
        setDraft(String(value));
        setEditing(true);
    }

    function finish(save: boolean) {
        if (finished.current) return;
        finished.current = true;
        setEditing(false);
        if (!save) return;

        const parsed = parseDecimal(draft);
        if (parsed === null) {
            onInvalid();
            return;
        }
        if (parsed !== value) onCommit(parsed);
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
    }

    if (editing) {
        return (
            <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={draft}
                aria-label={ariaLabel}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finish(true)}
                onKeyDown={onKeyDown}
                className={`rounded-md border border-indigo-500 bg-slate-950 px-2 py-1 text-right font-mono text-sm text-slate-100 outline-none ring-1 ring-indigo-500 ${inputClassName}`}
            />
        );
    }

    return (
        <button
            type="button"
            onClick={start}
            title="Click to edit"
            aria-label={`${ariaLabel}: ${display}. Click to edit`}
            className="rounded-md px-2 py-1 font-mono text-sm text-slate-100 transition-colors hover:bg-slate-800 hover:ring-1 hover:ring-slate-700"
        >
            {display}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface WarehouseTableProps {
    initialProducts: Product[];
    currency: string;
    initialCritical: boolean;
}

export default function WarehouseTable({ initialProducts, currency, initialCritical }: WarehouseTableProps) {
    const toast = useToast();
    const confirm = useConfirm();

    const [products, setProducts] = useState<Product[]>(initialProducts);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');
    const [onlyCritical, setOnlyCritical] = useState(initialCritical);

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Product | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Requests "in flight" per product (for safe +/- on rapid clicks)
    const pending = useRef<Map<number, number>>(new Map());

    const categories = useMemo(
        () => Array.from(new Set(products.map((p) => p.category))).sort((a, b) => a.localeCompare(b, 'en')),
        [products],
    );

    const criticalCount = useMemo(() => products.filter((p) => stockStatus(p) !== 'ok').length, [products]);
    const totalValue = useMemo(() => products.reduce((sum, p) => sum + p.qty_in_stock * p.unit_price, 0), [products]);

    const visible = useMemo(() => {
        const q = search.trim().toLocaleLowerCase();
        return products.filter((p) => {
            if (category !== 'all' && p.category !== category) return false;
            if (onlyCritical && stockStatus(p) === 'ok') return false;
            if (!q) return true;
            return p.sku.toLocaleLowerCase().includes(q) || p.name.toLocaleLowerCase().includes(q);
        });
    }, [products, search, category, onlyCritical]);

    function patchLocal(id: number, patch: Partial<Product>) {
        setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    }

    // --- +/- ---------------------------------------------------------------
    async function changeQty(product: Product, delta: number) {
        if (product.qty_in_stock + delta < 0) return;
        const id = product.id;

        pending.current.set(id, (pending.current.get(id) ?? 0) + 1);
        setProducts((prev) =>
            prev.map((p) => (p.id === id ? { ...p, qty_in_stock: round(p.qty_in_stock + delta, 3) } : p)),
        );

        const res = await adjustProductQuantity(id, delta);

        const left = (pending.current.get(id) ?? 1) - 1;
        if (left <= 0) pending.current.delete(id);
        else pending.current.set(id, left);

        if (!res.ok) {
            setProducts((prev) =>
                prev.map((p) => (p.id === id ? { ...p, qty_in_stock: round(p.qty_in_stock - delta, 3) } : p)),
            );
            toast.error('Failed to change the stock level', res.error);
            return;
        }
        if (left <= 0) patchLocal(id, { qty_in_stock: res.data.qty_in_stock });
    }

    // --- Inline editing --------------------------------------------------
    async function commitQty(product: Product, next: number) {
        const previous = product.qty_in_stock;
        const value = round(next, 3);
        patchLocal(product.id, { qty_in_stock: value });

        const res = await setProductQuantity(product.id, value);
        if (!res.ok) {
            patchLocal(product.id, { qty_in_stock: previous });
            toast.error('Failed to change the quantity', res.error);
            return;
        }
        patchLocal(product.id, { qty_in_stock: res.data.qty_in_stock });
        toast.success('Quantity updated', `${product.name}: ${formatQty(res.data.qty_in_stock)} ${product.unit}`);
    }

    async function commitPrice(product: Product, next: number) {
        const previous = product.unit_price;
        const value = round(next, 2);
        patchLocal(product.id, { unit_price: value });

        const res = await setProductPrice(product.id, value);
        if (!res.ok) {
            patchLocal(product.id, { unit_price: previous });
            toast.error('Failed to change the price', res.error);
            return;
        }
        patchLocal(product.id, { unit_price: res.data.unit_price });
        toast.success('Price updated', `${product.name}: ${formatMoney(res.data.unit_price, currency)}`);
    }

    function invalidNumber() {
        toast.warning('Invalid value', 'Enter a non-negative number, e.g. 12.50.');
    }

    // --- Modal: add / edit ---------------------------------------
    function openCreate() {
        setEditing(null);
        setForm(EMPTY_FORM);
        setFormError(null);
        setModalOpen(true);
    }

    function openEdit(product: Product) {
        setEditing(product);
        setForm(formFromProduct(product));
        setFormError(null);
        setModalOpen(true);
    }

    function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        if (!form.sku.trim() || !form.name.trim()) {
            setFormError('SKU and name are required.');
            return;
        }
        const qty = parseDecimal(form.qty);
        const min = parseDecimal(form.min);
        const price = parseDecimal(form.price);
        if (qty === null || min === null || price === null) {
            setFormError('Stock, minimum stock and price must be non-negative numbers (e.g. 12.50).');
            return;
        }

        const input: ProductInput = {
            sku: form.sku.trim(),
            name: form.name.trim(),
            category: form.category.trim() || 'General',
            unit: form.unit.trim() || 'pcs',
            qty_in_stock: qty,
            min_stock_level: min,
            unit_price: price,
        };

        setSaving(true);
        setFormError(null);
        const res = editing ? await updateProduct(editing.id, input) : await createProduct(input);
        setSaving(false);

        if (!res.ok) {
            setFormError(res.error);
            return;
        }

        const saved = res.data;
        setProducts((prev) =>
            sortProducts(editing ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]),
        );
        setModalOpen(false);
        toast.success(editing ? 'Product updated' : 'Product added', saved.name);
    }

    // --- Delete ---------------------------------------------------------
    async function handleDelete(product: Product) {
        const ok = await confirm({
            title: 'Delete product?',
            message: (
                <>
                    Product <strong className="text-slate-100">{product.name}</strong> ({product.sku || 'no SKU'}) will be
                    removed from inventory. Its lines on existing contracts and invoices are kept as text.
                </>
            ),
            confirmLabel: 'Delete',
            tone: 'danger',
        });
        if (!ok) return;

        const res = await deleteProduct(product.id);
        if (!res.ok) {
            toast.error('Delete failed', res.error);
            return;
        }
        setProducts((prev) => prev.filter((p) => p.id !== product.id));
        toast.success('Product deleted', product.name);
    }

    // -----------------------------------------------------------------------
    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="grid gap-4 sm:grid-cols-3">
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Products</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-slate-100">{products.length}</p>
                </div>
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Inventory value</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-slate-100">{formatMoney(totalValue, currency)}</p>
                </div>
                <div className={`${cardCls} p-4`}>
                    <p className="text-xs text-slate-400">Low stock</p>
                    <p className={`mt-1 font-mono text-xl font-semibold ${criticalCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {criticalCount}
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className={`${cardCls} flex flex-wrap items-center gap-3 p-4`}>
                <div className="relative min-w-56 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by SKU or name…"
                        className={`${inputCls} pl-9`}
                    />
                </div>

                <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    aria-label="Category"
                    className={`${inputCls} w-auto min-w-44`}
                >
                    <option value="all">All categories</option>
                    {categories.map((c) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </select>

                <button
                    type="button"
                    onClick={() => setOnlyCritical((v) => !v)}
                    aria-pressed={onlyCritical}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        onlyCritical
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                            : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                >
                    <AlertTriangle className="h-4 w-4" />
                    Low stock
                    <span className="font-mono text-xs">({criticalCount})</span>
                </button>

                <button type="button" onClick={openCreate} className={btnPrimary}>
                    <Plus className="h-4 w-4" />
                    Add product
                </button>
            </div>

            {/* Table */}
            <div className={`${cardCls} overflow-hidden`}>
                <div className="overflow-x-auto [contain:paint]">
                    <table className="w-full min-w-[56rem] text-sm">
                        <thead className="border-b border-slate-800 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">SKU</th>
                                <th className="px-4 py-3 text-left font-medium">Product</th>
                                <th className="px-4 py-3 text-center font-medium">In stock</th>
                                <th className="px-4 py-3 text-right font-medium">Min.</th>
                                <th className="px-4 py-3 text-right font-medium">Unit price</th>
                                <th className="px-4 py-3 text-right font-medium">Value</th>
                                <th className="px-4 py-3 text-left font-medium">Status</th>
                                <th className="px-4 py-3 text-right font-medium">
                                    <span className="sr-only">Actions</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {visible.map((p) => {
                                const status = stockStatus(p);
                                return (
                                    <tr
                                        key={p.id}
                                        className={`transition-colors hover:bg-slate-800/40 ${status === 'ok' ? '' : 'bg-amber-500/5'}`}
                                    >
                                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.sku || '—'}</td>
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-slate-100">{p.name}</p>
                                            <span className={`${badgeSlate} mt-1`}>{p.category}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => changeQty(p, -1)}
                                                    disabled={p.qty_in_stock <= 0}
                                                    aria-label={`Decrease stock of ${p.name}`}
                                                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
                                                >
                                                    <Minus className="h-3.5 w-3.5" />
                                                </button>
                                                <InlineNumber
                                                    value={p.qty_in_stock}
                                                    display={formatQty(p.qty_in_stock)}
                                                    ariaLabel={`Stock of ${p.name}`}
                                                    onCommit={(next) => commitQty(p, next)}
                                                    onInvalid={invalidNumber}
                                                    inputClassName="w-20"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => changeQty(p, 1)}
                                                    aria-label={`Increase stock of ${p.name}`}
                                                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition-colors hover:bg-slate-700"
                                                >
                                                    <Plus className="h-3.5 w-3.5" />
                                                </button>
                                                <span className="ml-1 w-10 text-xs text-slate-500">{p.unit}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-400">{formatQty(p.min_stock_level)}</td>
                                        <td className="px-4 py-3 text-right">
                                            <InlineNumber
                                                value={p.unit_price}
                                                display={formatMoney(p.unit_price, currency)}
                                                ariaLabel={`Unit price of ${p.name}`}
                                                onCommit={(next) => commitPrice(p, next)}
                                                onInvalid={invalidNumber}
                                                inputClassName="w-28"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-200">
                                            {formatMoney(p.qty_in_stock * p.unit_price, currency)}
                                        </td>
                                        <td className="px-4 py-3">
                                            {status === 'out' ? (
                                                <span className={badgeRose}>Out of stock</span>
                                            ) : status === 'critical' ? (
                                                <span className={badgeAmber}>Low</span>
                                            ) : (
                                                <span className={badgeEmerald}>In stock</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-end gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(p)}
                                                    aria-label={`Edit ${p.name}`}
                                                    className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(p)}
                                                    aria-label={`Delete ${p.name}`}
                                                    className="rounded-md p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
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
                        <Package className="h-10 w-10 text-slate-600" />
                        <p className="text-sm text-slate-400">
                            {products.length === 0
                                ? 'Your inventory is empty. Add your first product.'
                                : 'No products match the filters.'}
                        </p>
                        {products.length === 0 ? (
                            <button type="button" onClick={openCreate} className={btnPrimary}>
                                <Plus className="h-4 w-4" />
                                Add product
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <p className="text-xs text-slate-500">
                Showing {visible.length} of {products.length} products.
            </p>

            {/* Modal: add / edit */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editing ? 'Edit product' : 'New product'}
                description={editing ? editing.name : 'Fill in the product details.'}
                size="lg"
                busy={saving}
                footer={
                    <>
                        <button type="button" className={btnSecondary} onClick={() => setModalOpen(false)} disabled={saving}>
                            Cancel
                        </button>
                        <button type="submit" form="product-form" className={btnPrimary} disabled={saving}>
                            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}
                        </button>
                    </>
                }
            >
                <form id="product-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
                    {formError ? (
                        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300 sm:col-span-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            {formError}
                        </div>
                    ) : null}

                    <div>
                        <label htmlFor="p-sku" className={labelCls}>SKU *</label>
                        <input id="p-sku" className={`${inputCls} font-mono`} value={form.sku} maxLength={50} onChange={(e) => setField('sku', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="p-category" className={labelCls}>Category</label>
                        <input id="p-category" list="p-category-list" className={inputCls} value={form.category} maxLength={100} placeholder="General" onChange={(e) => setField('category', e.target.value)} />
                        <datalist id="p-category-list">
                            {categories.map((c) => (
                                <option key={c} value={c} />
                            ))}
                        </datalist>
                    </div>

                    <div className="sm:col-span-2">
                        <label htmlFor="p-name" className={labelCls}>Name *</label>
                        <input id="p-name" className={inputCls} value={form.name} maxLength={255} onChange={(e) => setField('name', e.target.value)} />
                    </div>

                    <div>
                        <label htmlFor="p-unit" className={labelCls}>Unit</label>
                        <input id="p-unit" list="p-unit-list" className={inputCls} value={form.unit} maxLength={20} onChange={(e) => setField('unit', e.target.value)} />
                        <datalist id="p-unit-list">
                            {UNIT_SUGGESTIONS.map((u) => (
                                <option key={u} value={u} />
                            ))}
                        </datalist>
                    </div>
                    <div>
                        <label htmlFor="p-price" className={labelCls}>Unit price ({currency})</label>
                        <input id="p-price" inputMode="decimal" className={`${inputCls} text-right font-mono`} value={form.price} onChange={(e) => setField('price', e.target.value)} />
                    </div>

                    <div>
                        <label htmlFor="p-qty" className={labelCls}>In stock</label>
                        <input id="p-qty" inputMode="decimal" className={`${inputCls} text-right font-mono`} value={form.qty} onChange={(e) => setField('qty', e.target.value)} />
                    </div>
                    <div>
                        <label htmlFor="p-min" className={labelCls}>Minimum stock</label>
                        <input id="p-min" inputMode="decimal" className={`${inputCls} text-right font-mono`} value={form.min} onChange={(e) => setField('min', e.target.value)} />
                    </div>
                </form>
            </Modal>
        </div>
    );
}
