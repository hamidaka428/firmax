'use client';

import Link from 'next/link';
import { ArrowRight, Printer } from 'lucide-react';
import { formatDate, formatMoney, formatNumber, formatQty } from '@/app/lib/format';
import { amountInWords } from '@/app/lib/validation';
import { DOC_TITLE, isNote } from '@/app/lib/documents';
import { PAYMENT_METHOD_LABEL } from '@/app/lib/labels';
import type { DocType, PaymentMethod } from '@/app/lib/types';

export interface PrintInvoiceData {
    invoice: {
        id: number;
        invoice_number: string;
        issue_date: string;
        due_date: string | null;
        subtotal: number;
        vat_rate: number;
        vat_exempt_reason: string;
        vat_amount: number;
        total_amount: number;
        status: string;
        payment_method: string;
        paid_date: string | null;
        notes: string;
        contract_number: string;
        doc_type: DocType;
        note_reason: string;
        related_number: string;
        related_date: string | null;
    };
    items: { description: string; unit: string; quantity: number; unit_price: number; line_total: number }[];
    supplier: {
        name: string;
        reg_no: string;
        vat_number: string;
        city: string;
        address: string;
        country: string;
        representative: string;
        phone: string;
        email: string;
        bank_name: string;
        iban: string;
        bic: string;
        currency: string;
        logo_url: string | null;
    };
    client: {
        name: string;
        reg_no: string;
        vat_number: string;
        city: string;
        address: string;
        country: string;
        representative: string;
    } | null;
}

function groupIban(iban: string): string {
    return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

function PartyRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    if (!value) return null;
    return (
        <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-gray-500">{label}</dt>
            <dd className={`min-w-0 break-words font-medium text-black ${mono ? 'font-mono' : ''}`}>{value}</dd>
        </div>
    );
}

