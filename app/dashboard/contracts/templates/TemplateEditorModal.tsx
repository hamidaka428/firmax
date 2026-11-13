'use client';

import { useMemo, useRef, useState } from 'react';
import { CONTRACT_TYPE_LABEL } from '@/app/lib/labels';
import type { FormEvent } from 'react';
import { AlertTriangle, Eye, Pencil } from 'lucide-react';
import { Modal } from '@/app/components/ui/Modal';
import { btnPrimary, btnSecondary, inputCls, labelCls } from '@/app/components/ui/styles';
import ContractDocument from '@/app/components/ContractDocument';
import {
    PARTY_ROLES,
    TEMPLATE_FIELD_GROUPS,
    endDateForMonths,
    renderTemplate,
    unknownFields,
} from '@/app/lib/contract-template';
import type { TemplateCompany, TemplateParty } from '@/app/lib/contract-template';
import { CONTRACT_TYPES } from '@/app/lib/types';
import type { ContractTemplate, ContractTemplateInput, ContractType } from '@/app/lib/types';
import { createTemplate, updateTemplate } from './actions';

const SAMPLE_CLIENT: TemplateParty = {
    name: 'Sample Client Ltd',
    reg_no: 'HRB 123456',
    vat_number: 'DE123456789',
    city: 'Berlin',
    address: 'Friedrichstraße 1',
    country: 'Germany',
    representative: 'Anna Schmidt',
    phone: '+49 30 555 0100',
    email: 'office@example.com',
};

const SAMPLE_ITEMS = [
    { description: 'Sample product', unit: 'pcs', quantity: 2, unit_price: 250 },
    { description: 'Sample service', unit: 'h', quantity: 5, unit_price: 100 },
];

interface TemplateEditorModalProps {
    editing: ContractTemplate | null;
    /** Copy of an existing template (new template with pre-filled content) */
    copyOf: ContractTemplate | null;
    company: TemplateCompany;
    sampleClient: TemplateParty | null;
    today: string;
    onClose: () => void;
    onSaved: (template: ContractTemplate, wasEdit: boolean) => void;
}

