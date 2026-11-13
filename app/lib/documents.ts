// app/lib/documents.ts
// Document types: invoice, credit note, debit note and proforma invoice.
// Used both in the browser and in SQL queries (signed amounts for revenue and receivables).

import type { DocType } from './types';

export const DOC_LABEL: Record<DocType, string> = {
    invoice: 'Invoice',
    credit_note: 'Credit note',
    debit_note: 'Debit note',
    proforma: 'Proforma invoice',
};

/** Title on the printed document */
export const DOC_TITLE: Record<DocType, string> = {
    invoice: 'INVOICE',
    credit_note: 'CREDIT NOTE',
    debit_note: 'DEBIT NOTE',
    proforma: 'PROFORMA INVOICE',
};

/** Short label in tables */
export const DOC_SHORT: Record<DocType, string> = {
    invoice: 'INV',
    credit_note: 'CN',
    debit_note: 'DN',
    proforma: 'PF',
};

export function isNote(t: DocType): boolean {
    return t === 'credit_note' || t === 'debit_note';
}

/** Does the document count towards revenue and receivables? (A proforma is not a tax document.) */
export function countsInRevenue(t: DocType): boolean {
    return t !== 'proforma';
}

/** Signed value: a credit note reduces revenue and the receivable. */
export function signedAmount(t: DocType, amount: number): number {
    return t === 'credit_note' ? -amount : amount;
}

/** Has a payment term (can be overdue) — invoices and debit notes. */
export function hasDueDate(t: DocType): boolean {
    return t === 'invoice' || t === 'debit_note' || t === 'proforma';
}

/* ---------------------------- SQL helpers ---------------------------- */

/** SQL expression: signed amount (credit notes are negative). alias e.g. 'i.' */
export function sqlSigned(column: string, alias = ''): string {
    return `(CASE WHEN ${alias}doc_type = 'credit_note' THEN -${alias}${column} ELSE ${alias}${column} END)`;
}

/** SQL condition: tax documents only (no proformas). */
export function sqlTaxDocs(alias = ''): string {
    return `${alias}doc_type <> 'proforma'`;
}
