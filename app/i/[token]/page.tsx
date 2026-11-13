import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound, unstable_rethrow } from 'next/navigation';
import { query } from '@/app/lib/db';
import { getCurrentUser } from '@/app/lib/auth';
import { loadInvoicePrint } from '@/app/lib/invoice-print-data';
import { DOC_TITLE } from '@/app/lib/documents';
import { APP_NAME } from '@/app/lib/app';
import InvoicePrint from '@/app/dashboard/invoices/[id]/print/InvoicePrint';

export const dynamic = 'force-dynamic';

const load = cache((token: string) =>
    /^[A-Za-z0-9_-]{20,64}$/.test(token) ? loadInvoicePrint({ token }, () => `/i/${token}/logo`) : Promise.resolve(null),
);

// The link is private: not indexed and no Referer sent to external sites
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
    const loaded = await load((await params).token);
    const t = loaded ? DOC_TITLE[loaded.data.invoice.doc_type] : 'Document';
    return {
        title: loaded ? `${t.charAt(0)}${t.slice(1).toLowerCase()} no. ${loaded.data.invoice.invoice_number} · ${loaded.data.supplier.name}` : 'Document',
        robots: { index: false, follow: false },
        referrer: 'no-referrer',
    };
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const loaded = await load(token);
    if (!loaded) notFound();

    // Record the client's first view (but not when the owner checks the link themselves)
    let viewerId: number | null = null;
    try {
        viewerId = (await getCurrentUser())?.id ?? null;
    } catch (error) {
        unstable_rethrow(error);
    }
    if (viewerId === null || viewerId !== loaded.ownerId) {
        await query(`UPDATE invoices SET viewed_at = now() WHERE share_token = $1 AND viewed_at IS NULL`, [token]);
    }

    const { supplier } = loaded.data;
    return (
        <div className="min-h-screen bg-slate-950 px-4 py-6 print:bg-white print:p-0">
            <InvoicePrint data={loaded.data} publicView />
            <p className="no-print mx-auto mt-2 max-w-[210mm] text-center text-xs text-slate-500">
                This document was sent by {supplier.name} via {APP_NAME}. For questions, contact the issuer
                {supplier.email ? <> at <a className="text-slate-300 underline" href={`mailto:${supplier.email}`}>{supplier.email}</a></> : null}.
            </p>
        </div>
    );
}
