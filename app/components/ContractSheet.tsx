import ContractDocument from './ContractDocument';
import type { ComponentProps } from 'react';
import type { ContractItem } from '@/app/lib/types';

/** A4 sheet with the contract text — shared by the internal print view and the public link. */
export default function ContractSheet({
    logoUrl,
    company,
    body,
    items,
    currency,
    signatures,
}: {
    logoUrl: string | null;
    company: { name: string; reg_no: string; city: string; address: string };
    body: string;
    items: ContractItem[];
    currency: string;
    signatures: ComponentProps<typeof ContractDocument>['signatures'];
}) {
    return (
        <div className="overflow-x-auto [contain:paint] print:overflow-visible print:[contain:none]">
            <article className="mx-auto mb-6 min-h-[297mm] w-[210mm] bg-white p-[18mm] text-black shadow-2xl print:mb-0 print:min-h-0 print:w-full print:p-0 print:shadow-none">
                {logoUrl ? (
                    <div className="mb-6 flex items-center justify-between gap-6 border-b border-gray-300 pb-3">
                        {/* eslint-disable-next-line @next/next/no-img-element -- the logo comes from a protected route */}
                        <img src={logoUrl} alt={company.name} className="max-h-[18mm] max-w-[60mm] object-contain object-left" />
                        <p className="text-right text-[11px] leading-snug text-gray-600">
                            {company.name}
                            <br />
                            Reg. no. {company.reg_no}
                            {company.address ? (
                                <>
                                    <br />
                                    {[company.city, company.address].filter(Boolean).join(', ')}
                                </>
                            ) : null}
                        </p>
                    </div>
                ) : null}
                <ContractDocument text={body} items={items} currency={currency} signatures={signatures} />
            </article>
        </div>
    );
}