export default function TemplateEditorModal({
    editing,
    copyOf,
    company,
    sampleClient,
    today,
    onClose,
    onSaved,
}: TemplateEditorModalProps) {
    const source = editing ?? copyOf;
    const [name, setName] = useState(editing ? editing.name : copyOf ? `${copyOf.name} (copy)` : '');
    const [type, setType] = useState<ContractType>(source?.contract_type ?? 'sale');
    const [defaultTitle, setDefaultTitle] = useState(source?.default_title ?? '');
    const [months, setMonths] = useState(source?.default_months ? String(source.default_months) : '');
    const [body, setBody] = useState(
        source?.body ??
            '# AGREEMENT\n## No. {{contract.number}}\n\nThis agreement is made on {{contract.start}} between {{company.name}} and {{client.name}}.\n\n## 1. Subject\n\n{{contract.subject}}\n\n{{items_table}}\n',
    );
    const [view, setView] = useState<'edit' | 'preview'>('edit');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const unknown = useMemo(() => unknownFields(body), [body]);

    const preview = useMemo(() => {
        const m = months ? Number(months) : null;
        return renderTemplate(body, {
            company,
            client: sampleClient ?? SAMPLE_CLIENT,
            contract: {
                number: `CT-${today.slice(0, 4)}-0001`,
                title: defaultTitle || 'Contract subject',
                type,
                start_date: today,
                end_date: m && Number.isInteger(m) && m > 0 ? endDateForMonths(today, m) : null,
                total: 1000,
                notes: '',
            },
            today,
        });
    }, [body, company, sampleClient, defaultTitle, type, months, today]);

    /** Inserts text at the cursor (or replaces the selected text). */
    function insertAtCursor(text: string, opts: { ownLine?: boolean; wrap?: [string, string]; linePrefix?: string } = {}) {
        const ta = textareaRef.current;
        const start = ta?.selectionStart ?? body.length;
        const end = ta?.selectionEnd ?? body.length;
        let insert = text;
        let newStart = start;
        let newEnd = start;

        if (opts.wrap) {
            const selected = body.slice(start, end) || text;
            insert = `${opts.wrap[0]}${selected}${opts.wrap[1]}`;
            newStart = start + opts.wrap[0].length;
            newEnd = newStart + selected.length;
        } else if (opts.linePrefix) {
            // Adds a prefix at the start of the current line
            const prefix = opts.linePrefix;
            const lineStart = start === 0 ? 0 : body.lastIndexOf('\n', start - 1) + 1;
            const nl = body.indexOf('\n', lineStart);
            const lineEnd = nl === -1 ? body.length : nl;
            const cleaned = body.slice(lineStart, lineEnd).replace(/^#{1,2} /, '');
            const next = body.slice(0, lineStart) + prefix + cleaned + body.slice(lineEnd);
            setBody(next);
            const caret = lineStart + prefix.length + cleaned.length;
            requestAnimationFrame(() => {
                ta?.focus();
                ta?.setSelectionRange(caret, caret);
            });
            return;
        } else {
            if (opts.ownLine) {
                const before = body.slice(0, start);
                const after = body.slice(end);
                const pre = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
                const post = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
                insert = `${pre}${text}${post}`;
            }
            newStart = newEnd = start + insert.length;
        }

        const next = body.slice(0, start) + insert + body.slice(end);
        setBody(next);
        requestAnimationFrame(() => {
            ta?.focus();
            ta?.setSelectionRange(newStart, newEnd);
        });
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!name.trim()) return setError('Enter a template name.');
        if (!body.trim()) return setError('The template text is empty.');
        if (unknown.length > 0) return setError(`Fix the unknown fields: ${unknown.map((u) => `{{${u}}}`).join(', ')}`);
        const m = months.trim() ? Number(months) : null;
        if (m !== null && (!Number.isInteger(m) || m < 1 || m > 600)) return setError('The term must be a whole number of months (1–600).');

        const input: ContractTemplateInput = {
            name: name.trim(),
            contract_type: type,
            default_title: defaultTitle.trim(),
            default_months: m,
            body,
        };
        setSaving(true);
        setError(null);
        const res = editing ? await updateTemplate(editing.id, input) : await createTemplate(input);
        setSaving(false);
        if (!res.ok) return setError(res.error);
        onSaved(res.data, editing !== null);
    }

    const [companyRole, clientRole] = PARTY_ROLES[type];

    return (
        <Modal
            open
            onClose={onClose}
            title={editing ? `Edit template "${editing.name}"` : 'New contract template'}
            description="Write or paste the contract text and insert fields. They are filled in automatically for each new contract."
            size="2xl"
            busy={saving}
            closeOnBackdrop={false}
            footer={
                <>
                    {editing && editing.contract_count > 0 ? (
                        <p className="mr-auto text-xs text-slate-500">
                            Changes don&apos;t affect the {editing.contract_count} contract(s) already created from this template.
                        </p>
                    ) : (
                        <span className="mr-auto" />
                    )}
                    <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button type="submit" form="template-form" className={btnPrimary} disabled={saving}>
                        {saving ? 'Saving…' : editing ? 'Save template' : 'Create template'}
                    </button>
                </>
            }
        >
            <form id="template-form" onSubmit={handleSubmit} className="space-y-5">
                {error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {error}
                    </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-12">
                    <div className="sm:col-span-5">
                        <label htmlFor="tpl-name" className={labelCls}>Template name *</label>
                        <input id="tpl-name" className={inputCls} value={name} maxLength={150} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scaffolding rental agreement" />
                    </div>
                    <div className="sm:col-span-3">
                        <label htmlFor="tpl-type" className={labelCls}>Contract type</label>
                        <select id="tpl-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as ContractType)}>
                            {CONTRACT_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {CONTRACT_TYPE_LABEL[t]}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-500">
                            Roles: {companyRole} / {clientRole}
                        </p>
                    </div>
                    <div className="sm:col-span-2">
                        <label htmlFor="tpl-months" className={labelCls}>Term (months)</label>
                        <input
                            id="tpl-months"
                            inputMode="numeric"
                            className={`${inputCls} font-mono`}
                            value={months}
                            onChange={(e) => setMonths(e.target.value.replace(/[^\d]/g, ''))}
                            placeholder="open-ended"
                        />
                    </div>
                    <div className="sm:col-span-2">
                        <label htmlFor="tpl-title" className={labelCls}>Default subject</label>
                        <input id="tpl-title" className={inputCls} value={defaultTitle} maxLength={255} onChange={(e) => setDefaultTitle(e.target.value)} />
                    </div>
                </div>

                <div className="flex items-center gap-2" role="tablist" aria-label="View">
                    {(
                        [
                            ['edit', 'Edit', Pencil],
                            ['preview', 'Preview with sample data', Eye],
                        ] as const
                    ).map(([id, label, Icon]) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={view === id}
                            onClick={() => setView(id)}
                            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                                view === id ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/40' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                        </button>
                    ))}
                </div>

                {view === 'edit' ? (
                    <div className="grid gap-4 lg:grid-cols-12">
                        <div className="lg:col-span-8">
                            <div className="mb-2 flex flex-wrap gap-1.5">
                                <button type="button" className={`${btnSecondary} px-2.5 py-1 text-xs`} onClick={() => insertAtCursor('', { linePrefix: '# ' })}>
                                    Title
                                </button>
                                <button type="button" className={`${btnSecondary} px-2.5 py-1 text-xs`} onClick={() => insertAtCursor('', { linePrefix: '## ' })}>
                                    Section
                                </button>
                                <button type="button" className={`${btnSecondary} px-2.5 py-1 text-xs font-bold`} onClick={() => insertAtCursor('text', { wrap: ['**', '**'] })}>
                                    Bold
                                </button>
                            </div>
                            <label htmlFor="tpl-body" className="sr-only">Template text</label>
                            <textarea
                                id="tpl-body"
                                ref={textareaRef}
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                rows={22}
                                spellCheck
                                lang="en"
                                className={`${inputCls} min-h-[28rem] font-mono text-[13px] leading-relaxed`}
                            />
                            {unknown.length > 0 ? (
                                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    Unknown fields: {unknown.map((u) => `{{${u}}}`).join(', ')} — check the spelling or insert them from the list.
                                </p>
                            ) : null}
                            <p className="mt-2 text-xs leading-relaxed text-slate-500">
                                <span className="font-mono text-slate-400"># Text</span> — title ·{' '}
                                <span className="font-mono text-slate-400">## Text</span> — section ·{' '}
                                <span className="font-mono text-slate-400">**text**</span> — bold · blank line — new paragraph. You can paste text
                                straight from Word.
                            </p>
                        </div>

                        <aside className="space-y-4 lg:col-span-4">
                            <p className="text-xs text-slate-400">Click a field to insert it at the cursor:</p>
                            {TEMPLATE_FIELD_GROUPS.map((group) => (
                                <div key={group.title}>
                                    <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</h4>
                                    <div className="flex flex-wrap gap-1.5">
                                        {group.fields.map((f) => (
                                            <button
                                                key={f.key}
                                                type="button"
                                                title={`{{${f.key}}}`}
                                                onClick={() => insertAtCursor(`{{${f.key}}}`, { ownLine: f.key === 'items_table' })}
                                                className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-xs text-slate-200 transition-colors hover:border-indigo-500/60 hover:bg-indigo-500/10 hover:text-indigo-200"
                                            >
                                                {f.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </aside>
                    </div>
                ) : (
                    <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-slate-950 p-4">
                        <div className="mx-auto max-w-[210mm] rounded bg-white p-8 shadow-xl">
                            <ContractDocument
                                text={preview}
                                items={SAMPLE_ITEMS}
                                currency={company.currency}
                                compact
                                signatures={[
                                    { role: companyRole, name: company.name, person: company.representative },
                                    { role: clientRole, name: (sampleClient ?? SAMPLE_CLIENT).name, person: (sampleClient ?? SAMPLE_CLIENT).representative },
                                ]}
                            />
                        </div>
                        <p className="mt-3 text-center text-xs text-slate-500">
                            The preview uses a sample client, an amount of 1,000 and two sample lines. Empty fields are shown as &quot;………………&quot;.
                        </p>
                    </div>
                )}
            </form>
        </Modal>
    );
}
