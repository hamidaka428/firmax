import { requireActiveCompany } from '@/app/lib/tenant';
import { runRecurringBillingLazy } from '@/app/lib/recurring';
import { todayISO } from '@/app/lib/format';
import { loadClientOptions, loadProductOptions } from '../contracts/data';
import { loadContractOptions, loadInvoices } from './data';
import InvoicesView from './InvoicesView';
import { loadBankAccounts, loadInvoiceSeries } from '@/app/lib/billing-setup';
import { appUrl } from '@/app/lib/app';

export const metadata = { title: 'Invoices' };

const VALID_TABS = ['all', 'pending', 'paid', 'overdue', 'cancelled'] as const;

export default async function InvoicesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
    const rawHighlight = Array.isArray(params.highlight) ? params.highlight[0] : params.highlight;
    const initialTab = VALID_TABS.find((t) => t === rawTab) ?? 'all';
    const highlightId = rawHighlight && /^\d+$/.test(rawHighlight) ? Number(rawHighlight) : null;

    const company = await requireActiveCompany();

    await runRecurringBillingLazy(company.id); // due recurring invoices from contracts
    const [invoices, clients, contracts, products, bankAccounts, series] = await Promise.all([
        loadInvoices(company.id),
        loadClientOptions(company.id),
        loadContractOptions(company.id),
        loadProductOptions(company.id),
        loadBankAccounts(company.id),
        loadInvoiceSeries(company.id),
    ]);

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-100">Invoices</h1>
                <p className="mt-1 text-sm text-slate-400">
                    Numbers are assigned automatically (10 digits). An invoice that isn&apos;t valid is cancelled, never deleted.
                </p>
            </div>

            <InvoicesView
                key={company.id}
                initialInvoices={invoices}
                clients={clients}
                bankAccounts={bankAccounts}
                series={series}
                mainIban={company.iban}
                companyName={company.name}
                origin={appUrl()}
                contracts={contracts}
                products={products}
                currency={company.currency}
                today={todayISO()}
                initialTab={initialTab}
                highlightId={highlightId}
            />
        </div>
    );
}
