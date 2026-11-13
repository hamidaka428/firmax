import { SQL_TZ } from '@/app/lib/format';
import type { NextRequest } from 'next/server';
import { query } from '@/app/lib/db';
import { getActiveCompany } from '@/app/lib/tenant';
import { getCurrentUser } from '@/app/lib/auth';
import { DOC_LABEL, signedAmount } from '@/app/lib/documents';
import type { DocType, PaymentMethod } from '@/app/lib/types';
import { PAYMENT_METHOD_LABEL, invoiceStatusLabel } from '@/app/lib/labels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ExportRow {
    invoice_number: string;
    issue_date: string;
    due_date: string | null;
    client_name: string;
    client_reg_no: string;
    client_vat: string;
    contract_number: string;
    subtotal: number;
    vat_rate: number;
    vat_amount: number;
    total_amount: number;
    status: string;
    payment_method: string;
    paid_date: string | null;
    vat_exempt_reason: string;
    doc_type: DocType;
    related_number: string;
}

/** CSV number: dot as the decimal separator, no thousands separator. */
function num(value: number): string {
    return value.toFixed(2);
}

function cell(value: string): string {
    const v = value ?? '';
    // Protection against CSV/formula injection in Excel
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** ISO 8601 dates (YYYY-MM-DD) — unambiguous in every locale. */
function isoDate(iso: string | null): string {
    return iso ? iso.slice(0, 10) : '';
}

/**
 * GET /api/export/invoices?month=2026-10
 * CSV (UTF-8 with BOM, comma-separated) with the active company's invoices — for your accountant / sales ledger.
 */
export async function GET(request: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return new Response('Sign-in required.', { status: 401 });
    const company = await getActiveCompany();
    if (!company) return new Response('No active company.', { status: 401 });

    const month = request.nextUrl.searchParams.get('month') ?? '';
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return new Response('Invalid month (expected YYYY-MM).', { status: 400 });
    }

    const params: unknown[] = [company.id];
    let filter = '';
    if (month) {
        params.push(`${month}-01`);
        filter = `AND i.issue_date >= $2::date AND i.issue_date < ($2::date + INTERVAL '1 month')`;
    }

    const res = await query<ExportRow>(
        `SELECT COALESCE(i.invoice_number, '') AS invoice_number, i.issue_date, i.due_date,
                COALESCE(cl.name, '') AS client_name, COALESCE(cl.reg_no, '') AS client_reg_no,
                COALESCE(cl.vat_number, '') AS client_vat, COALESCE(ct.contract_number, '') AS contract_number,
                i.subtotal, i.vat_rate, i.vat_amount, i.total_amount, i.status, i.payment_method,
                to_char(i.paid_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD') AS paid_date,
                i.vat_exempt_reason, i.doc_type, COALESCE(r.invoice_number, '') AS related_number
           FROM invoices i
           LEFT JOIN clients cl ON cl.id = i.client_id
           LEFT JOIN contracts ct ON ct.id = i.contract_id
           LEFT JOIN invoices r ON r.id = i.related_invoice_id AND i.doc_type IN ('credit_note', 'debit_note')
          WHERE i.company_id = $1 AND i.doc_type <> 'proforma' ${filter}
          ORDER BY i.invoice_number ASC, i.id ASC`,
        params,
    );

    const header = [
        'Type', 'Number', 'Related invoice', 'Issue date', 'Due date', 'Client', 'Client reg. no.', 'Client VAT ID', 'Contract',
        `Net (${company.currency})`, 'VAT %', `VAT (${company.currency})`, `Total (${company.currency})`,
        'Status', 'Payment method', 'Paid on', 'VAT exemption note',
    ];
    const lines = [header.map(cell).join(',')];
    for (const r of res.rows) {
        const cancelled = r.status === 'cancelled';
        // Credit notes have negative amounts — the sum is the actual revenue
        const sg = (v: number) => signedAmount(r.doc_type, v);
        lines.push(
            [
                cell(DOC_LABEL[r.doc_type]),
                cell(r.invoice_number),
                cell(r.related_number),
                isoDate(r.issue_date),
                isoDate(r.due_date),
                cell(r.client_name),
                cell(r.client_reg_no),
                cell(r.client_vat),
                cell(r.contract_number),
                num(cancelled ? 0 : sg(r.subtotal)),
                String(r.vat_rate),
                num(cancelled ? 0 : sg(r.vat_amount)),
                num(cancelled ? 0 : sg(r.total_amount)),
                cell(invoiceStatusLabel(r.status)),
                cell(PAYMENT_METHOD_LABEL[r.payment_method as PaymentMethod] ?? r.payment_method),
                isoDate(r.paid_date),
                cell(r.vat_exempt_reason),
            ].join(','),
        );
    }

    const totals = res.rows
        .filter((r) => r.status !== 'cancelled')
        .reduce(
            (a, r) => ({
                s: a.s + signedAmount(r.doc_type, r.subtotal),
                v: a.v + signedAmount(r.doc_type, r.vat_amount),
                t: a.t + signedAmount(r.doc_type, r.total_amount),
            }),
            { s: 0, v: 0, t: 0 },
        );
    lines.push(['TOTAL (excl. cancelled)', '', '', '', '', '', '', '', '', num(totals.s), '', num(totals.v), num(totals.t), '', '', '', ''].join(','));

    const body = '﻿' + lines.join('\r\n') + '\r\n';
    const fileName = `invoices_${(company.reg_no || String(company.id)).replace(/[^A-Za-z0-9_-]+/g, '')}_${month || 'all'}.csv`;
    return new Response(body, {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Cache-Control': 'no-store',
        },
    });
}