function Sheet({ data }: { data: PrintInvoiceData }) {
    const changeSuffix =
        data.invoice.doc_type === 'credit_note' ? ' (decrease)' : data.invoice.doc_type === 'debit_note' ? ' (increase)' : '';
    const { invoice, items, supplier, client } = data;
    const cur = supplier.currency;
    const cancelled = invoice.status === 'cancelled';
    const place = (p: { city: string; address: string; country?: string }) => [p.address, p.city, p.country].filter(Boolean).join(', ');

    return (
        <article className="relative mx-auto mb-6 min-h-[297mm] w-[210mm] bg-white p-[14mm] text-[12px] leading-snug text-black shadow-2xl print:mb-0 print:min-h-0 print:w-full print:p-0 print:shadow-none">
            {cancelled ? (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center text-[96px] font-black uppercase tracking-widest text-red-600/15"
                    style={{ transform: 'rotate(-30deg)' }}
                >
                    Cancelled
                </div>
            ) : null}

            {/* Header */}
            <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
                <div>
                    {supplier.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the logo comes from a protected route
                        <img src={supplier.logo_url} alt={supplier.name} className="mb-3 max-h-[22mm] max-w-[70mm] object-contain object-left" />
                    ) : null}
                    <h1 className="text-2xl font-bold tracking-wide">{DOC_TITLE[invoice.doc_type]}</h1>
                    <p className="mt-1 text-gray-600">No. <span className="font-mono text-base font-bold text-black">{invoice.invoice_number}</span></p>
                    {isNote(invoice.doc_type) ? (
                        <p className="mt-1 text-gray-700">
                            relating to invoice no. <span className="font-mono font-semibold">{invoice.related_number}</span>
                            {invoice.related_date ? <> of {formatDate(invoice.related_date)}</> : null}
                        </p>
                    ) : null}
                    {invoice.doc_type === 'proforma' ? (
                        <p className="mt-1 text-[11px] text-gray-500">A proforma invoice is not a tax invoice and cannot be used to reclaim VAT.</p>
                    ) : null}
                </div>
                <dl className="space-y-0.5 text-right">
                    <div className="flex justify-end gap-2">
                        <dt className="text-gray-500">Issue date:</dt>
                        <dd className="font-semibold">{formatDate(invoice.issue_date)}</dd>
                    </div>
                    {invoice.doc_type !== 'proforma' ? (
                        <div className="flex justify-end gap-2">
                            <dt className="text-gray-500">Supply date:</dt>
                            <dd className="font-semibold">{formatDate(invoice.issue_date)}</dd>
                        </div>
                    ) : null}
                    {invoice.doc_type !== 'credit_note' ? (
                        <div className="flex justify-end gap-2">
                            <dt className="text-gray-500">{invoice.doc_type === 'proforma' ? 'Valid until:' : 'Due date:'}</dt>
                            <dd className="font-semibold">{formatDate(invoice.due_date)}</dd>
                        </div>
                    ) : null}
                </dl>
            </header>

            {/* Parties */}
            <section className="mt-4 grid grid-cols-2 gap-6">
                <div className="rounded border border-gray-400 p-3">
                    <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-600">Supplier</h2>
                    <dl className="space-y-1">
                        <PartyRow label="Company" value={supplier.name} />
                        <PartyRow label="Reg. no." value={supplier.reg_no} mono />
                        <PartyRow label="VAT ID" value={supplier.vat_number} mono />
                        <PartyRow label="Address" value={place(supplier)} />
                        <PartyRow label="Contact" value={supplier.representative} />
                        <PartyRow label="Email" value={supplier.email} />
                        <PartyRow label="IBAN" value={groupIban(supplier.iban)} mono />
                        <PartyRow label="BIC/SWIFT" value={supplier.bic} mono />
                        <PartyRow label="Bank" value={supplier.bank_name} />
                    </dl>
                </div>
                <div className="rounded border border-gray-400 p-3">
                    <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-600">Bill to</h2>
                    {client ? (
                        <dl className="space-y-1">
                            <PartyRow label="Company" value={client.name} />
                            <PartyRow label="Reg. no." value={client.reg_no} mono />
                            <PartyRow label="VAT ID" value={client.vat_number} mono />
                            <PartyRow label="Address" value={place(client)} />
                            <PartyRow label="Contact" value={client.representative} />
                        </dl>
                    ) : (
                        <p className="text-gray-500">—</p>
                    )}
                </div>
            </section>

            {/* Lines */}
            <table className="mt-5 w-full border-collapse text-[12px]">
                <thead>
                    <tr className="bg-gray-100">
                        <th className="w-8 border border-gray-400 px-2 py-1.5 text-center font-semibold">#</th>
                        <th className="border border-gray-400 px-2 py-1.5 text-left font-semibold">Description</th>
                        <th className="w-14 border border-gray-400 px-2 py-1.5 text-center font-semibold">Unit</th>
                        <th className="w-20 border border-gray-400 px-2 py-1.5 text-right font-semibold">Qty</th>
                        <th className="w-24 border border-gray-400 px-2 py-1.5 text-right font-semibold">Unit price</th>
                        <th className="w-28 border border-gray-400 px-2 py-1.5 text-right font-semibold">Amount ({cur})</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((it, index) => (
                        <tr key={index}>
                            <td className="border border-gray-400 px-2 py-1.5 text-center">{index + 1}</td>
                            <td className="border border-gray-400 px-2 py-1.5">{it.description}</td>
                            <td className="border border-gray-400 px-2 py-1.5 text-center">{it.unit}</td>
                            <td className="border border-gray-400 px-2 py-1.5 text-right font-mono">{formatQty(it.quantity)}</td>
                            <td className="border border-gray-400 px-2 py-1.5 text-right font-mono">{formatNumber(it.unit_price, 2)}</td>
                            <td className="border border-gray-400 px-2 py-1.5 text-right font-mono">{formatNumber(it.line_total, 2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Totals */}
            <section className="mt-4 flex items-start justify-between gap-6">
                <div className="max-w-[55%] space-y-1.5">
                    {isNote(invoice.doc_type) ? (
                        <p>
                            <span className="text-gray-500">Reason:</span> <span className="font-semibold">{invoice.note_reason}</span>
                        </p>
                    ) : null}
                    <p>
                        <span className="text-gray-500">Payment method:</span>{' '}
                        <span className="font-semibold">{PAYMENT_METHOD_LABEL[invoice.payment_method as PaymentMethod] ?? invoice.payment_method}</span>
                    </p>
                    {invoice.contract_number ? (
                        <p>
                            <span className="text-gray-500">Reference:</span> <span className="font-semibold">Contract no. {invoice.contract_number}</span>
                        </p>
                    ) : null}
                    {invoice.status === 'paid' ? (
                        <p className="font-semibold text-green-700">
                            Paid{invoice.paid_date ? ` on ${formatDate(invoice.paid_date)}` : ''}
                        </p>
                    ) : null}
                    {invoice.vat_rate === 0 ? (
                        <p className="text-gray-700">
                            <span className="text-gray-500">VAT note:</span>{' '}
                            <span className="font-semibold">{invoice.vat_exempt_reason || '—'}</span>
                        </p>
                    ) : null}
                    {invoice.notes ? (
                        <p className="whitespace-pre-wrap">
                            <span className="text-gray-500">Notes:</span> {invoice.notes}
                        </p>
                    ) : null}
                </div>

                <table className="w-72 shrink-0 border-collapse text-[12px]">
                    <tbody>
                        <tr>
                            <td className="border border-gray-400 px-3 py-1.5 text-gray-600">Subtotal{changeSuffix}</td>
                            <td className="border border-gray-400 px-3 py-1.5 text-right font-mono">{formatMoney(invoice.subtotal, cur)}</td>
                        </tr>
                        <tr>
                            <td className="border border-gray-400 px-3 py-1.5 text-gray-600">VAT {formatNumber(invoice.vat_rate, invoice.vat_rate % 1 ? 2 : 0)}%{changeSuffix}</td>
                            <td className="border border-gray-400 px-3 py-1.5 text-right font-mono">{formatMoney(invoice.vat_amount, cur)}</td>
                        </tr>
                        <tr className="bg-gray-100 text-[13px] font-bold">
                            <td className="border border-gray-400 px-3 py-2">
                                {invoice.doc_type === 'credit_note' ? 'Total credit' : invoice.doc_type === 'debit_note' ? 'Total additional charge' : 'Total due'}
                            </td>
                            <td className="border border-gray-400 px-3 py-2 text-right font-mono">{formatMoney(invoice.total_amount, cur)}</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <p className="mt-3 border-y border-gray-300 py-1.5">
                <span className="text-gray-500">Amount in words:</span>{' '}
                <span className="font-semibold">{amountInWords(invoice.total_amount, cur)}</span>
            </p>

            {invoice.doc_type !== 'credit_note' && supplier.iban && invoice.status !== 'paid' ? (
                <p className="mt-3 text-gray-700">
                    Please pay by bank transfer to <span className="font-mono font-semibold">{groupIban(supplier.iban)}</span>
                    {supplier.bic ? <> (BIC {supplier.bic})</> : null}, quoting <span className="font-semibold">{invoice.invoice_number}</span> as the payment reference.
                </p>
            ) : null}

        </article>
    );
}

/** publicView = the client opens the document via a link (no way back into the app). */
export default function InvoicePrint({ data, publicView = false }: { data: PrintInvoiceData; publicView?: boolean }) {
    return (
        <div>
            <div className="no-print mx-auto mb-5 flex w-[210mm] max-w-full flex-wrap items-center justify-between gap-3">
                {publicView ? (
                    <p className="text-sm text-slate-300">
                        <span className="font-semibold text-slate-100">{data.supplier.name}</span>
                        <span className="text-slate-500"> · to print or save a PDF, click &quot;Print&quot; and choose &quot;Save as PDF&quot;</span>
                    </p>
                ) : (
                    <Link
                        href={`/dashboard/invoices?highlight=${data.invoice.id}`}
                        className="inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-100"
                    >
                        <ArrowRight className="h-4 w-4 rotate-180" />
                        Back to invoices
                    </Link>
                )}

                <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
                >
                    <Printer className="h-4 w-4" />
                    {publicView ? 'Print / PDF' : 'Print'}
                </button>
            </div>

            {/* On a phone the A4 sheet scrolls horizontally instead of widening the whole page */}
            <div className="overflow-x-auto [contain:paint] print:overflow-visible print:[contain:none]">
                <Sheet data={data} />
            </div>
        </div>
    );
}
