// app/lib/recurring.ts
// Recurring invoices from contracts (rentals, subscriptions, maintenance).
//
// A contract stores: every how many months (billing_months), the first date (billing_start) and how many periods
// have already been invoiced (billing_issued). The next period starts at billing_start + issued × months —
// computed from the anchor so the day doesn't drift (31 Jan → 28 Feb → 31 Mar, not 28 Mar).
//
// The invoice is issued with today's date (numbering must be chronological) and the period is stated in the note.
// Missed periods (e.g. the server was down) are caught up — one invoice per period.
// The same period can never be invoiced twice (unique index on contract_id + billing_period_start).

import { query, withTransaction } from './db';
import type { DbClient } from './db';
import { SQL_TODAY, formatDate, round } from './format';
import { assignNumber } from './numbering';
import { ensureInvoiceToken, parseRecipients, sendInvoiceMail } from './share';
import type { InvoiceMailInfo } from './share';

export { BILLING_OPTIONS, billingShort } from './recurring-options';

/** Start date of the next period, computed in SQL from the anchor. */
export const SQL_NEXT_PERIOD = `(c.billing_start + make_interval(months => c.billing_issued * c.billing_months))::date`;

/** At most this many missed periods are caught up at once per contract. */
const MAX_CATCH_UP = 12;

export interface GeneratedInvoice {
    company_id: number;
    contract_id: number;
    invoice_id: number;
    invoice_number: string;
    period_start: string;
    total_amount: number;
}

interface DueContract {
    id: number;
    company_id: number;
    auto_email: boolean;
}

/**
 * Generates all due recurring invoices.
 * companyId = only for this company (when the dashboard opens), otherwise for all companies (cron).
 */
export async function runRecurringBilling(companyId?: number): Promise<GeneratedInvoice[]> {
    const params: unknown[] = [];
    let where = '';
    if (companyId !== undefined) {
        params.push(companyId);
        where = 'AND c.company_id = $1';
    }
    const due = await query<DueContract>(
        `SELECT c.id, c.company_id, c.billing_auto_email AS auto_email
           FROM contracts c
          WHERE c.billing_months > 0 AND c.billing_start IS NOT NULL AND c.status = 'active'
            AND c.client_id IS NOT NULL
            AND ${SQL_NEXT_PERIOD} <= ${SQL_TODAY}
            AND (c.end_date IS NULL OR ${SQL_NEXT_PERIOD} <= c.end_date)
            ${where}
          ORDER BY c.company_id, c.id`,
        params,
    );

    const out: GeneratedInvoice[] = [];
    for (const row of due.rows) {
        for (let i = 0; i < MAX_CATCH_UP; i++) {
            let made: GeneratedInvoice | null | 'skip';
            try {
                made = await withTransaction((client) => generateOne(client, row.company_id, row.id));
            } catch (error) {
                console.error(`Recurring invoice for contract ${row.id}:`, error);
                break;
            }
            if (made === null) break; // no more due periods
            if (made !== 'skip') {
                out.push(made);
                if (row.auto_email) await autoSend(made);
            }
        }
    }
    return out;
}

