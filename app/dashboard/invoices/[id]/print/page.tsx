import { notFound } from 'next/navigation';
import { query } from '@/app/lib/db';
import { logoUrl, requireActiveCompany } from '@/app/lib/tenant';
import { requireUser } from '@/app/lib/auth';
import { loadInvoicePrint } from '@/app/lib/invoice-print-data';
import Link from 'next/link';
import InvoicePrint from './InvoicePrint';
import SwitchToCompany from '@/app/components/SwitchToCompany';

export const metadata = { title: 'Print invoice' };

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    if (!/^\d+$/.test(rawId)) notFound();
    const id = Number(rawId);

    const user = await requireUser();
    const company = await requireActiveCompany();

    const loaded = await loadInvoicePrint({ id, companyId: company.id }, ({ logoPath }) => logoUrl(logoPath)!);
    if (!loaded) {
        // The invoice may belong to another company — offer to switch instead of a blank 404.
        const owner = await query<{ id: number; name: string; invoice_number: string }>(
            `SELECT c.id, c.name, COALESCE(i.invoice_number, '') AS invoice_number
               FROM invoices i JOIN companies c ON c.id = i.company_id
              WHERE i.id = $1 AND c.owner_id = $2 -- only the user's own companies
             `,
            [id, user.id],
        );
        if (owner.rows.length === 0) notFound();
        const o = owner.rows[0];
        return (
            <div className="mx-auto mt-10 max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
                <h1 className="text-lg font-semibold text-slate-100">This invoice belongs to another company</h1>
                <p className="mt-2 text-sm text-slate-400">
                    Invoice no. <span className="font-mono text-slate-200">{o.invoice_number}</span> was issued by{' '}
                    <span className="font-medium text-slate-200">{o.name}</span>, but you are currently working in{' '}
                    <span className="font-medium text-slate-200">{company.name}</span>.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <Link href="/dashboard/invoices" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
                        Back to invoices
                    </Link>
                    <SwitchToCompany companyId={o.id} companyName={o.name} />
                </div>
            </div>
        );
    }
    return <InvoicePrint data={loaded.data} />;
}
