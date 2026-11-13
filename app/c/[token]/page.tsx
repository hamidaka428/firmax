import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound, unstable_rethrow } from 'next/navigation';
import { query } from '@/app/lib/db';
import { getCurrentUser } from '@/app/lib/auth';
import { APP_NAME } from '@/app/lib/app';
import { PARTY_ROLES } from '@/app/lib/contract-template';
import ContractSheet from '@/app/components/ContractSheet';
import PrintButton from '@/app/components/PrintButton';
import { loadContracts } from '@/app/dashboard/contracts/data';

export const dynamic = 'force-dynamic';

interface Head {
    id: number;
    company_id: number;
    owner_id: number | null;
    name: string;
    reg_no: string;
    city: string;
    address: string;
    representative: string;
    email: string;
    currency: string;
    logo_path: string | null;
    client_name: string | null;
    client_representative: string | null;
}

const load = cache(async (token: string) => {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const res = await query<Head>(
        `SELECT c.id, c.company_id, co.owner_id, co.name, co.reg_no, co.city, co.address, co.representative, co.email,
                co.currency, co.logo_path, cl.name AS client_name, cl.representative AS client_representative
           FROM contracts c
           JOIN companies co ON co.id = c.company_id
           LEFT JOIN clients cl ON cl.id = c.client_id
          WHERE c.share_token = $1`,
        [token],
    );
    const head = res.rows[0];
    if (!head) return null;
    const [contract] = await loadContracts(head.company_id, head.id);
    return contract && contract.body ? { head, contract } : null;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
    const loaded = await load((await params).token);
    return {
        title: loaded ? `Contract no. ${loaded.contract.contract_number} · ${loaded.head.name}` : 'Document',
        robots: { index: false, follow: false },
        referrer: 'no-referrer',
    };
}

export default async function PublicContractPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const loaded = await load(token);
    if (!loaded) notFound();
    const { head, contract } = loaded;

    let viewerId: number | null = null;
    try {
        viewerId = (await getCurrentUser())?.id ?? null;
    } catch (error) {
        unstable_rethrow(error);
    }
    if (viewerId === null || viewerId !== head.owner_id) {
        await query(`UPDATE contracts SET viewed_at = now() WHERE share_token = $1 AND viewed_at IS NULL`, [token]);
    }

    const [companyRole, clientRole] = PARTY_ROLES[contract.contract_type];
    const showLogo = Boolean(head.logo_path);

    return (
        <div className="min-h-screen bg-slate-950 px-4 py-6 print:bg-white print:p-0">
            <div className="no-print mx-auto mb-5 flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-300">
                    <span className="font-semibold text-slate-100">{head.name}</span>
                    <span className="text-slate-500"> · for a PDF, click &quot;Print&quot; and choose &quot;Save as PDF&quot;</span>
                </p>
                <PrintButton />
            </div>
            <ContractSheet
                logoUrl={showLogo ? `/i/${token}/logo` : null}
                company={head}
                body={contract.body}
                items={contract.items}
                currency={head.currency}
                signatures={[
                    { role: companyRole, name: head.name, person: head.representative },
                    { role: clientRole, name: head.client_name ?? contract.client_name, person: head.client_representative ?? '' },
                ]}
            />
            <p className="no-print mx-auto mt-2 max-w-[210mm] text-center text-xs text-slate-500">
                This document was sent by {head.name} via {APP_NAME}.
                {head.email ? <> Questions: <a className="text-slate-300 underline" href={`mailto:${head.email}`}>{head.email}</a>.</> : null}
            </p>
        </div>
    );
}
