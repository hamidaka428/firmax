import { query } from '@/app/lib/db';
import { logoUrl, requireActiveCompany } from '@/app/lib/tenant';
import { requireUser } from '@/app/lib/auth';
import SettingsView from './SettingsView';
import BankSeriesCard from './BankSeriesCard';
import { loadBankAccounts, loadInvoiceSeries } from '@/app/lib/billing-setup';
import type { CompanyOverview } from './SettingsView';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const openNew = (Array.isArray(params.new) ? params.new[0] : params.new) === '1';

    const user = await requireUser();
    const company = await requireActiveCompany();
    const overview = await query<CompanyOverview>(
        `SELECT c.id, c.name, c.reg_no, c.city, c.currency, c.invoice_seq,
                (SELECT COUNT(*) FROM clients   WHERE company_id = c.id) AS clients,
                (SELECT COUNT(*) FROM contracts WHERE company_id = c.id) AS contracts,
                (SELECT COUNT(*) FROM invoices  WHERE company_id = c.id) AS invoices
           FROM companies c WHERE c.owner_id = $1 ORDER BY c.name ASC`,
        [user.id],
    );

    const [accounts, series] = await Promise.all([loadBankAccounts(company.id), loadInvoiceSeries(company.id)]);
    const mainNext = String((overview.rows.find((c) => c.id === company.id)?.invoice_seq ?? 0) + 1).padStart(10, '0');

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
                <p className="mt-1 text-sm text-slate-400">Details of the active company and management of your companies.</p>
            </div>

            <SettingsView
                key={company.id}
                company={{
                    name: company.name,
                    reg_no: company.reg_no,
                    vat_number: company.vat_number,
                    city: company.city,
                    address: company.address,
                    country: company.country,
                    representative: company.representative,
                    phone: company.phone,
                    email: company.email,
                    bank_name: company.bank_name,
                    iban: company.iban,
                    bic: company.bic,
                    currency: company.currency,
                }}
                logoUrl={logoUrl(company.logo_path)}
                activeId={company.id}
                companies={overview.rows}
                openNew={openNew}
            />

            <BankSeriesCard
                key={`bank-${company.id}`}
                mainBank={{ bank_name: company.bank_name, iban: company.iban }}
                mainNext={mainNext}
                initialAccounts={accounts}
                initialSeries={series}
            />
        </div>
    );
}
