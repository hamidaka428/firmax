'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { btnPrimary } from '@/app/components/ui/styles';
import { CompanyFields, EMPTY_COMPANY } from '@/app/dashboard/settings/SettingsView';
import { createCompany } from '@/app/dashboard/settings/actions';
import type { CompanyInput } from '@/app/lib/types';

export default function OnboardingForm() {
    const router = useRouter();
    const [form, setForm] = useState<CompanyInput>(EMPTY_COMPANY);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!form.name.trim()) return setError('Enter the company name.');
        setSaving(true);
        setError(null);
        const res = await createCompany(form);
        if (!res.ok) {
            setSaving(false);
            setError(res.error);
            return;
        }
        router.push('/dashboard');
        router.refresh();
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error ? (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                </div>
            ) : null}
            <CompanyFields idPrefix="onb" value={form} onChange={(key, v) => setForm((prev) => ({ ...prev, [key]: v }))} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
                <p className="text-xs text-slate-500">The registration number is printed on every invoice. You can fill in the rest later in Settings.</p>
                <button type="submit" disabled={saving} className={btnPrimary}>
                    {saving ? 'Creating…' : 'Create company'}
                    <ArrowRight className="h-4 w-4" />
                </button>
            </div>
        </form>
    );
}
