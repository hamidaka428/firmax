import { SQL_TZ } from '@/app/lib/format';
import { query } from '@/app/lib/db';
import { SQL_NEXT_PERIOD } from '@/app/lib/recurring';
import type { ClientOption, Contract, ContractItem, ProductOption, StockUpdate } from '@/app/lib/types';

type ContractRow = Omit<Contract, 'items'>;

/** The company's contracts with their lines. With onlyId returns just one contract. */
export async function loadContracts(companyId: number, onlyId?: number): Promise<Contract[]> {
    const params: unknown[] = [companyId];
    let extra = '';
    if (onlyId !== undefined) {
        params.push(onlyId);
        extra = 'AND c.id = $2';
    }

    const res = await query<ContractRow>(
        `SELECT c.id, COALESCE(c.contract_number, '') AS contract_number, c.title, c.contract_type,
                c.client_id, COALESCE(cl.name, '—') AS client_name,
                c.start_date, c.end_date, c.total_price, c.status,
                c.file_path, c.file_name, c.notes, c.template_id, c.body,
                c.billing_months, c.billing_start, c.billing_issued, c.billing_due_days,
                c.billing_vat_rate, c.billing_vat_exempt_reason, c.billing_auto_email,
                c.share_token, c.sent_to,
                to_char(c.sent_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD HH24:MI') AS sent_at,
                to_char(c.viewed_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD HH24:MI') AS viewed_at,
                CASE WHEN c.billing_months > 0 AND c.billing_start IS NOT NULL AND c.status = 'active'
                          AND (c.end_date IS NULL OR ${SQL_NEXT_PERIOD} <= c.end_date)
                     THEN ${SQL_NEXT_PERIOD} END AS billing_next,
                (SELECT COUNT(*) FROM invoices i WHERE i.contract_id = c.id AND i.status <> 'cancelled') AS invoice_count,
                (SELECT COUNT(*) FROM contract_items ci WHERE ci.contract_id = c.id AND ci.stock_deducted) AS deducted_count
           FROM contracts c
           LEFT JOIN clients cl ON cl.id = c.client_id
          WHERE c.company_id = $1 ${extra}
          ORDER BY c.id DESC`,
        params,
    );
    if (res.rows.length === 0) return [];

    const ids = res.rows.map((r) => r.id);
    const items = await query<ContractItem & { contract_id: number }>(
        `SELECT id, contract_id, product_id, description, unit, quantity, unit_price, line_total, stock_deducted
           FROM contract_items
          WHERE contract_id = ANY($1::int[])
          ORDER BY contract_id, position, id`,
        [ids],
    );

    const byContract = new Map<number, ContractItem[]>();
    for (const row of items.rows) {
        const { contract_id, ...item } = row;
        const list = byContract.get(contract_id) ?? [];
        list.push(item);
        byContract.set(contract_id, list);
    }

    return res.rows.map((r) => ({ ...r, items: byContract.get(r.id) ?? [] }));
}

export async function loadClientOptions(companyId: number): Promise<ClientOption[]> {
    const res = await query<ClientOption>(
        `SELECT id, name, reg_no, vat_number, city, address, country, representative, phone, email
           FROM clients WHERE company_id = $1 ORDER BY name ASC`,
        [companyId],
    );
    return res.rows;
}

export async function loadProductOptions(companyId: number): Promise<ProductOption[]> {
    const res = await query<ProductOption>(
        `SELECT id, COALESCE(sku, '') AS sku, name, unit, qty_in_stock, unit_price
           FROM products WHERE company_id = $1 ORDER BY category ASC, name ASC`,
        [companyId],
    );
    return res.rows;
}

/** Current stock of the given products (after deduction/restore). */
export async function readStock(companyId: number, productIds: number[]): Promise<StockUpdate[]> {
    if (productIds.length === 0) return [];
    const res = await query<StockUpdate>(
        `SELECT id, qty_in_stock FROM products WHERE company_id = $1 AND id = ANY($2::int[])`,
        [companyId, productIds],
    );
    return res.rows;
}
