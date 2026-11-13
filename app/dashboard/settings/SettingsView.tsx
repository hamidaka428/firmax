'use client';

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, Building2, Check, Plus } from 'lucide-react';
import { Modal } from '@/app/components/ui/Modal';
import { useToast } from '@/app/components/ui/ToastProvider';
import { badgeEmerald, btnPrimary, btnSecondary, cardCls, inputCls, labelCls } from '@/app/components/ui/styles';
import { switchCompany } from '@/app/lib/tenant-actions';
import type { CompanyInput } from '@/app/lib/types';
import { createCompany, updateCompany } from './actions';
import LogoCard from './LogoCard';
import { CURRENCIES } from '@/app/lib/validation';

export interface CompanyOverview {
    id: number;
    name: string;
    reg_no: string;
    city: string;
    currency: string;
    invoice_seq: number;
    clients: number;
    contracts: number;
    invoices: number;
}

export const EMPTY_COMPANY: CompanyInput = {
    name: '',
    reg_no: '',
    vat_number: '',
    city: '',
    address: '',
    country: '',
    representative: '',
    phone: '',
    email: '',
    bank_name: '',
    iban: '',
    bic: '',
    currency: 'EUR',
};


export function CompanyFields({
    idPrefix,
    value,
    onChange,
}: {
    idPrefix: string;
    value: CompanyInput;
    onChange: <K extends keyof CompanyInput>(key: K, v: string) => void;
}) {
    const id = (name: string) => `${idPrefix}-${name}`;
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
                <label htmlFor={id('name')} className={labelCls}>Company name *</label>
                <input id={id('name')} className={inputCls} value={value.name} maxLength={255} onChange={(e) => onChange('name', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('reg_no')} className={labelCls}>Registration no. / Tax ID</label>
                <input id={id('reg_no')} className={`${inputCls} font-mono`} value={value.reg_no} maxLength={30} onChange={(e) => onChange('reg_no', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('vat')} className={labelCls}>VAT ID</label>
                <input id={id('vat')} className={`${inputCls} font-mono`} value={value.vat_number} maxLength={30} placeholder="e.g. DE123456789" onChange={(e) => onChange('vat_number', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('city')} className={labelCls}>City</label>
                <input id={id('city')} className={inputCls} value={value.city} maxLength={100} onChange={(e) => onChange('city', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('representative')} className={labelCls}>Representative</label>
                <input id={id('representative')} className={inputCls} value={value.representative} maxLength={150} onChange={(e) => onChange('representative', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('address')} className={labelCls}>Address</label>
                <input id={id('address')} className={inputCls} value={value.address} maxLength={255} onChange={(e) => onChange('address', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('country')} className={labelCls}>Country</label>
                <input id={id('country')} className={inputCls} value={value.country} maxLength={100} onChange={(e) => onChange('country', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('phone')} className={labelCls}>Phone</label>
                <input id={id('phone')} className={inputCls} value={value.phone} maxLength={50} onChange={(e) => onChange('phone', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('email')} className={labelCls}>Email</label>
                <input id={id('email')} type="email" className={inputCls} value={value.email} maxLength={150} onChange={(e) => onChange('email', e.target.value)} />
            </div>

            <div className="border-t border-slate-800 pt-4 sm:col-span-2">
                <h3 className="text-sm font-semibold text-slate-200">Bank details (shown on invoices)</h3>
            </div>
            <div>
                <label htmlFor={id('bank')} className={labelCls}>Bank</label>
                <input id={id('bank')} className={inputCls} value={value.bank_name} maxLength={150} onChange={(e) => onChange('bank_name', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('currency')} className={labelCls}>Currency</label>
                <input id={id('currency')} list={id('currency-list')} className={`${inputCls} font-mono uppercase`} value={value.currency} maxLength={5} onChange={(e) => onChange('currency', e.target.value)} />
                <datalist id={id('currency-list')}>
                    {CURRENCIES.map((c) => (
                        <option key={c} value={c} />
                    ))}
                </datalist>
            </div>
            <div>
                <label htmlFor={id('iban')} className={labelCls}>IBAN</label>
                <input id={id('iban')} className={`${inputCls} font-mono uppercase`} value={value.iban} maxLength={40} onChange={(e) => onChange('iban', e.target.value)} />
            </div>
            <div>
                <label htmlFor={id('bic')} className={labelCls}>BIC / SWIFT</label>
                <input id={id('bic')} className={`${inputCls} font-mono uppercase`} value={value.bic} maxLength={20} onChange={(e) => onChange('bic', e.target.value)} />
            </div>
        </div>
    );
}

interface SettingsViewProps {
    company: CompanyInput;
    activeId: number;
    companies: CompanyOverview[];
    logoUrl: string | null;
    openNew: boolean;
}

export default function SettingsView({ company, activeId, companies, openNew, logoUrl }: SettingsViewProps) {
    const toast = useToast();
    const [switching, startSwitch] = useTransition();

    const [form, setForm] = useState<CompanyInput>(company);
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [newOpen, setNewOpen] = useState(openNew);
    const [newForm, setNewForm] = useState<CompanyInput>(EMPTY_COMPANY);
    const [newError, setNewError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    function setField<K extends keyof CompanyInput>(key: K, value: string) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    function setNewField<K extends keyof CompanyInput>(key: K, value: string) {
        setNewForm((prev) => ({ ...prev, [key]: value }));
    }

    async function handleSave(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!form.name.trim()) {
            setFormError('Company name is required.');
            return;
        }
        setSaving(true);
        setFormError(null);
        const res = await updateCompany(form);
        setSaving(false);
        if (!res.ok) {
            setFormError(res.error);
            return;
        }
        toast.success('Settings saved', form.name);
    }

    async function handleCreate(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!newForm.name.trim()) {
            setNewError('Company name is required.');
            return;
        }
        setCreating(true);
        setNewError(null);
        const res = await createCompany(newForm);
        setCreating(false);
        if (!res.ok) {
            setNewError(res.error);
            return;
        }
        setNewOpen(false);
        setNewForm(EMPTY_COMPANY);
        toast.success('Company created and set as active', newForm.name);
    }

    function handleSwitch(c: CompanyOverview) {
        startSwitch(async () => {
            const res = await switchCompany(c.id);
            if (res.ok) toast.success('Company switched', c.name);
            else toast.error('Could not switch company', res.error);
        });
    }

    const active = companies.find((c) => c.id === activeId);

    return (
        <div className="space-y-6">
            <LogoCard companyName={company.name} initialLogoUrl={logoUrl} />

            {/* Active company details */}
            <section className={`${cardCls} p-6`}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-100">Company details</h2>
                        {active ? (
                            <p className="mt-0.5 text-sm text-slate-400">
                                Next invoice:{' '}
                                <span className="font-mono text-slate-200">{String(active.invoice_seq + 1).padStart(10, '0')}</span>
                            </p>
                        ) : null}
                    </div>
                </div>

                <form onSubmit={handleSave} className="space-y-5">
                    {formError ? (
                        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            {formError}
                        </div>
                    ) : null}

                    <CompanyFields idPrefix="co" value={form} onChange={setField} />

                    {form.currency.toUpperCase() !== company.currency ? (
                        <p className="flex items-start gap-2 text-xs text-amber-400">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            Changing the currency doesn&apos;t convert existing prices and invoices — it only changes how amounts are displayed.
                        </p>
                    ) : null}

                    <div className="flex justify-end">
                        <button type="submit" className={btnPrimary} disabled={saving}>
                            {saving ? 'Saving…' : 'Save changes'}
                        </button>
                    </div>
                </form>
            </section>

            {/* All companies */}
            <section className={`${cardCls} p-6`}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-slate-100">Your companies</h2>
                    <button type="button" onClick={() => setNewOpen(true)} className={btnPrimary}>
                        <Plus className="h-4 w-4" />
                        New company
                    </button>
                </div>

                <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                    {companies.map((c) => {
                        const isActive = c.id === activeId;
                        return (
                            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
                                        <Building2 className="h-4 w-4" />
                                    </span>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-slate-100">{c.name}</p>
                                        <p className="text-xs text-slate-500">
                                            <span className="font-mono">Reg. no.: {c.reg_no || '—'}</span>
                                            {c.city ? ` · ${c.city}` : ''} · {c.clients} clients · {c.contracts} contracts · {c.invoices} invoices · {c.currency}
                                        </p>
                                    </div>
                                </div>
                                {isActive ? (
                                    <span className={badgeEmerald}>
                                        <Check className="h-3 w-3" />
                                        Active
                                    </span>
                                ) : (
                                    <button type="button" className={`${btnSecondary} px-3 py-1.5`} disabled={switching} onClick={() => handleSwitch(c)}>
                                        Switch
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                    Each company&apos;s data is fully separated: clients, inventory, contracts, invoices and numbering.
                </p>
            </section>

            <Modal
                open={newOpen}
                onClose={() => setNewOpen(false)}
                title="New company"
                description="The company becomes active once created."
                size="lg"
                busy={creating}
                footer={
                    <>
                        <button type="button" className={btnSecondary} onClick={() => setNewOpen(false)} disabled={creating}>
                            Cancel
                        </button>
                        <button type="submit" form="new-company-form" className={btnPrimary} disabled={creating}>
                            {creating ? 'Creating…' : 'Create company'}
                        </button>
                    </>
                }
            >
                <form id="new-company-form" onSubmit={handleCreate} className="space-y-4">
                    {newError ? (
                        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            {newError}
                        </div>
                    ) : null}
                    <CompanyFields idPrefix="nc" value={newForm} onChange={setNewField} />
                </form>
            </Modal>
        </div>
    );
}
