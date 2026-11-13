// app/lib/invoice-print-data.ts
// Data for printing a document — shared by the internal print view (/dashboard/invoices/[id]/print)
// and the public online link (/i/[token]).

import { SQL_TZ } from './format';
import { query } from './db';
import type { PrintInvoiceData } from '@/app/dashboard/invoices/[id]/print/InvoicePrint';
import type { DocType } from './types';

interface Row {
    id: number;
    company_id: number;
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
    client_name: string | null;
    client_reg_no: string | null;
    client_vat: string | null;
    client_city: string | null;
    client_country: string | null;
    client_address: string | null;
    client_representative: string | null;
    client_email: string | null;
    co_name: string;
    co_reg_no: string;
    co_vat: string;
    co_city: string;
    co_country: string;
    co_address: string;
    co_representative: string;
    co_phone: string;
    co_email: string;
    co_bank: string;
    co_iban: string;
    co_bic: string;
    co_currency: string;
    co_logo: string | null;
    owner_id: number | null;
    share_token: string | null;
}

export interface LoadedPrint {
    data: PrintInvoiceData;
    companyId: number;
    ownerId: number | null;
    logoPath: string | null;
    clientEmail: string;
    shareToken: string | null;
}

/**
 * by.id + companyId → internal print (only a document of this company);
 * by.token → public link. logoUrl allows a different logo URL (the public one doesn't go through a session).
 */
export async function loadInvoicePrint(
    by: { id: number; companyId: number } | { token: string },
    logoUrl: (row: { id: number; logoPath: string; token: string | null }) => string,
): Promise<LoadedPrint | null> {
    const where = 'token' in by ? 'i.share_token = $1' : 'i.id = $1 AND i.company_id = $2';
    const params = 'token' in by ? [by.token] : [by.id, by.companyId];
    const res = await query<Row>(
        `SELECT i.id, i.company_id, COALESCE(i.invoice_number, '') AS invoice_number, i.issue_date, i.due_date,
                i.subtotal, i.vat_rate, i.vat_exempt_reason, i.vat_amount, i.total_amount, i.status, i.payment_method,
                to_char(i.paid_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD') AS paid_date,
                i.notes, COALESCE(ct.contract_number, '') AS contract_number,
                i.doc_type, i.note_reason, COALESCE(r.invoice_number, '') AS related_number, r.issue_date AS related_date,
                cl.name AS client_name, cl.reg_no AS client_reg_no, cl.vat_number AS client_vat,
                cl.city AS client_city, cl.country AS client_country, cl.address AS client_address, cl.representative AS client_representative, cl.email AS client_email,
                co.name AS co_name, co.reg_no AS co_reg_no, co.vat_number AS co_vat, co.city AS co_city, co.country AS co_country, co.address AS co_address,
                co.representative AS co_representative, co.phone AS co_phone, co.email AS co_email,
                COALESCE(ba.bank_name, co.bank_name) AS co_bank, COALESCE(ba.iban, co.iban) AS co_iban, COALESCE(ba.bic, co.bic) AS co_bic,
                co.currency AS co_currency, co.logo_path AS co_logo,
                co.owner_id, i.share_token
           FROM invoices i
           JOIN companies co ON co.id = i.company_id
           LEFT JOIN bank_accounts ba ON ba.id = i.bank_account_id AND ba.company_id = i.company_id
           LEFT JOIN clients cl ON cl.id = i.client_id
           LEFT JOIN contracts ct ON ct.id = i.contract_id
           LEFT JOIN invoices r ON r.id = i.related_invoice_id
          WHERE ${where}`,
        params,
    );
    const row = res.rows[0];
    if (!row) return null;

    const items = await query<PrintInvoiceData['items'][number]>(
        `SELECT description, unit, quantity, unit_price, line_total
           FROM invoice_items WHERE invoice_id = $1 ORDER BY position, id`,
        [row.id],
    );

    const data: PrintInvoiceData = {
        invoice: {
            id: row.id,
            invoice_number: row.invoice_number,
            issue_date: row.issue_date,
            due_date: row.due_date,
            subtotal: row.subtotal,
            vat_rate: row.vat_rate,
            vat_exempt_reason: row.vat_exempt_reason,
            vat_amount: row.vat_amount,
            total_amount: row.total_amount,
            status: row.status,
            payment_method: row.payment_method,
            paid_date: row.paid_date,
            notes: row.notes,
            contract_number: row.contract_number,
            doc_type: row.doc_type,
            note_reason: row.note_reason,
            related_number: row.related_number,
            related_date: row.related_date,
        },
        items: items.rows,
        supplier: {
            name: row.co_name,
            reg_no: row.co_reg_no,
            vat_number: row.co_vat,
            city: row.co_city,
            country: row.co_country,
            address: row.co_address,
            representative: row.co_representative,
            phone: row.co_phone,
            email: row.co_email,
            bank_name: row.co_bank,
            iban: row.co_iban,
            bic: row.co_bic,
            currency: row.co_currency,
            logo_url: row.co_logo ? logoUrl({ id: row.id, logoPath: row.co_logo, token: row.share_token }) : null,
        },
        client: row.client_name
            ? {
                  name: row.client_name,
                  reg_no: row.client_reg_no ?? '',
                  vat_number: row.client_vat ?? '',
                  city: row.client_city ?? '',
                  country: row.client_country ?? '',
                  address: row.client_address ?? '',
                  representative: row.client_representative ?? '',
              }
            : null,
    };

    return {
        data,
        companyId: row.company_id,
        ownerId: row.owner_id,
        logoPath: row.co_logo,
        clientEmail: row.client_email ?? '',
        shareToken: row.share_token,
    };
}
