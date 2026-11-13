import { SQL_TZ } from '@/app/lib/format';
import { query } from '@/app/lib/db';
import type { ContractOption, Invoice, InvoiceItem } from '@/app/lib/types';

type InvoiceRow = Omit<Invoice, 'items'>;

/** The company's invoices with their lines. With onlyId returns just one invoice. */
export async function loadInvoices(companyId: number, onlyId?: number): Promise<Invoice[]> {
    const params: unknown[] = [companyId];
    let extra = '';
    if (onlyId !== undefined) {
        params.push(onlyId);
        extra = 'AND i.id = $2';
    }

    const res = await query<InvoiceRow>(
        `SELECT i.id, COALESCE(i.invoice_number, '') AS invoice_number,
                i.client_id, COALESCE(cl.name, '—') AS client_name,
                i.contract_id, COALESCE(ct.contract_number, '') AS contract_number,
                i.issue_date, i.due_date, i.subtotal, i.vat_rate, i.vat_exempt_reason, i.vat_amount, i.total_amount,
                i.status, i.payment_method,
                to_char(i.paid_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD') AS paid_date,
                i.file_path, i.file_name, i.notes,
                i.doc_type, i.related_invoice_id, i.note_reason,
                COALESCE(r.invoice_number, '') AS related_number, r.issue_date AS related_date,
                COALESCE((SELECT x.invoice_number FROM invoices x
                           WHERE x.related_invoice_id = i.id AND x.doc_type = 'invoice' AND i.doc_type = 'proforma'
                           ORDER BY x.id LIMIT 1), '') AS converted_number,
                i.series_key, i.bank_account_id, i.share_token,
                to_char(i.sent_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD HH24:MI') AS sent_at, i.sent_to,
                to_char(i.viewed_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD HH24:MI') AS viewed_at
           FROM invoices i
           LEFT JOIN clients cl ON cl.id = i.client_id
           LEFT JOIN contracts ct ON ct.id = i.contract_id
           LEFT JOIN invoices r ON r.id = i.related_invoice_id
          WHERE i.company_id = $1 ${extra}
          ORDER BY i.issue_date DESC, i.id DESC`,
        params,
    );
    if (res.rows.length === 0) return [];

    const ids = res.rows.map((r) => r.id);
    const items = await query<InvoiceItem & { invoice_id: number }>(
        `SELECT id, invoice_id, product_id, description, unit, quantity, unit_price, line_total
           FROM invoice_items
          WHERE invoice_id = ANY($1::int[])
          ORDER BY invoice_id, position, id`,
        [ids],
    );

    const byInvoice = new Map<number, InvoiceItem[]>();
    for (const row of items.rows) {
        const { invoice_id, ...item } = row;
        const list = byInvoice.get(invoice_id) ?? [];
        list.push(item);
        byInvoice.set(invoice_id, list);
    }

    return res.rows.map((r) => ({ ...r, items: byInvoice.get(r.id) ?? [] }));
}

/** The company's contracts with their lines — for "Fill from contract" in the form. */
export async function loadContractOptions(companyId: number): Promise<ContractOption[]> {
    const contracts = await query<{ id: number; contract_number: string; title: string; client_id: number | null }>(
        `SELECT id, COALESCE(contract_number, '') AS contract_number, title, client_id
           FROM contracts WHERE company_id = $1 ORDER BY id DESC`,
        [companyId],
    );
    if (contracts.rows.length === 0) return [];

    const items = await query<{
        contract_id: number;
        product_id: number | null;
        description: string;
        unit: string;
        quantity: number;
        unit_price: number;
    }>(
        `SELECT contract_id, product_id, description, unit, quantity, unit_price
           FROM contract_items
          WHERE contract_id = ANY($1::int[])
          ORDER BY contract_id, position, id`,
        [contracts.rows.map((c) => c.id)],
    );

    const byContract = new Map<number, ContractOption['items']>();
    for (const row of items.rows) {
        const list = byContract.get(row.contract_id) ?? [];
        list.push({
            product_id: row.product_id,
            description: row.description,
            unit: row.unit,
            quantity: row.quantity,
            unit_price: row.unit_price,
        });
        byContract.set(row.contract_id, list);
    }

    return contracts.rows.map((c) => ({ ...c, items: byContract.get(c.id) ?? [] }));
}
