// app/components/ContractDocument.tsx
// Renders a filled-in contract as a sheet of paper (editor preview and A4 print).

import { Fragment } from 'react';
import { parseDocument, splitBold } from '@/app/lib/contract-template';
import { formatMoney, formatQty, round } from '@/app/lib/format';

export interface DocumentItem {
    description: string;
    unit: string;
    quantity: number;
    unit_price: number;
}

export interface DocumentSignature {
    role: string;
    name: string;
    person: string;
}

interface ContractDocumentProps {
    text: string;
    items: DocumentItem[];
    currency: string;
    signatures?: [DocumentSignature, DocumentSignature];
    /** Smaller font for the editor preview */
    compact?: boolean;
}

function Inline({ line }: { line: string }) {
    return (
        <>
            {splitBold(line).map((part, i) =>
                part.bold ? (
                    <strong key={i} className="font-semibold">
                        {part.text}
                    </strong>
                ) : (
                    <Fragment key={i}>{part.text}</Fragment>
                ),
            )}
        </>
    );
}

function ItemsTable({ items, currency }: { items: DocumentItem[]; currency: string }) {
    const total = round(items.reduce((s, it) => s + round(it.quantity * it.unit_price, 2), 0), 2);
    if (items.length === 0) {
        return <p className="my-3 italic text-gray-500">[The line-items table will appear here once you add lines.]</p>;
    }
    return (
        <table className="my-3 w-full border-collapse text-[0.95em]">
            <thead>
                <tr className="bg-gray-100">
                    <th className="border border-gray-400 px-2 py-1 text-left">#</th>
                    <th className="border border-gray-400 px-2 py-1 text-left">Description</th>
                    <th className="border border-gray-400 px-2 py-1 text-center">Unit</th>
                    <th className="border border-gray-400 px-2 py-1 text-right">Quantity</th>
                    <th className="border border-gray-400 px-2 py-1 text-right">Unit price</th>
                    <th className="border border-gray-400 px-2 py-1 text-right">Amount</th>
                </tr>
            </thead>
            <tbody>
                {items.map((it, i) => (
                    <tr key={i}>
                        <td className="border border-gray-400 px-2 py-1">{i + 1}</td>
                        <td className="border border-gray-400 px-2 py-1">{it.description}</td>
                        <td className="border border-gray-400 px-2 py-1 text-center">{it.unit}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right font-mono">{formatQty(it.quantity)}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right font-mono">{formatMoney(it.unit_price, currency)}</td>
                        <td className="border border-gray-400 px-2 py-1 text-right font-mono">
                            {formatMoney(round(it.quantity * it.unit_price, 2), currency)}
                        </td>
                    </tr>
                ))}
                <tr className="font-semibold">
                    <td colSpan={5} className="border border-gray-400 px-2 py-1 text-right">
                        Total (excl. VAT)
                    </td>
                    <td className="border border-gray-400 px-2 py-1 text-right font-mono">{formatMoney(total, currency)}</td>
                </tr>
            </tbody>
        </table>
    );
}

export default function ContractDocument({ text, items, currency, signatures, compact = false }: ContractDocumentProps) {
    const blocks = parseDocument(text);

    const elements = blocks.map((b, i) => {
        const prev = blocks[i - 1];
        switch (b.kind) {
            case 'title':
                return (
                    <h1 key={i} className="mb-1 text-center text-[1.45em] font-bold tracking-wide">
                        <Inline line={b.text} />
                    </h1>
                );
            case 'heading':
                // A subtitle right below the title (e.g. "No. CT-2026-0001") is centred
                return prev?.kind === 'title' ? (
                    <p key={i} className="mb-5 text-center font-semibold">
                        <Inline line={b.text} />
                    </p>
                ) : (
                    <h2 key={i} className="mb-1.5 mt-4 font-bold">
                        <Inline line={b.text} />
                    </h2>
                );
            case 'items':
                return <ItemsTable key={i} items={items} currency={currency} />;
            default:
                return (
                    <p key={i} className="mb-2.5 text-justify indent-6">
                        {b.lines.map((line, j) => (
                            <Fragment key={j}>
                                {j > 0 ? <br /> : null}
                                <Inline line={line} />
                            </Fragment>
                        ))}
                    </p>
                );
        }
    });

    // The last paragraph and the signatures print together — signatures never end up alone on a new page
    const last = signatures ? elements.pop() : null;

    return (
        <div className={`font-serif text-black ${compact ? 'text-[12px] leading-relaxed' : 'text-[13px] leading-relaxed'}`}>
            {elements}

            {signatures ? (
                <div className="break-inside-avoid">
                    {last}
                    <section className="mt-10 grid grid-cols-2 gap-12">
                        {signatures.map((s) => (
                            <div key={s.role} className="text-center">
                                <p className="font-bold">{s.role}:</p>
                                <div className="mt-12 border-t border-black pt-1">
                                    <p className="font-semibold">{s.name || ' '}</p>
                                    <p className="text-gray-600">{s.person || ' '}</p>
                                </div>
                            </div>
                        ))}
                    </section>
                </div>
            ) : null}
        </div>
    );
}
