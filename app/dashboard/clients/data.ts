import { query } from '@/app/lib/db';
import type { ClientRow } from '@/app/lib/types';

/** The company's clients with summary totals. With onlyId returns just one client. */
export async function loadClients(companyId: number, onlyId?: number): Promise<ClientRow[]> {
    const params: unknown[] = [companyId];
    let extra = '';
    if (onlyId !== undefined) {
        params.push(onlyId);
        extra = 'AND c.id = $2';
    }

    const res = await query<ClientRow>(
        `SELECT c.id, c.name, c.reg_no, c.vat_number, c.city, c.address, c.country, c.representative, c.phone, c.email, c.notes,
                (SELECT COUNT(*) FROM contracts ct WHERE ct.client_id = c.id) AS contract_count,
                COALESCE((SELECT SUM((CASE WHEN i.doc_type = 'credit_note' THEN -i.total_amount ELSE i.total_amount END)) FROM invoices i
                           WHERE i.client_id = c.id AND i.status <> 'cancelled' AND i.doc_type <> 'proforma'), 0) AS invoiced_total,
                COALESCE((SELECT SUM((CASE WHEN i.doc_type = 'credit_note' THEN -i.total_amount ELSE i.total_amount END)) FROM invoices i
                           WHERE i.client_id = c.id AND i.status = 'pending' AND i.doc_type <> 'proforma'), 0) AS unpaid_total
           FROM clients c
          WHERE c.company_id = $1 ${extra}
          ORDER BY c.name ASC`,
        params,
    );
    return res.rows;
}
