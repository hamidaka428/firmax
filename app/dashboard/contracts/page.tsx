import { requireActiveCompany } from '@/app/lib/tenant';
import { runRecurringBillingLazy } from '@/app/lib/recurring';
import { appUrl } from '@/app/lib/app';
import { todayISO } from '@/app/lib/format';
import { loadClientOptions, loadContracts, loadProductOptions } from './data';
import { loadTemplates } from './templates/data';
import ContractsView from './ContractsView';

export const metadata = { title: 'Contracts' };

const VALID_TABS = ['all', 'active', 'soon', 'expired', 'closed'] as const;

export default async function ContractsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
    const initialTab = VALID_TABS.find((t) => t === rawTab) ?? 'all';
    const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const openNew = first(params.new) === '1';
    const rawTemplate = Number(first(params.template));
    const initialTemplateId = Number.isInteger(rawTemplate) && rawTemplate > 0 ? rawTemplate : null;

    const company = await requireActiveCompany();

    await runRecurringBillingLazy(company.id); // due recurring invoices from contracts
    const [contracts, clients, products, templates] = await Promise.all([
        loadContracts(company.id),
        loadClientOptions(company.id),
        loadProductOptions(company.id),
        loadTemplates(company.id),
    ]);

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-100">Contracts</h1>
                <p className="mt-1 text-sm text-slate-400">
                    Validity is calculated automatically from the end date. You can attach a signed file to every contract.
                </p>
            </div>

            <ContractsView
                key={company.id}
                initialContracts={contracts}
                clients={clients}
                initialProducts={products}
                templates={templates}
                company={company}
                currency={company.currency}
                today={todayISO()}
                initialTab={initialTab}
                openNew={openNew}
                initialTemplateId={initialTemplateId}
                origin={appUrl()}
            />
        </div>
    );
}
