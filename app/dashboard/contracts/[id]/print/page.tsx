import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Pencil } from 'lucide-react';
import { query } from '@/app/lib/db';
import { logoUrl, requireActiveCompany } from '@/app/lib/tenant';
import { requireUser } from '@/app/lib/auth';
import { PARTY_ROLES } from '@/app/lib/contract-template';
import ContractSheet from '@/app/components/ContractSheet';
import PrintButton from '@/app/components/PrintButton';
import SwitchToCompany from '@/app/components/SwitchToCompany';
import { loadContracts } from '../../data';

export const metadata = { title: 'Print contract' };

export default async function ContractPrintPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: rawId } = await params;
    if (!/^\d+$/.test(rawId)) notFound();
    const id = Number(rawId);

    const user = await requireUser();
    const company = await requireActiveCompany();
    const [contract] = await loadContracts(company.id, id);

    if (!contract) {
        // The contract may belong to another company — offer to switch instead of a blank 404.
        const owner = await query<{ id: number; name: string; contract_number: string }>(
            `SELECT co.id, co.name, COALESCE(c.contract_number, '') AS contract_number
               FROM contracts c JOIN companies co ON co.id = c.company_id
              WHERE c.id = $1 AND co.owner_id = $2 -- only the user's own companies
             `,
            [id, user.id],
        );
        if (owner.rows.length === 0) notFound();
        const o = owner.rows[0];
        return (
            <div className="mx-auto mt-10 max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
                <h1 className="text-lg font-semibold text-slate-100">This contract belongs to another company</h1>
                <p className="mt-2 text-sm text-slate-400">
                    Contract <span className="font-mono text-slate-200">{o.contract_number}</span> belongs to{' '}
                    <span className="font-medium text-slate-200">{o.name}</span>, but you are currently working in{' '}
                    <span className="font-medium text-slate-200">{company.name}</span>.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <Link href="/dashboard/contracts" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
                        Back to contracts
                    </Link>
                    <SwitchToCompany companyId={o.id} companyName={o.name} />
                </div>
            </div>
        );
    }

    const client = contract.client_id
        ? (
              await query<{ name: string; representative: string }>(`SELECT name, representative FROM clients WHERE id = $1 AND company_id = $2`, [
                  contract.client_id,
                  company.id,
              ])
          ).rows[0] ?? null
        : null;

    const [companyRole, clientRole] = PARTY_ROLES[contract.contract_type];

    return (
        <div>
            <div className="no-print mx-auto mb-5 flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-3">
                <Link
                    href="/dashboard/contracts"
                    className="inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-100"
                >
                    <ArrowRight className="h-4 w-4 rotate-180" />
                    Back to contracts
                </Link>
                {contract.body ? <PrintButton /> : null}
            </div>

            {contract.body ? (
                <ContractSheet
                    logoUrl={company.logo_path ? logoUrl(company.logo_path) : null}
                    company={company}
                    body={contract.body}
                    items={contract.items}
                    currency={company.currency}
                    signatures={[
                        { role: companyRole, name: company.name, person: company.representative },
                        { role: clientRole, name: client?.name ?? contract.client_name, person: client?.representative ?? '' },
                    ]}
                />
            ) : (
                <div className="mx-auto max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
                    <h1 className="text-lg font-semibold text-slate-100">This contract has no text</h1>
                    <p className="mt-2 text-sm text-slate-400">
                        Contract <span className="font-mono text-slate-200">{contract.contract_number}</span> was created without a template. Open
                        it for editing, choose a template in the top field and save — the text will be filled in automatically.
                    </p>
                    <Link
                        href="/dashboard/contracts"
                        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                    >
                        <Pencil className="h-4 w-4" />
                        Back to contracts
                    </Link>
                </div>
            )}
        </div>
    );
}
