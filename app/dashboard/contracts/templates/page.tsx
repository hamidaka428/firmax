import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireActiveCompany } from '@/app/lib/tenant';
import { todayISO } from '@/app/lib/format';
import { loadClientOptions } from '../data';
import { loadTemplates } from './data';
import TemplatesView from './TemplatesView';

export const metadata = { title: 'Contract templates' };

export default async function TemplatesPage() {
    const company = await requireActiveCompany();
    const [templates, clients] = await Promise.all([loadTemplates(company.id), loadClientOptions(company.id)]);

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div>
                <Link
                    href="/dashboard/contracts"
                    className="mb-3 inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-100"
                >
                    <ArrowRight className="h-4 w-4 rotate-180" />
                    Back to contracts
                </Link>
                <h1 className="text-2xl font-semibold text-slate-100">Contract templates</h1>
                <p className="mt-1 text-sm text-slate-400">Ready-made texts that are filled in automatically when you create a new contract.</p>
            </div>

            <TemplatesView
                key={company.id}
                initialTemplates={templates}
                company={company}
                sampleClient={clients[0] ?? null}
                today={todayISO()}
            />
        </div>
    );
}
