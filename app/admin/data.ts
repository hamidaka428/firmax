// app/admin/data.ts
// Admin panel queries — the only place that reads ACROSS all companies.
// Every function here is called only after requireAdmin().

import { SQL_TZ } from '@/app/lib/format';
import { query } from '@/app/lib/db';

export interface AdminCompanyRow {
    id: number;
    name: string;
    reg_no: string;
    city: string;
    email: string;
    phone: string;
    currency: string;
    created_at: string;
    last_activity: string;
    clients: number;
    products: number;
    contracts: number;
    invoices: number;
    invoices_30d: number;
    invoiced_total: number;
    has_logo: boolean;
    owner_email: string | null;
}

export interface AdminOverview {
    users: number;
    new_users_month: number;
    companies: number;
    new_this_month: number;
    active_30d: number;
    clients: number;
    contracts: number;
    invoices: number;
    invoices_30d: number;
    invoiced_by_currency: { currency: string; total: number }[];
    signups_by_month: { month: string; count: number }[];
}

/** Last activity = the latest of: company creation, client, contract, invoice. */
const LAST_ACTIVITY = `GREATEST(
        c.created_at,
        COALESCE((SELECT MAX(created_at) FROM clients   WHERE company_id = c.id), c.created_at),
        COALESCE((SELECT MAX(created_at) FROM contracts WHERE company_id = c.id), c.created_at),
        COALESCE((SELECT MAX(created_at) FROM invoices  WHERE company_id = c.id), c.created_at)
    )`;

export async function loadAdminCompanies(onlyId?: number): Promise<AdminCompanyRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (onlyId !== undefined) {
        params.push(onlyId);
        where = 'WHERE c.id = $1';
    }
    const res = await query<AdminCompanyRow>(
        `SELECT c.id, c.name, c.reg_no, c.city, c.email, c.phone, c.currency,
                to_char(c.created_at AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD') AS created_at,
                to_char(${LAST_ACTIVITY} AT TIME ZONE ${SQL_TZ}, 'YYYY-MM-DD') AS last_activity,
                (SELECT COUNT(*) FROM clients   WHERE company_id = c.id)::int AS clients,
                (SELECT COUNT(*) FROM products  WHERE company_id = c.id)::int AS products,
                (SELECT COUNT(*) FROM contracts WHERE company_id = c.id)::int AS contracts,
                (SELECT COUNT(*) FROM invoices  WHERE company_id = c.id)::int AS invoices,
                (SELECT COUNT(*) FROM invoices  WHERE company_id = c.id
                    AND created_at >= now() - INTERVAL '30 days')::int AS invoices_30d,
                COALESCE((SELECT SUM((CASE WHEN doc_type = 'credit_note' THEN -total_amount ELSE total_amount END)) FROM invoices
                    WHERE company_id = c.id AND status <> 'cancelled' AND doc_type <> 'proforma'), 0)::float8 AS invoiced_total,
                (c.logo_path IS NOT NULL) AS has_logo,
                u.email AS owner_email
           FROM companies c
           LEFT JOIN users u ON u.id = c.owner_id
           ${where}
          ORDER BY c.created_at DESC, c.id DESC`,
        params,
    );
    return res.rows;
}

