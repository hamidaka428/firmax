import { requireActiveCompany } from '@/app/lib/tenant';
import { todayISO } from '@/app/lib/format';
import { loadClients } from './data';
import ClientsTable from './ClientsTable';

export const metadata = { title: 'Clients' };

export default async function ClientsPage() {
    const company = await requireActiveCompany();
    const clients = await loadClients(company.id);

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-slate-100">Clients</h1>
                <p className="mt-1 text-sm text-slate-400">
                    Clients of {company.name}. Open &quot;History&quot; to see the client&apos;s contracts and invoices.
                </p>
            </div>

            <ClientsTable
                key={company.id}
                initialClients={clients}
                currency={company.currency}
                today={todayISO()}
            />
        </div>
    );
}
