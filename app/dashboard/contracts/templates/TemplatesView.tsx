'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/app/components/ui/ToastProvider';
import { useConfirm } from '@/app/components/ui/ConfirmDialog';
import { badgeSlate, btnPrimary, btnSecondary, cardCls } from '@/app/components/ui/styles';
import { formatDate } from '@/app/lib/format';
import { CONTRACT_TYPE_LABEL } from '@/app/lib/labels';
import type { TemplateCompany, TemplateParty } from '@/app/lib/contract-template';
import type { ContractTemplate } from '@/app/lib/types';
import { deleteTemplate } from './actions';
import TemplateEditorModal from './TemplateEditorModal';

interface TemplatesViewProps {
    initialTemplates: ContractTemplate[];
    company: TemplateCompany;
    sampleClient: TemplateParty | null;
    today: string;
}

function monthsLabel(m: number | null): string {
    if (!m) return 'Open-ended';
    if (m % 12 === 0) return m === 12 ? '1 year' : `${m / 12} years`;
    return m === 1 ? '1 month' : `${m} months`;
}

export default function TemplatesView({ initialTemplates, company, sampleClient, today }: TemplatesViewProps) {
    const toast = useToast();
    const confirm = useConfirm();
    const [templates, setTemplates] = useState(initialTemplates);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<ContractTemplate | null>(null);
    const [copyOf, setCopyOf] = useState<ContractTemplate | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);

    function open(edit: ContractTemplate | null, copy: ContractTemplate | null) {
        setEditing(edit);
        setCopyOf(copy);
        setEditorOpen(true);
    }

    function handleSaved(t: ContractTemplate, wasEdit: boolean) {
        setTemplates((prev) => {
            const next = wasEdit ? prev.map((x) => (x.id === t.id ? t : x)) : [...prev, t];
            return next.sort((a, b) => a.name.localeCompare(b.name, 'en'));
        });
        setEditorOpen(false);
        toast.success(wasEdit ? 'Template saved' : 'Template created', t.name);
    }

    async function handleDelete(t: ContractTemplate) {
        const ok = await confirm({
            title: 'Delete template',
            message: (
                <p>
                    Delete the template <strong className="text-slate-100">&quot;{t.name}&quot;</strong>?
                    {t.contract_count > 0
                        ? ` The ${t.contract_count} contract(s) already created from it keep their text.`
                        : ''}
                </p>
            ),
            confirmLabel: 'Delete',
            tone: 'danger',
        });
        if (!ok) return;
        setBusyId(t.id);
        const res = await deleteTemplate(t.id);
        setBusyId(null);
        if (!res.ok) return toast.error('Delete failed', res.error);
        setTemplates((prev) => prev.filter((x) => x.id !== t.id));
        toast.success('Template deleted', t.name);
    }

    return (
        <div className="space-y-4">
            <div className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-4`}>
                <p className="max-w-3xl text-sm text-slate-400">
                    A template is ready-made contract text with fields such as <span className="font-mono text-slate-300">{'{{client.name}}'}</span> and{' '}
                    <span className="font-mono text-slate-300">{'{{contract.amount}}'}</span>. Choose a template for a new contract — the text is filled in with
                    the client details, dates and line items.
                </p>
                <button type="button" onClick={() => open(null, null)} className={btnPrimary}>
                    <Plus className="h-4 w-4" />
                    New template
                </button>
            </div>

            {templates.length === 0 ? (
                <div className={`${cardCls} flex flex-col items-center gap-3 px-6 py-14 text-center`}>
                    <FileText className="h-10 w-10 text-slate-600" />
                    <p className="text-sm text-slate-400">You have no templates. Create your first one — for example the contract you use most often.</p>
                    <button type="button" onClick={() => open(null, null)} className={btnPrimary}>
                        <Plus className="h-4 w-4" />
                        New template
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {templates.map((t) => {
                        const busy = busyId === t.id;
                        return (
                            <article key={t.id} className={`${cardCls} flex flex-col p-5`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="truncate font-semibold text-slate-100" title={t.name}>
                                            {t.name}
                                        </h3>
                                        <p className="mt-0.5 truncate text-xs text-slate-500">{t.default_title || 'No default subject'}</p>
                                    </div>
                                    <span className={`${badgeSlate} shrink-0`}>{CONTRACT_TYPE_LABEL[t.contract_type]}</span>
                                </div>

                                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <dt className="text-slate-500">Term</dt>
                                        <dd className="text-slate-300">{monthsLabel(t.default_months)}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-slate-500">Used</dt>
                                        <dd className="font-mono text-slate-300">
                                            {t.contract_count} {t.contract_count === 1 ? 'contract' : 'contracts'}
                                        </dd>
                                    </div>
                                    <div className="col-span-2">
                                        <dt className="text-slate-500">Last changed</dt>
                                        <dd className="text-slate-300">{formatDate(t.updated_at)}</dd>
                                    </div>
                                </dl>

                                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
                                    <Link
                                        href={`/dashboard/contracts?new=1&template=${t.id}`}
                                        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600/90 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
                                    >
                                        New contract
                                        <ArrowRight className="h-3.5 w-3.5" />
                                    </Link>
                                    <button type="button" onClick={() => open(null, t)} disabled={busy} className={`${btnSecondary} px-2.5 py-1.5 text-xs`}>
                                        <Plus className="h-3.5 w-3.5" />
                                        Copy
                                    </button>
                                    <span className="ml-auto flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => open(t, null)}
                                            disabled={busy}
                                            aria-label={`Edit template ${t.name}`}
                                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(t)}
                                            disabled={busy}
                                            aria-label={`Delete template ${t.name}`}
                                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </span>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            <p className="text-xs text-slate-500">
                The sample templates are generic examples. Before using them with clients, review and adapt them to your business and jurisdiction (ideally with a lawyer).
            </p>

            {editorOpen ? (
                <TemplateEditorModal
                    key={editing?.id ?? `new-${copyOf?.id ?? 0}`}
                    editing={editing}
                    copyOf={copyOf}
                    company={company}
                    sampleClient={sampleClient}
                    today={today}
                    onClose={() => setEditorOpen(false)}
                    onSaved={handleSaved}
                />
            ) : null}
        </div>
    );
}