export async function loadAdminOverview(): Promise<AdminOverview> {
    const [totals, byCurrency, signups] = await Promise.all([
        query<Omit<AdminOverview, 'invoiced_by_currency' | 'signups_by_month'>>(
            `SELECT
                (SELECT COUNT(*) FROM users)::int AS users,
                (SELECT COUNT(*) FROM users
                   WHERE created_at >= date_trunc('month', now() AT TIME ZONE ${SQL_TZ}) AT TIME ZONE ${SQL_TZ})::int AS new_users_month,
                (SELECT COUNT(*) FROM companies)::int AS companies,
                (SELECT COUNT(*) FROM companies
                   WHERE created_at >= date_trunc('month', now() AT TIME ZONE ${SQL_TZ}) AT TIME ZONE ${SQL_TZ})::int AS new_this_month,
                (SELECT COUNT(*) FROM companies c
                   WHERE ${LAST_ACTIVITY} >= now() - INTERVAL '30 days')::int AS active_30d,
                (SELECT COUNT(*) FROM clients)::int   AS clients,
                (SELECT COUNT(*) FROM contracts)::int AS contracts,
                (SELECT COUNT(*) FROM invoices)::int  AS invoices,
                (SELECT COUNT(*) FROM invoices WHERE created_at >= now() - INTERVAL '30 days')::int AS invoices_30d`,
        ),
        query<{ currency: string; total: number }>(
            `SELECT co.currency, SUM((CASE WHEN i.doc_type = 'credit_note' THEN -i.total_amount ELSE i.total_amount END))::float8 AS total
               FROM invoices i JOIN companies co ON co.id = i.company_id
              WHERE i.status <> 'cancelled' AND i.doc_type <> 'proforma'
              GROUP BY co.currency
              ORDER BY total DESC`,
        ),
        query<{ month: string; count: number }>(
            `WITH months AS (
                SELECT generate_series(
                    date_trunc('month', now() AT TIME ZONE ${SQL_TZ}) - INTERVAL '11 months',
                    date_trunc('month', now() AT TIME ZONE ${SQL_TZ}),
                    INTERVAL '1 month') AS m
             )
             SELECT to_char(m, 'YYYY-MM') AS month,
                    (SELECT COUNT(*) FROM companies
                      WHERE date_trunc('month', created_at AT TIME ZONE ${SQL_TZ}) = m)::int AS count
               FROM months ORDER BY m`,
        ),
    ]);
    return { ...totals.rows[0], invoiced_by_currency: byCurrency.rows, signups_by_month: signups.rows };
}

export interface AdminCompanyDetail {
    company: AdminCompanyRow & {
        vat_number: string;
        address: string;
        representative: string;
        iban: string;
        templates: number;
    };
    recentInvoices: { id: number; invoice_number: string; issue_date: string; client_name: string; total_amount: number; status: string }[];
    recentContracts: { id: number; contract_number: string; title: string; start_date: string; client_name: string; total_price: number; status: string }[];
    invoicedByMonth: { month: string; total: number; count: number }[];
}

export async function loadAdminCompany(id: number): Promise<AdminCompanyDetail | null> {
    const [row] = await loadAdminCompanies(id);
    if (!row) return null;

    const [extra, invoices, contracts, months] = await Promise.all([
        query<{ vat_number: string; address: string; representative: string; iban: string; templates: number }>(
            `SELECT vat_number, address, representative, iban,
                    (SELECT COUNT(*) FROM contract_templates WHERE company_id = c.id)::int AS templates
               FROM companies c WHERE id = $1`,
            [id],
        ),
        query<AdminCompanyDetail['recentInvoices'][number]>(
            `SELECT i.id, COALESCE(i.invoice_number, '') AS invoice_number, i.issue_date,
                    COALESCE(cl.name, '—') AS client_name, i.total_amount::float8 AS total_amount, i.status
               FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
              WHERE i.company_id = $1
              ORDER BY i.issue_date DESC, i.id DESC LIMIT 8`,
            [id],
        ),
        query<AdminCompanyDetail['recentContracts'][number]>(
            `SELECT ct.id, ct.contract_number, ct.title, ct.start_date,
                    COALESCE(cl.name, '—') AS client_name, ct.total_price::float8 AS total_price, ct.status
               FROM contracts ct LEFT JOIN clients cl ON cl.id = ct.client_id
              WHERE ct.company_id = $1
              ORDER BY ct.start_date DESC, ct.id DESC LIMIT 8`,
            [id],
        ),
        query<{ month: string; total: number; count: number }>(
            `WITH months AS (
                SELECT generate_series(
                    date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
                    date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS m
             )
             SELECT to_char(m, 'YYYY-MM') AS month,
                    COALESCE(SUM((CASE WHEN i.doc_type = 'credit_note' THEN -i.total_amount ELSE i.total_amount END)) FILTER (WHERE i.status <> 'cancelled'), 0)::float8 AS total,
                    COUNT(i.id)::int AS count
               FROM months
               LEFT JOIN invoices i ON i.company_id = $1 AND i.doc_type <> 'proforma' AND date_trunc('month', i.issue_date) = m
              GROUP BY m ORDER BY m`,
            [id],
        ),
    ]);

    return {
        company: { ...row, ...extra.rows[0] },
        recentInvoices: invoices.rows,
        recentContracts: contracts.rows,
        invoicedByMonth: months.rows,
    };
}