/** One invoice for the next due period. null = nothing to issue; 'skip' = the period is already invoiced. */
async function generateOne(client: DbClient, companyId: number, contractId: number): Promise<GeneratedInvoice | null | 'skip'> {
    // SKIP LOCKED: if another request (cron and dashboard at the same time) is already processing the contract — skip
    const res = await client.query<{
        contract_number: string | null;
        client_id: number;
        months: number;
        period_start: string;
        period_end: string;
        due_days: number;
        vat_rate: number;
        vat_exempt_reason: string;
        today: string;
    }>(
        `SELECT c.contract_number, c.client_id, c.billing_months AS months,
                ${SQL_NEXT_PERIOD} AS period_start,
                LEAST(c.end_date, (c.billing_start + make_interval(months => (c.billing_issued + 1) * c.billing_months))::date - 1) AS period_end,
                c.billing_due_days AS due_days, c.billing_vat_rate AS vat_rate, c.billing_vat_exempt_reason AS vat_exempt_reason,
                ${SQL_TODAY} AS today
           FROM contracts c
          WHERE c.id = $1 AND c.company_id = $2 AND c.billing_months > 0 AND c.billing_start IS NOT NULL
            AND c.status = 'active' AND c.client_id IS NOT NULL
            AND ${SQL_NEXT_PERIOD} <= ${SQL_TODAY}
            AND (c.end_date IS NULL OR ${SQL_NEXT_PERIOD} <= c.end_date)
          FOR UPDATE SKIP LOCKED`,
        [contractId, companyId],
    );
    const c = res.rows[0];
    if (!c) return null;

    // There is already an invoice for this period (e.g. the date was changed by hand) → just advance the counter
    const exists = await client.query(
        `SELECT 1 FROM invoices WHERE contract_id = $1 AND billing_period_start = $2`,
        [contractId, c.period_start],
    );
    if (exists.rows.length > 0) {
        await client.query(`UPDATE contracts SET billing_issued = billing_issued + 1 WHERE id = $1`, [contractId]);
        return 'skip';
    }

    const sums = await client.query<{ subtotal: number; cnt: number }>(
        `SELECT COALESCE(SUM(line_total), 0) AS subtotal, COUNT(*) AS cnt FROM contract_items WHERE contract_id = $1`,
        [contractId],
    );
    if (sums.rows[0].cnt === 0) return null;

    const vatRate = Number(c.vat_rate);
    const subtotal = round(sums.rows[0].subtotal, 2);
    const vatAmount = round((subtotal * vatRate) / 100, 2);
    const total = round(subtotal + vatAmount, 2);
    const due = new Date(Date.parse(`${c.today}T00:00:00Z`) + c.due_days * 86_400_000).toISOString().slice(0, 10);
    const note = [
        c.contract_number ? `Under contract ${c.contract_number}` : 'Under contract',
        `for the period ${formatDate(c.period_start)} – ${formatDate(c.period_end)}`,
    ].join(' ');

    const num = { rows: [{ n: (await assignNumber(client, companyId, 'invoice')).number }] };
    const inv = await client.query<{ id: number }>(
        `INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                               subtotal, vat_rate, vat_amount, total_amount, status, payment_method, notes,
                               vat_exempt_reason, doc_type, series_key, billing_period_start)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', 'bank_transfer', $11, $12, 'invoice', 'main', $13)
         RETURNING id`,
        [companyId, c.client_id, contractId, num.rows[0].n, c.today, due, subtotal, vatRate, vatAmount, total, note,
         vatRate === 0 ? c.vat_exempt_reason : '', c.period_start],
    );
    await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
         SELECT $1, product_id, description, unit, quantity, unit_price, line_total, position
           FROM contract_items WHERE contract_id = $2 ORDER BY position, id`,
        [inv.rows[0].id, contractId],
    );
    await client.query(`UPDATE contracts SET billing_issued = billing_issued + 1 WHERE id = $1`, [contractId]);

    return {
        company_id: companyId,
        contract_id: contractId,
        invoice_id: inv.rows[0].id,
        invoice_number: num.rows[0].n,
        period_start: c.period_start,
        total_amount: total,
    };
}

/** Emails the generated invoice to the client (if enabled and the client has an email address). */
async function autoSend(g: GeneratedInvoice): Promise<void> {
    try {
        const r = await query<InvoiceMailInfo & { client_email: string }>(
            `SELECT i.doc_type, i.invoice_number, i.issue_date, i.due_date, i.total_amount::float8 AS total_amount, i.status,
                    co.currency, co.name AS company_name, co.email AS company_email, co.iban,
                    COALESCE(cl.name, '') AS client_name, COALESCE(cl.email, '') AS client_email
               FROM invoices i JOIN companies co ON co.id = i.company_id LEFT JOIN clients cl ON cl.id = i.client_id
              WHERE i.id = $1`,
            [g.invoice_id],
        );
        const info = r.rows[0];
        const to = info ? parseRecipients(info.client_email) : null;
        if (!info || !to) return;
        const token = await ensureInvoiceToken(g.invoice_id, g.company_id);
        if (!token) return;
        const sent = await sendInvoiceMail(info, token, to, '');
        if (sent.ok) {
            await query(`UPDATE invoices SET sent_at = now(), sent_to = $2 WHERE id = $1`, [g.invoice_id, to.join(', ').slice(0, 255)]);
        }
    } catch (error) {
        console.error('Automatic sending of recurring invoice', g.invoice_id, error);
    }
}

/**
 * Lightweight variant for the dashboard: generates the company's due invoices, but at most once every 10 minutes
 * per process (so it doesn't query on every page view). Errors never break the page.
 */
const lastRun = new Map<number, number>();
export async function runRecurringBillingLazy(companyId: number): Promise<GeneratedInvoice[]> {
    const now = Date.now();
    if ((lastRun.get(companyId) ?? 0) > now - 10 * 60_000) return [];
    lastRun.set(companyId, now);
    try {
        return await runRecurringBilling(companyId);
    } catch (error) {
        console.error('runRecurringBillingLazy', error);
        return [];
    }
}

/** Forces a run on the next page view (e.g. after a contract is saved). */
export function resetRecurringThrottle(companyId: number): void {
    lastRun.delete(companyId);
}
